"""Offline tests for Starlette agent service endpoints."""

from unittest.mock import MagicMock
import pytest
from starlette.testclient import TestClient

from popcorn_agent.agent import AgentServiceError
from popcorn_agent.config import Settings
from popcorn_agent.polly import PollyServiceError, PollyValidationError
from popcorn_agent.server import create_app


@pytest.fixture
def test_settings():
    return Settings(
        openrouter_api_key="mock-key",
        openrouter_model="test/mock-model",
        mcp_url="http://127.0.0.1:8000/mcp",
        aws_region="eu-north-1",
        aws_profile="popcorn",
        polly_voice="Brian",
        polly_engine="standard",
        host="127.0.0.1",
        port=8100,
    )


@pytest.fixture
def mock_agent_service():
    service = MagicMock()
    return service


@pytest.fixture
def mock_polly_speaker():
    speaker = MagicMock()
    return speaker


@pytest.fixture
def client(test_settings, mock_agent_service, mock_polly_speaker):
    app = create_app(
        settings=test_settings,
        agent_service=mock_agent_service,
        polly_speaker=mock_polly_speaker,
    )
    return TestClient(app)


def test_health_endpoint(client, test_settings):
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["ok"] is True
    assert data["model"] == test_settings.openrouter_model
    assert data["mcp"] == test_settings.mcp_url
    assert data["voice"] == test_settings.polly_voice


def test_chat_validation_empty_body(client):
    response = client.post("/chat", json={})
    assert response.status_code == 400
    assert "text is required" in response.json()["error"]


def test_chat_validation_whitespace_only(client):
    response = client.post("/chat", json={"text": "   "})
    assert response.status_code == 400
    assert "text is required" in response.json()["error"]


def test_chat_success(client, mock_agent_service):
    async def mock_chat(text, speaker, conversation_id):
        return {
            "conversation_id": conversation_id or "c_test123",
            "reply": "Got it, Bedirhan is on the couch.",
            "steps": [
                {
                    "tool": "set_couch",
                    "input": {"people": [{"name": "Bedirhan"}]},
                    "ok": True,
                    "ms": 120,
                }
            ],
            "ms_total": 520,
        }

    mock_agent_service.chat = mock_chat

    response = client.post(
        "/chat",
        json={"text": "it's me Bedirhan", "speaker": "Bedirhan", "conversation_id": None},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["conversation_id"] == "c_test123"
    assert data["reply"] == "Got it, Bedirhan is on the couch."
    assert len(data["steps"]) == 1
    assert data["steps"][0]["tool"] == "set_couch"
    assert data["steps"][0]["ok"] is True
    assert data["steps"][0]["ms"] == 120
    assert data["ms_total"] == 520


def test_chat_upstream_error(client, mock_agent_service):
    async def mock_chat(text, speaker, conversation_id):
        raise AgentServiceError("Failed to communicate with OpenRouter.")

    mock_agent_service.chat = mock_chat

    response = client.post("/chat", json={"text": "hello"})
    assert response.status_code == 502
    assert "Failed to communicate with OpenRouter." in response.json()["error"]


def test_chat_stream(client, mock_agent_service):
    async def mock_stream(text, speaker, conversation_id):
        yield {"type": "start", "conversation_id": "c_stream456"}
        yield {"type": "tool_start", "tool": "set_couch", "input": {"people": [{"name": "Bedirhan"}]}}
        yield {"type": "tool_end", "tool": "set_couch", "ok": True, "ms": 250}
        yield {"type": "text", "delta": "Hello "}
        yield {"type": "text", "delta": "world."}
        yield {"type": "done", "reply": "Hello world.", "conversation_id": "c_stream456", "ms_total": 680}

    mock_agent_service.chat_stream = mock_stream

    response = client.post("/chat/stream", json={"text": "hi"})
    assert response.status_code == 200
    assert "text/event-stream" in response.headers["content-type"]

    lines = [line.strip() for line in response.text.split("\n") if line.startswith("data: ")]
    assert len(lines) == 6
    assert '"type": "start"' in lines[0]
    assert '"type": "tool_start"' in lines[1]
    assert '"type": "tool_end"' in lines[2]
    assert '"type": "text"' in lines[3]
    assert '"type": "done"' in lines[5]
    assert '"ms_total": 680' in lines[5]


def test_speak_validation(client):
    res_empty = client.post("/speak", json={"text": ""})
    assert res_empty.status_code == 400

    res_long = client.post("/speak", json={"text": "a" * 1501})
    assert res_long.status_code == 400
    assert "exceeds maximum" in res_long.json()["error"]


def test_speak_success(client, mock_polly_speaker):
    mock_polly_speaker.synthesize.return_value = (b"\xff\xfb\x90\x00fake-mp3", "Brian", "standard")
    response = client.post("/speak", json={"text": "Welcome to Popcorn AI"})
    assert response.status_code == 200
    assert response.headers["content-type"] == "audio/mpeg"
    assert response.content == b"\xff\xfb\x90\x00fake-mp3"


def test_speak_polly_error(client, mock_polly_speaker):
    mock_polly_speaker.synthesize.side_effect = PollyServiceError("Polly communication failed.")
    response = client.post("/speak", json={"text": "Hello"})
    assert response.status_code == 502
    assert "Polly communication failed." in response.json()["error"]
