"""Tests for conversation memory store."""

import time
from popcorn_agent.store import InMemoryConversationStore


def test_create_id():
    store = InMemoryConversationStore()
    cid1 = store.create_id()
    cid2 = store.create_id()
    assert cid1.startswith("c_")
    assert cid2.startswith("c_")
    assert cid1 != cid2


def test_save_and_retrieve_messages():
    store = InMemoryConversationStore()
    cid = store.create_id()
    messages = [
        {"role": "user", "content": [{"text": "Hello"}]},
        {"role": "assistant", "content": [{"text": "Hi there"}]},
    ]
    store.save_messages(cid, messages)
    retrieved = store.get_messages(cid)
    assert len(retrieved) == 2
    assert retrieved[0]["role"] == "user"
    assert retrieved[1]["content"][0]["text"] == "Hi there"


def test_message_capping():
    max_msgs = 5
    store = InMemoryConversationStore(max_messages=max_msgs)
    cid = store.create_id()
    messages = [{"role": "user", "index": i} for i in range(10)]
    store.save_messages(cid, messages)
    retrieved = store.get_messages(cid)
    assert len(retrieved) == max_msgs
    # Verify it kept the LAST 5 messages
    assert [m["index"] for m in retrieved] == [5, 6, 7, 8, 9]


def test_idle_ttl_expiration(monkeypatch):
    current_time = 1000.0
    monkeypatch.setattr(time, "time", lambda: current_time)

    store = InMemoryConversationStore(ttl_seconds=60)
    cid = store.create_id()
    store.save_messages(cid, [{"role": "user", "text": "test"}])

    assert len(store.get_messages(cid)) == 1

    # Advance time beyond TTL
    current_time = 1065.0
    assert store.get_messages(cid) == []


def test_tool_pair_safe_truncation_24_messages():
    """Verify that a 24-message history containing tool pairs cuts cleanly at a user text message."""
    store = InMemoryConversationStore(max_messages=20)
    cid = store.create_id()

    messages = [
        # Turn 0: plain turn (2 messages, idx 0..1)
        {"role": "user", "content": [{"text": "Turn 0 prompt"}]},
        {"role": "assistant", "content": [{"text": "Turn 0 reply"}]},
        # Turn 1: tool turn (4 messages, idx 2..5)
        {"role": "user", "content": [{"text": "Turn 1 prompt"}]},
        {"role": "assistant", "content": [{"toolUse": {"name": "tool1", "toolUseId": "call_1", "input": {}}}]},
        {"role": "user", "content": [{"toolResult": {"toolUseId": "call_1", "status": "success"}}]},
        {"role": "assistant", "content": [{"text": "Turn 1 final answer"}]},
    ]
    # Add 4 more tool turns (each 4 messages) -> 2 + 4 + 16 = 22, plus 2 more = 24 messages
    for i in range(2, 6):
        messages.extend([
            {"role": "user", "content": [{"text": f"Turn {i} prompt"}]},
            {"role": "assistant", "content": [{"toolUse": {"name": f"tool{i}", "toolUseId": f"call_{i}", "input": {}}}]},
            {"role": "user", "content": [{"toolResult": {"toolUseId": f"call_{i}", "status": "success"}}]},
            {"role": "assistant", "content": [{"text": f"Turn {i} final answer"}]},
        ])
    # Add final plain turn (2 messages) to reach 24 total messages
    messages.extend([
        {"role": "user", "content": [{"text": "Final user query"}]},
        {"role": "assistant", "content": [{"text": "Final assistant reply"}]},
    ])

    assert len(messages) == 24

    # With max_messages=20, a naive messages[-20:] starts at index 4 (which is a user toolResult!)
    assert "toolResult" in messages[-20]["content"][0]

    store.save_messages(cid, messages)
    saved = store.get_messages(cid)

    # Saved history must start with a plain user text message
    assert len(saved) < 20
    first_msg = saved[0]
    assert first_msg["role"] == "user"
    assert "text" in first_msg["content"][0]
    assert not any("toolResult" in block for block in first_msg["content"])
    assert first_msg["content"][0]["text"] == "Turn 2 prompt"

