import asyncio

import pytest
from starlette.testclient import TestClient

from popcorn_mcp.server import create_app
from popcorn_mcp.service import Popcorn, PopcornError
from popcorn_mcp.store import MemoryStore
from popcorn_mcp.tmdb import CERT_ORDER, TMDBError, providers_for

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


def _provider(pid, name, priority):
    return {"provider_id": pid, "provider_name": name, "logo_path": f"/l{pid}.png", "display_priority": priority}


# Shape of a real /movie/{id}/watch/providers response (checked live for Rocky, 1366).
PROVIDERS = {"id": 1, "results": {"US": {
    "link": "https://www.themoviedb.org/movie/1/watch?locale=US",
    "rent": [_provider(10, "Amazon Video", 8), _provider(2, "Apple TV Store", 9)],
    "flatrate": [_provider(9, "Amazon Prime Video", 3)],
    "buy": [_provider(10, "Amazon Video", 8), _provider(2, "Apple TV Store", 9), _provider(3, "Google Play Movies", 20),
            _provider(192, "YouTube", 21)],
}}}


def _result(movie_id):
    title, genre_ids, _, vote = CATALOG[movie_id]
    return {"id": movie_id, "title": title, "genre_ids": genre_ids, "vote_average": vote, "vote_count": 1000 + movie_id,
            "popularity": 100 - movie_id, "release_date": "2024-01-01", "overview": "", "poster_path": f"/{movie_id}.jpg"}


# Films the fake discover returns whatever the certification filter says (TMDB lets a few through).
LEAKY = {13}
CATALOG[13] = ("Leaky Slasher", [16, 27], "R", 6.5)
KEYWORDS = {"superhero": 9715, "heist": 10051}
MOVIE_KEYWORDS = {8: {9715}, 4: {9715}, 7: {10051}}


class FakeTMDB:
    def __init__(self):
        self.calls = []

    async def genres(self):
        return GENRES

    async def discover(self, with_genres=None, without_genres=None, max_certification=None, min_votes=300, page=1,
                       sort_by="popularity.desc", with_keywords=None, without_keywords=None, year_from=None,
                       year_to=None, watch_region=None, monetization=None):
        self.calls.append({"with_genres": with_genres, "without_genres": without_genres, "cert": max_certification,
                           "min_votes": min_votes, "page": page, "sort_by": sort_by, "with_keywords": with_keywords,
                           "watch_region": watch_region, "monetization": monetization})
        if page > 1:
            return []
        wanted = {int(g) for g in with_genres.split("|")} if with_genres else None
        avoid = {int(g) for g in without_genres.split(",")} if without_genres else set()
        keywords = {int(k) for k in with_keywords.split("|")} if with_keywords else None
        out = []
        for movie_id, (_, genre_ids, cert, _) in CATALOG.items():
            if wanted and not wanted & set(genre_ids):
                continue
            if avoid & set(genre_ids):
                continue
            if keywords and not keywords & MOVIE_KEYWORDS.get(movie_id, set()):
                continue
            if max_certification and movie_id not in LEAKY and CERT_ORDER.index(cert) > CERT_ORDER.index(max_certification):
                continue
            out.append(_result(movie_id))
        return out

    async def keyword_id(self, word):
        return KEYWORDS.get(word.casefold())

    async def search(self, title):
        return [_result(i) for i, m in CATALOG.items() if title.casefold() in m[0].casefold()]

    async def movie(self, movie_id):
        title, genre_ids, cert, vote = CATALOG[movie_id]
        return {
            "id": movie_id, "title": title, "vote_average": vote, "release_date": "2024-01-01",
            "genres": [{"id": g, "name": GENRES[g]} for g in genre_ids], "poster_path": None,
            "release_dates": {"results": [{"iso_3166_1": "US", "release_dates": [{"certification": cert}]}]},
            "credits": {"cast": [], "crew": []}, "backdrop_path": f"/b{movie_id}.jpg", "overview": "A film.",
        }

    async def certification(self, movie_id):
        return CATALOG[movie_id][2]

    async def watch_providers(self, movie_id):
        if movie_id == 2:
            raise TMDBError("TMDB request failed")
        return PROVIDERS


class FakePolly:
    voice, engine, ext = "autumn", "orpheus", "wav"

    def __init__(self, fail=False):
        self.texts, self.fail = [], fail

    async def synthesize(self, text):
        if self.fail:
            raise RuntimeError("tts down")
        self.texts.append(text)
        return b"ID3" + text.encode()


def make(polly=None):
    return Popcorn(MemoryStore(), FakeTMDB(), "test", speaker=polly)


async def put_picks(p, ids=(1, 4, 5, 8), **find):
    """find_candidates then show_picks for these ids (they must be in the pool)."""
    pool = await p.find_candidates(**find)
    return pool, await p.show_picks([{"movie_id": i, "why": f"why {i}", "match": 80} for i in ids])


def run(coro):
    return asyncio.run(coro)


def test_pool_is_streaming_only_kid_safe_and_excludes_seen_and_vetoed():
    async def scenario():
        p = make()
        await p.set_couch([{"name": "Bedirhan"}, {"name": "Can", "age": 10}])
        await p.update_taste("Bedirhan", loves=["sci-fi"], hates=["comedy"])
        await p.mark_seen(["Can"], [3])
        pool = await p.find_candidates(exclude_ids=[9])
        return p, pool, await p.get_state()

    p, pool, state = run(scenario())
    ids = [c["id"] for c in pool["candidates"]]
    assert pool["kid_filter"] == "PG"
    assert 13 not in ids  # discover leaked an R film; the code check drops it
    assert 3 not in ids and 9 not in ids  # Can saw Space Kids; excluded by id
    assert all("Comedy" not in c["genres"] for c in pool["candidates"])  # Bedirhan's veto
    assert all(CATALOG[i][2] in ("G", "PG") for i in ids) and ids
    assert set(pool["candidates"][0]) == {"id", "title", "year", "genres", "rating", "votes", "overview"}
    assert state["pool"] == {"ids": ids, "kid_filter": "PG", "genres": []}
    calls = p._tmdb.calls
    assert all(c["watch_region"] == "US" and c["monetization"] == "flatrate" and c["min_votes"] == 150 for c in calls)
    assert "878" in [c["with_genres"] for c in calls] and None in [c["with_genres"] for c in calls]  # top genre + open


def test_pool_genres_and_keywords():
    async def scenario():
        p = make()
        await p.set_couch([{"name": "Ayse"}])
        return await p.find_candidates(genres=["action"], keywords=["superhero", "zzz"])

    pool = run(scenario())
    assert {c["title"] for c in pool["candidates"]} == {"Star War Zone", "Hero Hour"}
    assert pool["unknown_keywords"] == ["zzz"]
    with pytest.raises(PopcornError, match="couch is empty"):
        run(make().find_candidates())


def test_show_picks_checks_ids_and_builds_cards_with_audio():
    async def scenario():
        polly = FakePolly()
        p = make(polly)
        await p.set_couch([{"name": "Ayse"}])
        await p.find_candidates()
        with pytest.raises(PopcornError, match="Movie id 999 is not in the last find_candidates"):
            await p.show_picks([{"movie_id": i, "why": "x", "match": 70} for i in (1, 4, 5, 999)])
        with pytest.raises(PopcornError, match="4 to 8"):
            await p.show_picks([{"movie_id": 1, "why": "x", "match": 70}])
        shown = await p.show_picks([{"movie_id": 1, "why": "  Ayse, a  quick laugh. ", "match": 120},
                                    {"movie_id": 4, "why": "w" * 300, "match": 10},
                                    {"movie_id": 5, "why": "c", "match": 77}, {"movie_id": 8, "why": "d", "match": 60}])
        return shown, await p.get_state(), polly

    shown, state, polly = run(scenario())
    cards = state["recommendations"]
    assert state["screen"] == "recommendations" and len(cards) == 4 and shown["shown"][0] == "Laugh Riot (2024)"
    assert cards[0]["why"] == "Ayse, a quick laugh." and cards[0]["match"] == 99 and cards[1]["match"] == 50
    assert len(cards[1]["why"]) <= 220
    assert all(c["why_audio"].startswith("/api/voice/") and c["why_audio"].endswith(".wav") for c in cards)
    assert polly.texts[0] == "Ayse, a quick laugh."


def test_show_picks_needs_a_fresh_pool_after_a_kid_joins():
    async def scenario():
        p = make()
        await p.set_couch([{"name": "Ayse"}])
        await p.find_candidates()
        await p.add_to_couch("Can", age=8)
        await p.show_picks([{"movie_id": i, "why": "x", "match": 70} for i in (1, 4, 5, 8)])

    with pytest.raises(PopcornError, match="couch changed"):
        run(scenario())


def test_kid_joining_fades_unsafe_cards_without_refill():
    async def scenario():
        p = make()
        await p.set_couch([{"name": "Bedirhan"}])
        await put_picks(p, ids=(3, 4, 5, 8))
        after = await p.add_to_couch("Can", age=8, role="son", gender="male")
        return after, await p.tv_state()

    after, state = run(scenario())
    assert after["kid_filter"] == "PG"
    assert sorted(after["removed_from_screen"]) == ["Hero Hour", "Star War Zone"]
    assert [r["title"] for r in state["recommendations"]] == ["Space Kids", "Toon Town"]  # no refill
    assert after["memory"]["name"] == "Can" and after["memory"]["role"] == "son" and after["memory"]["new"]
    assert state["screen"] == "recommendations"
    assert [m["name"] for m in state["members"]] == ["Bedirhan", "Can"]


def test_mark_seen_saves_watched_and_fades_cards():
    async def scenario():
        p = make()
        await p.set_couch([{"name": "Ayse"}, {"name": "Bedirhan"}])
        await put_picks(p)
        seen = await p.mark_seen(["Ayse"], [4, 8])
        again = await p.find_candidates()
        return seen, await p.get_state(), again, await p._profile("ayse"), await p._profile("bedirhan")

    seen, state, again, ayse, bedirhan = run(scenario())
    assert seen["saved_for"] == ["Ayse"] and sorted(seen["removed_from_screen"]) == ["Hero Hour", "Star War Zone"]
    assert [r["id"] for r in state["recommendations"]] == [1, 5]
    assert {w["id"]: w["reaction"] for w in ayse["watched"]} == {4: None, 8: None} and not bedirhan["watched"]
    assert ayse["watched"][0]["title"] == "Star War Zone" and ayse["watched"][0]["year"] == "2024"
    assert not {4, 8} & {c["id"] for c in again["candidates"]}  # anyone on the couch saw it: out


def test_http_seen_route_marks_couch_and_goes_back_to_reel():
    p = make()
    with TestClient(create_app(p), base_url="http://127.0.0.1:8000") as client:
        client.post("/api/couch", json={"add": "Ayse"})
        client.post("/api/couch", json={"add": "Bedirhan"})
        run(put_picks(p))
        assert client.post("/api/details", json={"movie_id": 4}).status_code == 200
        assert client.post("/api/seen", json={"movie_id": "4"}).status_code == 400
        assert client.post("/api/seen", json={"movie_id": 4}).json()["removed_from_screen"] == ["Star War Zone"]
        state = client.get("/api/state").json()
        assert state["screen"] == "recommendations" and state["details"] is None
        assert 4 not in [r["id"] for r in state["recommendations"]]
        assert all(m["watched"] == ["Star War Zone (2024)"] for m in state["members"])


def test_memory_defaults_for_old_profiles_and_notes_rules():
    async def scenario():
        p = make()
        old = {"id": "ayse", "name": "Ayse", "age": 40, "kid": False, "genres": {"35": 0.8}, "liked": [], "disliked": [],
               "watched": [{"id": 1, "title": "Laugh Riot", "at": 1}], "notes": [], "duel_rounds": 0}
        await p._store.put(p._key("profile", "ayse"), old)
        await p._store.put(p._key("profiles"), {"ids": ["ayse"]})
        first = (await p.get_profiles(["Ayse"]))[0]
        for i in range(14):
            await p.update_taste("Ayse", note=f"note {i}")
        await p.update_taste("Ayse", note="  NOTE 5 ")  # dedupe moves it to the end
        result = await p.update_taste("Ayse", note="x" * 200, role="mom", gender="female", age=41)
        return first, result

    first, result = run(scenario())
    assert first == {"name": "Ayse", "named": True, "age": 40, "role": None, "gender": None, "kid": False,
                     "loves": ["Comedy"], "likes": [], "dislikes": [], "never": [], "notes": [], "duel": [],
                     "duel_skipped": False, "watched": ["Laugh Riot"], "new": False}
    memory = result["memory"]
    assert len(memory["notes"]) == 12 and memory["notes"][-2] == "NOTE 5" and len(memory["notes"][-1]) <= 140
    assert "note 5" not in memory["notes"] and "note 13" in memory["notes"]
    assert (memory["role"], memory["gender"], memory["age"]) == ("mom", "female", 41)


def test_set_couch_returns_memory_and_rename_person():
    async def scenario():
        p = make()
        couch = await p.set_couch([{"name": "Ahmet", "age": 43, "role": "dad", "gender": "male"},
                                   {"name": "Ahmet's son", "age": 10, "named": False}])
        await p.start_rating("Toon Town")
        renamed = await p.rename_person("ahmet's son", "Emir")
        with pytest.raises(PopcornError, match="already someone called Ahmet"):
            await p.rename_person("Emir", "ahmet")
        return couch, renamed, await p.tv_state(), await p._profile("ahmet's son")

    couch, renamed, state, gone = run(scenario())
    assert couch["couch"] == ["Ahmet", "Ahmet's son"] and couch["kid_filter"] == "PG"
    assert [m["role"] for m in couch["memory"]] == ["dad", None] and couch["memory"][1]["named"] is False
    assert renamed["memory"]["name"] == "Emir" and renamed["memory"]["named"] is True and gone is None
    assert [m["name"] for m in state["members"]] == ["Ahmet", "Emir"]
    assert state["rating"]["people"] == ["Ahmet", "Emir"]


def test_duel_candidates_pairs_history_and_kid_safety():
    async def scenario():
        p = make()
        await p.set_couch([{"name": "Ayse"}, {"name": "Can", "age": 8}])
        pool = await p.duel_candidates("Ayse")
        await p.set_couch([{"name": "Ayse"}])
        with pytest.raises(PopcornError, match="couch changed"):
            await p.start_duel("Ayse", [[3, 5], [9, 11], [1, 4]])
        adult = await p.duel_candidates("Ayse")
        ids = [c["id"] for c in adult["candidates"] if c["id"] != 2]
        with pytest.raises(PopcornError, match="Movie id 999 is not in Ayse's last duel_candidates"):
            await p.start_duel("Ayse", [[ids[0], 999], [ids[1], ids[2]], [ids[3], ids[4]]])
        with pytest.raises(PopcornError, match="used twice"):
            await p.start_duel("Ayse", [[ids[0], ids[1]], [ids[0], ids[2]], [ids[3], ids[4]]])
        with pytest.raises(PopcornError, match="3 to 6"):
            await p.start_duel("Ayse", [[ids[0], ids[1]]])
        started = await p.start_duel("Ayse", [[3, 1], [5, 9], [11, 10]])
        results = [await p.record_duel_choice("left") for _ in range(3)]
        again = await p.duel_candidates("Ayse")
        return pool, started, results, await p.get_state(), again, p._tmdb.calls

    pool, started, results, state, again, calls = run(scenario())
    ids = {c["id"] for c in pool["candidates"]}
    assert pool["kid_filter"] == "PG" and ids and all(CATALOG[i][2] in ("G", "PG") for i in ids) and 13 not in ids
    assert all(c["sort_by"] == "vote_count.desc" for c in calls) and {c["page"] for c in calls} == {1, 2, 3}
    assert started["duel"]["left"]["title"] == "Space Kids" and started["duel"]["total"] == 3
    assert [r["done"] for r in results] == [False, False, True]
    assert results[0]["picked"] == "picked Space Kids (2024) over Laugh Riot (2024)"
    assert results[-1]["memory"]["duel"][-1] == "picked Dance Off (2024) over Puzzle Box (2024)"
    assert len(results[-1]["memory"]["duel"]) == 3 and not results[-1]["memory"]["new"]
    assert state["screen"] == "couch" and state["duel"] is None
    assert not {3, 1, 5, 9, 11, 10} & {c["id"] for c in again["candidates"]}  # already seen in a duel
    with pytest.raises(PopcornError):
        run(make().record_duel_choice("left"))


def test_duel_skip_before_any_round_marks_duel_skipped():
    async def scenario():
        p = make()
        await p.set_couch([{"name": "Ayse"}])
        await p.duel_candidates("Ayse")
        await p.start_duel("Ayse", [[1, 2], [3, 4], [5, 6]])
        skipped = await p.record_duel_choice("skip")
        await p.duel_candidates("Ayse")
        await p.start_duel("Ayse", [[7, 8], [9, 10], [11, 13]])
        await p.record_duel_choice("right")
        later = await p.record_duel_choice("skip")
        return skipped, later, await p.get_state()

    skipped, later, state = run(scenario())
    assert skipped["done"] and skipped["skipped"] and skipped["memory"]["duel_skipped"] is True
    assert later["done"] and later["memory"]["duel_skipped"] is False and later["rounds_done"] == 1
    assert later["memory"]["duel"] == ["picked Hero Hour (2024) over Big Heist (2024)"]
    assert state["duel"] is None and state["screen"] == "couch"


def test_rating_round_speaks_the_questions():
    async def scenario():
        p = make(FakePolly())
        await _family_on_details(p)
        await p.start_rating()
        await p.record_reaction("Bedirhan", "loved", "great")
        await p.record_reaction("Ayse", None)  # voice skip
        await p.record_reaction("Ayse", "meh", by="hand")  # change, Can still asked
        await p.skip_turn()  # hand skip of Can: no ack, ends the round
        return (await p.get_state())["speech"]

    speech = run(scenario())
    assert [s["text"] for s in speech] == [
        "How was Laugh Riot? Bedirhan, what did you think?",
        "Loved it, noted. Ayse, what about you?",
        "Skipped. Can, what about you?",
        "Okay, noted. Can, what about you?",
        "Saved, thanks everyone.",
    ]
    assert [s["id"] for s in speech] == [1, 2, 3, 4, 5] and all(s["audio"] for s in speech)


def test_speech_keeps_six_and_survives_polly_failure():
    async def scenario():
        p = make(FakePolly(fail=True))
        for i in range(8):
            await p.push_speech(f"line {i}")
        return await p.get_state()

    state = run(scenario())
    assert [s["id"] for s in state["speech"]] == [3, 4, 5, 6, 7, 8]
    assert state["speech"][-1] == {"id": 8, "text": "line 7", "audio": None} and state["voice"]["state"] == "idle"


def test_http_speech_voice_and_audio_routes():
    polly = FakePolly()
    p = make(polly)
    with TestClient(create_app(p), base_url="http://127.0.0.1:8000") as client:
        assert client.post("/api/speech", json={"text": "x" * 601}).status_code == 400
        item = client.post("/api/speech", json={"text": "Hello  there"}).json()["speech"]
        assert item["text"] == "Hello there" and item["audio"].startswith("/api/voice/")
        mp3 = client.get(item["audio"])
        assert mp3.status_code == 200 and mp3.headers["content-type"] == "audio/wav" and mp3.content == b"ID3Hello there"
        assert "max-age=86400" in mp3.headers["cache-control"]
        client.post("/api/speech", json={"text": "Hello there"})
        assert polly.texts == ["Hello there"]  # cached
        assert client.get("/api/voice/" + "0" * 40 + ".wav").status_code == 404
        assert client.get("/api/voice/nothex.wav").status_code == 404

        assert client.post("/api/voice", json={"state": "talking"}).status_code == 400
        assert client.post("/api/voice", json={"state": "listening", "text": "I", "speaker": "Ayse"}).json()["changed"]
        assert client.post("/api/voice", json={"state": "listening", "text": "I want", "speaker": "Ayse"}).json()["changed"] is False
        voice = client.get("/api/state").json()["voice"]
        assert voice == {**voice, "state": "listening", "text": "I", "speaker": "Ayse"}


def test_voice_throttle_and_rating_live_copy():
    async def scenario():
        p = make()
        await _family_on_details(p)
        await p.start_rating()
        first = await p.set_voice("listening", "I", "Ayse")
        fast = await p.set_voice("listening", "I loved", "Ayse")  # within 250 ms: dropped
        thinking = await p.set_voice("thinking", "I loved it")  # state change always lands
        return first, fast, thinking, await p.get_state()

    first, fast, thinking, state = run(scenario())
    assert first["changed"] and not fast["changed"] and thinking["changed"]
    assert state["voice"]["state"] == "thinking" and state["rating"]["live"] == "I loved it"


def test_http_qr_and_phone_routes_and_mcp_tools():
    with TestClient(create_app(make()), base_url="http://127.0.0.1:8000") as client:
        qr = client.get("/api/qr.png", params={"url": "http://192.168.1.5:8000/phone/?agent=x"})
        assert qr.status_code == 200 and qr.headers["content-type"] == "image/png" and qr.content[:4] == b"\x89PNG"
        assert client.get("/api/qr.png", params={"url": "javascript:alert(1)"}).status_code == 400
        assert client.get("/api/qr.png", params={"url": "https://a.b/" + "x" * 300}).status_code == 400
        index = client.get("/phone/")
        assert index.status_code == 200 and index.headers["content-type"].startswith("text/html")
        assert client.get("/phone/app.js").headers["content-type"].startswith("text/javascript")
        assert client.get("/phone/styles.css").headers["content-type"].startswith("text/css")
        assert client.get("/phone/secret.txt").status_code == 404
        assert client.get("/phone/..%2Fserver.py").status_code == 404
        assert client.post("/api/recommend").status_code == 410

        headers = {"Accept": "application/json, text/event-stream", "Content-Type": "application/json",
                   "MCP-Protocol-Version": "2025-11-25"}
        listed = client.post("/mcp", headers=headers, json={"jsonrpc": "2.0", "id": 2, "method": "tools/list"})
        names = {t["name"] for t in listed.json()["result"]["tools"]}
        assert names == {"set_couch", "add_to_couch", "remove_from_couch", "get_profiles", "update_taste",
                         "rename_person", "find_candidates", "show_picks", "mark_seen", "duel_candidates",
                         "start_duel", "record_duel_choice", "mark_watched", "get_movie_details", "start_rating",
                         "record_reaction"}


def test_http_api_and_stateless_mcp():
    with TestClient(create_app(make()), base_url="http://127.0.0.1:8000") as client:
        assert client.post("/api/couch", json={"add": "Ayse"}).status_code == 200
        state = client.get("/api/state").json()
        assert [m["name"] for m in state["members"]] == ["Ayse"]
        assert state["speech"] == [] and state["voice"]["state"] == "idle" and state["pool"] is None
        assert client.post("/api/couch", json={"add": "Can", "age": 9}).status_code == 200
        assert client.post("/api/couch", json={"remove": "Ayse"}).status_code == 200
        state = client.get("/api/state").json()
        assert [m["name"] for m in state["members"]] == ["Can"]
        assert [m["name"] for m in state["household"]] == ["Ayse", "Can"]  # left the couch, still in the family
        assert client.post("/api/duel", json={"pick": "left"}).status_code == 400  # no duel running
        assert client.post("/api/duel", json={"pick": "up"}).status_code == 400

        headers = {"Accept": "application/json, text/event-stream", "Content-Type": "application/json"}
        init = client.post("/mcp", headers=headers, json={
            "jsonrpc": "2.0", "id": 1, "method": "initialize",
            "params": {"protocolVersion": "2025-11-25", "capabilities": {},
                       "clientInfo": {"name": "test", "version": "1"}},
        })
        assert init.status_code == 200, init.text
        assert init.json()["result"]["protocolVersion"] == "2025-11-25"


def test_providers_dedupe_priority_and_cap():
    providers, link = providers_for(PROVIDERS, "US")
    assert [(p["name"], p["kind"]) for p in providers] == [
        ("Amazon Prime Video", "stream"), ("Amazon Video", "rent"), ("Apple TV Store", "rent"), ("Google Play Movies", "buy"),
    ]
    assert providers[0] == {"id": 9, "name": "Amazon Prime Video", "logo": "https://image.tmdb.org/t/p/w92/l9.png", "kind": "stream"}
    assert link.endswith("locale=US")
    assert providers_for(PROVIDERS, "TR") == ([], None)
    assert providers_for({}, "US") == ([], None)


def test_details_have_backdrop_and_providers_and_survive_provider_failure():
    async def scenario():
        p = Popcorn(MemoryStore(), FakeTMDB(), "test", watch_region="US")
        await p.set_couch([{"name": "Ayse"}])
        good = await p.get_movie_details("1")
        broken = await p.get_movie_details("2")  # watch providers raise
        return good, broken

    good, broken = run(scenario())
    assert good["backdrop"] == "https://image.tmdb.org/t/p/w1280/b1.jpg"
    assert len(good["providers"]) == 4 and good["providers_region"] == "US" and good["providers_link"]
    assert broken["providers"] == [] and broken["providers_link"] is None and broken["title"] == "Night Terror"


async def _family_on_details(p):
    await p.set_couch([{"name": "Bedirhan"}, {"name": "Ayse"}, {"name": "Can", "age": 9}])
    await put_picks(p, ids=(3, 5, 9, 11))
    await p.open_details(1)  # Laugh Riot, comedy
    await p.start_watching(1, "Amazon Prime Video")


def test_full_rating_flow_updates_taste_memory():
    async def scenario():
        p = make()
        await _family_on_details(p)
        watching = (await p.get_state())["watching"]
        started = await p.start_rating()
        await p.set_live("honestly a bit")
        voice = await p.record_reaction("bedirhan", "loved", "  honestly a bit long but I loved it  ")
        hand = await p.record_reaction("Ayse", "disliked", "ignored for hand", by="hand")
        last = await p.skip_turn()
        return watching, started, voice, hand, last, await p.get_state(), {
            n: await p._profile(n) for n in ("bedirhan", "ayse", "can")}

    watching, started, voice, hand, last, state, profiles = run(scenario())
    assert watching["title"] == "Laugh Riot" and watching["provider"] == "Amazon Prime Video"
    assert started["rating"]["people"] == ["Bedirhan", "Ayse", "Can"] and started["rating"]["asking"] == "Bedirhan"
    assert voice == {"saved": "Bedirhan", "reaction": "loved", "next": "Ayse", "done": False}
    assert hand["next"] == "Can"
    assert last["done"] is True
    rating = state["rating"]
    assert state["screen"] == "rating" and state["message"] == "Saved: Laugh Riot" and state["watching"] is None
    assert rating["done"] is True and rating["asking"] is None and rating["live"] == ""
    assert rating["answers"]["Bedirhan"] == {"reaction": "loved", "quote": "honestly a bit long but I loved it", "skipped": False, "by": "voice"}
    assert rating["answers"]["Ayse"] == {"reaction": "disliked", "quote": "", "skipped": False, "by": "hand"}
    assert rating["answers"]["Can"] == {"reaction": None, "quote": "", "skipped": True, "by": "skip"}
    assert all(any(w["id"] == 1 for w in prof["watched"]) for prof in profiles.values())  # watched for all
    assert profiles["bedirhan"]["liked"] == [1] and profiles["bedirhan"]["genres"]["35"] == 0.3
    assert profiles["ayse"]["disliked"] == [1] and profiles["ayse"]["genres"]["35"] == -0.2
    assert profiles["can"]["liked"] == [] and profiles["can"]["disliked"] == [] and "35" not in profiles["can"]["genres"]
    assert 1 not in [r["id"] for r in state["recommendations"]]


def test_changing_an_answer_overwrites_and_does_not_move_asking_back():
    async def scenario():
        p = make()
        await _family_on_details(p)
        await p.start_rating()
        await p.record_reaction("Bedirhan", "meh", "it was ok")
        await p.record_reaction("Ayse", "liked", "")
        again = await p.record_reaction("Bedirhan", "loved", "actually I loved it")
        return again, (await p.get_state())["rating"]

    again, rating = run(scenario())
    assert again["next"] == "Can" and rating["asking"] == "Can"
    assert rating["answers"]["Bedirhan"]["reaction"] == "loved" and rating["answers"]["Bedirhan"]["quote"] == "actually I loved it"


def test_finish_early_marks_everyone_watched():
    async def scenario():
        p = make()
        await _family_on_details(p)
        await p.start_rating()
        done = await p.finish_rating()
        again = await p.finish_rating()  # second Back press is harmless
        return done, again, await p.get_state(), [await p._profile(n) for n in ("bedirhan", "ayse", "can")]

    done, again, state, profiles = run(scenario())
    assert done["done"] and again["done"]
    assert state["rating"]["done"] and state["rating"]["answers"] == {}
    assert all(prof["watched"] and not prof["genres"] for prof in profiles)
    with pytest.raises(PopcornError, match="already saved"):
        run(_answer_after_done())


async def _answer_after_done():
    p = make()
    await _family_on_details(p)
    await p.start_rating()
    await p.finish_rating()
    await p.record_reaction("Ayse", "loved")


def test_rating_errors():
    async def unknown():
        p = make()
        await _family_on_details(p)
        await p.start_rating()
        await p.record_reaction("Zeynep", "loved")

    async def nothing_to_rate():
        p = make()
        await p.set_couch([{"name": "Ayse"}])
        await p.start_rating()

    with pytest.raises(PopcornError, match="Zeynep is not in this rating"):
        run(unknown())
    with pytest.raises(PopcornError, match="Which movie"):
        run(nothing_to_rate())
    with pytest.raises(PopcornError, match="No rating is running"):
        run(make().set_live("hi"))


def test_start_rating_with_a_named_movie_and_from_details():
    async def scenario():
        p = make()
        await p.set_couch([{"name": "Ayse"}])
        named = await p.start_rating("Toon Town")
        await p.open_details(3)
        from_details = await p.start_rating()
        return named, from_details

    named, from_details = run(scenario())
    assert named["rating"]["movie"]["title"] == "Toon Town"
    assert from_details["rating"]["movie"] == {"id": 3, "title": "Space Kids", "year": "2024", "poster": None,
                                               "genres": ["Science Fiction", "Family", "Animation"]}


def test_go_to_clears_details_watching_and_rating():
    async def scenario():
        p = make()
        await _family_on_details(p)
        await p.start_rating()
        await p.go_to("couch")
        return await p.get_state()

    state = run(scenario())
    assert state["screen"] == "couch"
    assert state["details"] is None and state["watching"] is None and state["rating"] is None
    with pytest.raises(PopcornError):
        run(make().go_to("duel"))


def test_set_live_skips_unchanged_text_and_caps_length():
    async def scenario():
        p = make()
        await _family_on_details(p)
        await p.start_rating()
        first = await p.set_live("I  loved")
        version = (await p.get_state())["version"]
        same = await p.set_live("I loved")
        after = (await p.get_state())["version"]
        long = await p.set_live("x" * 500)
        return first, same, version, after, long

    first, same, version, after, long = run(scenario())
    assert first["changed"] and not same["changed"] and version == after
    assert len(long["live"]) == 300


def test_old_state_without_new_keys_still_works():
    async def scenario():
        p = make()
        await p.set_couch([{"name": "Ayse"}])
        old = await p._store.get(p._key("tv"))
        for key in ("watching", "rating", "focus"):
            old.pop(key, None)
        await p._store.put(p._key("tv"), old)
        state = await p.get_state()
        await p.set_focus(5)
        await p.open_details(5)
        rated = await p.start_rating()
        return state, await p.tv_state(), rated

    state, tv, rated = run(scenario())
    assert state["watching"] is None and state["rating"] is None and state["focus"] is None
    assert tv["focus"]["movie_id"] == 5 and tv["screen"] == "rating" and rated["rating"]["movie"]["id"] == 5


def test_http_rating_routes():
    with TestClient(create_app(make()), base_url="http://127.0.0.1:8000") as client:
        client.post("/api/couch", json={"add": "Ayse"})
        client.post("/api/couch", json={"add": "Can", "age": 9})
        assert client.post("/api/details", json={"movie_id": "1"}).status_code == 400
        assert client.post("/api/details", content=b"not json").status_code == 400
        assert client.post("/api/details", json={"movie_id": 1}).json()["providers"]
        assert client.post("/api/focus", json={"movie_id": 1}).status_code == 200
        assert client.post("/api/watch", json={"movie_id": 1}).status_code == 400
        assert client.post("/api/watch", json={"movie_id": 1, "provider": "Amazon Prime Video"}).status_code == 200
        assert client.post("/api/screen", json={"screen": "duel"}).status_code == 400
        assert client.post("/api/rating/live", json={"text": "hi"}).status_code == 400  # no rating yet
        assert client.post("/api/rating/start").json()["rating"]["asking"] == "Ayse"
        assert client.get("/api/rating").json()["screen"] == "rating"
        assert client.post("/api/rating/live", json={"text": "I loved"}).json()["changed"] is True
        assert client.post("/api/rating/answer", json={"name": "Ayse", "reaction": "great"}).status_code == 400
        assert client.post("/api/rating/answer", json={"name": "Zeynep", "reaction": "liked"}).status_code == 400
        assert client.post("/api/rating/answer", json={"name": "Ayse", "reaction": "liked"}).json()["next"] == "Can"
        assert client.post("/api/rating/skip", json={}).json()["done"] is True
        assert client.post("/api/rating/finish").json()["done"] is True
        state = client.get("/api/state").json()
        assert state["rating"]["done"] and state["message"] == "Saved: Laugh Riot"
        assert client.post("/api/screen", json={"screen": "couch"}).status_code == 200
        assert client.get("/api/state").json()["rating"] is None


# ---------- OpenRouter voice (fake OpenRouter over httpx.MockTransport) ----------


import httpx

from popcorn_mcp.voice_stt import OpenRouterSTT
from popcorn_mcp.voice_tts import OpenRouterTTS


def test_tts_request_shape():
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append((request.url.path, request.headers["authorization"], __import__("json").loads(request.content)))
        return httpx.Response(200, content=b"ID3mp3", headers={"content-type": "audio/mpeg"})

    tts = OpenRouterTTS("k", transport=httpx.MockTransport(handler))
    assert run(tts.synthesize("Hello   there. " * 40)) == b"ID3mp3"
    assert len(seen) == 1 and seen[0][:2] == ("/api/v1/audio/speech", "Bearer k")
    assert seen[0][2] == {"model": "elevenlabs/eleven-flash-v2.5", "voice": "sarah", "response_format": "mp3",
                          "input": " ".join(("Hello there. " * 40).split())}
    assert (tts.ext, tts.content_type) == ("mp3", "audio/mpeg")


def stt_app(handler):
    stt = OpenRouterSTT("k", transport=httpx.MockTransport(handler))
    return TestClient(create_app(make(), transcriber=stt), base_url="http://127.0.0.1:8000")


def test_transcribe_route_shapes_and_empty_noise():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["path"], seen["ct"], seen["body"] = request.url.path, request.headers["content-type"], request.content
        if b"noise" in request.content:
            return httpx.Response(200, json={"text": "Thank you.", "segments": [{"text": "Thank you.", "no_speech_prob": 0.95}]})
        return httpx.Response(200, json={"text": " I want  a comedy ", "segments": [{"text": " I want  a comedy ", "no_speech_prob": 0.01}]})

    with stt_app(handler) as client:
        r = client.post("/api/transcribe?speaker=Ayse", content=b"audio-bytes", headers={"Content-Type": "audio/webm;codecs=opus"})
        assert r.status_code == 200 and r.json() == {"text": "I want a comedy"}
        assert seen["path"] == "/api/v1/audio/transcriptions" and seen["ct"].startswith("multipart/form-data")
        for field in (b'name="model"', b"openai/whisper-large-v3-turbo", b'name="temperature"', b"verbose_json", b'name="language"', b'filename="speech.webm"'):
            assert field in seen["body"]
        assert client.post("/api/transcribe", content=b"noise", headers={"Content-Type": "audio/mp4"}).json() == {"text": ""}
        assert client.post("/api/transcribe", content=b"", headers={"Content-Type": "audio/mp4"}).json() == {"text": ""}
        assert client.post("/api/transcribe", content=b"x" * (10 * 1024 * 1024 + 1)).status_code == 400


def test_transcribe_route_errors_are_plain_502():
    with stt_app(lambda request: httpx.Response(500, json={"error": {"message": "boom"}})) as client:
        r = client.post("/api/transcribe", content=b"a", headers={"Content-Type": "audio/webm"})
        assert r.status_code == 502 and "boom" not in r.json()["error"] and r.json()["error"].endswith("Try again.")
    with TestClient(create_app(make()), base_url="http://127.0.0.1:8000") as client:
        assert client.post("/api/transcribe", content=b"a").status_code == 502
