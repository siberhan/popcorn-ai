"""Fakes for offline tests: a scripted model, fake MCP tools, and a fake MCP HTTP server."""

import json
from typing import Any

import httpx
from strands import tool
from strands.models.model import Model


class ScriptedModel(Model):
    """Plays back scripted responses. Each response: a list of ("text", s) or ("tool", name, input)."""

    def __init__(self, responses: list[list[tuple]]) -> None:
        self.responses = list(responses)
        self.calls: list[dict[str, Any]] = []

    def update_config(self, **model_config: Any) -> None:
        pass

    def get_config(self) -> Any:
        return {}

    async def structured_output(self, output_model, prompt, system_prompt=None, **kwargs):  # pragma: no cover
        raise NotImplementedError
        yield {}

    async def stream(self, messages, tool_specs=None, system_prompt=None, **kwargs):
        self.calls.append({"messages": json.loads(json.dumps(messages, default=str)), "system_prompt": system_prompt})
        parts = self.responses.pop(0) if self.responses else [("text", "ok")]
        yield {"messageStart": {"role": "assistant"}}
        used_tool = False
        for i, part in enumerate(parts):
            if part[0] == "text":
                yield {"contentBlockStart": {"start": {}}}
                yield {"contentBlockDelta": {"delta": {"text": part[1]}}}
                yield {"contentBlockStop": {}}
            else:
                used_tool = True
                yield {"contentBlockStart": {"start": {"toolUse": {"name": part[1], "toolUseId": f"t{len(self.calls)}_{i}"}}}}
                yield {"contentBlockDelta": {"delta": {"toolUse": {"input": json.dumps(part[2])}}}}
                yield {"contentBlockStop": {}}
        yield {"messageStop": {"stopReason": "tool_use" if used_tool else "end_turn"}}


MEMORY = {"name": "Leyla", "named": True, "age": 10, "kid": True, "notes": [], "new": True}


@tool
def set_couch(people: list[dict]) -> dict:
    """Set the couch."""
    return {"ok": True, "memory": [{**MEMORY, "name": p["name"]} for p in people]}


@tool
def find_candidates(genres: list[str] | None = None, exclude_ids: list[int] | None = None) -> dict:
    """Candidate pool."""
    return {"kid_filter": None, "candidates": [{"id": i, "title": f"Film {i}", "overview": "x" * 150} for i in range(40)]}


@tool
def show_picks(picks: list[dict]) -> dict:
    """Show picks."""
    return {"ok": True}


@tool
def start_rating(movie: str | None = None) -> dict:
    """Start rating."""
    return {"ok": True}


@tool
def record_reaction(name: str, reaction: str | None, quote: str = "") -> dict:
    """Record a reaction."""
    return {"ok": True, "done": False}


@tool
def get_profiles(names: list[str] | None = None) -> dict:
    """Profiles."""
    return {"people": [MEMORY]}


TOOLS = [set_couch, find_candidates, show_picks, start_rating, record_reaction, get_profiles]


class FakeMCP:
    """Records TV route calls; `state` is what GET /api/state returns (None -> 503)."""

    def __init__(self, state: dict | None = None, speech_status: int = 200) -> None:
        self.state = state
        self.speech_status = speech_status
        self.posts: list[tuple[str, dict]] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        if request.method == "GET" and request.url.path == "/api/state":
            return httpx.Response(200, json=self.state) if self.state is not None else httpx.Response(503)
        body = json.loads(request.content or b"{}")
        self.posts.append((request.url.path, body))
        if request.url.path == "/api/speech":
            return httpx.Response(self.speech_status, json={"ok": self.speech_status == 200})
        return httpx.Response(200, json={"ok": True})

    def client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(transport=httpx.MockTransport(self.handler))
