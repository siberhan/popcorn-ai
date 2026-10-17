"""Conversation storage interface and in-memory implementation."""

import time
import uuid
from typing import Protocol


class ConversationStore(Protocol):
    """Interface for conversation history storage."""

    def get_messages(self, conversation_id: str) -> list[dict]:
        """Retrieve stored messages for a conversation. Returns empty list if expired or unknown."""
        ...

    def save_messages(self, conversation_id: str, messages: list[dict]) -> None:
        """Save updated messages for a conversation, capped and with updated active timestamp."""
        ...

    def create_id(self) -> str:
        """Create a new unique conversation ID."""
        ...


def _is_plain_user_message(msg: dict) -> bool:
    """Check if message is a user prompt with no toolResult blocks."""
    if not isinstance(msg, dict) or msg.get("role") != "user":
        return False
    content = msg.get("content", [])
    if isinstance(content, list):
        for block in content:
            if isinstance(block, dict) and "toolResult" in block:
                return False
    elif isinstance(content, dict) and "toolResult" in content:
        return False
    return True


class InMemoryConversationStore:
    """In-memory conversation store with idle expiry and message capping."""

    def __init__(self, max_messages: int = 20, ttl_seconds: int = 1800):
        self.max_messages = max_messages
        self.ttl_seconds = ttl_seconds
        # Mapping: conversation_id -> {"last_active": float, "messages": list[dict]}
        self._conversations: dict[str, dict] = {}

    def create_id(self) -> str:
        """Generate a random prefixed conversation id like 'c_8f3a9b1c'."""
        return f"c_{uuid.uuid4().hex[:12]}"

    def _cleanup_expired(self, now: float) -> None:
        expired = [
            cid
            for cid, data in self._conversations.items()
            if (now - data["last_active"]) > self.ttl_seconds
        ]
        for cid in expired:
            self._conversations.pop(cid, None)

    def get_messages(self, conversation_id: str) -> list[dict]:
        now = time.time()
        self._cleanup_expired(now)
        data = self._conversations.get(conversation_id)
        if not data:
            return []
        if (now - data["last_active"]) > self.ttl_seconds:
            self._conversations.pop(conversation_id, None)
            return []
        data["last_active"] = now
        return list(data["messages"])

    def save_messages(self, conversation_id: str, messages: list[dict]) -> None:
        now = time.time()
        self._cleanup_expired(now)
        # Cap at the last max_messages
        capped = messages[-self.max_messages :] if len(messages) > self.max_messages else list(messages)
        # If capped history had to be sliced, ensure the first message is a plain user prompt
        if len(messages) > self.max_messages:
            while capped and not _is_plain_user_message(capped[0]):
                capped.pop(0)
        self._conversations[conversation_id] = {
            "last_active": now,
            "messages": capped,
        }

