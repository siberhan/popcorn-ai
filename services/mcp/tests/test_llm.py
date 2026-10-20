"""The OpenRouter JSON chat client: the pinned provider, the JSON extraction, and the errors it maps."""

import asyncio
import json

import httpx
import pytest

from popcorn_mcp import llm
from popcorn_mcp.llm import LLMError, OpenRouterLLM, json_object

MESSAGES = [{"role": "system", "content": "answer JSON"}, {"role": "user", "content": "hi"}]


def reply(content, usage=None) -> httpx.Response:
    return httpx.Response(200, json={"choices": [{"message": {"content": content}}],
                                    "usage": usage or {"prompt_tokens": 10, "completion_tokens": 3, "cost": 0.00012}})


def test_json_object_finds_a_fenced_or_buried_object():
    assert json_object('{"a": 1}') == {"a": 1}
    assert json_object('```json\n{"picks": []}\n```') == {"picks": []}
    assert json_object('```\n{"picks": [{"title": "Up"}]}\n```') == {"picks": [{"title": "Up"}]}
    assert json_object('Sure! {"picks": [{"title": "Up"}]} hope that helps') == {"picks": [{"title": "Up"}]}
    assert json_object('{"a": {"b": 2}}') == {"a": {"b": 2}}
    assert json_object('prefix {"broken": } then {"ok": 1}') == {"ok": 1}
    assert json_object("no json here") is None
    assert json_object("[1, 2]") is None  # an array is not an object
    assert json_object("") is None
    assert json_object(None) is None


def test_json_chat_sends_the_cerebras_pin_reasoning_and_usage(caplog):
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["path"], seen["auth"] = request.url.path, request.headers["authorization"]
        seen["body"] = json.loads(request.content)
        return reply('```json\n{"picks": []}\n```')

    client = OpenRouterLLM("secret-key", transport=httpx.MockTransport(handler))
    with caplog.at_level("INFO"):
        result = asyncio.run(client.json_chat(MESSAGES, temperature=0.2, effort="low"))
    assert result == {"picks": []}
    assert seen["path"] == "/api/v1/chat/completions" and seen["auth"] == "Bearer secret-key"
    assert seen["body"] == {
        "model": "openai/gpt-oss-120b:nitro",  # the default model
        "messages": MESSAGES,
        "provider": {"only": ["cerebras/fp16"], "allow_fallbacks": False},
        "reasoning": {"effort": "low"},
        "temperature": 0.2,
        "usage": {"include": True},
    }
    assert "10 in / 3 out / $0.000120" in caplog.text  # the cost of every call is logged
    assert "secret-key" not in caplog.text


def test_json_chat_uses_the_configured_model_and_a_twenty_second_timeout():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["body"] = json.loads(request.content)
        return reply('{"ok": true}')

    client = OpenRouterLLM("k", "vendor/other-model", transport=httpx.MockTransport(handler))
    assert client.model == "vendor/other-model"
    assert asyncio.run(client.json_chat(MESSAGES)) == {"ok": True}
    assert seen["body"]["model"] == "vendor/other-model"
    assert seen["body"]["temperature"] == 0.5 and seen["body"]["reasoning"] == {"effort": "low"}
    assert llm.TIMEOUT == 20


def test_json_chat_returns_none_when_the_reply_has_no_json():
    client = OpenRouterLLM("k", transport=httpx.MockTransport(lambda request: reply("I cannot help with that.")))
    assert asyncio.run(client.json_chat(MESSAGES)) is None
    empty = OpenRouterLLM("k", transport=httpx.MockTransport(lambda request: httpx.Response(200, json={"choices": []})))
    assert asyncio.run(empty.json_chat(MESSAGES)) is None


@pytest.mark.parametrize("answer", [httpx.Response(500, json={"error": "boom"}), httpx.Response(429),
                                    httpx.Response(200, content=b"not json")])
def test_json_chat_turns_bad_answers_into_llm_error(answer):
    client = OpenRouterLLM("k", transport=httpx.MockTransport(lambda request: answer))
    with pytest.raises(LLMError):
        asyncio.run(client.json_chat(MESSAGES))


@pytest.mark.parametrize("error", [httpx.ConnectError("no route"), httpx.ReadTimeout("too slow")])
def test_json_chat_turns_network_errors_into_llm_error(error):
    def handler(request: httpx.Request) -> httpx.Response:
        raise error

    client = OpenRouterLLM("k", transport=httpx.MockTransport(handler))
    with pytest.raises(LLMError, match="isn't answering"):
        asyncio.run(client.json_chat(MESSAGES))
