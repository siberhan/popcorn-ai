import asyncio

import pytest
from starlette.testclient import TestClient

from popcorn_mcp.server import create_app
from popcorn_mcp.service import Popcorn, PopcornError
from popcorn_mcp.store import MemoryStore
from popcorn_mcp.tmdb import CERT_ORDER

GENRES = {
    28: "Action", 12: "Adventure", 16: "Animation", 35: "Comedy", 80: "Crime", 99: "Documentary",
    18: "Drama", 10751: "Family", 14: "Fantasy", 27: "Horror", 10402: "Music", 9648: "Mystery",
    10749: "Romance", 878: "Science Fiction", 53: "Thriller",
}
# id: (title, genre ids, US certification, vote average)
CATALOG = {
    1: ("Laugh Riot", [35], "PG-13", 7.5),
    2: ("Night Terror", [27, 53], "R", 7.0),
    3: ("Space Kids", [878, 10751, 16], "PG", 7.2),
    4: ("Star War Zone", [878, 28], "PG-13", 7.8),
    5: ("Toon Town", [16, 35, 10751], "G", 7.0),
    6: ("Love Story", [10749, 18], "PG-13", 7.1),
    7: ("Big Heist", [80, 53], "R", 7.3),
    8: ("Hero Hour", [28, 12], "PG-13", 7.4),
    9: ("Fairy Path", [14, 12, 10751], "PG", 7.0),
    10: ("Puzzle Box", [9648, 53], "PG-13", 6.9),
    11: ("Dance Off", [10402, 35], "PG", 6.8),
    12: ("Ocean Life", [99], "G", 7.6),
}


def _result(movie_id):
    title, genre_ids, _, vote = CATALOG[movie_id]
    return {"id": movie_id, "title": title, "genre_ids": genre_ids, "vote_average": vote,
            "release_date": "2024-01-01", "overview": "", "poster_path": f"/{movie_id}.jpg"}


class FakeTMDB:
    async def genres(self):
        return GENRES

    async def discover(self, with_genres=None, without_genres=None, max_certification=None, min_votes=300, page=1):
        if page > 1:
            return []
        wanted = {int(g) for g in with_genres.split("|")} if with_genres else None
        avoid = {int(without_genres)} if without_genres else set()
        out = []
        for movie_id, (_, genre_ids, cert, _) in CATALOG.items():
            if wanted and not wanted & set(genre_ids):
                continue
            if avoid & set(genre_ids):
                continue
            if max_certification and CERT_ORDER.index(cert) > CERT_ORDER.index(max_certification):
                continue
            out.append(_result(movie_id))
        return out

    async def search(self, title):
        return [_result(i) for i, m in CATALOG.items() if title.casefold() in m[0].casefold()]

    async def movie(self, movie_id):
        title, genre_ids, cert, vote = CATALOG[movie_id]
        return {
            "id": movie_id, "title": title, "vote_average": vote, "release_date": "2024-01-01",
            "genres": [{"id": g, "name": GENRES[g]} for g in genre_ids], "poster_path": None,
            "release_dates": {"results": [{"iso_3166_1": "US", "release_dates": [{"certification": cert}]}]},
            "credits": {"cast": [], "crew": []},
        }


def make():
    return Popcorn(MemoryStore(), FakeTMDB(), "test")


def run(coro):
    return asyncio.run(coro)


def test_hated_genre_is_never_recommended():
    async def scenario():
        p = make()
        await p.set_couch([{"name": "Bedirhan"}, {"name": "Ayse"}])
        await p.update_taste("Bedirhan", loves=["thriller"], hates=["horror"])
        await p.update_taste("Ayse", loves=["thrillers"])
        return await p.recommend(limit=10)

    recs = run(scenario())["recommendations"]
    assert recs
    assert all("Horror" not in r["genres"] for r in recs)
    assert recs[0]["title"] in ("Big Heist", "Puzzle Box")


def test_kid_joining_removes_unsafe_movies_live():
    async def scenario():
        p = make()
        await p.set_couch([{"name": "Bedirhan"}])
        await p.update_taste("Bedirhan", loves=["sci-fi", "action"])
        before = await p.recommend()
        after = await p.add_to_couch("Can", age=8)
        state = await p.tv_state()
        return before, after, state

    before, after, state = run(scenario())
    assert "Star War Zone" in [r["title"] for r in before["recommendations"]]
    assert after["kid_filter"] == "PG"
    assert "Star War Zone" in after["removed_from_screen"]
    assert "Space Kids" not in after["removed_from_screen"]
    assert "Space Kids" in [r["title"] for r in after["recommendations"]]  # safe cards stay
    safe = {CATALOG[r["id"]][2] for r in after["recommendations"]}
    assert safe <= {"G", "PG"}
    assert state["screen"] == "recommendations"
    assert [m["name"] for m in state["members"]] == ["Bedirhan", "Can"]


def test_duel_is_kid_safe_when_a_kid_is_on_the_couch():
    async def scenario():
        p = make()
        await p.set_couch([{"name": "Bedirhan"}, {"name": "Can", "age": 8}])
        return (await p.start_duel("Bedirhan"))["duel"]

    duel = run(scenario())
    for side in ("left", "right"):
        assert CATALOG[duel[side]["id"]][2] in {"G", "PG"}


def test_poster_duel_builds_taste():
    async def scenario():
        p = make()
        await p.set_couch([{"name": "Ayse"}])
        started = await p.start_duel("Ayse", rounds=3)
        results = [await p.record_duel_choice("left") for _ in range(3)]
        state = await p.get_state()
        return started, results, state

    started, results, state = run(scenario())
    assert started["duel"]["round"] == 1
    assert [r["done"] for r in results] == [False, False, True]
    assert results[-1]["profile"]["loves"] or results[-1]["profile"]["likes"]
    assert state["screen"] == "couch" and state["duel"] is None
    with pytest.raises(PopcornError):
        run(make().record_duel_choice("left"))


def test_watched_movie_is_not_recommended_again():
    async def scenario():
        p = make()
        await p.set_couch([{"name": "Ayse"}])
        await p.update_taste("Ayse", loves=["comedy"])
        first = await p.recommend()
        top = first["recommendations"][0]["title"]
        saved = await p.mark_watched(top, reactions={"ayse": "loved"})
        again = await p.recommend()
        return top, saved, again

    top, saved, again = run(scenario())
    assert saved["updated"] == [{"name": "Ayse", "reaction": "loved"}]
    assert top not in [r["title"] for r in again["recommendations"]]


def test_empty_couch_is_a_user_error():
    with pytest.raises(PopcornError, match="couch is empty"):
        run(make().recommend())


def test_http_api_and_stateless_mcp():
    with TestClient(create_app(make()), base_url="http://127.0.0.1:8000") as client:
        assert client.post("/api/couch", json={"add": "Ayse"}).status_code == 200
        state = client.get("/api/state").json()
        assert [m["name"] for m in state["members"]] == ["Ayse"]
        assert client.post("/api/duel", json={"pick": "left"}).status_code == 400  # no duel running

        headers = {"Accept": "application/json, text/event-stream", "Content-Type": "application/json"}
        init = client.post("/mcp", headers=headers, json={
            "jsonrpc": "2.0", "id": 1, "method": "initialize",
            "params": {"protocolVersion": "2025-11-25", "capabilities": {},
                       "clientInfo": {"name": "test", "version": "1"}},
        })
        assert init.status_code == 200, init.text
        assert init.json()["result"]["protocolVersion"] == "2025-11-25"

        # Stateless: a later request works without a session id.
        headers["MCP-Protocol-Version"] = "2025-11-25"
        listed = client.post("/mcp", headers=headers, json={"jsonrpc": "2.0", "id": 2, "method": "tools/list"})
        assert listed.status_code == 200, listed.text
        names = {t["name"] for t in listed.json()["result"]["tools"]}
        assert {"set_couch", "recommend_for_couch", "start_duel", "mark_watched"} <= names
