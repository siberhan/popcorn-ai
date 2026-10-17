"""Core agent orchestration using Strands Agents SDK and MCP client."""

import asyncio
import logging
import time
from dataclasses import dataclass
from typing import Any, AsyncIterator

from strands import Agent
from strands.hooks import HookProvider, HookRegistry
from strands.hooks.events import AfterToolCallEvent, BeforeToolCallEvent
from strands.models.openai import OpenAIModel
from strands.tools.mcp import MCPClient

from .prompts import build_system_prompt
from .store import ConversationStore, InMemoryConversationStore

logger = logging.getLogger(__name__)

SENTINEL = object()


@dataclass
class ChatStep:
    tool: str
    input: dict[str, Any]
    ok: bool
    ms: int

    def to_dict(self) -> dict[str, Any]:
        return {
            "tool": self.tool,
            "input": self.input,
            "ok": self.ok,
            "ms": self.ms,
        }


class _StepCollectorHook(HookProvider):
    """Tracks synchronous/blocking agent tool execution steps."""

    def __init__(self) -> None:
        self.steps: list[dict[str, Any]] = []

    def register_hooks(self, registry: HookRegistry, **kwargs: Any) -> None:
        registry.add_callback(AfterToolCallEvent, self.on_after_tool)

    def on_after_tool(self, event: AfterToolCallEvent) -> None:
        name = event.selected_tool.tool_name if event.selected_tool else event.tool_use.get("name", "unknown")
        inp = event.tool_use.get("input", {})
        ok = (event.exception is None) and (
            isinstance(event.result, dict) and event.result.get("status") != "error"
        )
        ms = int((event.duration or 0) * 1000)
        self.steps.append(ChatStep(tool=name, input=inp, ok=ok, ms=ms).to_dict())


class _QueueStreamingHook(HookProvider):
    """Pushes tool_start and tool_end events into an asyncio.Queue in real time."""

    def __init__(self, queue: asyncio.Queue) -> None:
        self.queue = queue

    def register_hooks(self, registry: HookRegistry, **kwargs: Any) -> None:
        registry.add_callback(BeforeToolCallEvent, self.on_before_tool)
        registry.add_callback(AfterToolCallEvent, self.on_after_tool)

    def on_before_tool(self, event: BeforeToolCallEvent) -> None:
        name = event.selected_tool.tool_name if event.selected_tool else event.tool_use.get("name", "unknown")
        inp = event.tool_use.get("input", {})
        self.queue.put_nowait({"type": "tool_start", "tool": name, "input": inp})

    def on_after_tool(self, event: AfterToolCallEvent) -> None:
        name = event.selected_tool.tool_name if event.selected_tool else event.tool_use.get("name", "unknown")
        ok = (event.exception is None) and (
            isinstance(event.result, dict) and event.result.get("status") != "error"
        )
        ms = int((event.duration or 0) * 1000)
        self.queue.put_nowait({"type": "tool_end", "tool": name, "ok": ok, "ms": ms})


class AgentServiceError(Exception):
    """Raised when an upstream LLM or MCP failure occurs."""


class PopcornAgentService:
    """Manages the Strands Agent instance, OpenRouter model provider, and MCP tools."""

    def __init__(
        self,
        api_key: str,
        model_id: str,
        mcp_url: str = "http://127.0.0.1:8000/mcp",
        store: ConversationStore | None = None,
    ) -> None:
        self.model_id = model_id
        self.mcp_url = mcp_url
        self.store = store or InMemoryConversationStore()

        self.model = OpenAIModel(
            client_args={
                "base_url": "https://openrouter.ai/api/v1",
                "api_key": api_key,
            },
            model_id=model_id,
            params={"temperature": 0.0},
        )
        self.mcp_client = MCPClient(url=mcp_url)
        self._tools_cache: list[Any] | None = None

    def _get_tools(self) -> list[Any]:
        """Return MCP tools with OpenAPI anyOf-null unwrapped for OpenRouter compatibility."""
        if self._tools_cache is not None:
            return self._tools_cache
        try:
            self.mcp_client.start()
            tools = self.mcp_client.list_tools_sync()
            for t in tools:
                props = t.tool_spec.get("inputSchema", {}).get("json", {}).get("properties", {})
                for key, val in props.items():
                    if isinstance(val, dict) and "anyOf" in val:
                        non_null = [s for s in val["anyOf"] if isinstance(s, dict) and s.get("type") != "null"]
                        if non_null:
                            title = val.get("title", key)
                            props[key] = {**non_null[0], "title": title, "default": None}
            self._tools_cache = tools
            return self._tools_cache
        except Exception as exc:
            logger.warning("Could not list or normalize MCP tools: %s", exc)
            return [self.mcp_client]

    def shutdown(self) -> None:
        """Clean up MCP client resources."""
        try:
            self.mcp_client.stop(None, None, None)
        except Exception as exc:
            logger.warning("Error stopping MCPClient: %s", exc)

    async def chat(
        self,
        text: str,
        speaker: str | None = None,
        conversation_id: str | None = None,
    ) -> dict[str, Any]:
        """Non-streaming chat endpoint implementation."""
        t0 = time.perf_counter()
        cleaned_text = (text or "").strip()
        if not cleaned_text:
            raise ValueError("text is required")

        cid = conversation_id or self.store.create_id()
        messages = self.store.get_messages(cid)
        system_prompt = build_system_prompt(speaker)
        collector = _StepCollectorHook()

        try:
            agent = Agent(
                model=self.model,
                tools=self._get_tools(),
                messages=messages,
                system_prompt=system_prompt,
                hooks=[collector],
                callback_handler=None,
            )
            result = await agent.invoke_async(cleaned_text)
            reply = "".join(
                c["text"] for c in result.message.get("content", []) if isinstance(c, dict) and "text" in c
            ).strip()

            self.store.save_messages(cid, agent.messages)
            ms_total = int((time.perf_counter() - t0) * 1000)
            return {
                "conversation_id": cid,
                "reply": reply,
                "steps": collector.steps,
                "ms_total": ms_total,
            }
        except ValueError:
            raise
        except Exception as exc:
            logger.exception("Agent chat failed: %s", exc)
            raise AgentServiceError("Failed to process conversation with language model.") from exc

    async def chat_stream(
        self,
        text: str,
        speaker: str | None = None,
        conversation_id: str | None = None,
    ) -> AsyncIterator[dict[str, Any]]:
        """Streaming chat endpoint implementation (yields event objects)."""
        t0 = time.perf_counter()
        cleaned_text = (text or "").strip()
        if not cleaned_text:
            yield {"type": "error", "error": "text is required"}
            return

        cid = conversation_id or self.store.create_id()
        yield {"type": "start", "conversation_id": cid}

        messages = self.store.get_messages(cid)
        system_prompt = build_system_prompt(speaker)

        queue: asyncio.Queue[Any] = asyncio.Queue()
        stream_hook = _QueueStreamingHook(queue)

        try:
            agent = Agent(
                model=self.model,
                tools=self._get_tools(),
                messages=messages,
                system_prompt=system_prompt,
                hooks=[stream_hook],
                callback_handler=None,
            )
        except Exception as exc:
            logger.exception("Failed to initialize Agent for streaming: %s", exc)
            yield {"type": "error", "error": "Failed to initialize agent service."}
            return

        async def _run_stream() -> None:
            full_reply: list[str] = []
            try:
                async for event in agent.stream_async(cleaned_text):
                    if "data" in event and event["data"]:
                        delta = event["data"]
                        full_reply.append(delta)
                        queue.put_nowait({"type": "text", "delta": delta})
                    elif "result" in event:
                        res = event["result"]
                        # Use generated message content if available
                        if hasattr(res, "message") and isinstance(res.message, dict):
                            reply_text = "".join(
                                c["text"]
                                for c in res.message.get("content", [])
                                if isinstance(c, dict) and "text" in c
                            ).strip()
                        else:
                            reply_text = "".join(full_reply).strip()

                        self.store.save_messages(cid, agent.messages)
                        ms_total = int((time.perf_counter() - t0) * 1000)
                        queue.put_nowait({
                            "type": "done",
                            "reply": reply_text,
                            "conversation_id": cid,
                            "ms_total": ms_total,
                        })
            except Exception as e:
                logger.exception("Streaming error in background agent execution: %s", e)
                queue.put_nowait({"type": "error", "error": "An error occurred while generating the response."})
            finally:
                queue.put_nowait(SENTINEL)

        task = asyncio.create_task(_run_stream())

        while True:
            item = await queue.get()
            if item is SENTINEL:
                break
            yield item

        await task
