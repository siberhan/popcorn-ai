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
from .voice_stt import MAX_BYTES, OpenRouterSTT, TranscribeError
from .voice_tts import OpenRouterTTS
from .service import REACTION_DELTA, SCREENS_BACK, SPEECH_MAX, VOICE_STATES, Popcorn, PopcornError, Reaction
from .store import DynamoStore, MemoryStore
from .tmdb import TMDB, TMDBError

STATIC = Path(__file__).parent / "static"
AUDIO_TYPES = {"wav": "audio/wav", "mp3": "audio/mpeg"}

INSTRUCTIONS = """\
Popcorn AI helps the people on the couch pick a film and shows everything on their TV.
1. Who is watching? -> set_couch (or add_to_couch / remove_from_couch). Results include each person's memory.
2. New people: duel_candidates(name), then start_duel(name, pairs) with 3-6 contrasting pairs from that list.
   Save what people say about their taste with update_taste (genres and a short note).
3. Picks: find_candidates (filters from what they asked for), choose 4-8 films, then show_picks with one
   spoken, spoiler-free "why" sentence per film. "We've seen X" -> mark_seen.
4. Back from the film -> start_rating; save each spoken answer with record_reaction. The TV asks the questions.
Every tool that changes the TV screen updates it right away.
"""

READ_ONLY = ToolAnnotations(read_only_hint=True, open_world_hint=False)
UPDATES_TV = ToolAnnotations(read_only_hint=False, destructive_hint=False, open_world_hint=False)
PHONE_FILES = {"index.html": "text/html; charset=utf-8", "app.js": "text/javascript; charset=utf-8",
               "styles.css": "text/css; charset=utf-8"}
Gender = Literal["male", "female"]


class Person(BaseModel):
    name: str = Field(description="First name as said, or a label like \"Ahmet's son\" if they won't give a name")
    age: int | None = Field(default=None, description="Age in years, if known. Under 13 = child, under 17 = teen.")
    kid: bool | None = Field(default=None, description="True if a child and the age is unknown.")
    role: str | None = Field(default=None, description="Short family role: 'dad', 'mom', 'older son', 'grandma'.")
    gender: Gender | None = Field(default=None, description="Only if clear from what was said.")
    named: bool | None = Field(default=None, description="False when `name` is a label, not a real name.")


class Pick(BaseModel):
    movie_id: int = Field(description="id from the last find_candidates result")
    why: str = Field(description="One spoken, spoiler-free sentence for the people on the couch, max 220 chars")
    match: int = Field(description="How well it fits this couch, 50-99")


def _user_errors(func):
    """Turn expected problems into messages the agent can read out."""

    @functools.wraps(func)
    async def wrapper(*args, **kwargs):
        try:
            return await func(*args, **kwargs)
        except PopcornError as exc:
            raise ToolError(str(exc)) from exc
        except TMDBError as exc:
            raise ToolError("The movie database is not answering right now. Try again in a moment.") from exc

    return wrapper


def build_service() -> Popcorn:
    settings = load_settings()
    store = DynamoStore(settings.table_name, settings.region) if settings.table_name else MemoryStore()
    speaker = (OpenRouterTTS(settings.openrouter_api_key, settings.tts_model, settings.tts_voice)
               if settings.openrouter_api_key else None)
    return Popcorn(store, TMDB(settings.tmdb_token, store), settings.household, settings.watch_region, speaker)


def build_mcp(popcorn: Popcorn) -> MCPServer:
    mcp = MCPServer(name="popcorn-ai", title="Popcorn AI", instructions=INSTRUCTIONS, version="0.2.0")

    @mcp.tool(annotations=UPDATES_TV)
    @_user_errors
    async def set_couch(people: list[Person]) -> dict:
        """Set who is on the couch tonight (replaces the couch). Unknown people get a new profile.
        Returns each person's memory; use it, it is not repeated anywhere else."""
        return await popcorn.set_couch([p.model_dump() for p in people])

    @mcp.tool(annotations=UPDATES_TV)
    @_user_errors
    async def add_to_couch(name: str, age: int | None = None, kid: bool | None = None, role: str | None = None,
                           gender: Gender | None = None, named: bool | None = None) -> dict:
        """Add one person to the couch; returns their memory. On the reel, films that no longer fit
        (e.g. a child joined) fade out: see removed_from_screen. Args as in set_couch."""
        return await popcorn.add_to_couch(name, age, kid, role, gender, named)

    @mcp.tool(annotations=UPDATES_TV)
    @_user_errors
    async def remove_from_couch(name: str) -> dict:
        """Remove one person from the couch (they stay in the household)."""
        return await popcorn.remove_from_couch(name)

    @mcp.tool(annotations=READ_ONLY)
    @_user_errors
    async def get_profiles(names: list[str] | None = None) -> dict:
        """Memory for the given people, or for everyone in the household if no names are given.
        Also says who is on the couch right now."""
        state = await popcorn.tv_state()
        return {"profiles": await popcorn.get_profiles(names), "on_couch": [m["name"] for m in state["members"]]}

    @mcp.tool(annotations=UPDATES_TV)
    @_user_errors
    async def update_taste(
        name: str,
        loves: list[str] | None = None,
        likes: list[str] | None = None,
        dislikes: list[str] | None = None,
        hates: list[str] | None = None,
        note: str | None = None,
        role: str | None = None,
        gender: Gender | None = None,
        age: int | None = None,
    ) -> dict:
        """Save what someone said about their taste. Genres are names like comedy, sci-fi, animation, horror;
        "hates" = never show it while they are on the couch. note: one short fact in your words (max 140 chars),
        e.g. "Loves superhero films, more so mixed with horror". role/gender/age: update if they told you."""
        return await popcorn.update_taste(name, loves, likes, dislikes, hates, note, role, gender, age)

    @mcp.tool(annotations=UPDATES_TV)
    @_user_errors
    async def rename_person(name: str, new_name: str) -> dict:
        """Give a person saved under a label (e.g. "Ahmet's son") their real name, or fix a misheard name."""
        return await popcorn.rename_person(name, new_name)

    @mcp.tool(annotations=UPDATES_TV)
    @_user_errors
    async def find_candidates(
        genres: list[str] | None = None,
        without_genres: list[str] | None = None,
        keywords: list[str] | None = None,
        without_keywords: list[str] | None = None,
        year_from: int | None = None,
        year_to: int | None = None,
        exclude_ids: list[int] | None = None,
    ) -> dict:
        """Up to 40 films for the couch to choose from: on a streaming service here, kid-safe for this couch,
        nothing anyone on the couch watched or hates. Call before show_picks, and again after feedback.
        genres: any of (TMDB names, e.g. ["Science Fiction"]); leave empty to use the couch's taste.
        keywords: plain words like "superhero", "time travel", "heist". exclude_ids: films to leave out."""
        return await popcorn.find_candidates(genres, without_genres, keywords, without_keywords, year_from, year_to,
                                             exclude_ids)

    @mcp.tool(annotations=UPDATES_TV)
    @_user_errors
    async def show_picks(picks: list[Pick]) -> dict:
        """Show 4-8 films from the last find_candidates list on the TV reel. Each `why` is read aloud on the TV
        when the reel stops on that film, so write it for the people on the couch, by name when it helps."""
        return await popcorn.show_picks([p.model_dump() for p in picks])

    @mcp.tool(annotations=UPDATES_TV)
    @_user_errors
    async def mark_seen(names: list[str], movie_ids: list[int]) -> dict:
        """Save that these people have already seen these films (no rating). Their cards leave the reel.
        names: empty = everyone on the couch."""
        return await popcorn.mark_seen(names, movie_ids)

    @mcp.tool(annotations=UPDATES_TV)
    @_user_errors
    async def duel_candidates(name: str) -> dict:
        """About 50 well-known films for one person's poster duel, across genres, kid-safe for them and the couch.
        Then call start_duel with pairs from this list."""
        return await popcorn.duel_candidates(name)

    @mcp.tool(annotations=UPDATES_TV)
    @_user_errors
    async def start_duel(name: str, pairs: list[list[int]]) -> dict:
        """Start a poster duel on the TV. pairs: 3-6 [left_id, right_id] from that person's last duel_candidates,
        each pair contrasting two tastes, no film twice. They pick with the remote; you hear about it later."""
        return await popcorn.start_duel(name, pairs)

    @mcp.tool(annotations=UPDATES_TV)
    @_user_errors
    async def record_duel_choice(pick: Literal["left", "right", "skip"]) -> dict:
        """Record a duel pick said by voice ("the left one"). skip ends the duel."""
        return await popcorn.record_duel_choice(pick)

    @mcp.tool(annotations=UPDATES_TV)
    @_user_errors
    async def mark_watched(movie: str, reactions: dict[str, Reaction] | None = None, who: list[str] | None = None) -> dict:
        """Quick one-shot save that a movie was watched, with reactions, e.g. {"Ayse": "loved"}.
        movie: a title or TMDB id. who: watchers (default: everyone on the couch). Prefer start_rating."""
        return await popcorn.mark_watched(movie, reactions, who)

    @mcp.tool(annotations=UPDATES_TV)
    @_user_errors
    async def get_movie_details(movie: str, show_on_tv: bool = True) -> dict:
        """Details for one movie (title or TMDB id): plot, runtime, rating, cast, where to watch, and whether it is
        OK for this couch. show_on_tv=false to just answer a question."""
        return await popcorn.get_movie_details(movie, show_on_tv)

    @mcp.tool(annotations=UPDATES_TV)
    @_user_errors
    async def start_rating(movie: str | None = None) -> dict:
        """Call when the family is back from the film. The TV asks each person in turn by voice.
        movie: only if they name a different film; by default the one they went to watch."""
        return await popcorn.start_rating(movie)

    @mcp.tool(annotations=UPDATES_TV)
    @_user_errors
    async def record_reaction(name: str, reaction: Reaction | None, quote: str = "") -> dict:
        """Save one person's spoken answer during the rating. reaction null = they skipped or passed.
        quote: their own words, short. Answering again overwrites. The TV speaks the next question itself."""
        return await popcorn.record_reaction(name, reaction, quote, "voice")

    return mcp


def add_tv_routes(mcp: MCPServer, popcorn: Popcorn, transcriber: OpenRouterSTT | None = None) -> None:
    """Plain JSON endpoints for the TV app: poll the screen state, send D-pad actions."""

    async def handle(call) -> JSONResponse:
        try:
            return JSONResponse(await call())
        except PopcornError as exc:
            return JSONResponse({"error": str(exc)}, status_code=400)
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

    @mcp.custom_route("/static/backdrop-blob.png", methods=["GET"])
    async def backdrop_blob(request: Request) -> FileResponse:
        # Vega cannot load images bundled from the shared UI package, so the TV fetches this one over HTTPS.
        return FileResponse(STATIC / "backdrop-blob.png", media_type="image/png", headers={"Cache-Control": "public, max-age=86400"})

    @mcp.custom_route("/api/state", methods=["GET"])
    async def state(request: Request) -> JSONResponse:
        return await handle(popcorn.tv_state)

    @mcp.custom_route("/api/rating", methods=["GET"])
    async def rating(request: Request) -> JSONResponse:
        """Just the screen and the rating round: one store read, for the voice agent's every turn."""
        async def call():
            state = await popcorn.get_state()
            return {"screen": state["screen"], "rating": state["rating"]}
        return await handle(call)

    @mcp.custom_route("/api/duel", methods=["POST"])
    async def duel(request: Request) -> JSONResponse:
        body = await body_of(request) or {}
        if body.get("pick") not in ("left", "right", "skip"):
            return bad("pick must be 'left', 'right' or 'skip'")
        return await handle(lambda: popcorn.record_duel_choice(body["pick"]))

    @mcp.custom_route("/api/couch", methods=["POST"])
    async def couch(request: Request) -> JSONResponse:
        body = await body_of(request) or {}
        if body.get("add"):
            return await handle(lambda: popcorn.add_to_couch(body["add"], body.get("age"), body.get("kid")))
        if body.get("remove"):
            return await handle(lambda: popcorn.remove_from_couch(body["remove"]))
        return JSONResponse({"error": "send {'add': name} or {'remove': name}"}, status_code=400)

    @mcp.custom_route("/api/recommend", methods=["POST"])
    async def recommend(request: Request) -> JSONResponse:
        # v2: picks come from the agent (POST {AGENT}/event {"event": "show_picks"}).
        return JSONResponse({"error": "Show picks now goes through Popcorn's voice agent."}, status_code=410)

    @mcp.custom_route("/api/seen", methods=["POST"])
    async def seen(request: Request) -> JSONResponse:
        """Details screen "Already seen": watched (no reaction) for the couch, card removed, back to the reel."""
        if (movie_id := movie_id_of(await body_of(request))) is None:
            return bad("send {'movie_id': n}")
        return await handle(lambda: popcorn.mark_seen(None, [movie_id], back_to_reel=True))

    @mcp.custom_route("/api/speech", methods=["POST"])
    async def speech(request: Request) -> JSONResponse:
        body = await body_of(request) or {}
        text = body.get("text")
        if not isinstance(text, str) or not text.strip() or len(text) > SPEECH_MAX:
            return bad(f"send {{'text': s}} with 1 to {SPEECH_MAX} characters")
        return await handle(lambda: popcorn.push_speech(text))

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
            return bad("screen must be 'recommendations' or 'couch'")
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
        if not isinstance(name, str) or not name.strip() or reaction not in REACTION_DELTA:
            return bad(f"send {{'name': s, 'reaction': one of {', '.join(REACTION_DELTA)}}}")
        return await handle(lambda: popcorn.record_reaction(name, reaction, "", "hand"))

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
