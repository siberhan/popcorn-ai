"""The v4 service: profiles, genres, favorites catalog, LLM picks, the rating with spoken answers.

The TMDB client and the LLM are fakes here: no network, and every request they would send is kept,
so a test can say exactly which films were asked for and what reached the model.
"""

import asyncio

import httpx
import pytest
from starlette.testclient import TestClient

from popcorn_mcp import service
from popcorn_mcp.server import create_app
from popcorn_mcp.service import Popcorn, PopcornError
from popcorn_mcp.store import MemoryStore
from popcorn_mcp.tmdb import CERT_ORDER, TMDBError, providers_for
from popcorn_mcp.voice_stt import OpenRouterSTT
from popcorn_mcp.voice_tts import OpenRouterTTS

YEAR = "2024"
GENRES = {
    28: "Action", 12: "Adventure", 16: "Animation", 35: "Comedy", 80: "Crime", 99: "Documentary", 18: "Drama",
    10751: "Family", 14: "Fantasy", 27: "Horror", 10402: "Music", 9648: "Mystery", 10749: "Romance",
    878: "Science Fiction", 53: "Thriller", 10770: "TV Movie",
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
    13: ("Puppy Parade", [10751, 35], "G", 6.6),
    14: ("Robot Rescue", [16, 878], "PG", 6.7),
    15: ("Cliff Climbers", [12, 99], "PG", 6.5),
    16: ("Snow Friends", [16, 10751], "PG", 6.9),
    17: ("Comet Cowboys", [878, 12], "PG", 7.1),
    18: ("Sing Along", [10402, 10751], "G", 6.4),
    19: ("Pony Express", [12, 10751], "G", 6.3),
    20: ("Dragon School", [14, 16], "PG", 6.2),
    21: ("Last Train", [53, 80], "R", 7.7),
    22: ("Silent Lake", [27, 9648], "R", 6.1),
    23: ("Quiet Minds", [18, 9648], "R", 7.9),
    24: ("Space Odyssey II", [878, 18], "PG-13", 8.1),
    25: ("Moon Garden", [14, 10749], "PG", 6.0),
    26: ("Paper Planes", [18, 10751], "PG", 7.0),
    27: ("Ticket to Mars", [878, 35], "PG", 6.9),
    28: ("Giant Ants", [27, 28], "R", 5.9),
    29: ("Unrated Gem", [18], None, 5.5),
    30: ("Lost Poster", [35], "PG", 5.0),
}
NOPOSTER = {30}
FILMS = {"discover", "search", "movie", "certification"}
LABELS = [name for name in GENRES.values() if name != "TV Movie"]
PICKS_10 = ["Space Kids", "Toon Town", "Fairy Path", "Dance Off", "Puppy Parade", "Robot Rescue", "Snow Friends",
            "Comet Cowboys", "Sing Along", "Pony Express"]


def film_ids(*genre_ids: int) -> set[int]:
    return {i for i, (_, genres, _, _) in CATALOG.items() if set(genres) & set(genre_ids)}


PAGE = 20  # films in one page of the fake TMDB


def _result(movie_id: int) -> dict:
    title, genre_ids, _, vote = CATALOG[movie_id]
    return {"id": movie_id, "title": title, "genre_ids": genre_ids, "vote_average": vote, "vote_count": 1000 + movie_id,
            "popularity": 100 - movie_id, "release_date": f"{YEAR}-01-01", "overview": "",
            "poster_path": None if movie_id in NOPOSTER else f"/{movie_id}.jpg"}


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


class FakeTMDB:
    """The CATALOG films, paged 20 at a time; `synthetic` adds generated films per sort for the big catalogs."""

    def __init__(self, synthetic=0, shared=0):
        self.calls = []
        self.synthetic = synthetic  # films per sort and genre, for the 200-film catalog tests
        self.shared = shared  # of those, films both sorts offer
        self.no_cert = set()  # films whose certification check fails
        self.films = {}

    def pool(self, genre_id: int, sort_by: str = "popularity.desc") -> list[int]:
        """The films one sort offers for a genre, in page order: the shared ones first, then its own."""
        base = 10_000_000 if sort_by == "popularity.desc" else 20_000_000
        return ([30_000_000 + genre_id * 1000 + n for n in range(self.shared)]
                + [base + genre_id * 1000 + n for n in range(self.synthetic - self.shared)])

    def film(self, movie_id: int, genre_id: int) -> dict:
        if movie_id not in self.films:
            self.films[movie_id] = {"id": movie_id, "title": f"Film {movie_id}", "genre_ids": [genre_id],
                                    "vote_average": 6.0, "vote_count": 1000, "popularity": 10,
                                    "release_date": f"{YEAR}-01-01", "overview": "", "poster_path": f"/{movie_id}.jpg"}
        return self.films[movie_id]

    async def genres(self):
        return GENRES

    async def trending(self, page=1):
        self.calls.append({"kind": "trending", "page": page})
        films = [_result(i) for i in CATALOG if i <= 15]
        return films[(page - 1) * PAGE:page * PAGE]

    async def discover(self, with_genres=None, min_votes=300, page=1, sort_by="popularity.desc"):
        self.calls.append({"kind": "discover", "with_genres": with_genres, "min_votes": min_votes, "page": page,
                           "sort_by": sort_by})
        wanted = {int(g) for g in with_genres.split("|")} if with_genres else set()
        if self.synthetic and wanted:  # the big-catalog tests: generated films, one set per sort
            genre_id = sorted(wanted)[0]
            return [self.film(i, genre_id) for i in self.pool(genre_id, sort_by)[(page - 1) * PAGE:page * PAGE]]
        films = [_result(i) for i, (_, genre_ids, _, _) in CATALOG.items() if not wanted or wanted & set(genre_ids)]
        return films[(page - 1) * PAGE:page * PAGE]

    async def search(self, title, year=None):
        self.calls.append({"kind": "search", "title": title, "year": year})
        wanted = " ".join(title.split()).casefold()
        hits = [i for i, (name, _, _, _) in CATALOG.items() if name.casefold() == wanted]
        if not hits:
            hits = [i for i, (name, _, _, _) in CATALOG.items() if wanted in name.casefold()]
        if not hits and wanted in ("film", "movie", "all"):
            hits = list(CATALOG.keys())
        if year is not None and year != int(YEAR):  # every film is from YEAR
            hits = []
        return [_result(i) for i in hits]

    async def movie(self, movie_id):
        self.calls.append({"kind": "movie", "movie_id": movie_id})
        title, genre_ids, cert, vote = CATALOG[movie_id]
        return {
            "id": movie_id, "title": title, "vote_average": vote, "release_date": f"{YEAR}-01-01",
            "genres": [{"id": g, "name": GENRES[g]} for g in genre_ids],
            "poster_path": None if movie_id in NOPOSTER else f"/{movie_id}.jpg",
            "release_dates": {"results": [{"iso_3166_1": "US",
                                           "release_dates": [{"certification": cert}] if cert else []}]},
            "credits": {"cast": [], "crew": []}, "backdrop_path": f"/b{movie_id}.jpg", "overview": "A film.",
            "tagline": "", "runtime": 100,
        }

    async def certification(self, movie_id):
        self.calls.append({"kind": "certification", "movie_id": movie_id})
        if movie_id in self.no_cert:
            raise TMDBError("TMDB request failed")
        return "PG-13" if movie_id in self.films else CATALOG[movie_id][2]

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


class FakeLLM:
    """Canned JSON replies (None = not JSON at all), and every request it was given."""

    model = "fake/model"

    def __init__(self, replies=None):
        self.replies = list(replies) if replies else []
        self.requests = []  # one entry per call: {"messages", "temperature", "effort"}
        self.popcorn = None  # a test sets this to look at the TV state while the call runs
        self.loading_seen = None

    async def json_chat(self, messages, *, temperature=0.5, effort="low"):
        self.requests.append({"messages": messages, "temperature": temperature, "effort": effort})
        if self.popcorn is not None:
            self.loading_seen = (await self.popcorn.get_state())["picks_loading"]
        if not self.replies:
            return None
        return self.replies.pop(0) if len(self.replies) > 1 else self.replies[0]

    @property
    def last_user(self) -> str:
        return self.requests[-1]["messages"][-1]["content"]

    @property
    def system(self) -> str:
        return self.requests[-1]["messages"][0]["content"]


def make(polly=None, llm=None, tmdb=None) -> Popcorn:
    return Popcorn(MemoryStore(), tmdb or FakeTMDB(), "test", speaker=polly, llm=llm or FakeLLM([{"picks": []}]))


def run(coro):
    return asyncio.run(coro)


async def seeded(p: Popcorn, genres=("Comedy",)) -> dict:
    """Ayse with genres and her favorites done, so `new` is False."""
    await p.seed_catalog()
    await p.set_couch([{"name": "Ayse"}])
    await p.save_genres("Ayse", list(genres))
    for i in range(1, 6):
        await p.toggle_favorite(i)
    await p.done_favorites()
    return await p._require_profile("Ayse")


def picks(*items) -> dict:
    return {"picks": [{"title": t, "year": y, "why": w} for t, y, w in items]}


def twelve(**whys) -> dict:
    """Twelve clean picks for an adult couch, in a known order."""
    titles = ["Laugh Riot", "Star War Zone", "Love Story", "Big Heist", "Puzzle Box", "Hero Hour",
              "Fairy Path", "Dance Off", "Space Kids", "Toon Town", "Ocean Life", "Moon Garden"]
    return picks(*[(t, int(YEAR), whys.get(t, f"why {t}")) for t in titles])


# ---------- profiles and the Member view ----------


def test_a_new_person_is_a_name_and_an_age_and_goes_to_genres():
    async def scenario():
        p = make()
        added = await p.add_to_couch("Can", 9)
        return added, await p.get_state(), await p.tv_state(), await p._require_profile("can")

    added, state, tv, profile = run(scenario())
    assert added["new_people"] == ["Can"] and added["genres_for"] == "Can" and added["kid_filter"] == "PG"
    assert state["screen"] == "genres" and state["genres_for"] == "Can"
    assert profile["kid"] is True and profile["genres"] == [] and profile["favorites_done"] is False
    assert set(profile) == {"id", "name", "age", "kid", "genres", "favorites", "favorites_done", "reviews"}
    assert tv["members"] == [{"name": "Can", "age": 9, "kid": True, "genres": [], "favorites": [], "favorites_done": False,
                              "reviews": [], "new": True}]


def test_member_view_is_compact_and_keeps_the_last_ten():
    async def scenario():
        p = make()
        profile = {"id": "ayse", "name": "Ayse", "age": 40, "kid": False, "genres": ["Comedy", "Mystery"],
                   "favorites": [{"id": 1, "title": "Laugh Riot", "year": YEAR, "genres": ["Comedy"]}],
                   "favorites_done": True,
                   "reviews": [{"id": i, "title": f"Film {i}", "year": YEAR, "reaction": "liked", "summary": "s",
                                "at": 1} for i in range(12)]}
        await p._store.put(p._key("profile", "ayse"), profile)
        await p._store.put(p._key("profiles"), {"ids": ["ayse"]})
        return await p.get_profiles(["Ayse"])

    (member,) = run(scenario())
    assert set(member) == {"name", "age", "kid", "genres", "favorites", "favorites_done", "reviews", "new"}
    assert member["favorites"] == [f"Laugh Riot ({YEAR})"]
    assert len(member["reviews"]) == 10 and set(member["reviews"][0]) == {"title", "year", "reaction", "summary"}
    assert member["reviews"][0] == {"title": "Film 2", "year": YEAR, "reaction": "liked", "summary": "s"}
    assert member["new"] is False


def test_old_profiles_get_the_new_fields():
    async def scenario():
        p = make()
        await p._store.put(p._key("profile", "ayse"), {"id": "ayse", "name": "Ayse", "watched": [], "notes": []})
        await p._store.put(p._key("profiles"), {"ids": ["ayse"]})
        return await p.get_profiles()

    (member,) = run(scenario())
    assert member == {"name": "Ayse", "age": None, "kid": False, "genres": [], "favorites": [], "favorites_done": False,
                      "reviews": [], "new": True}


def test_edit_name_and_age_and_delete():
    async def scenario():
        p = make()
        await p.set_couch([{"name": "Ayse", "age": 30}, {"name": "Can"}])
        with pytest.raises(PopcornError, match="name, an age"):
            await p.edit_person("Can")
        with pytest.raises(PopcornError, match="already someone"):
            await p.edit_person("Can", new_name="ayse")
        both = await p.edit_person("Can", new_name="Cem", age=9)
        cleared = await p.edit_person("cem", age=None)
        adult = await p.edit_person("Cem", age=20)
        gone = await p.delete_person("Cem")
        return both, cleared, adult, gone, await p.tv_state()

    both, cleared, adult, gone, state = run(scenario())
    assert both["memory"]["name"] == "Cem" and both["memory"]["kid"] is True
    assert cleared["memory"]["age"] is None and cleared["memory"]["kid"] is True  # kid stays
    assert adult["memory"]["kid"] is False and gone == {"deleted": "Cem"}
    assert [m["name"] for m in state["members"]] == ["Ayse"] and state["message"] == "Cem was deleted"


def test_save_genres_takes_aliases_and_needs_one_known_name():
    async def scenario():
        p = make()
        await p.set_couch([{"name": "Ayse"}])
        saved = await p.save_genres("Ayse", ["sci-fi", "tragedy", "Comedy"])
        with pytest.raises(PopcornError, match="at least one genre"):
            await p.save_genres("Ayse", ["tragedy", "nonsense"])
        with pytest.raises(PopcornError, match="don't know"):
            await p.save_genres("Nobody", ["Comedy"])
        return saved, await p._require_profile("ayse")

    saved, profile = run(scenario())
    assert profile["genres"] == ["Science Fiction", "Comedy"]  # exact TMDB names, in the order given
    assert saved["unknown_genres"] == ["tragedy"]


# ---------- favorites ----------


def test_genres_save_opens_favorites():
    async def scenario():
        p = make()
        await p.set_couch([{"name": "Ayse"}])
        saved = await p.save_genres("Ayse", ["Action", "Comedy"])
        state = await p.get_state()
        return saved, state

    saved, state = run(scenario())
    assert state["screen"] == "favorites"
    assert state["favorites"]["name"] == "Ayse"
    assert state["favorites"]["picked"] == []
    assert state["favorites"]["min"] == 5
    assert state["favorites"]["max"] == 25
    assert saved["favorites"]["name"] == "Ayse"


def test_toggle_pick_and_unpick():
    async def scenario():
        p = make()
        await p.seed_catalog()
        await p.set_couch([{"name": "Ayse"}])
        await p.save_genres("Ayse", ["Comedy"])
        # pick film 1
        await p.toggle_favorite(1)
        s1 = await p.get_state()
        # pick film 2
        await p.toggle_favorite(2)
        s2 = await p.get_state()
        # unpick film 1
        await p.toggle_favorite(1)
        s3 = await p.get_state()
        return s1, s2, s3

    s1, s2, s3 = run(scenario())
    assert [c["id"] for c in s1["favorites"]["picked"]] == [1]
    assert [c["id"] for c in s2["favorites"]["picked"]] == [1, 2]
    assert [c["id"] for c in s3["favorites"]["picked"]] == [2]


def test_26th_pick_refused():
    async def scenario():
        p = make()
        await p.set_couch([{"name": "Ayse"}])
        await p.save_genres("Ayse", ["Comedy"])
        genres = await p._tmdb.genres()
        state = await p.get_state()
        state["favorites"]["results"] = [
            p._fav_card({"id": i, "title": f"Film {i}", "poster_path": f"/{i}.jpg", "release_date": "2024-01-01", "vote_average": 7.0}, genres)
            for i in range(1, 30)
        ]
        await p._save_state(state)
        for i in range(1, 26):
            await p.toggle_favorite(i)
        s25 = await p.get_state()
        with pytest.raises(PopcornError, match="You can pick up to 25 films"):
            await p.toggle_favorite(26)
        return s25

    s25 = run(scenario())
    assert len(s25["favorites"]["picked"]) == 25


def test_done_with_fewer_than_5_refused_with_5_saves_and_goes_to_couch():
    async def scenario():
        p = make()
        await p.seed_catalog()
        await p.set_couch([{"name": "Ayse"}])
        await p.save_genres("Ayse", ["Comedy"])
        for i in range(1, 5):
            await p.toggle_favorite(i)
        with pytest.raises(PopcornError, match="Pick at least 5 films"):
            await p.done_favorites()
        await p.toggle_favorite(5)
        done = await p.done_favorites()
        state = await p.get_state()
        profile = await p._require_profile("ayse")
        return done, state, profile

    done, state, profile = run(scenario())
    assert done["done"] is True
    assert state["screen"] == "couch"
    assert state["favorites"] is None
    assert state["message"] == "Got it! Ayse's taste is saved."
    assert profile["favorites_done"] is True
    assert len(profile["favorites"]) == 5
    assert [f["id"] for f in profile["favorites"]] == [1, 2, 3, 4, 5]


def test_back_keeps_picks_and_popcorn_reopens_them():
    async def scenario():
        p = make()
        await p.seed_catalog()
        await p.set_couch([{"name": "Ayse"}])
        await p.save_genres("Ayse", ["Comedy"])
        await p.toggle_favorite(1)
        await p.toggle_favorite(2)
        await p.go_to("couch")
        s_back = await p.get_state()
        resumed = await p.open_ask()
        s_resumed = await p.get_state()
        return s_back, resumed, s_resumed

    s_back, resumed, s_resumed = run(scenario())
    assert s_back["screen"] == "couch"
    assert s_back["favorites"] is not None
    assert [c["id"] for c in s_back["favorites"]["picked"]] == [1, 2]
    assert resumed["screen"] == "favorites"
    assert s_resumed["screen"] == "favorites"
    assert [c["id"] for c in s_resumed["favorites"]["picked"]] == [1, 2]


def test_search_results_kid_filtered():
    async def scenario():
        p = make()
        await p.set_couch([{"name": "Can", "age": 9}])
        await p.save_genres("Can", ["Action"])
        await p.query_favorites("film")
        kid_state = await p.get_state()

        p2 = make()
        await p2.set_couch([{"name": "Ayse", "age": 30}])
        await p2.save_genres("Ayse", ["Action"])
        await p2.query_favorites("film")
        adult_state = await p2.get_state()

        return kid_state["favorites"]["results"], adult_state["favorites"]["results"]

    kid_res, adult_res = run(scenario())
    kid_ids = {c["id"] for c in kid_res}
    adult_ids = {c["id"] for c in adult_res}
    assert 2 not in kid_ids  # Night Terror is R-rated
    assert 3 in kid_ids      # Space Kids is PG
    assert 2 in adult_ids    # Night Terror is allowed for adult


def test_catalog_doc_built_with_no_film_twice_and_kid_filtered_on_read():
    async def scenario():
        p = make()
        await p.seed_catalog()
        doc = await p._store.get("favcat")
        pop_ids = [c["id"] for c in doc["popular"]]
        best_ids = [c["id"] for c in doc["best"]]

        await p.set_couch([{"name": "Can", "age": 9}])
        await p.save_genres("Can", ["Thriller"])
        kid_cat = await p.get_favorites_catalog()

        await p.set_couch([{"name": "Ayse", "age": 30}])
        await p.save_genres("Ayse", ["Thriller"])
        adult_cat = await p.get_favorites_catalog()

        return doc, pop_ids, best_ids, kid_cat, adult_cat

    doc, pop_ids, best_ids, kid_cat, adult_cat = run(scenario())
    assert "built_at" in doc
    assert len(pop_ids) == len(set(pop_ids))
    assert len(best_ids) == len(set(best_ids))
    assert not (set(pop_ids) & set(best_ids))

    def ids(cat):
        return {c["id"] for c in [f for g in cat["for_you"] for f in g["films"]] + cat["popular"] + cat["best"]}

    assert not {2, 21} & ids(kid_cat)  # Night Terror and Last Train (R) filtered out for the kid
    assert {2, 21} <= ids(adult_cat)   # both allowed for the adult


def test_catalog_has_a_list_per_genre_kid_filtered_and_pickable():
    async def scenario():
        p = make()
        await p.set_couch([{"name": "Can", "age": 9}])
        await p.save_genres("Can", ["Comedy", "Horror"])
        kid_cat = await p.get_favorites_catalog()
        await p.toggle_favorite(13)  # Puppy Parade: only in the Comedy list
        state = await p.get_state()

        await p.set_couch([{"name": "Ayse", "age": 30}])
        await p.save_genres("Ayse", ["Horror"])
        adult_cat = await p.get_favorites_catalog()
        return kid_cat, state, adult_cat

    kid_cat, state, adult_cat = run(scenario())
    comedy = [s for s in kid_cat["for_you"] if s["genre"] == "Comedy"][0]["films"]
    assert {5, 11, 13} <= {c["id"] for c in comedy} and 1 not in {c["id"] for c in comedy}  # Laugh Riot is PG-13
    assert all("Comedy" in c["genres"] for c in comedy)
    # no film twice on the page
    ids = [c["id"] for s in kid_cat["for_you"] for c in s["films"]] + [c["id"] for c in kid_cat["popular"] + kid_cat["best"]]
    assert len(ids) == len(set(ids))
    # the horror films are R-rated: no Horror list for the kid, one with Night Terror for the adult
    assert "Horror" not in [s["genre"] for s in kid_cat["for_you"]]
    assert 2 in [c["id"] for c in adult_cat["for_you"][0]["films"]]
    assert [c["id"] for c in state["favorites"]["picked"]] == [13]
    # popular and best keep only films of the person's genres
    assert all({"Comedy", "Horror"} & set(c["genres"]) for c in kid_cat["popular"] + kid_cat["best"])
    assert all("Horror" in c["genres"] for c in adult_cat["popular"] + adult_cat["best"])


def test_recommender_prompt_has_favorite_films():
    async def scenario():
        llm = FakeLLM([twelve()])
        p = make(llm=llm)
        await seeded(p)
        await p.recommend()
        return llm.last_user

    prompt = run(scenario())
    assert "Favorite films: Laugh Riot (2024); Night Terror (2024); Space Kids (2024); Star War Zone (2024); Toon Town (2024)" in prompt
    assert "Duel picks:" not in prompt





# ---------- picks ----------


def test_recommend_keeps_ten_and_carries_each_why_by_id():
    async def scenario():
        llm = FakeLLM([picks(("Laugh Riot", 2024, "why laugh"),
                             ("Lost Poster", 2024, "why lost"),  # found, but has no poster: dropped
                             ("Star War Zone", 1999, "why star"),  # the year misses, the title alone hits
                             ("Love Story", 2024, "why love"), ("Big Heist", 2024, "why heist"),
                             ("Puzzle Box", 2024, "why puzzle"), ("Laugh Riot", 2024, "why dupe"),
                             ("Nope Not A Film", 2024, "why nope"), ("Hero Hour", 2024, "why hero"),
                             ("Fairy Path", 2024, "why fairy"), ("Dance Off", 2024, "why dance"),
                             ("Space Kids", 2024, "why space"), ("Toon Town", 2024, "why toon"),
                             ("Ocean Life", 2024, "why ocean"))])
        polly = FakePolly()
        p = make(polly, llm)
        llm.popcorn = p
        await p.set_couch([{"name": "Ayse", "age": 40}, {"name": "Bedirhan", "age": 43}])
        result = await p.recommend()
        return result, await p.get_state(), llm, polly

    result, state, llm, polly = run(scenario())
    cards = result["recommendations"]
    assert len(cards) == 10 and state["recommendations"] == cards and state["screen"] == "recommendations"
    assert [c["title"] for c in cards] == ["Laugh Riot", "Star War Zone", "Love Story", "Big Heist", "Puzzle Box",
                                          "Hero Hour", "Fairy Path", "Dance Off", "Space Kids", "Toon Town"]
    assert [c["why"] for c in cards] == ["why laugh", "why star", "why love", "why heist", "why puzzle", "why hero",
                                         "why fairy", "why dance", "why space", "why toon"]
    assert cards[1]["year"] == YEAR and all("match" not in c for c in cards)
    assert all(c["why_audio"].startswith("/api/voice/") and c["why_audio"].endswith(".wav") for c in cards)
    assert polly.texts == [c["why"] for c in cards]
    assert llm.loading_seen is True and state["picks_loading"] is False  # the TV saw the call running
    assert len(llm.requests) == 1 and llm.requests[0]["temperature"] == 0.5
    assert "Suggest 12 films" in llm.system and "name" not in llm.system.lower()
    assert "Ayse (40)\nGenres: not chosen yet" in llm.last_user
    assert "Duel picks:" not in llm.last_user and "Do not suggest these again" not in llm.last_user
    assert [(s["id"], s["title"], s["year"]) for s in state["shown_tonight"]] == [(c["id"], c["title"], c["year"])
                                                                                 for c in cards]


def test_recommend_for_a_kid_drops_unsafe_films_and_writes_the_kid_rule():
    async def scenario():
        llm = FakeLLM([picks(("Night Terror", 2024, "why scary"),        # R
                             ("Unrated Gem", 2024, "why unrated"),        # no US certification
                             ("Laugh Riot", 2024, "why laugh"))           # PG-13
                            ])
        llm.replies[0]["picks"] += [{"title": t, "year": 2024, "why": f"why {t}"} for t in PICKS_10]
        p = make(llm=llm)
        await p.set_couch([{"name": "Ayse", "age": 40}, {"name": "Can", "age": 8}])
        result = await p.recommend()
        return result, llm

    result, llm = run(scenario())
    titles = [c["title"] for c in result["recommendations"]]
    assert titles == PICKS_10 and "Night Terror" not in titles and "Laugh Riot" not in titles
    rule = ("Can is 8. Only films rated US PG or lower that suit that age: "
            "no horror, strong violence, sexual content or strong language.")
    assert rule in llm.last_user
    assert "Ayse (40)\nGenres: not chosen yet" in llm.last_user and "Can (8)" in llm.last_user


def test_more_asks_without_this_evenings_films():
    async def scenario():
        llm = FakeLLM([twelve()])
        p = make(llm=llm)
        await p.set_couch([{"name": "Ayse"}])
        first = await p.recommend()
        second = await p.recommend(more=True)
        return first, second, llm, await p.get_state()

    first, second, llm, state = run(scenario())
    first_titles = [f"{c['title']} ({c['year']})" for c in first["recommendations"]]
    user = llm.requests[1]["messages"][-1]["content"]
    assert user.endswith("Do not suggest these again: " + ", ".join(first_titles))
    assert "Do not suggest these again" not in llm.requests[0]["messages"][-1]["content"]
    assert len(state["shown_tonight"]) == 20 and second["recommendations"]


def test_recommend_retries_once_then_shows_the_picks():
    async def scenario():
        llm = FakeLLM([picks(("Laugh Riot", 2024, "why one")), twelve()])
        p = make(llm=llm)
        await p.set_couch([{"name": "Ayse"}])
        return await p.recommend(), llm

    result, llm = run(scenario())
    assert len(result["recommendations"]) == 10 and len(llm.requests) == 2


def test_recommend_gives_up_after_one_retry():
    async def scenario():
        llm = FakeLLM([picks(*[("Laugh Riot", 2024, "why laugh")] * 3 + [("Nope Not A Film", 2024, "why nope")])])
        p = make(llm=llm)
        await p.set_couch([{"name": "Ayse"}])
        with pytest.raises(service.LLMError, match="enough films"):
            await p.recommend()
        return await p.get_state(), llm

    state, llm = run(scenario())
    assert len(llm.requests) == 2  # one retry, then the error
    assert state["picks_loading"] is False and state["recommendations"] == [] and state["screen"] == "genres"


def test_recommend_needs_a_couch_and_an_llm():
    async def scenario():
        without = Popcorn(MemoryStore(), FakeTMDB(), "test")
        await without.set_couch([{"name": "Ayse"}])
        return without

    with pytest.raises(PopcornError, match="couch is empty"):
        run(make().recommend())
    with pytest.raises(PopcornError, match="not set up"):
        run(run(scenario()).recommend())



# ---------- what they feel like tonight ----------


def test_popcorn_opens_the_ask_screen_once_everyone_is_set():
    async def scenario():
        p = make()
        await p.seed_catalog()
        await seeded(p)
        result = await p.open_ask()
        return result, await p.get_state()

    result, state = run(scenario())
    assert result == {"screen": "ask"} and state["screen"] == "ask" and state["ask_reply"] == ""


def test_popcorn_sends_an_unfinished_person_back_to_their_genres_or_favorites():
    async def scenario():
        p = make()
        await p.seed_catalog()
        await p.set_couch([{"name": "Can", "age": 9}])
        no_genres = await p.open_ask()
        await p.save_genres("Can", ["Comedy"])  # favorites opens
        await p.toggle_favorite(1)
        await p.go_to("couch")  # Back in the middle of favorites
        resumed = await p.open_ask()
        return no_genres, resumed, await p.get_state()

    no_genres, resumed, state = run(scenario())
    assert no_genres == {"screen": "genres", "genres_for": "Can"}
    assert resumed["screen"] == "favorites" and [c["id"] for c in resumed["favorites"]["picked"]] == [1]
    assert state["screen"] == "favorites"


def test_a_wish_is_checked_then_goes_into_the_picks():
    async def scenario():
        llm = FakeLLM([{"verdict": "ok", "request": "A light comedy"}, twelve()])
        p = make(llm=llm)
        await p.seed_catalog()
        await seeded(p)
        await p.open_ask()
        result = await p.ask("bir komedi olsun, hafif")
        more = await p.recommend(more=True)
        return result, more, llm, await p.get_state()

    result, more, llm, state = run(scenario())
    check = llm.requests[0]["messages"]
    assert check[-1]["content"] == "bir komedi olsun, hafif" and "Ayse" not in check[-1]["content"]
    assert llm.requests[0]["temperature"] == 0 and '"verdict"' in check[0]["content"]
    assert result["ok"] is True and len(result["recommendations"]) == 10
    assert "Tonight they feel like: A light comedy" in llm.requests[1]["messages"][-1]["content"]
    assert "Tonight they feel like: A light comedy" in llm.requests[2]["messages"][-1]["content"]  # New picks keep it
    assert state["screen"] == "recommendations" and state["request"] == "A light comedy" and more["recommendations"]


def test_a_wish_it_cannot_help_with_stays_on_the_ask_screen():
    async def scenario():
        llm = FakeLLM([{"verdict": "recent", "request": ""}])
        p = make(FakePolly(), llm)
        await p.seed_catalog()
        await seeded(p)
        await p.open_ask()
        recent = await p.ask("this year's new films")
        llm.replies = [{"verdict": "no", "request": ""}]
        off = await p.ask("what's the weather")
        llm.replies = [None]
        garbage = await p.ask("asdf")
        calls = len(llm.requests)
        blank = await p.ask("  ?? ")
        return recent, off, garbage, blank, calls, len(llm.requests), await p.get_state()

    recent, off, garbage, blank, calls, calls_after, state = run(scenario())
    assert recent == {"ok": False, "reply": service.ASK_RECENT}
    assert "last two years" in service.ASK_RECENT and "cinemas" in service.ASK_RECENT
    assert off == garbage == blank == {"ok": False, "reply": service.ASK_SORRY}
    assert calls_after == calls  # nothing to check, so no LLM call
    assert state["screen"] == "ask" and state["ask_reply"] == service.ASK_SORRY and state["recommendations"] == []
    assert state["speech"][-1]["text"] == service.ASK_SORRY


def test_skip_asks_without_a_wish_and_a_new_couch_forgets_it():
    async def scenario():
        llm = FakeLLM([{"verdict": "ok", "request": "Something scary"}, twelve()])
        p = make(llm=llm)
        await p.seed_catalog()
        await seeded(p)
        await p.ask("scary")
        after_wish = (await p.get_state())["request"]
        await p.recommend(request="")  # Skip
        skipped = llm.last_user
        await p.ask("scary")
        await p.add_to_couch("Bedirhan", 43)
        return after_wish, skipped, (await p.get_state())["request"]

    after_wish, skipped, after_couch = run(scenario())
    assert after_wish == "Something scary" and "Tonight they feel like" not in skipped and after_couch == ""


# ---------- the rating ----------


async def _family_rating(p, movie="Laugh Riot"):
    await p.set_couch([{"name": "Bedirhan"}, {"name": "Ayse"}, {"name": "Can", "age": 9}])
    await p.open_details(1)
    await p.start_watching(1, "Amazon Prime Video")
    return await p.start_rating(movie)


def test_rating_saves_reviews_instead_of_watched():
    async def scenario():
        p = make()
        started = await _family_rating(p)
        voice = await p.record_reaction("Bedirhan", "loved", "honestly a bit long but I loved it")
        hand = await p.record_reaction("Ayse", "disliked", "ignored for a button", by="hand")
        last = await p.skip_turn()
        return started, voice, hand, last, await p.get_state(), {
            n: await p._require_profile(n) for n in ("bedirhan", "ayse", "can")}

    started, voice, hand, last, state, profiles = run(scenario())
    assert started["rating"]["people"] == ["Bedirhan", "Ayse", "Can"] and started["rating"]["asking"] == "Bedirhan"
    assert voice == {"saved": "Bedirhan", "reaction": "loved", "next": "Ayse", "done": False}
    assert hand["next"] == "Can" and last["done"] is True
    answers = state["rating"]["answers"]
    assert answers["Bedirhan"] == {"reaction": "loved", "skipped": False, "by": "voice",
                                   "quote": "honestly a bit long but I loved it"}
    assert answers["Ayse"] == {"reaction": "disliked", "skipped": False, "by": "hand", "quote": ""}
    assert answers["Can"] == {"reaction": None, "skipped": True, "by": "skip", "quote": ""}
    assert state["screen"] == "rating" and state["message"] == "Saved: Laugh Riot"
    review = profiles["bedirhan"]["reviews"][0]
    assert (review["id"], review["title"], review["year"], review["reaction"], review["summary"]) == (
        1, "Laugh Riot", YEAR, "loved", "honestly a bit long but I loved it")
    assert [r["reaction"] for r in profiles["ayse"]["reviews"]] == ["disliked"]
    assert profiles["can"]["reviews"] == []  # a skip is not an opinion
    assert all(not {"watched", "liked", "disliked"} & set(profile) for profile in profiles.values())


def test_a_new_review_for_the_same_film_replaces_it():
    async def scenario():
        p = make()
        await p.set_couch([{"name": "Ayse"}])
        await p.start_rating("Laugh Riot")
        await p.record_reaction("Ayse", "meh")
        first = await p._require_profile("ayse")
        await p.start_rating("Toon Town")
        await p.record_reaction("Ayse", "loved")
        await p.start_rating("Laugh Riot")
        await p.record_reaction("Ayse", "liked")
        return first["reviews"], (await p._require_profile("ayse"))["reviews"]

    first, after = run(scenario())
    assert [(r["title"], r["reaction"]) for r in first] == [("Laugh Riot", "meh")]
    assert [(r["title"], r["reaction"]) for r in after] == [("Toon Town", "loved"), ("Laugh Riot", "liked")]


def test_rating_voice_saves_the_llm_summary():
    async def scenario():
        llm = FakeLLM([{"reaction": "loved", "summary": "Really funny, we clapped"}])
        p = make(llm=llm)
        await _family_rating(p, "Toon Town")
        result = await p.voice_reaction("I loved it, so funny and sweet", None)
        await p.skip_turn()
        await p.skip_turn()  # the last answer saves the reviews
        state = await p.get_state()
        profile = await p._require_profile("bedirhan")
        return result, state, profile, llm

    result, state, profile, llm = run(scenario())
    assert result == {"saved": "Bedirhan", "reaction": "loved", "next": "Ayse", "done": False}
    assert state["rating"]["answers"]["Bedirhan"] == {"reaction": "loved", "skipped": False, "by": "voice",
                                                      "quote": "Really funny, we clapped"}
    assert profile["reviews"][0]["summary"] == "Really funny, we clapped"
    assert profile["reviews"][0]["reaction"] == "loved"
    assert "Film: Toon Town (2024)" in llm.last_user and "They said: I loved it, so funny and sweet" in llm.last_user
    assert llm.requests[0]["temperature"] == 0 and llm.requests[0]["effort"] == "low"


def test_rating_voice_caps_the_summary_at_fifteen_words():
    async def scenario():
        llm = FakeLLM([{"reaction": "meh", "summary": " ".join(f"word{i}" for i in range(30))}])
        p = make(llm=llm)
        await _family_rating(p)
        result = await p.voice_reaction("it was okay I guess", None)
        return result, await p.get_state()

    result, state = run(scenario())
    assert len(state["rating"]["answers"]["Bedirhan"]["quote"].split()) == 15
    assert result["reaction"] == "meh"


def test_rating_voice_rejects_unclear_answers():
    async def scenario():
        p = make(llm=FakeLLM([None]))
        await _family_rating(p)
        for text in ("", "   ", "..."):
            with pytest.raises(PopcornError, match="didn't catch that"):
                await p.voice_reaction(text, None)
        with pytest.raises(PopcornError, match="didn't catch that"):  # the model answered no JSON
            await p.voice_reaction("I liked it a lot", None)
        return await p.get_state()

    state = run(scenario())
    assert state["rating"]["answers"] == {}


def test_rating_voice_rejects_a_reaction_the_model_invented():
    async def scenario():
        p = make(llm=FakeLLM([{"reaction": "amazing", "summary": "so good"}]))
        await _family_rating(p)
        with pytest.raises(PopcornError, match="didn't catch that"):
            await p.voice_reaction("I thought it was great", None)

    run(scenario())


def test_rating_errors_and_finish_early():
    async def scenario():
        p = make()
        await _family_rating(p)
        with pytest.raises(PopcornError, match="Zeynep is not in this rating"):
            await p.record_reaction("Zeynep", "loved")
        done = await p.finish_rating()
        again = await p.finish_rating()
        with pytest.raises(PopcornError, match="already saved"):
            await p.record_reaction("Ayse", "loved")
        return done, again, await p.get_state()

    done, again, state = run(scenario())
    assert done["done"] and again["done"] and state["rating"]["answers"] == {}
    assert state["message"] == "Saved: Laugh Riot"
    with pytest.raises(PopcornError, match="Which movie"):
        run(_nothing_to_rate())


async def _nothing_to_rate():
    p = make()
    await p.set_couch([{"name": "Ayse"}])
    await p.start_rating()


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
    assert from_details["rating"]["movie"] == {"id": 3, "title": "Space Kids", "year": YEAR,
                                               "poster": "https://image.tmdb.org/t/p/w342/3.jpg",
                                               "genres": ["Science Fiction", "Family", "Animation"]}


def test_go_to_clears_details_watching_and_rating():
    async def scenario():
        p = make()
        await _family_rating(p)
        await p.go_to("couch")
        return await p.get_state()

    state = run(scenario())
    assert state["screen"] == "couch"
    assert state["details"] is None and state["watching"] is None and state["rating"] is None
    with pytest.raises(PopcornError):
        run(make().go_to("duel"))


def test_voice_state_throttle_and_rating_live_copy():
    async def scenario():
        p = make()
        await _family_rating(p)
        first = await p.set_voice("listening", "I", "Bedirhan")
        fast = await p.set_voice("listening", "I loved", "Bedirhan")  # within 250 ms: dropped
        thinking = await p.set_voice("thinking", "I loved it")  # state change always lands
        return first, fast, thinking, await p.get_state()

    first, fast, thinking, state = run(scenario())
    assert first["changed"] and not fast["changed"] and thinking["changed"]
    assert state["voice"]["state"] == "thinking" and state["rating"]["live"] == "I loved it"


def test_speech_keeps_six_and_survives_tts_failure():
    async def scenario():
        p = make(FakePolly(fail=True))
        await _family_rating(p)
        return await p.get_state()

    state = run(scenario())
    assert [s["id"] for s in state["speech"]] == [1]  # one line: the rating question
    assert state["speech"][0]["text"] == "How was Laugh Riot? Bedirhan, what did you think?"
    assert all(s["audio"] is None for s in state["speech"])


# ---------- HTTP ----------


def client(p=None) -> TestClient:
    return TestClient(create_app(p or make()), base_url="http://127.0.0.1:8000")


def test_http_state_has_the_v3_fields_and_no_old_ones():
    with client() as c:
        state = c.get("/api/state").json()
        assert state["screen"] == "couch" and state["genres_for"] is None
        assert state["picks_loading"] is False and state["shown_tonight"] == [] and state["recommendations"] == []
        assert "boost" not in state and "pool" not in state
        assert state["speech"] == [] and state["voice"]["state"] == "idle" and state["members"] == []
        assert {"version", "updated_at", "household", "favorites", "details", "watching", "rating", "focus"} <= set(state)
        assert "duel" not in state


def test_http_genres_couch_and_person():
    p = make()
    with client(p) as c:
        genres = c.get("/api/genres").json()["genres"]
        assert {"id": 28, "name": "Action"} in genres and len(genres) == len(GENRES) - 1
        assert "TV Movie" not in [g["name"] for g in genres]
        assert c.post("/api/couch", json={}).status_code == 400
        assert c.post("/api/couch", json={"add": "Ayse", "age": "9"}).status_code == 400
        added = c.post("/api/couch", json={"add": "Ayse", "age": 30}).json()
        assert added["new_people"] == ["Ayse"] and added["genres_for"] == "Ayse"
        state = c.get("/api/state").json()
        assert state["screen"] == "genres" and state["genres_for"] == "Ayse"
        assert state["members"][0] == {"name": "Ayse", "age": 30, "kid": False, "genres": [], "favorites": [],
                                       "favorites_done": False, "reviews": [], "new": True}
        assert c.post("/api/person", json={"name": "Ayse", "genres": []}).status_code == 400
        assert c.post("/api/person", json={"name": "Ayse", "genres": ["Nonsense"]}).status_code == 400
        assert c.post("/api/person", json={"name": "Ayse", "genres": [1]}).status_code == 400
        saved = c.post("/api/person", json={"name": "Ayse", "genres": ["Comedy", "Mystery"]}).json()
        assert saved["memory"]["genres"] == ["Comedy", "Mystery"] and saved["favorites"]["name"] == "Ayse"
        assert c.get("/api/state").json()["screen"] == "favorites"
        assert c.post("/api/couch", json={"remove": "Ayse"}).json()["couch"] == []
        assert c.post("/api/couch", json={"remove": "Ayse"}).status_code == 400
        assert c.post("/api/person", json={"delete": "Ayse"}).json() == {"deleted": "Ayse"}


def test_http_person_edit_and_favorites_routes():
    p = make()
    with client(p) as c:
        c.post("/api/couch", json={"add": "Ayse", "age": 30})
        assert c.post("/api/person", json={"edit": "Ayse"}).status_code == 400
        assert c.post("/api/person", json={"edit": "Ayse", "age": "9"}).status_code == 400
        assert c.post("/api/person", json={"edit": "Nobody", "age": 9}).status_code == 400
        edited = c.post("/api/person", json={"edit": "Ayse", "name": "Aysel", "age": 12}).json()
        assert edited["memory"]["name"] == "Aysel" and edited["memory"]["kid"] is True
        assert c.get("/api/favorites/catalog").status_code == 400
        assert c.post("/api/favorites", json={}).status_code == 400
        assert c.post("/api/favorites", json={"start": ""}).status_code == 400
        assert c.post("/api/favorites", json={"toggle": "not-int"}).status_code == 400
        assert c.post("/api/favorites", json={"done": False}).status_code == 400


def test_http_favorites_from_the_catalog_and_recommend():
    llm = FakeLLM([twelve()])
    p = make(llm=llm)
    with client(p) as c:
        c.post("/events", json={"popcorn": "seed_catalog"})
        c.post("/api/couch", json={"add": "Ayse"})
        saved = c.post("/api/person", json={"name": "Ayse", "genres": ["Comedy"]}).json()
        assert saved["favorites"]["name"] == "Ayse"
        state = c.get("/api/state").json()
        assert state["screen"] == "favorites" and state["favorites"]["picked"] == []

        cat = c.get("/api/favorites/catalog").json()
        assert cat["for_you"][0]["genre"] == "Comedy" and cat["for_you"][0]["films"]
        assert all("Comedy" in f["genres"] for f in cat["for_you"][0]["films"] + cat["popular"] + cat["best"])

        for i in range(1, 6):
            t = c.post("/api/favorites", json={"toggle": i}).json()
            assert len(t["favorites"]["picked"]) == i

        q = c.post("/api/favorites", json={"query": "Riot"}).json()
        assert any(r["title"] == "Laugh Riot" for r in q["favorites"]["results"])

        done = c.post("/api/favorites", json={"done": True}).json()
        assert done["done"] is True
        assert c.get("/api/state").json()["screen"] == "couch"
        assert c.get("/api/state").json()["members"][0]["favorites_done"] is True

        assert c.post("/api/recommend", json={"more": "yes"}).status_code == 400
        shown = c.post("/api/recommend", json={"more": False}).json()["recommendations"]
        assert len(shown) == 10
        state = c.get("/api/state").json()
        assert state["screen"] == "recommendations" and state["picks_loading"] is False
        assert len(state["shown_tonight"]) == 10
        assert c.post("/api/recommend").json()["recommendations"]  # no body: more = false


def test_http_recommend_failure_is_a_502_and_clears_the_loading_flag():
    p = make(llm=FakeLLM([{"picks": []}]))
    with client(p) as c:
        c.post("/api/couch", json={"add": "Ayse"})
        failed = c.post("/api/recommend", json={"more": False})
        assert failed.status_code == 502 and "enough films" in failed.json()["error"]
        assert c.get("/api/state").json()["picks_loading"] is False


def test_http_removed_routes_are_gone():
    with client() as c:
        assert c.post("/api/seen", json={"movie_id": 1}).status_code == 404
        assert c.post("/api/duel", json={"pick": "left"}).status_code == 404
        assert c.post("/api/duel/start", json={"name": "Ayse"}).status_code == 404
        assert c.post("/api/duel/warm").status_code == 404
        assert c.post("/api/speech", json={"text": "hi"}).status_code == 404
        assert c.get("/api/rating").status_code == 404


def test_http_events_seed_the_catalog_only():
    p = make()
    with client(p) as c:
        first = c.post("/events", json={"popcorn": "seed_catalog"})
        assert first.status_code == 200 and first.json() == {"built": ["favcat"], "remaining": []}
        assert c.post("/events", json={"popcorn": "seed_catalog"}).json() == {"built": [], "remaining": []}
        assert c.post("/events", json={"popcorn": "seed_duel_catalog"}).status_code == 400
        assert c.post("/events", json={"popcorn": "refresh_duel_pools"}).status_code == 400
        assert c.post("/events", json={}).status_code == 400
        assert c.post("/events", content=b"not json").status_code == 400


def test_http_rating_routes():
    with client() as c:
        c.post("/api/couch", json={"add": "Ayse", "age": 30})
        c.post("/api/couch", json={"add": "Can", "age": 9})
        assert c.post("/api/details", json={"movie_id": "1"}).status_code == 400
        assert c.post("/api/details", content=b"not json").status_code == 400
        assert c.post("/api/details", json={"movie_id": 1}).json()["providers"]
        assert c.post("/api/focus", json={"movie_id": 1}).status_code == 200
        assert c.post("/api/watch", json={"movie_id": 1}).status_code == 400
        assert c.post("/api/watch", json={"movie_id": 1, "provider": "Amazon Prime Video"}).status_code == 200
        assert c.post("/api/screen", json={"screen": "duel"}).status_code == 400
        assert c.post("/api/rating/live", json={"text": "hi"}).status_code == 400  # no rating yet
        assert c.post("/api/rating/start").json()["rating"]["asking"] == "Ayse"
        assert c.post("/api/rating/live", json={"text": "I loved"}).json()["changed"] is True
        assert c.post("/api/rating/answer", json={"name": "Ayse", "reaction": "great"}).status_code == 400
        assert c.post("/api/rating/answer", json={"name": "Zeynep", "reaction": "liked"}).status_code == 400
        assert c.post("/api/rating/answer", json={"name": "Ayse", "reaction": "liked"}).json()["next"] == "Can"
        assert c.post("/api/rating/skip", json={}).json()["done"] is True
        assert c.post("/api/rating/finish").json()["done"] is True
        state = c.get("/api/state").json()
        assert state["rating"]["done"] and state["message"] == "Saved: Laugh Riot"
        assert c.post("/api/screen", json={"screen": "couch"}).status_code == 200
        assert c.get("/api/state").json()["rating"] is None


def test_http_rating_voice():
    llm = FakeLLM([{"reaction": "liked", "summary": "Funny and warm"}])
    with client(make(llm=llm)) as c:
        c.post("/api/couch", json={"add": "Ayse"})
        c.post("/api/couch", json={"add": "Can", "age": 9})
        c.post("/api/details", json={"movie_id": 5})  # Toon Town
        assert c.post("/api/rating/start").status_code == 200
        assert c.post("/api/rating/voice", json={"text": ""}).status_code == 400
        assert c.post("/api/rating/voice", json={"text": "...", "name": 5}).status_code == 400
        answer = c.post("/api/rating/voice", json={"text": "It was funny and warm"})
        assert answer.status_code == 200 and answer.json()["reaction"] == "liked"
        assert answer.json()["next"] == "Can"
        assert c.get("/api/state").json()["rating"]["answers"]["Ayse"]["quote"] == "Funny and warm"


def test_http_rating_voice_bad_json_is_a_400():
    with client(make(llm=FakeLLM([None]))) as c:
        c.post("/api/couch", json={"add": "Ayse"})
        c.post("/api/details", json={"movie_id": 5})
        c.post("/api/rating/start")
        bad = c.post("/api/rating/voice", json={"text": "It was funny and warm"})
        assert bad.status_code == 400 and bad.json()["error"] == "I didn't catch that, try again or use the buttons"


def test_http_qr_and_phone_routes_and_mcp_tools():
    with client() as c:
        qr = c.get("/api/qr.png", params={"url": "http://192.168.1.5:8000/phone/"})
        assert qr.status_code == 200 and qr.headers["content-type"] == "image/png" and qr.content[:4] == b"\x89PNG"
        assert c.get("/api/qr.png", params={"url": "javascript:alert(1)"}).status_code == 400
        assert c.get("/api/qr.png", params={"url": "https://a.b/" + "x" * 300}).status_code == 400
        page = c.get("/phone/")
        assert page.status_code == 200 and page.headers["content-type"].startswith("text/html")
        assert "Press Popcorn or open the rating on the TV to talk" in page.text
        app_js = c.get("/phone/app.js")
        assert app_js.headers["content-type"].startswith("text/javascript")
        assert "/api/rating/voice" in app_js.text and "/chat" not in app_js.text and "agent" not in app_js.text
        assert c.get("/phone/styles.css").headers["content-type"].startswith("text/css")
        assert c.get("/phone/secret.txt").status_code == 404
        assert c.get("/phone/..%2Fserver.py").status_code == 404

        headers = {"Accept": "application/json, text/event-stream", "Content-Type": "application/json",
                   "MCP-Protocol-Version": "2025-11-25"}
        listed = c.post("/mcp", headers=headers, json={"jsonrpc": "2.0", "id": 2, "method": "tools/list"})
        names = {t["name"] for t in listed.json()["result"]["tools"]}
        assert names == {"set_couch", "add_to_couch", "remove_from_couch", "get_profiles", "rename_person",
                         "save_genres", "recommend", "get_movie_details",
                         "start_rating", "record_reaction"}


def test_http_stateless_mcp_initializes():
    with client() as c:
        init = c.post("/mcp", headers={"Accept": "application/json, text/event-stream",
                                       "Content-Type": "application/json"}, json={
            "jsonrpc": "2.0", "id": 1, "method": "initialize",
            "params": {"protocolVersion": "2025-11-25", "capabilities": {},
                       "clientInfo": {"name": "test", "version": "1"}},
        })
        assert init.status_code == 200, init.text
        assert init.json()["result"]["protocolVersion"] == "2025-11-25"


# ---------- details, providers, voice and speech routes ----------


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
        return await p.get_movie_details("1"), await p.get_movie_details("2")  # 2: providers raise

    good, broken = run(scenario())
    assert good["backdrop"] == "https://image.tmdb.org/t/p/w1280/b1.jpg"
    assert len(good["providers"]) == 4 and good["providers_region"] == "US" and good["providers_link"]
    assert good["certification_us"] == "PG-13" and good["ok_for_this_couch"] is True
    assert broken["providers"] == [] and broken["providers_link"] is None and broken["title"] == "Night Terror"


def test_http_speech_voice_and_audio_routes():
    polly = FakePolly()
    with client(make(polly)) as c:
        c.post("/api/couch", json={"add": "Ayse"})
        c.post("/api/details", json={"movie_id": 5})
        c.post("/api/rating/start")
        speech = c.get("/api/state").json()["speech"]
        assert speech[0]["text"] == "How was Toon Town? Ayse, what did you think?"
        mp3 = c.get(speech[0]["audio"])
        assert mp3.status_code == 200 and mp3.headers["content-type"] == "audio/wav"
        assert mp3.content == b"ID3How was Toon Town? Ayse, what did you think?"
        assert "max-age=86400" in mp3.headers["cache-control"]
        assert c.get("/api/voice/" + "0" * 40 + ".wav").status_code == 404
        assert c.get("/api/voice/nothex.wav").status_code == 404
        assert c.post("/api/voice", json={"state": "talking"}).status_code == 400
        assert c.post("/api/voice", json={"state": "listening", "text": "I", "speaker": "Ayse"}).json()["changed"]
        voice = c.get("/api/state").json()["voice"]
        assert voice == {**voice, "state": "listening", "text": "I", "speaker": "Ayse"}


def stt_app(handler):
    stt = OpenRouterSTT("k", transport=httpx.MockTransport(handler))
    return TestClient(create_app(make(), transcriber=stt), base_url="http://127.0.0.1:8000")


def test_transcribe_route_shapes_and_empty_noise():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["path"], seen["ct"], seen["body"] = request.url.path, request.headers["content-type"], request.content
        if b"noise" in request.content:
            return httpx.Response(200, json={"text": "Thank you.", "segments": [{"text": "Thank you.", "no_speech_prob": 0.95}]})
        return httpx.Response(200, json={"text": " I loved  it ", "segments": [{"text": " I loved  it ", "no_speech_prob": 0.01}]})

    with stt_app(handler) as c:
        r = c.post("/api/transcribe", content=b"audio-bytes", headers={"Content-Type": "audio/webm;codecs=opus"})
        assert r.status_code == 200 and r.json() == {"text": "I loved it"}
        assert seen["path"] == "/api/v1/audio/transcriptions" and seen["ct"].startswith("multipart/form-data")
        assert b'name="model"' in seen["body"] and b"openai/whisper-large-v3-turbo" in seen["body"]
        assert c.post("/api/transcribe", content=b"noise", headers={"Content-Type": "audio/mp4"}).json() == {"text": ""}
        assert c.post("/api/transcribe", content=b"x" * (10 * 1024 * 1024 + 1)).status_code == 400


def test_transcribe_route_errors_are_plain_502():
    with stt_app(lambda request: httpx.Response(500, json={"error": {"message": "boom"}})) as c:
        r = c.post("/api/transcribe", content=b"a", headers={"Content-Type": "audio/webm"})
        assert r.status_code == 502 and "boom" not in r.json()["error"]
    with client() as c:
        assert c.post("/api/transcribe", content=b"a").status_code == 502


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
