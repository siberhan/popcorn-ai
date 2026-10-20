"""Popcorn AI MCP server (stateless Streamable HTTP) plus a small JSON API for the TV app.

Run locally:  uv run popcorn-mcp       (MCP endpoint: http://127.0.0.1:8000/mcp; POPCORN_PORT=8010 for another port)
"""

import functools
import io
import os
from pathlib import Path
from typing import Literal

import segno
import uvicorn
from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.types import ToolAnnotations
from pydantic import BaseModel, Field
from starlette.applications import Starlette
from starlette.middleware.cors import CORSMiddleware
from starlette.requests import Request
from starlette.responses import FileResponse, JSONResponse, Response

from .config import load_settings
from .llm import LLMError, OpenRouterLLM
from .voice_stt import MAX_BYTES, OpenRouterSTT, TranscribeError
from .voice_tts import OpenRouterTTS
from .service import REACTIONS, SCREENS_BACK, UNSET, VOICE_STATES, Popcorn, PopcornError, Reaction
from .store import DynamoStore, MemoryStore
from .tmdb import TMDB, TMDBError

STATIC = Path(__file__).parent / "static"
AUDIO_TYPES = {"wav": "audio/wav", "mp3": "audio/mpeg"}

INSTRUCTIONS = """\
Popcorn AI keeps the profile of everyone in the household and puts tonight's film on their TV.
1. Who is watching? -> set_couch, or add_to_couch / remove_from_couch. A person is a name and an age.
2. A new person picks genres on the TV (save_genres); they then pick their favorite films.
3. Show picks -> recommend: ten films for everyone on the couch, with one spoken line each. `request` is
   what they feel like tonight, if they said.
4. Watch: get_movie_details. Back from the film -> start_rating; every answer is saved with record_reaction.
Every tool that changes the TV screen updates it right away.
"""

READ_ONLY = ToolAnnotations(read_only_hint=True, open_world_hint=False)
UPDATES_TV = ToolAnnotations(read_only_hint=False, destructive_hint=False, open_world_hint=False)
PHONE_FILES = {"index.html": "text/html; charset=utf-8", "app.js": "text/javascript; charset=utf-8",
               "styles.css": "text/css; charset=utf-8"}


class Person(BaseModel):
    name: str = Field(description="The name as said.")
    age: int | None = Field(default=None, description="Age in years, if known. Under 13 = child.")


def _user_errors(func):
    """Turn expected problems into messages the caller can read out."""

    @functools.wraps(func)
    async def wrapper(*args, **kwargs):
        try:
            return await func(*args, **kwargs)
        except PopcornError as exc:
            raise ToolError(str(exc)) from exc
        except LLMError as exc:
            raise ToolError(str(exc)) from exc
        except TMDBError as exc:
            raise ToolError("The movie database is not answering right now. Try again in a moment.") from exc

    return wrapper


def build_service() -> Popcorn:
    settings = load_settings()
    store = DynamoStore(settings.table_name, settings.region) if settings.table_name else MemoryStore()
    speaker = (OpenRouterTTS(settings.openrouter_api_key, settings.tts_model, settings.tts_voice)
               if settings.openrouter_api_key else None)
    llm = (OpenRouterLLM(settings.openrouter_api_key, settings.rec_model)
           if settings.openrouter_api_key else None)
    return Popcorn(store, TMDB(settings.tmdb_token, store), settings.household, settings.watch_region, speaker, llm)


def build_mcp(popcorn: Popcorn) -> MCPServer:
    mcp = MCPServer(name="popcorn-ai", title="Popcorn AI", instructions=INSTRUCTIONS, version="0.3.0")

    @mcp.tool(annotations=UPDATES_TV)
    @_user_errors
    async def set_couch(people: list[Person]) -> dict:
        """Set who is on the couch tonight (replaces the couch). Unknown people get a new profile and go to the
        genre screen first. Returns each person as the TV sees them."""
        return await popcorn.set_couch([p.model_dump() for p in people])

    @mcp.tool(annotations=UPDATES_TV)
    @_user_errors
    async def add_to_couch(name: str, age: int | None = None) -> dict:
        """Add one person to the couch; a new person goes to the genre screen, a known one back to the couch."""
        return await popcorn.add_to_couch(name, age)

    @mcp.tool(annotations=UPDATES_TV)
    @_user_errors
    async def remove_from_couch(name: str) -> dict:
        """Remove one person from the couch (they stay in the household)."""
        return await popcorn.remove_from_couch(name)

    @mcp.tool(annotations=READ_ONLY)
    @_user_errors
    async def get_profiles(names: list[str] | None = None) -> dict:
        """Genres, favorite films and reviews for the given people, or for everyone in the household if no names
        are given. Also says who is on the couch right now."""
        state = await popcorn.tv_state()
        return {"profiles": await popcorn.get_profiles(names), "on_couch": [m["name"] for m in state["members"]]}

    @mcp.tool(annotations=UPDATES_TV)
    @_user_errors
    async def rename_person(name: str, new_name: str) -> dict:
        """Fix a misheard name."""
        return await popcorn.rename_person(name, new_name)

    @mcp.tool(annotations=UPDATES_TV)
    @_user_errors
    async def save_genres(name: str, genres: list[str]) -> dict:
        """Save the TMDB genres a person picked (names like "Comedy", "Science Fiction", "Mystery").
        A person who has not finished favorites gets the page opened in the same request."""
        return await popcorn.save_genres(name, genres)

    @mcp.tool(annotations=UPDATES_TV)
    @_user_errors
    async def recommend(more: bool = False, request: str | None = None) -> dict:
        """Ten films for everyone on the couch, each with one spoken spoiler-free `why` line: screen
        `recommendations`. more=true asks again without the films already shown this evening. `request`:
        what they feel like tonight ("" for nothing; left out keeps tonight's)."""
        return await popcorn.recommend(more, request)

    @mcp.tool(annotations=UPDATES_TV)
    @_user_errors
    async def get_movie_details(movie: str, show_on_tv: bool = True) -> dict:
        """Details for one movie (title or TMDB id): plot, runtime, rating, cast, where to watch, and whether it is
        OK for this couch. show_on_tv=false to just answer a question."""
        return await popcorn.get_movie_details(movie, show_on_tv)

    @mcp.tool(annotations=UPDATES_TV)
    @_user_errors
    async def start_rating(movie: str | None = None) -> dict:
        """The family is back from the film: the TV asks each person in turn.
        movie: only if they name a different film; by default the one they went to watch."""
        return await popcorn.start_rating(movie)

    @mcp.tool(annotations=UPDATES_TV)
    @_user_errors
    async def record_reaction(name: str, reaction: Reaction | None, summary: str = "") -> dict:
        """Save one person's answer during the rating. reaction null = they skipped or passed.
        summary: their opinion in one short line (max 15 words) when it came from speaking.
        Answering again overwrites. The TV speaks the next question itself."""
        return await popcorn.record_reaction(name, reaction, summary, "voice")

    return mcp


def add_tv_routes(mcp: MCPServer, popcorn: Popcorn, transcriber: OpenRouterSTT | None = None) -> None:
    """Plain JSON endpoints for the TV app: poll the screen state, send D-pad actions."""

    async def handle(call) -> JSONResponse:
        try:
            return JSONResponse(await call())
        except PopcornError as exc:
            return JSONResponse({"error": str(exc)}, status_code=400)
        except LLMError as exc:
            return JSONResponse({"error": str(exc)}, status_code=502)
        except TMDBError:
            return JSONResponse({"error": "The movie database is not answering right now."}, status_code=503)

    async def body_of(request: Request) -> dict | None:
        try:
            body = await request.json()
        except ValueError:
            return None
        return body if isinstance(body, dict) else None

    def bad(message: str) -> JSONResponse:
        return JSONResponse({"error": message}, status_code=400)

    def movie_id_of(body: dict | None) -> int | None:
        value = (body or {}).get("movie_id")
        return value if isinstance(value, int) and not isinstance(value, bool) and value > 0 else None

    @mcp.custom_route("/health", methods=["GET"])
    async def health(request: Request) -> JSONResponse:
        return JSONResponse({"ok": True})

    @mcp.custom_route("/events", methods=["POST"])
    async def events(request: Request) -> JSONResponse:
        """Non-HTTP Lambda events: Lambda Web Adapter POSTs them here (AWS_LWA_PASS_THROUGH_PATH)."""
        if await body_of(request) != {"popcorn": "seed_catalog"}:
            return bad('send {"popcorn": "seed_catalog"}')
        return await handle(popcorn.seed_catalog)

    @mcp.custom_route("/static/backdrop-blob.png", methods=["GET"])
    async def backdrop_blob(request: Request) -> FileResponse:
        # Vega cannot load images bundled from the shared UI package, so the TV fetches this one over HTTPS.
        return FileResponse(STATIC / "backdrop-blob.png", media_type="image/png", headers={"Cache-Control": "public, max-age=86400"})

    @mcp.custom_route("/api/state", methods=["GET"])
    async def state(request: Request) -> JSONResponse:
        return await handle(popcorn.tv_state)

    @mcp.custom_route("/api/genres", methods=["GET"])
    async def genres(request: Request) -> JSONResponse:
        return await handle(popcorn.genres_list)

    @mcp.custom_route("/api/couch", methods=["POST"])
    async def couch(request: Request) -> JSONResponse:
        """Add or remove one person. A new person comes back on screen `genres`."""
        body = await body_of(request) or {}
        if isinstance(body.get("add"), str) and body["add"].strip():
            age = body.get("age")
            if age is not None and (not isinstance(age, int) or isinstance(age, bool)):
                return bad("age must be a whole number")
            return await handle(lambda: popcorn.add_to_couch(body["add"], age))
        if isinstance(body.get("remove"), str) and body["remove"].strip():
            return await handle(lambda: popcorn.remove_from_couch(body["remove"]))
        return JSONResponse({"error": "send {'add': name, 'age'?: n} or {'remove': name}"}, status_code=400)

    @mcp.custom_route("/api/person", methods=["POST"])
    async def person(request: Request) -> JSONResponse:
        """Save a person's genres (and start their favorites when never done), or edit name/age, or delete."""
        body = await body_of(request) or {}
        if isinstance(body.get("delete"), str) and body["delete"].strip():
            return await handle(lambda: popcorn.delete_person(body["delete"]))
        if isinstance(body.get("edit"), str) and body["edit"].strip():
            new_name, age = body.get("name"), body.get("age", UNSET)
            if new_name is not None and not isinstance(new_name, str):
                return bad("name must be a string")
            if age is not UNSET and age is not None and (not isinstance(age, int) or isinstance(age, bool)):
                return bad("age must be a whole number or null")
            return await handle(lambda: popcorn.edit_person(body["edit"], new_name, age))
        name, genres = body.get("name"), body.get("genres")
        if isinstance(name, str) and name.strip() and isinstance(genres, list):
            if not all(isinstance(g, str) and g.strip() for g in genres):
                return bad("genres must be a list of genre names")
            return await handle(lambda: popcorn.save_genres(name, genres))
        return bad("send {'name': s, 'genres': [s]} or {'edit': name, 'name'?: s, 'age'?: n|null} or {'delete': name}")

    @mcp.custom_route("/api/favorites/catalog", methods=["GET"])
    async def favorites_catalog(request: Request) -> JSONResponse:
        return await handle(popcorn.get_favorites_catalog)

    @mcp.custom_route("/api/favorites", methods=["POST"])
    async def favorites(request: Request) -> JSONResponse:
        body = await body_of(request) or {}
        if "start" in body:
            start = body["start"]
            if not isinstance(start, str) or not start.strip():
                return bad("send {'start': name}")
            return await handle(lambda: popcorn.start_favorites(start))
        if "toggle" in body:
            toggle = body["toggle"]
            if not isinstance(toggle, int) or isinstance(toggle, bool):
                return bad("toggle must be an integer id")
            return await handle(lambda: popcorn.toggle_favorite(toggle))
        if "query" in body:
            query = body["query"]
            if not isinstance(query, str):
                return bad("query must be a string")
            return await handle(lambda: popcorn.query_favorites(query))
        if "done" in body:
            if body["done"] is not True:
                return bad("done must be true")
            return await handle(popcorn.done_favorites)
        return bad("send {'start': name}, {'toggle': id}, {'query': s} or {'done': true}")

    @mcp.custom_route("/api/ask", methods=["POST"])
    async def ask(request: Request) -> JSONResponse:
        """No text: open the "what do you feel like tonight?" screen. With text: check it, then the picks."""
        text = (await body_of(request) or {}).get("text")
        if text is None:
            return await handle(popcorn.open_ask)
        if not isinstance(text, str):
            return bad("text must be a string")
        return await handle(lambda: popcorn.ask(text))

    @mcp.custom_route("/api/recommend", methods=["POST"])
    async def recommend(request: Request) -> JSONResponse:
        """Tonight's picks: one LLM call, ten kid-checked cards on the reel. more=true leaves out this evening's.
        `request` sets tonight's wish without the check ("" = Skip); left out keeps it."""
        body = await body_of(request) or {}
        more, wish = body.get("more", False), body.get("request")
        if not isinstance(more, bool):
            return bad("more must be true or false")
        if not isinstance(wish, (str, type(None))):
            return bad("request must be a string")
        return await handle(lambda: popcorn.recommend(more, wish))

    @mcp.custom_route("/api/voice", methods=["POST"])
    async def voice(request: Request) -> JSONResponse:
        body = await body_of(request) or {}
        text, speaker = body.get("text"), body.get("speaker")
        if body.get("state") not in VOICE_STATES or not isinstance(text, (str, type(None))) \
                or not isinstance(speaker, (str, type(None))):
            return bad(f"send {{'state': one of {', '.join(VOICE_STATES)}, 'text'?: s, 'speaker'?: s}}")
        return await handle(lambda: popcorn.set_voice(body["state"], text, speaker))

    @mcp.custom_route("/api/voice/{name}", methods=["GET"])
    async def voice_audio(request: Request) -> Response:
        sha, _, ext = request.path_params["name"].rpartition(".")
        audio = await popcorn.voice_audio(sha) if ext in AUDIO_TYPES else None
        if audio is None:
            return JSONResponse({"error": "not found"}, status_code=404)
        return Response(audio, media_type=AUDIO_TYPES[ext], headers={"Cache-Control": "public, max-age=86400"})

    @mcp.custom_route("/api/transcribe", methods=["POST"])
    async def transcribe(request: Request) -> JSONResponse:
        """Raw audio body (the phone's recording) -> {"text"}. Silence or noise gives an empty text."""
        if transcriber is None:
            return JSONResponse({"error": "Speech recognition is not set up on this server."}, status_code=502)
        length = request.headers.get("content-length")
        if length and length.isdigit() and int(length) > MAX_BYTES:
            return bad("That recording is too long. Keep it under 30 seconds.")
        audio = await request.body()
        if len(audio) > MAX_BYTES:
            return bad("That recording is too long. Keep it under 30 seconds.")
        try:
            text = await transcriber.transcribe(audio, request.headers.get("content-type", "audio/webm"))
        except TranscribeError as exc:
            return JSONResponse({"error": str(exc)}, status_code=502)
        return JSONResponse({"text": text})

    @mcp.custom_route("/api/qr.png", methods=["GET"])
    async def qr(request: Request) -> Response:
        url = request.query_params.get("url", "")
        if not url.startswith(("http://", "https://")) or len(url) > 300:
            return bad("send ?url=<http(s) URL, max 300 chars>")
        png = io.BytesIO()
        segno.make(url, error="m").save(png, kind="png", scale=10, border=2, dark="#000000", light="#ffffff")
        return Response(png.getvalue(), media_type="image/png", headers={"Cache-Control": "public, max-age=86400"})

    @mcp.custom_route("/phone/", methods=["GET"])
    async def phone_index(request: Request) -> Response:
        return phone_file("index.html")

    @mcp.custom_route("/phone/{file}", methods=["GET"])
    async def phone_asset(request: Request) -> Response:
        return phone_file(request.path_params["file"])

    def phone_file(name: str) -> Response:
        path = STATIC / "phone" / name
        if name not in PHONE_FILES or not path.is_file():
            return JSONResponse({"error": "not found"}, status_code=404)
        return FileResponse(path, media_type=PHONE_FILES[name], headers={"Cache-Control": "no-cache"})

    @mcp.custom_route("/api/details", methods=["POST"])
    async def details(request: Request) -> JSONResponse:
        if (movie_id := movie_id_of(await body_of(request))) is None:
            return bad("send {'movie_id': n}")
        return await handle(lambda: popcorn.open_details(movie_id))

    @mcp.custom_route("/api/screen", methods=["POST"])
    async def screen(request: Request) -> JSONResponse:
        body = await body_of(request) or {}
        if body.get("screen") not in SCREENS_BACK:
            return bad("screen must be 'recommendations', 'ask' or 'couch'")
        return await handle(lambda: popcorn.go_to(body["screen"]))

    @mcp.custom_route("/api/focus", methods=["POST"])
    async def focus(request: Request) -> JSONResponse:
        if (movie_id := movie_id_of(await body_of(request))) is None:
            return bad("send {'movie_id': n}")
        return await handle(lambda: popcorn.set_focus(movie_id))

    @mcp.custom_route("/api/watch", methods=["POST"])
    async def watch(request: Request) -> JSONResponse:
        body = await body_of(request)
        provider = (body or {}).get("provider")
        if (movie_id := movie_id_of(body)) is None or not isinstance(provider, str) or not provider.strip():
            return bad("send {'movie_id': n, 'provider': name}")
        return await handle(lambda: popcorn.start_watching(movie_id, provider))

    @mcp.custom_route("/api/rating/start", methods=["POST"])
    async def rating_start(request: Request) -> JSONResponse:
        return await handle(popcorn.start_rating)

    @mcp.custom_route("/api/rating/answer", methods=["POST"])
    async def rating_answer(request: Request) -> JSONResponse:
        body = await body_of(request) or {}
        name, reaction = body.get("name"), body.get("reaction")
        if not isinstance(name, str) or not name.strip() or reaction not in REACTIONS:
            return bad(f"send {{'name': s, 'reaction': one of {', '.join(REACTIONS)}}}")
        return await handle(lambda: popcorn.record_reaction(name, reaction, "", "hand"))

    @mcp.custom_route("/api/rating/voice", methods=["POST"])
    async def rating_voice(request: Request) -> JSONResponse:
        """A spoken answer from the phone: the LLM saves a reaction and a one-line summary."""
        body = await body_of(request) or {}
        text, name = body.get("text"), body.get("name")
        if not isinstance(text, str) or not text.strip():
            return bad("I didn't catch that, try again or use the buttons")
        if name is not None and (not isinstance(name, str) or not name.strip()):
            return bad("name must be a non-empty string")
        return await handle(lambda: popcorn.voice_reaction(text, name))

    @mcp.custom_route("/api/rating/skip", methods=["POST"])
    async def rating_skip(request: Request) -> JSONResponse:
        body = await body_of(request) or {}
        name = body.get("name")
        if name is not None and (not isinstance(name, str) or not name.strip()):
            return bad("name must be a non-empty string")
        return await handle(lambda: popcorn.skip_turn(name))

    @mcp.custom_route("/api/rating/live", methods=["POST"])
    async def rating_live(request: Request) -> JSONResponse:
        body = await body_of(request)
        if body is None or not isinstance(body.get("text"), str):
            return bad("send {'text': s}")
        return await handle(lambda: popcorn.set_live(body["text"]))

    @mcp.custom_route("/api/rating/finish", methods=["POST"])
    async def rating_finish(request: Request) -> JSONResponse:
        return await handle(popcorn.finish_rating)


def create_app(popcorn: Popcorn | None = None, host: str = "127.0.0.1", transcriber: OpenRouterSTT | None = None) -> Starlette:
    if popcorn is None:
        popcorn = build_service()
        settings = load_settings()
        key = settings.openrouter_api_key
        transcriber = transcriber or (OpenRouterSTT(key, settings.stt_model) if key else None)
    mcp = build_mcp(popcorn)
    add_tv_routes(mcp, popcorn, transcriber)
    # Stateless + JSON responses: every request stands alone, which suits Lambda.
    app = mcp.streamable_http_app(stateless_http=True, json_response=True, host=host)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
        allow_headers=["*"],
        expose_headers=["Mcp-Session-Id"],
    )
    return app


def main() -> None:
    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("POPCORN_PORT") or os.environ.get("PORT") or "8000")
    uvicorn.run(create_app(host=host), host=host, port=port)
