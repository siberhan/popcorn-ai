"""Tests for the household session store and the size rule."""

import asyncio
import json

from popcorn_agent.store import OMITTED, MemoryKeyValue, SessionStore, couch_from, doc_size, trim


def run(coro):
    return asyncio.run(coro)


def prompt(text):
    return {"role": "user", "content": [{"text": text}]}


def tool_turn(i, tool, result, inp=None, pad=0):
    return [
        prompt(f"turn {i}" + " " * pad),
        {"role": "assistant", "content": [{"toolUse": {"name": tool, "toolUseId": f"u{i}", "input": inp or {}}}]},
        {"role": "user", "content": [{"toolResult": {"toolUseId": f"u{i}", "status": "success",
                                                     "content": [{"text": json.dumps(result)}]}}]},
        {"role": "assistant", "content": [{"text": f"reply {i}"}]},
    ]


def test_load_save_and_idle_reset():
    store = SessionStore(MemoryKeyValue(), "h")
    s = run(store.load(now=1000))
    s.messages = [prompt("hi")]
    run(store.save(s, now=1000))
    again = run(store.load(now=1000 + 3 * 3600))
    assert again.id == s.id and again.messages == [prompt("hi")]
    fresh = run(store.load(now=1001 + 3 * 3600 + 1000))
    assert fresh.id != s.id and fresh.messages == []


def test_new_session_replaces_the_household_one():
    store = SessionStore(MemoryKeyValue(), "h")
    s = run(store.load())
    s.messages = [prompt("hi")]
    run(store.save(s))
    new = run(store.new())
    loaded = run(store.load())
    assert loaded.id == new.id != s.id and loaded.messages == []


def test_under_the_limit_nothing_changes():
    msgs = tool_turn(0, "find_candidates", {"candidates": [1, 2]})
    assert trim(msgs, 10_000) == msgs


def test_old_lists_are_omitted_first_newest_turn_kept():
    big = {"candidates": [{"id": i, "overview": "x" * 150} for i in range(40)]}
    msgs = tool_turn(0, "find_candidates", big) + tool_turn(1, "duel_candidates", big) + tool_turn(2, "find_candidates", big)
    limit = doc_size(msgs) - 1000
    out = trim(msgs, limit)
    texts = [b["toolResult"]["content"][0]["text"] for m in out for b in m["content"] if "toolResult" in b]
    assert texts[0] == OMITTED and texts[1] != OMITTED and texts[2] != OMITTED
    assert len(out) == 12 and doc_size(out) <= limit


def test_then_oldest_turns_go_but_couch_memory_stays():
    memory = {"memory": [{"name": "Leyla", "notes": [], "new": True}]}
    msgs = (tool_turn(0, "set_couch", memory, {"people": [{"name": "Leyla"}]})
            + tool_turn(1, "get_movie_details", {"x": 1}, pad=3000)
            + tool_turn(2, "get_movie_details", {"x": 2}, pad=3000)
            + tool_turn(3, "get_movie_details", {"x": 3}, pad=3000))
    out = trim(msgs, doc_size(msgs) - 5000)
    first_texts = [m["content"][0]["text"].strip() for m in out if m["role"] == "user" and "text" in m["content"][0]]
    assert first_texts == ["turn 0", "turn 3"]
    assert out[0]["role"] == "user" and "text" in out[0]["content"][0]


def test_memory_of_someone_who_left_can_go():
    memory = {"memory": [{"name": "Leyla", "notes": [], "new": True}]}
    msgs = (tool_turn(0, "set_couch", memory, {"people": [{"name": "Leyla"}]}, pad=3000)
            + tool_turn(1, "remove_from_couch", {"ok": True}, {"name": "Leyla"})
            + tool_turn(2, "get_movie_details", {"x": 2}))
    assert couch_from(msgs) == set()
    out = trim(msgs, doc_size(msgs) - 2000)
    assert out[0]["content"][0]["text"] == "turn 1"


def test_dynamo_doc_shape_matches_the_mcp_store():
    kv = MemoryKeyValue()
    store = SessionStore(kv, "h")
    s = run(store.load())
    run(store.save(s))
    doc = run(kv.get("h:session"))
    assert set(doc) == {"id", "messages", "last_active"}
