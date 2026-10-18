"""The household's running conversation: DynamoDB in the cloud, a dict in tests and local runs.

Same table schema as the MCP server: partition key "pk" (string), "doc" (JSON string),
TTL attribute "expires_at". The session lives at `<household>:session`:
`{"id", "messages", "last_active"}`.
"""

import asyncio
import json
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Protocol

import boto3
from botocore.config import Config

SESSION_TTL = 24 * 3600  # DynamoDB TTL of the session document
IDLE_RESET = 3 * 3600  # idle for longer than this -> a fresh session
MAX_DOC_BYTES = 300_000
LIST_TOOLS = ("find_candidates", "duel_candidates")
OMITTED = "[old list omitted]"
MEMORY_TOOLS = ("set_couch", "add_to_couch", "update_taste", "get_profiles")


class KeyValue(Protocol):
    async def get(self, key: str) -> dict | None: ...

    async def put(self, key: str, doc: dict, ttl_seconds: int | None = None) -> None: ...

    async def delete(self, key: str) -> None: ...


class MemoryKeyValue:
    def __init__(self) -> None:
        self._items: dict[str, tuple[str, float | None]] = {}

    async def get(self, key: str) -> dict | None:
        item = self._items.get(key)
        if item is None:
            return None
        raw, expires_at = item
        if expires_at is not None and expires_at < time.time():
            return None
        return json.loads(raw)

    async def put(self, key: str, doc: dict, ttl_seconds: int | None = None) -> None:
        expires_at = time.time() + ttl_seconds if ttl_seconds else None
        self._items[key] = (json.dumps(doc, default=str), expires_at)

    async def delete(self, key: str) -> None:
        self._items.pop(key, None)


class DynamoKeyValue:
    def __init__(self, table_name: str, region: str) -> None:
        config = Config(retries={"total_max_attempts": 3, "mode": "standard"}, connect_timeout=3, read_timeout=5)
        self._table = boto3.resource("dynamodb", region_name=region, config=config).Table(table_name)

    async def get(self, key: str) -> dict | None:
        response = await asyncio.to_thread(self._table.get_item, Key={"pk": key})
        item = response.get("Item")
        if item is None:
            return None
        # DynamoDB deletes expired items lazily, so check the TTL here too.
        if "expires_at" in item and int(item["expires_at"]) < time.time():
            return None
        return json.loads(item["doc"])

    async def put(self, key: str, doc: dict, ttl_seconds: int | None = None) -> None:
        item: dict[str, Any] = {"pk": key, "doc": json.dumps(doc, ensure_ascii=False, default=str)}
        if ttl_seconds:
            item["expires_at"] = int(time.time()) + ttl_seconds
        await asyncio.to_thread(self._table.put_item, Item=item)

    async def delete(self, key: str) -> None:
        await asyncio.to_thread(self._table.delete_item, Key={"pk": key})


@dataclass
class Session:
    id: str
    messages: list[dict] = field(default_factory=list)
    last_active: float = 0.0

    def to_doc(self) -> dict:
        return {"id": self.id, "messages": self.messages, "last_active": self.last_active}


def new_id() -> str:
    return f"s_{uuid.uuid4().hex[:12]}"


class SessionStore:
    """One running conversation per household, plus optional side conversations by id."""

    def __init__(self, kv: KeyValue, household: str, max_bytes: int = MAX_DOC_BYTES) -> None:
        self.kv = kv
        self.household = household
        self.max_bytes = max_bytes

    def _key(self, conversation_id: str | None) -> str:
        return f"{self.household}:session" + (f":{conversation_id}" if conversation_id else "")

    async def load(self, conversation_id: str | None = None, now: float | None = None) -> Session:
        """The household session (or the one named by `conversation_id`); fresh if missing or idle > 3 h."""
        now = time.time() if now is None else now
        doc = await self.kv.get(self._key(conversation_id))
        if doc and now - float(doc.get("last_active", 0)) <= IDLE_RESET:
            return Session(conversation_id or doc["id"], list(doc.get("messages", [])), float(doc["last_active"]))
        return Session(conversation_id or new_id(), [], now)

    async def new(self, now: float | None = None) -> Session:
        """Start a fresh household session and store it right away."""
        session = Session(new_id(), [], time.time() if now is None else now)
        await self.kv.put(self._key(None), session.to_doc(), SESSION_TTL)
        return session

    async def save(self, session: Session, household_session: bool = True,
                   couch: set[str] | None = None, now: float | None = None) -> None:
        """Trim to the size rule and store with a fresh `last_active`."""
        session.last_active = time.time() if now is None else now
        session.messages = trim(session.messages, self.max_bytes, couch)
        key = self._key(None if household_session else session.id)
        await self.kv.put(key, session.to_doc(), SESSION_TTL)


# ---------- size rule ----------


def doc_size(messages: list[dict]) -> int:
    return len(json.dumps({"id": "s_000000000000", "messages": messages, "last_active": 0.0},
                          ensure_ascii=False, default=str).encode())


def _blocks(msg: dict) -> list[dict]:
    content = msg.get("content", [])
    return [b for b in content if isinstance(b, dict)] if isinstance(content, list) else []


def is_prompt(msg: dict) -> bool:
    """A user message that starts a turn (text, no tool results)."""
    return msg.get("role") == "user" and not any("toolResult" in b for b in _blocks(msg))


def split_turns(messages: list[dict]) -> list[list[dict]]:
    """Group messages into turns; each turn starts at a plain user prompt."""
    turns: list[list[dict]] = []
    for msg in messages:
        if is_prompt(msg) or not turns:
            turns.append([msg])
        else:
            turns[-1].append(msg)
    return turns


def _tool_names(messages: list[dict]) -> dict[str, tuple[str, dict]]:
    """toolUseId -> (tool name, input) for every tool call."""
    out: dict[str, tuple[str, dict]] = {}
    for msg in messages:
        for b in _blocks(msg):
            use = b.get("toolUse")
            if isinstance(use, dict):
                out[use.get("toolUseId", "")] = (use.get("name", ""), use.get("input") or {})
    return out


def _result_json(result: dict) -> Any:
    if "structuredContent" in result:
        return result["structuredContent"]
    for c in result.get("content", []) or []:
        if isinstance(c, dict) and isinstance(c.get("text"), str):
            try:
                return json.loads(c["text"])
            except ValueError:
                continue
    return None


def _memory_names(value: Any) -> set[str]:
    """Names of every person memory (`memory(p)` items) found in a tool result."""
    names: set[str] = set()
    if isinstance(value, dict):
        if isinstance(value.get("name"), str) and ("notes" in value or "loves" in value):
            names.add(value["name"])
        for v in value.values():
            names |= _memory_names(v)
    elif isinstance(value, list):
        for v in value:
            names |= _memory_names(v)
    return names


def couch_from(messages: list[dict]) -> set[str]:
    """Who is on the couch, replayed from the couch tool calls in the history."""
    couch: set[str] = set()
    for name, args in _tool_names(messages).values():
        if name == "set_couch":
            couch = {p.get("name") for p in args.get("people", []) if isinstance(p, dict) and p.get("name")}
        elif name == "add_to_couch" and args.get("name"):
            couch.add(args["name"])
        elif name == "remove_from_couch":
            couch.discard(args.get("name"))
        elif name == "rename_person" and args.get("name") in couch and args.get("new_name"):
            couch.discard(args["name"])
            couch.add(args["new_name"])
    return couch


def _protected_turns(turns: list[list[dict]], couch: set[str]) -> set[int]:
    """Index of the newest turn that loaded each couch member's memory."""
    newest: dict[str, int] = {}
    for i, turn in enumerate(turns):
        calls = _tool_names(turn)
        for msg in turn:
            for b in _blocks(msg):
                res = b.get("toolResult")
                if not isinstance(res, dict) or res.get("status") == "error":
                    continue
                tool = calls.get(res.get("toolUseId", ""), ("", {}))[0]
                if tool in MEMORY_TOOLS:
                    for name in _memory_names(_result_json(res)) & couch:
                        newest[name] = i
    return set(newest.values())


def trim(messages: list[dict], max_bytes: int = MAX_DOC_BYTES, couch: set[str] | None = None) -> list[dict]:
    """Keep the session doc under `max_bytes`.

    First the oldest candidate lists (find_candidates / duel_candidates results) become
    "[old list omitted]", then the oldest whole turns go. The newest turn and the turn that
    loaded a couch member's memory stay.
    """
    if doc_size(messages) <= max_bytes:
        return messages
    turns = split_turns(messages)
    calls = _tool_names(messages)
    for turn in turns[:-1]:
        for msg in turn:
            for b in _blocks(msg):
                res = b.get("toolResult")
                if not isinstance(res, dict) or calls.get(res.get("toolUseId", ""), ("", {}))[0] not in LIST_TOOLS:
                    continue
                if res.get("content") == [{"text": OMITTED}]:
                    continue
                res["content"] = [{"text": OMITTED}]
                res.pop("structuredContent", None)
                if doc_size([m for t in turns for m in t]) <= max_bytes:
                    return [m for t in turns for m in t]
    keep = _protected_turns(turns, couch if couch is not None else couch_from(messages))
    keep.add(len(turns) - 1)
    alive = list(range(len(turns)))
    for i in range(len(turns) - 1):
        if i in keep:
            continue
        alive.remove(i)
        out = [m for j in alive for m in turns[j]]
        if doc_size(out) <= max_bytes:
            return out
    return [m for j in alive for m in turns[j]]
