"""OpenRouter chat with a JSON answer: one small async call, a dict back.

Both the picks and a spoken rating need a JSON object and nothing else, so the reply is parsed here and an
unusable answer becomes None (the caller decides what to tell the person). The provider is pinned to
Cerebras because the fast model runs there; a fallback could silently pick a slower one.
"""

import json
import logging
import re
from typing import Protocol

import httpx

from .voice_tts import BASE

TIMEOUT = 20
DEFAULT_MODEL = "openai/gpt-oss-120b:nitro"
PROVIDER = {"only": ["cerebras/fp16"], "allow_fallbacks": False}
FENCED = re.compile(r"```(?:json)?\s*(.*?)```", re.S)

log = logging.getLogger(__name__)


class LLMError(Exception):
    """The model is unreachable, or did not come up with enough usable films. The route answers 502."""


class LLM(Protocol):
    """One JSON-answering chat model; tests inject a fake."""

    model: str

    async def json_chat(self, messages: list[dict], *, temperature: float = 0.5, effort: str = "low") -> dict | None: ...


def json_object(text: str) -> dict | None:
    """The first JSON object in a reply, with or without a ``` fence, or None."""
    for part in [*FENCED.findall(text or ""), text or ""]:
        start = part.find("{")
        while start >= 0:
            try:
                value, _ = json.JSONDecoder().raw_decode(part[start:])
            except ValueError:
                start = part.find("{", start + 1)
                continue
            return value if isinstance(value, dict) else None
    return None


def _usage(data: dict) -> str:
    usage = data.get("usage") or {}
    cost = usage.get("cost")
    line = f"{usage.get('prompt_tokens', '?')} in / {usage.get('completion_tokens', '?')} out"
    return f"{line} / ${cost:.6f}" if isinstance(cost, (int, float)) else line


class OpenRouterLLM:
    def __init__(self, api_key: str, model: str = DEFAULT_MODEL,
                 transport: httpx.AsyncBaseTransport | None = None) -> None:
        self._key = api_key
        self.model = model
        self._transport = transport

    async def json_chat(self, messages: list[dict], *, temperature: float = 0.5, effort: str = "low") -> dict | None:
        body = {"model": self.model, "messages": messages, "provider": PROVIDER,
                "reasoning": {"effort": effort}, "temperature": temperature, "usage": {"include": True}}
        try:
            async with httpx.AsyncClient(base_url=BASE, headers={"Authorization": f"Bearer {self._key}"},
                                         timeout=TIMEOUT, transport=self._transport) as client:
                response = await client.post("/chat/completions", json=body)
        except httpx.HTTPError as exc:
            log.warning("OpenRouter chat failed: %r", exc)
            raise LLMError("The movie helper isn't answering right now. Try again.") from exc
        if response.status_code >= 400:
            log.warning("OpenRouter chat answered %s", response.status_code)
            raise LLMError("The movie helper isn't answering right now. Try again.")
        try:
            data = response.json()
        except ValueError as exc:
            raise LLMError("The movie helper answered with something I could not read.") from exc
        log.info("chat %s: %s", self.model, _usage(data))
        choices = data.get("choices") or []
        content = (choices[0].get("message") or {}).get("content") if choices else None
        return json_object(str(content or ""))
