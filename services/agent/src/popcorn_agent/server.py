"""Starlette web server implementing the agent service API contract."""

import json
import logging
from contextlib import asynccontextmanager
from typing import AsyncIterator

import uvicorn
from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.middleware.cors import CORSMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response, StreamingResponse
from starlette.routing import Route

from .agent import AgentServiceError, PopcornAgentService
from .config import Settings, load_settings
from .polly import PollyServiceError, PollySpeaker, PollyValidationError
from .store import InMemoryConversationStore

logger = logging.getLogger(__name__)


def create_app(
    settings: Settings | None = None,
    agent_service: PopcornAgentService | None = None,
    polly_speaker: PollySpeaker | None = None,
) -> Starlette:
    """Create and configure the Starlette application."""
    conf = settings or load_settings()
    store = InMemoryConversationStore()

    service = agent_service or PopcornAgentService(
        api_key=conf.openrouter_api_key,
        model_id=conf.openrouter_model,
        mcp_url=conf.mcp_url,
        store=store,
    )

    speaker = polly_speaker or PollySpeaker(
        region=conf.aws_region,
        profile=conf.aws_profile,
        default_voice=conf.polly_voice,
        engine=conf.polly_engine,
    )

    @asynccontextmanager
    async def lifespan(app: Starlette) -> AsyncIterator[None]:
        yield
        service.shutdown()

    async def health(request: Request) -> JSONResponse:
        return JSONResponse(
            {
                "ok": True,
                "model": conf.openrouter_model,
                "mcp": conf.mcp_url,
                "voice": conf.polly_voice,
            }
        )

    async def chat(request: Request) -> JSONResponse:
        try:
            body = await request.json()
        except Exception:
            return JSONResponse({"error": "Invalid JSON body."}, status_code=400)

        if not isinstance(body, dict):
            return JSONResponse({"error": "Request body must be a JSON object."}, status_code=400)

        text = body.get("text")
        if not text or not isinstance(text, str) or not text.strip():
            return JSONResponse({"error": "text is required and must not be empty."}, status_code=400)

        speaker_name = body.get("speaker")
        if speaker_name is not None and not isinstance(speaker_name, str):
            speaker_name = str(speaker_name)

        conversation_id = body.get("conversation_id")
        if conversation_id is not None and not isinstance(conversation_id, str):
            conversation_id = str(conversation_id)

        try:
            result = await service.chat(
                text=text.strip(),
                speaker=speaker_name,
                conversation_id=conversation_id,
            )
            return JSONResponse(result)
        except ValueError as exc:
            return JSONResponse({"error": str(exc)}, status_code=400)
        except AgentServiceError as exc:
            logger.error("Agent error in /chat: %s", exc)
            return JSONResponse({"error": str(exc)}, status_code=502)
        except Exception as exc:
            logger.exception("Unexpected error in /chat: %s", exc)
            return JSONResponse(
                {"error": "An internal error occurred while processing the request."},
                status_code=502,
            )

    async def chat_stream(request: Request) -> Response:
        try:
            body = await request.json()
        except Exception:
            return JSONResponse({"error": "Invalid JSON body."}, status_code=400)

        if not isinstance(body, dict):
            return JSONResponse({"error": "Request body must be a JSON object."}, status_code=400)

        text = body.get("text")
        if not text or not isinstance(text, str) or not text.strip():
            return JSONResponse({"error": "text is required and must not be empty."}, status_code=400)

        speaker_name = body.get("speaker")
        if speaker_name is not None and not isinstance(speaker_name, str):
            speaker_name = str(speaker_name)

        conversation_id = body.get("conversation_id")
        if conversation_id is not None and not isinstance(conversation_id, str):
            conversation_id = str(conversation_id)

        async def sse_event_stream() -> AsyncIterator[str]:
            try:
                async for event in service.chat_stream(
                    text=text.strip(),
                    speaker=speaker_name,
                    conversation_id=conversation_id,
                ):
                    data = json.dumps(event, ensure_ascii=False)
                    yield f"data: {data}\n\n"
            except Exception as exc:
                logger.exception("Unexpected error in SSE stream generator: %s", exc)
                err_data = json.dumps({"type": "error", "error": "An internal streaming error occurred."})
                yield f"data: {err_data}\n\n"

        return StreamingResponse(
            sse_event_stream(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )

    async def speak(request: Request) -> Response:
        try:
            body = await request.json()
        except Exception:
            return JSONResponse({"error": "Invalid JSON body."}, status_code=400)

        if not isinstance(body, dict):
            return JSONResponse({"error": "Request body must be a JSON object."}, status_code=400)

        text = body.get("text")
        if not text or not isinstance(text, str) or not text.strip():
            return JSONResponse({"error": "text is required and must not be empty."}, status_code=400)

        if len(text.strip()) > 1500:
            return JSONResponse(
                {"error": f"text length ({len(text.strip())}) exceeds maximum 1500 characters."},
                status_code=400,
            )

        try:
            audio_bytes, voice_used, engine_used = speaker.synthesize(text.strip())
            return Response(
                content=audio_bytes,
                media_type="audio/mpeg",
                headers={
                    "Content-Disposition": 'inline; filename="speak.mp3"',
                    "X-Polly-Voice": voice_used,
                    "X-Polly-Engine": engine_used,
                },
            )
        except PollyValidationError as exc:
            return JSONResponse({"error": str(exc)}, status_code=400)
        except PollyServiceError as exc:
            logger.error("Polly error in /speak: %s", exc)
            return JSONResponse({"error": str(exc)}, status_code=502)
        except Exception as exc:
            logger.exception("Unexpected error in /speak: %s", exc)
            return JSONResponse(
                {"error": "Failed to synthesize speech."},
                status_code=502,
            )

    routes = [
        Route("/health", health, methods=["GET"]),
        Route("/chat", chat, methods=["POST"]),
        Route("/chat/stream", chat_stream, methods=["POST"]),
        Route("/speak", speak, methods=["POST"]),
    ]

    middleware = [
        Middleware(
            CORSMiddleware,
            allow_origins=["*"],
            allow_methods=["GET", "POST", "OPTIONS"],
            allow_headers=["*"],
        )
    ]

    return Starlette(routes=routes, middleware=middleware, lifespan=lifespan)


def main() -> None:
    settings = load_settings()
    uvicorn.run(
        create_app(settings),
        host=settings.host,
        port=settings.port,
    )
