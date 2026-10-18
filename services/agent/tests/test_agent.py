"""Turn tests with a scripted model, fake MCP tools and a fake MCP HTTP server (no network)."""

import asyncio

import pytest

from popcorn_agent.agent import APOLOGY, AgentServiceError, PopcornAgentService, unwrap_nullable
from popcorn_agent.prompts import SYSTEM_PROMPT
from popcorn_agent.store import MemoryKeyValue, SessionStore

from .fakes import TOOLS, FakeMCP, ScriptedModel

COUCH_STATE = {"screen": "couch", "members": [{"name": "Ahmet"}, {"name": "Leyla"}]}
RATING_STATE = {"screen": "rating", "members": [{"name": "Ahmet"}],
                "rating": {"asking": "Leyla", "people": ["Ahmet", "Leyla"], "done": False}}


def make(responses, state=COUCH_STATE, speech_status=200, **kwargs):
    mcp = FakeMCP(state, speech_status)
    model = ScriptedModel(responses)
    sessions = SessionStore(MemoryKeyValue(), "test")
    service = PopcornAgentService(api_key="k", model_id="m", mcp_url="http://mcp.test/mcp", sessions=sessions,
                                  model=model, tools=TOOLS, http=mcp.client(), **kwargs)
    return service, model, mcp, sessions


def run(coro):
    return asyncio.run(coro)


def user_texts(call):
    return [b["text"] for m in call["messages"] if m["role"] == "user" for b in m["content"] if "text" in b]


def test_session_is_reused_across_turns_and_system_prompt_is_static():
    service, model, mcp, _ = make([[("text", "Hi Ahmet.")], [("text", "Sure.")]])
    first = run(service.chat("hello", speaker="Ahmet"))
    second = run(service.chat("and Leyla?", speaker="Ahmet"))
    assert first["conversation_id"] == second["conversation_id"]
    assert first["conversation_id"].startswith("s_")
    assert user_texts(model.calls[1])[0].endswith("hello")  # history came back
    assert model.calls[0]["system_prompt"] == model.calls[1]["system_prompt"] == SYSTEM_PROMPT


def test_per_turn_context_line_in_front_of_the_text():
    service, model, _, _ = make([[("text", "ok")]], state=RATING_STATE)
    run(service.chat("loved it", speaker="Leyla"))
    assert user_texts(model.calls[0])[-1] == (
        "[speaker: Leyla] [tv: screen=rating, asking=Leyla, people=Ahmet,Leyla]\nloved it")


def test_turn_works_when_the_tv_state_is_down():
    service, model, mcp, _ = make([[("text", "Hello there.")]], state=None)
    result = run(service.chat("hi"))
    assert result["reply"] == "Hello there."
    assert user_texts(model.calls[0])[-1] == "hi"
    assert mcp.posts == [("/api/speech", {"text": "Hello there."})]


def test_session_new_starts_fresh():
    service, model, _, _ = make([[("text", "a")], [("text", "b")]])
    first = run(service.chat("one"))
    new_id = run(service.new_session())
    second = run(service.chat("two"))
    assert new_id != first["conversation_id"] and second["conversation_id"] == new_id
    assert len(user_texts(model.calls[1])) == 1


def test_idle_session_resets(monkeypatch):
    service, model, _, sessions = make([[("text", "a")], [("text", "b")]])
    first = run(service.chat("one"))
    doc = run(sessions.kv.get("test:session"))
    doc["last_active"] -= 3 * 3600 + 1
    run(sessions.kv.put("test:session", doc))
    second = run(service.chat("two"))
    assert second["conversation_id"] != first["conversation_id"]
    assert len(user_texts(model.calls[1])) == 1


def test_speech_posted_after_a_normal_turn_with_tools():
    service, _, mcp, _ = make([
        [("tool", "set_couch", {"people": [{"name": "Ahmet"}]})],
        [("text", "Got it, Ahmet is on the couch.")],
    ])
    result = run(service.chat("it's me", speaker="Ahmet"))
    assert [s["tool"] for s in result["steps"]] == ["set_couch"] and result["steps"][0]["ok"]
    assert mcp.posts == [("/api/speech", {"text": "Got it, Ahmet is on the couch."})]


def test_rating_turn_is_not_spoken_but_voice_goes_idle():
    service, _, mcp, _ = make([
        [("tool", "record_reaction", {"name": "Leyla", "reaction": "loved", "quote": "loved it"})],
        [("text", "Loved it, noted.")],
    ], state=RATING_STATE)
    run(service.chat("loved it", speaker="Leyla"))
    assert mcp.posts == [("/api/voice", {"state": "idle"})]


def test_empty_reply_is_not_spoken():
    service, _, mcp, _ = make([[("tool", "start_rating", {})], []])
    result = run(service.chat("we are back"))
    assert result["reply"] == ""
    assert mcp.posts == [("/api/voice", {"state": "idle"})]


def test_speech_failure_does_not_fail_chat():
    service, _, mcp, _ = make([[("text", "Hello.")]], speech_status=500)
    result = run(service.chat("hi"))
    assert result["reply"] == "Hello."
    assert mcp.posts == [("/api/speech", {"text": "Hello."}), ("/api/voice", {"state": "idle"})]


def test_failed_turn_speaks_the_apology_and_keeps_the_session():
    class Broken(ScriptedModel):
        async def stream(self, *args, **kwargs):
            raise RuntimeError("upstream down")
            yield {}

    service, model, mcp, sessions = make([[("text", "first")]])
    first = run(service.chat("one"))
    service.model = Broken([])
    with pytest.raises(AgentServiceError):
        run(service.chat("two"))
    assert mcp.posts[-1] == ("/api/speech", {"text": APOLOGY})
    doc = run(sessions.kv.get("test:session"))
    assert doc["id"] == first["conversation_id"] and len(doc["messages"]) == 2


def test_turn_timeout():
    class Slow(ScriptedModel):
        async def stream(self, *args, **kwargs):
            await asyncio.sleep(5)
            yield {}

    service, _, mcp, _ = make([], turn_timeout=0.2)
    service.model = Slow([])
    with pytest.raises(AgentServiceError):
        run(service.chat("hi"))
    assert mcp.posts == [("/api/speech", {"text": APOLOGY})]


def test_tool_call_limit():
    loop = [[("tool", "get_profiles", {})]] * 30
    service, model, _, _ = make(loop, max_tool_calls=3)
    result = run(service.chat("loop"))
    assert len(result["steps"]) == 3
    assert result["reply"] == APOLOGY
    assert len(model.calls) == 6  # 3 + 3 more model calls with cancelled tools, then the cancel


def test_events_use_the_contract_sentences():
    service, model, _, _ = make([[("text", "a")], [("text", "b")], [("text", "c")], [("text", "d")]])
    run(service.event("duel_done", name="Leyla"))
    run(service.event("duel_done", name="Leyla", skipped=True))
    run(service.event("show_picks"))
    run(service.event("app_opened"))
    last = [user_texts(c)[-1].split("\n")[-1] for c in model.calls]
    assert last == ["[event] Leyla finished the poster duel.", "[event] Leyla skipped the poster duel.",
                    "[event] The family pressed Show picks on the TV.", "[event] The family opened Popcorn on the TV."]
    # Events carry the TV context but no speaker.
    assert user_texts(model.calls[0])[-1].startswith("[tv: screen=couch, people=Ahmet,Leyla]\n")


def test_event_validation():
    service, *_ = make([])
    with pytest.raises(ValueError):
        run(service.event("duel_done"))
    with pytest.raises(ValueError):
        run(service.event("dance"))


def test_stream_events_and_shape():
    service, _, mcp, _ = make([[("tool", "set_couch", {"people": [{"name": "Ahmet"}]})], [("text", "Done.")]])

    async def collect():
        return [e async for e in service.chat_stream("me", speaker="Ahmet")]

    events = run(collect())
    types = [e["type"] for e in events]
    assert types[0] == "start" and types[-1] == "done"
    assert "tool_start" in types and "tool_end" in types and "text" in types
    assert set(events[-1]) == {"type", "reply", "conversation_id", "ms_total"}
    assert mcp.posts == [("/api/speech", {"text": "Done."})]


def test_nullable_enum_keeps_null_as_a_choice():
    props = {
        "reaction": {"anyOf": [{"enum": ["loved", "meh"], "type": "string"}, {"type": "null"}], "title": "Reaction"},
        "movie": {"anyOf": [{"type": "string"}, {"type": "null"}], "default": None, "title": "Movie"},
    }
    unwrap_nullable(props)
    assert props["reaction"] == {"enum": ["loved", "meh", None], "title": "Reaction"}
    assert props["movie"] == {"type": "string", "title": "Movie", "default": None}


def test_silent_reply_is_not_stored_as_an_empty_assistant_message():
    service, _, _, sessions = make([[("tool", "start_rating", {})], []])
    run(service.chat("we are back"))
    doc = run(sessions.kv.get("test:session"))
    assert [m["role"] for m in doc["messages"]] == ["user", "assistant", "user"]
