"""Core agent orchestration: Strands Agent + OpenRouter + MCP tools, one household session."""

import asyncio
import logging
import time
from typing import Any, AsyncIterator

import httpx
from strands import Agent
from strands.agent.conversation_manager import NullConversationManager
from strands.hooks import HookProvider, HookRegistry
from strands.hooks.events import AfterToolCallEvent, BeforeModelCallEvent, BeforeToolCallEvent
from strands.models.openai import OpenAIModel
from strands.tools.mcp import MCPClient

from .prompts import SYSTEM_PROMPT, event_sentence, with_context
from .store import MemoryKeyValue, Session, SessionStore

logger = logging.getLogger(__name__)

APOLOGY = "Sorry, I didn't catch that. Try again?"
SILENT_TOOLS = ("start_rating", "record_reaction")  # the TV speaks the rating round itself
SPEECH_MAX = 600
SENTINEL = object()


def _tool_name(event: BeforeToolCallEvent | AfterToolCallEvent) -> str:
    return event.selected_tool.tool_name if event.selected_tool else event.tool_use.get("name", "unknown")


class _TurnHook(HookProvider):
    """Collects steps, streams tool events, and enforces the tool-call limit of one turn."""

    def __init__(self, queue: asyncio.Queue, max_tool_calls: int) -> None:
        self.queue = queue
        self.max_tool_calls = max_tool_calls
        self.steps: list[dict[str, Any]] = []
        self.tool_calls = 0
        self.model_calls = 0

    def register_hooks(self, registry: HookRegistry, **kwargs: Any) -> None:
        registry.add_callback(BeforeToolCallEvent, self.on_before_tool)
        registry.add_callback(AfterToolCallEvent, self.on_after_tool)
        registry.add_callback(BeforeModelCallEvent, self.on_before_model)

    def on_before_model(self, event: BeforeModelCallEvent) -> None:
        self.model_calls += 1
        # The model ignored the cancelled tool calls: end the turn with the apology.
        if self.model_calls > self.max_tool_calls + 3:
            event.cancel = APOLOGY

    def on_before_tool(self, event: BeforeToolCallEvent) -> None:
        self.tool_calls += 1
        if self.tool_calls > self.max_tool_calls:
            event.cancel_tool = "Tool limit for this turn reached. Do not call more tools; reply to the family now."
            return
        self.queue.put_nowait({"type": "tool_start", "tool": _tool_name(event), "input": event.tool_use.get("input", {})})

    def on_after_tool(self, event: AfterToolCallEvent) -> None:
        if event.cancel_message:
            return
        name = _tool_name(event)
        ok = event.exception is None and isinstance(event.result, dict) and event.result.get("status") != "error"
        ms = int((event.duration or 0) * 1000)
        self.steps.append({"tool": name, "input": event.tool_use.get("input", {}), "ok": ok, "ms": ms})
        self.queue.put_nowait({"type": "tool_end", "tool": name, "ok": ok, "ms": ms})


def unwrap_nullable(props: dict[str, Any]) -> None:
    """Rewrite `anyOf: [X, null]` properties in place for OpenRouter.

    Its constrained sampler collapses `anyOf: [X, null]` to null, so X is used alone.
    A nullable enum (record_reaction's `reaction`, where null means skip) keeps null as one more
    enum value, so the model can still choose it.
    """
    for key, val in props.items():
        if isinstance(val, dict) and "anyOf" in val:
            non_null = [s for s in val["anyOf"] if isinstance(s, dict) and s.get("type") != "null"]
            if not non_null:
                continue
            title = val.get("title", key)
            if "enum" in non_null[0]:
                props[key] = {"enum": [*non_null[0]["enum"], None], "title": title}
                if "default" in val:
                    props[key]["default"] = val["default"]
            else:
                props[key] = {**non_null[0], "title": title, "default": None}


def reply_text(message: dict | None) -> str:
    if not isinstance(message, dict):
        return ""
    return "".join(c["text"] for c in message.get("content", []) if isinstance(c, dict) and "text" in c).strip()


def drop_empty_replies(messages: list[dict]) -> list[dict]:
    """Remove assistant messages with no text and no tool call (silent rating turns).

    Chat Completions rejects or misreads an assistant message without content on the next turn.
    """
    def empty(msg: dict) -> bool:
        blocks = [b for b in msg.get("content", []) if isinstance(b, dict)]
        return msg.get("role") == "assistant" and not any(
            "toolUse" in b or (isinstance(b.get("text"), str) and b["text"].strip()) for b in blocks)
    return [m for m in messages if not empty(m)]


def should_speak(reply: str, steps: list[dict]) -> bool:
    """Speak every non-empty reply except in rating turns (the TV speaks those itself)."""
    return bool(reply) and not any(s.get("tool") in SILENT_TOOLS for s in steps)


class AgentServiceError(Exception):
    """Raised when an upstream LLM or MCP failure occurs."""


class PopcornAgentService:
    """Runs one agent turn at a time against the household session."""

    def __init__(
        self,
        api_key: str,
        model_id: str,
        mcp_url: str = "http://127.0.0.1:8000/mcp",
        sessions: SessionStore | None = None,
        turn_timeout: float = 60.0,
        max_tool_calls: int = 12,
        model: Any = None,
        tools: list[Any] | None = None,
        http: httpx.AsyncClient | None = None,
    ) -> None:
        self.model_id = model_id
        self.mcp_url = mcp_url
        self.sessions = sessions or SessionStore(MemoryKeyValue(), "demo")
        self.turn_timeout = turn_timeout
        self.max_tool_calls = max_tool_calls
        self.model = model or OpenAIModel(
            client_args={"base_url": "https://openrouter.ai/api/v1", "api_key": api_key},
            model_id=model_id,
            # Same key for every turn of the household: OpenAI-style providers route cache reads on it.
            params={"temperature": 0.0, "prompt_cache_key": f"popcorn-{self.sessions.household}"},
        )
        self.mcp_client = MCPClient(url=mcp_url) if tools is None else None
        # The MCP server also serves the TV routes next to /mcp.
        self.api_base = mcp_url.rstrip("/").removesuffix("/mcp")
        self._tools_cache: list[Any] | None = tools
        self._http = http
        self._lock = asyncio.Lock()

    # ---------- MCP + TV ----------

    def _get_tools(self) -> list[Any]:
        """MCP tools with `anyOf: [X, null]` unwrapped for OpenRouter."""
        if self._tools_cache is not None:
            return self._tools_cache
        try:
            self.mcp_client.start()
            tools = self.mcp_client.list_tools_sync()
            for t in tools:
                unwrap_nullable(t.tool_spec.get("inputSchema", {}).get("json", {}).get("properties", {}))
            self._tools_cache = tools
            return tools
        except Exception as exc:
            logger.warning("Could not list or normalize MCP tools: %s", exc)
            return [self.mcp_client]

    async def _request(self, method: str, path: str, **kwargs: Any) -> httpx.Response:
        if self._http is not None:
            return await self._http.request(method, self.api_base + path, **kwargs)
        async with httpx.AsyncClient(timeout=10) as http:
            return await http.request(method, self.api_base + path, **kwargs)

    async def tv_state(self) -> dict | None:
        """GET /api/state, or None. Never fails the turn."""
        try:
            return (await self._request("GET", "/api/state", timeout=3)).raise_for_status().json()
        except Exception as exc:  # noqa: BLE001 - the turn still works without it
            logger.warning("Could not read the TV state: %r", exc)
            return None

    async def speak(self, reply: str, steps: list[dict], failed: bool) -> None:
        """Speak the reply on the TV (or the apology), and leave the voice state idle. Never raises."""
        try:
            if failed:
                (await self._request("POST", "/api/speech", json={"text": APOLOGY})).raise_for_status()
            elif should_speak(reply, steps):
                (await self._request("POST", "/api/speech", json={"text": reply[:SPEECH_MAX]})).raise_for_status()
            else:
                (await self._request("POST", "/api/voice", json={"state": "idle"})).raise_for_status()
        except Exception as exc:  # noqa: BLE001 - /chat still answers
            logger.warning("Could not post the speech to the TV: %r", exc)
            try:
                await self._request("POST", "/api/voice", json={"state": "idle"}, timeout=3)
            except Exception:  # noqa: BLE001
                pass

    def shutdown(self) -> None:
        if self.mcp_client is None:
            return
        try:
            self.mcp_client.stop(None, None, None)
        except Exception as exc:
            logger.warning("Error stopping MCPClient: %s", exc)

    # ---------- sessions ----------

    async def new_session(self) -> str:
        async with self._lock:
            return (await self.sessions.new()).id

    async def _load(self, conversation_id: str | None) -> tuple[Session, bool]:
        """(session, is the household session)."""
        household = await self.sessions.load()
        if conversation_id is None or conversation_id == household.id:
            return household, True
        return await self.sessions.load(conversation_id), False

    # ---------- turns ----------

    async def turn(
        self,
        text: str,
        speaker: str | None = None,
        conversation_id: str | None = None,
        is_event: bool = False,
    ) -> AsyncIterator[dict[str, Any]]:
        """One turn as events: start, tool_start, tool_end, text, then done (with steps) or error."""
        t0 = time.perf_counter()
        cleaned = (text or "").strip()
        if not cleaned:
            yield {"type": "error", "error": "text is required"}
            return
        async with self._lock:
            session, household = await self._load(conversation_id)
            yield {"type": "start", "conversation_id": session.id}
            state = await self.tv_state()
            prompt = with_context(cleaned, None if is_event else speaker, state)

            queue: asyncio.Queue[Any] = asyncio.Queue()
            hook = _TurnHook(queue, self.max_tool_calls)
            outcome: dict[str, Any] = {}

            async def run() -> None:
                try:
                    agent = Agent(
                        model=self.model,
                        tools=self._get_tools(),
                        messages=list(session.messages),
                        system_prompt=SYSTEM_PROMPT,
                        hooks=[hook],
                        callback_handler=None,
                        conversation_manager=NullConversationManager(),
                    )
                    async for event in agent.stream_async(prompt):
                        if event.get("data"):
                            queue.put_nowait({"type": "text", "delta": event["data"]})
                        elif "result" in event:
                            outcome["reply"] = reply_text(getattr(event["result"], "message", None))
                    outcome["messages"] = agent.messages
                except Exception as exc:  # noqa: BLE001 - reported as the turn error
                    outcome["error"] = exc
                finally:
                    queue.put_nowait(SENTINEL)

            task = asyncio.create_task(run())
            deadline = time.monotonic() + self.turn_timeout
            timed_out = False
            while True:
                try:
                    item = await asyncio.wait_for(queue.get(), timeout=max(0.01, deadline - time.monotonic()))
                except TimeoutError:
                    timed_out = True
                    task.cancel()
                    break
                if item is SENTINEL:
                    break
                yield item
            try:
                await task
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass

            failed = timed_out or "error" in outcome or "messages" not in outcome
            reply = "" if failed else outcome.get("reply", "")
            if not failed:
                session.messages = drop_empty_replies(outcome["messages"])
                couch = {m["name"] for m in (state or {}).get("members", []) or [] if isinstance(m, dict) and m.get("name")} if state else None
                try:
                    await self.sessions.save(session, household_session=household, couch=couch)
                except Exception as exc:  # noqa: BLE001 - the reply still goes out
                    logger.warning("Could not save the session: %r", exc)
            await self.speak(reply, hook.steps, failed)

            ms_total = int((time.perf_counter() - t0) * 1000)
            if failed:
                if timed_out:
                    logger.error("Turn timed out after %.0f s", self.turn_timeout)
                else:
                    logger.error("Agent turn failed: %r", outcome.get("error"))
                yield {"type": "error", "error": "Failed to process conversation with language model.",
                       "steps": hook.steps, "ms_total": ms_total}
                return
            yield {"type": "done", "reply": reply, "conversation_id": session.id,
                   "ms_total": ms_total, "steps": hook.steps}

    async def chat(
        self,
        text: str,
        speaker: str | None = None,
        conversation_id: str | None = None,
        is_event: bool = False,
    ) -> dict[str, Any]:
        """Non-streaming turn: `{conversation_id, reply, steps, ms_total}`."""
        if not (text or "").strip():
            raise ValueError("text is required")
        async for event in self.turn(text, speaker, conversation_id, is_event):
            if event["type"] == "done":
                return {"conversation_id": event["conversation_id"], "reply": event["reply"],
                        "steps": event["steps"], "ms_total": event["ms_total"]}
            if event["type"] == "error":
                raise AgentServiceError(event["error"])
        raise AgentServiceError("Failed to process conversation with language model.")

    async def event(self, event: str, name: str | None = None, skipped: bool = False) -> dict[str, Any]:
        """A TV event as one turn (`[event] <sentence>`) on the household session."""
        return await self.chat(event_sentence(event, name, skipped), is_event=True)

    async def chat_stream(
        self,
        text: str,
        speaker: str | None = None,
        conversation_id: str | None = None,
    ) -> AsyncIterator[dict[str, Any]]:
        """Streaming turn with the event shapes of the API contract."""
        async for event in self.turn(text, speaker, conversation_id):
            if event["type"] == "done":
                event = {k: event[k] for k in ("type", "reply", "conversation_id", "ms_total")}
            elif event["type"] == "error":
                event = {"type": "error", "error": event["error"]}
            yield event
