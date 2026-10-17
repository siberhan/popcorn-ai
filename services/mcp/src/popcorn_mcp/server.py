"""Popcorn AI MCP server (stateless Streamable HTTP) plus a small JSON API for the TV app.

Run locally:  uv run popcorn-mcp       (MCP endpoint: http://127.0.0.1:8000/mcp)
"""

import functools
import os
from typing import Literal

import uvicorn
from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.types import ToolAnnotations
from pydantic import BaseModel, Field
from starlette.applications import Starlette
from starlette.middleware.cors import CORSMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

from .config import load_settings
from .service import Popcorn, PopcornError, Reaction
from .store import DynamoStore, MemoryStore
from .tmdb import TMDB, TMDBError

INSTRUCTIONS = """\
Popcorn AI picks a movie for the people on the couch tonight and shows it on their TV.
Typical flow:
1. Who is watching? -> set_couch (or add_to_couch / remove_from_couch for changes).
   Give an age for children; kids make every list kid-safe automatically.
2. New people have no taste memory. Start a poster duel on the TV (start_duel) and/or save
   what they say ("I hate horror") with update_taste.
3. Ask for picks with recommend_for_couch. Speak 2-3 titles with their "why" line; the TV shows all.
4. After watching, save reactions with mark_watched so the next pick is better.
Every tool that changes the TV screen updates it right away.
"""

READ_ONLY = ToolAnnotations(read_only_hint=True, open_world_hint=False)
UPDATES_TV = ToolAnnotations(read_only_hint=False, destructive_hint=False, open_world_hint=False)


class Person(BaseModel):
    name: str = Field(description="First name as the user says it, e.g. 'Ayse'")
    age: int | None = Field(default=None, description="Age in years, if known. Under 13 counts as a child.")
    kid: bool | None = Field(default=None, description="True if this person is a child and the age is unknown.")


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
    return Popcorn(store, TMDB(settings.tmdb_token, store), settings.household)


def build_mcp(popcorn: Popcorn) -> MCPServer:
    mcp = MCPServer(name="popcorn-ai", title="Popcorn AI", instructions=INSTRUCTIONS, version="0.1.0")

    @mcp.tool(annotations=UPDATES_TV)
    @_user_errors
    async def set_couch(people: list[Person]) -> dict:
        """Set who is on the couch tonight (replaces the current couch). Unknown people get a new, empty profile."""
        return await popcorn.set_couch([p.model_dump() for p in people])

    @mcp.tool(annotations=UPDATES_TV)
    @_user_errors
    async def add_to_couch(name: str, age: int | None = None, kid: bool | None = None) -> dict:
        """Add one person to the couch. If picks are on screen, they refresh live (a child removes unsafe movies)."""
        return await popcorn.add_to_couch(name, age, kid)

    @mcp.tool(annotations=UPDATES_TV)
    @_user_errors
    async def remove_from_couch(name: str) -> dict:
        """Remove one person from the couch. If picks are on screen, they refresh live."""
        return await popcorn.remove_from_couch(name)

    @mcp.tool(annotations=READ_ONLY)
    @_user_errors
    async def get_profiles(names: list[str] | None = None) -> dict:
        """Taste memory for the given people, or for everyone in the household if no names are given."""
        return {"profiles": await popcorn.get_profiles(names)}

    @mcp.tool(annotations=UPDATES_TV)
    @_user_errors
    async def update_taste(
        name: str,
        loves: list[str] | None = None,
        likes: list[str] | None = None,
        dislikes: list[str] | None = None,
        hates: list[str] | None = None,
        note: str | None = None,
    ) -> dict:
        """Save what someone said about genres, e.g. "I hate horror" -> hates=["horror"].
        Genres are names like comedy, sci-fi, animation, romance, thriller. "hates" means never show it to them."""
        return await popcorn.update_taste(name, loves, likes, dislikes, hates, note)

    @mcp.tool(annotations=UPDATES_TV)
    @_user_errors
    async def start_duel(name: str, rounds: int = 5) -> dict:
        """Start a poster duel on the TV for one person: each round shows two posters, they pick one with the remote.
        Use it for new people. The TV sends the picks; use record_duel_choice only if they say "left" or "right"."""
        return await popcorn.start_duel(name, rounds)

    @mcp.tool(annotations=UPDATES_TV)
    @_user_errors
    async def record_duel_choice(pick: Literal["left", "right"]) -> dict:
        """Record the poster picked in the current duel round, by voice."""
        return await popcorn.record_duel_choice(pick)

    @mcp.tool(annotations=UPDATES_TV)
    @_user_errors
    async def recommend_for_couch(boost_genres: list[str] | None = None, limit: int = 6) -> dict:
        """Recommend movies for everyone on the couch now and show them on the TV.
        Uses everyone's taste memory, skips watched and disliked movies, and is kid-safe when a child is present.
        boost_genres: tonight's mood, e.g. ["comedy"] for "something funny"."""
        return await popcorn.recommend(boost_genres, max(1, min(limit, 10)))

    @mcp.tool(annotations=UPDATES_TV)
    @_user_errors
    async def mark_watched(movie: str, reactions: dict[str, Reaction] | None = None, who: list[str] | None = None) -> dict:
        """Save that a movie was watched and how each person liked it, e.g. reactions={"Ayse": "loved"}.
        movie: a title or TMDB id. who: watchers (default: everyone on the couch)."""
        return await popcorn.mark_watched(movie, reactions, who)

    @mcp.tool(annotations=UPDATES_TV)
    @_user_errors
    async def get_movie_details(movie: str, show_on_tv: bool = True) -> dict:
        """Details for one movie (title or TMDB id): plot, runtime, rating, cast, and whether it is OK for this couch."""
        return await popcorn.get_movie_details(movie, show_on_tv)

    return mcp


def add_tv_routes(mcp: MCPServer, popcorn: Popcorn) -> None:
    """Plain JSON endpoints for the TV app: poll the screen state, send D-pad actions."""

    async def handle(call) -> JSONResponse:
        try:
            return JSONResponse(await call())
        except PopcornError as exc:
            return JSONResponse({"error": str(exc)}, status_code=400)
        except TMDBError:
            return JSONResponse({"error": "The movie database is not answering right now."}, status_code=503)

    @mcp.custom_route("/health", methods=["GET"])
    async def health(request: Request) -> JSONResponse:
        return JSONResponse({"ok": True})

    @mcp.custom_route("/api/state", methods=["GET"])
    async def state(request: Request) -> JSONResponse:
        return await handle(popcorn.tv_state)

    @mcp.custom_route("/api/duel", methods=["POST"])
    async def duel(request: Request) -> JSONResponse:
        body = await request.json()
        if body.get("pick") not in ("left", "right"):
            return JSONResponse({"error": "pick must be 'left' or 'right'"}, status_code=400)
        return await handle(lambda: popcorn.record_duel_choice(body["pick"]))

    @mcp.custom_route("/api/couch", methods=["POST"])
    async def couch(request: Request) -> JSONResponse:
        body = await request.json()
        if body.get("add"):
            return await handle(lambda: popcorn.add_to_couch(body["add"], body.get("age"), body.get("kid")))
        if body.get("remove"):
            return await handle(lambda: popcorn.remove_from_couch(body["remove"]))
        return JSONResponse({"error": "send {'add': name} or {'remove': name}"}, status_code=400)

    @mcp.custom_route("/api/recommend", methods=["POST"])
    async def recommend(request: Request) -> JSONResponse:
        return await handle(popcorn.recommend)


def create_app(popcorn: Popcorn | None = None, host: str = "127.0.0.1") -> Starlette:
    popcorn = popcorn or build_service()
    mcp = build_mcp(popcorn)
    add_tv_routes(mcp, popcorn)
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
    uvicorn.run(create_app(host=host), host=host, port=int(os.environ.get("PORT", "8000")))
