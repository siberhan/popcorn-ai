"""Popcorn AI domain logic: couch, taste profiles, poster duel, recommendations.

The "TV state" document is what the TV app polls. Every tool that changes what
the TV should show writes it, so voice commands appear on screen.
"""

import asyncio
import time
from typing import Literal

from . import taste
from .store import Store
from .tmdb import TMDB, cert_allowed, poster_url, us_certification

# Genre id pairs for the poster duel: one poster per side, contrasting tastes.
DUEL_PAIRS = [(35, 27), (28, 10749), (16, 53), (878, 18), (12, 80)]
KID_DUEL_PAIRS = [(35, 14), (16, 28), (10751, 878), (12, 9648), (10402, 99)]

Reaction = Literal["loved", "liked", "meh", "disliked", "hated"]
REACTION_DELTA = {"loved": 0.3, "liked": 0.15, "meh": 0.0, "disliked": -0.2, "hated": -0.4}


class PopcornError(Exception):
    """A problem the user can fix. The message is shown to them."""


def slug(name: str) -> str:
    return " ".join(name.split()).casefold()


class Popcorn:
    def __init__(self, store: Store, tmdb: TMDB, household: str) -> None:
        self._store = store
        self._tmdb = tmdb
        self._household = household

    def _key(self, *parts: str) -> str:
        return ":".join((self._household, *parts))

    # ---------- profiles ----------

    async def _profile(self, name: str) -> dict | None:
        return await self._store.get(self._key("profile", slug(name)))

    async def _require_profile(self, name: str) -> dict:
        profile = await self._profile(name)
        if profile is None:
            raise PopcornError(f"I don't know {name} yet. Add them to the couch first.")
        return profile

    async def _save_profile(self, profile: dict) -> None:
        await self._store.put(self._key("profile", profile["id"]), profile)

    async def _profile_ids(self) -> list[str]:
        index = await self._store.get(self._key("profiles"))
        return index["ids"] if index else []

    async def _ensure_profile(self, name: str, age: int | None = None, kid: bool | None = None) -> tuple[dict, bool]:
        profile = await self._profile(name)
        created = profile is None
        if created:
            profile = {
                "id": slug(name),
                "name": " ".join(name.split()),
                "age": None,
                "kid": False,
                "genres": {},
                "liked": [],
                "disliked": [],
                "watched": [],
                "notes": [],
                "duel_rounds": 0,
            }
            ids = await self._profile_ids()
            await self._store.put(self._key("profiles"), {"ids": [*ids, profile["id"]]})
        if age is not None:
            profile["age"] = age
            profile["kid"] = age < 13
        if kid is not None:
            profile["kid"] = kid
        if created or age is not None or kid is not None:
            await self._save_profile(profile)
        return profile, created

    async def _resolve_genres(self, names: list[str]) -> tuple[list[int], list[str]]:
        genres = await self._tmdb.genres()
        found, unknown = [], []
        for name in names:
            genre_id = taste.resolve_genre(name, genres)
            if genre_id is None:
                unknown.append(name)
            elif genre_id not in found:
                found.append(genre_id)
        return found, unknown

    async def summarize(self, profile: dict) -> dict:
        genres = await self._tmdb.genres()
        ranked = sorted(profile["genres"].items(), key=lambda kv: -kv[1])
        label = lambda g: genres.get(int(g), g)  # noqa: E731
        return {
            "name": profile["name"],
            "age": profile["age"],
            "kid": profile["kid"],
            "loves": [label(g) for g, w in ranked if w >= 0.5],
            "likes": [label(g) for g, w in ranked if 0.2 <= w < 0.5],
            "dislikes": [label(g) for g, w in ranked if w <= -0.3],
            "never": [label(g) for g, w in ranked if w <= taste.VETO],
            "watched": [w["title"] for w in profile["watched"][-5:]],
            "notes": profile["notes"][-3:],
            "new": not profile["genres"] and profile["duel_rounds"] == 0,
        }

    async def get_profiles(self, names: list[str] | None = None) -> list[dict]:
        if names:
            profiles = [await self._require_profile(n) for n in names]
        else:
            profiles = [p for p in [await self._store.get(self._key("profile", i)) for i in await self._profile_ids()] if p]
        return [await self.summarize(p) for p in profiles]

    async def update_taste(
        self,
        name: str,
        loves: list[str] | None = None,
        likes: list[str] | None = None,
        dislikes: list[str] | None = None,
        hates: list[str] | None = None,
        note: str | None = None,
    ) -> dict:
        profile, _ = await self._ensure_profile(name)
        weights = profile["genres"]
        unknown = []
        for names, apply in (
            (loves, lambda k: max(weights.get(k, 0.0), 0.8)),
            (likes, lambda k: min(1.0, weights.get(k, 0.0) + 0.4)),
            (dislikes, lambda k: max(-1.0, weights.get(k, 0.0) - 0.4)),
            (hates, lambda k: min(weights.get(k, 0.0), -0.9)),
        ):
            ids, missing = await self._resolve_genres(names or [])
            unknown += missing
            for genre_id in ids:
                weights[str(genre_id)] = round(apply(str(genre_id)), 3)
        if note:
            profile["notes"].append(note)
        await self._save_profile(profile)
        result = {"profile": await self.summarize(profile)}
        if unknown:
            result["unknown_genres"] = unknown
        return result

    # ---------- TV state ----------

    async def get_state(self) -> dict:
        state = await self._store.get(self._key("tv"))
        return state or {
            "version": 0,
            "updated_at": 0,
            "members": [],
            "screen": "couch",
            "message": "",
            "recommendations": [],
            "boost": [],
            "duel": None,
            "details": None,
        }

    async def _save_state(self, state: dict, **changes) -> dict:
        state.update(changes)
        state["version"] += 1
        state["updated_at"] = int(time.time())
        await self._store.put(self._key("tv"), state)
        return state

    async def tv_state(self) -> dict:
        state = await self.get_state()
        members = [p for p in [await self._profile(m) for m in state["members"]] if p]
        return {**state, "members": [await self.summarize(p) for p in members]}

    # ---------- couch ----------

    async def _members(self, state: dict) -> list[dict]:
        return [p for p in [await self._profile(m) for m in state["members"]] if p]

    async def _couch_result(self, state: dict, created: list[str]) -> dict:
        members = await self._members(state)
        result = {"couch": [await self.summarize(p) for p in members], "kid_filter": taste.max_certification(members)}
        if created:
            result["new_people"] = created
            result["hint"] = "New people have no taste memory yet. Start a poster duel or ask what they like."
        return result

    async def _after_couch_change(self, state: dict, created: list[str], message: str) -> dict:
        """Refresh recommendations if the TV is showing them, so changes appear live."""
        if state["screen"] == "recommendations" and state["members"]:
            before = {r["id"]: r["title"] for r in state["recommendations"]}
            await self._save_state(state, message=message)
            recs = await self.recommend(boost_genres=state["boost"], limit=len(before) or 6)
            after = {r["id"] for r in recs["recommendations"]}
            result = await self._couch_result(state, created)
            result["recommendations"] = recs["recommendations"]
            result["removed_from_screen"] = [title for movie_id, title in before.items() if movie_id not in after]
            return result
        await self._save_state(state, screen="couch", message=message)
        return await self._couch_result(state, created)

    async def set_couch(self, people: list[dict]) -> dict:
        state = await self.get_state()
        created = []
        members = []
        for person in people:
            profile, new = await self._ensure_profile(person["name"], person.get("age"), person.get("kid"))
            if new:
                created.append(profile["name"])
            if profile["id"] not in members:
                members.append(profile["id"])
        state["members"] = members
        await self._save_state(state, screen="couch", recommendations=[], duel=None, details=None, message="")
        return await self._couch_result(state, created)

    async def add_to_couch(self, name: str, age: int | None = None, kid: bool | None = None) -> dict:
        state = await self.get_state()
        profile, new = await self._ensure_profile(name, age, kid)
        if profile["id"] not in state["members"]:
            state["members"].append(profile["id"])
        return await self._after_couch_change(state, [profile["name"]] if new else [], f"{profile['name']} joined")

    async def remove_from_couch(self, name: str) -> dict:
        state = await self.get_state()
        if slug(name) not in state["members"]:
            raise PopcornError(f"{name} is not on the couch.")
        state["members"].remove(slug(name))
        return await self._after_couch_change(state, [], f"{' '.join(name.split())} left")

    # ---------- movies ----------

    @staticmethod
    def _card(movie: dict, genres: dict[int, str]) -> dict:
        genre_ids = movie.get("genre_ids") or [g["id"] for g in movie.get("genres", [])]
        overview = movie.get("overview") or ""
        return {
            "id": movie["id"],
            "title": movie["title"],
            "year": (movie.get("release_date") or "")[:4],
            "genres": [genres[g] for g in genre_ids if g in genres],
            "genre_ids": genre_ids,
            "rating": round(movie.get("vote_average") or 0, 1),
            "overview": overview if len(overview) <= 240 else overview[:237].rsplit(" ", 1)[0] + "...",
            "poster": poster_url(movie.get("poster_path")),
        }

    async def _find_movie(self, movie: str) -> dict:
        if movie.strip().isdigit():
            return await self._tmdb.movie(int(movie))
        state = await self.get_state()
        wanted = movie.casefold().strip()
        for card in state["recommendations"]:
            if card["title"].casefold() == wanted:
                return await self._tmdb.movie(card["id"])
        results = await self._tmdb.search(movie)
        if not results:
            raise PopcornError(f"I couldn't find a movie called {movie}.")
        return await self._tmdb.movie(results[0]["id"])

    async def recommend(self, boost_genres: list[str] | None = None, limit: int = 6) -> dict:
        state = await self.get_state()
        members = await self._members(state)
        if not members:
            raise PopcornError("The couch is empty. Tell me who is watching first.")
        genres = await self._tmdb.genres()
        boost_ids, unknown = await self._resolve_genres(boost_genres or [])
        vetoes = taste.vetoed(members)
        max_cert = taste.max_certification(members)
        weights = taste.group_genre_weights(members)
        top = [g for g, w in sorted(weights.items(), key=lambda kv: -kv[1]) if w > 0 and g not in vetoes][:3]

        queries: list[str | None] = [str(g) for g in top]
        if boost_ids:
            queries.insert(0, "|".join(str(g) for g in boost_ids))
        pages = await asyncio.gather(*(self._tmdb.discover(with_genres=q, max_certification=max_cert) for q in queries or [None]))

        seen = {w["id"] for p in members for w in p["watched"]} | {m for p in members for m in p["disliked"]}
        scored = []
        for movie in {m["id"]: m for page in pages for m in page}.values():
            genre_ids = set(movie["genre_ids"])
            if movie["id"] in seen or genre_ids & vetoes:
                continue
            group = taste.group_score([taste.member_score(p, movie["genre_ids"]) for p in members])
            boosted = bool(genre_ids & set(boost_ids))
            rank = group + (0.25 if boosted else 0) + (movie["vote_average"] - 7) * 0.05
            scored.append((rank, group, boosted, movie))
        scored.sort(key=lambda s: -s[0])

        recs = []
        for _, group, boosted, movie in scored[:limit]:
            card = self._card(movie, genres)
            card["match"] = taste.match_percent(group, movie["vote_average"], boosted)
            card["why"] = taste.why_line(members, movie["genre_ids"], genres)
            recs.append(card)
        await self._save_state(state, screen="recommendations", recommendations=recs, boost=boost_genres or [], duel=None, details=None)
        result = {"couch": [p["name"] for p in members], "kid_filter": max_cert, "recommendations": recs}
        if unknown:
            result["unknown_genres"] = unknown
        return result

    async def get_movie_details(self, movie: str, show_on_tv: bool = True) -> dict:
        details = await self._find_movie(movie)
        genres = await self._tmdb.genres()
        card = self._card(details, genres)
        cert = us_certification(details)
        state = await self.get_state()
        max_cert = taste.max_certification(await self._members(state))
        card.update(
            {
                "overview": details.get("overview") or "",
                "tagline": details.get("tagline") or "",
                "runtime_minutes": details.get("runtime"),
                "certification_us": cert,
                "ok_for_this_couch": cert_allowed(cert, max_cert),
                "director": next((c["name"] for c in details.get("credits", {}).get("crew", []) if c.get("job") == "Director"), None),
                "cast": [c["name"] for c in details.get("credits", {}).get("cast", [])[:5]],
            }
        )
        if show_on_tv:
            await self._save_state(state, screen="details", details=card)
        return card

    async def mark_watched(self, movie: str, reactions: dict[str, Reaction] | None = None, who: list[str] | None = None) -> dict:
        details = await self._find_movie(movie)
        genre_ids = [g["id"] for g in details.get("genres", [])]
        state = await self.get_state()
        watchers = [slug(n) for n in who] if who else list(state["members"])
        reactions = {slug(k): v for k, v in (reactions or {}).items()}
        updated = []
        for person in dict.fromkeys(watchers + list(reactions)):
            profile = await self._require_profile(person)
            if all(w["id"] != details["id"] for w in profile["watched"]):
                profile["watched"].append({"id": details["id"], "title": details["title"], "at": int(time.time())})
            reaction = reactions.get(person)
            if reaction:
                taste.nudge(profile["genres"], genre_ids, REACTION_DELTA[reaction])
                if reaction in ("loved", "liked") and details["id"] not in profile["liked"]:
                    profile["liked"].append(details["id"])
                if reaction in ("disliked", "hated") and details["id"] not in profile["disliked"]:
                    profile["disliked"].append(details["id"])
            await self._save_profile(profile)
            updated.append({"name": profile["name"], "reaction": reaction})
        recs = [r for r in state["recommendations"] if r["id"] != details["id"]]
        await self._save_state(state, recommendations=recs, message=f"Saved: {details['title']}")
        return {"movie": details["title"], "updated": updated}

    # ---------- poster duel ----------

    async def _duel_pick(self, want: int, avoid: int, max_cert: str | None, exclude: set[int]) -> dict:
        for page in (1, 2):
            results = await self._tmdb.discover(
                with_genres=str(want),
                without_genres=str(avoid),
                max_certification=max_cert,
                min_votes=200 if max_cert else 1000,
                page=page,
            )
            for movie in results:
                if movie["id"] not in exclude and movie.get("poster_path"):
                    return movie
        raise PopcornError("I ran out of posters for the duel.")

    async def _next_duel_round(self, state: dict, profile: dict) -> dict:
        duel = state["duel"]
        max_cert = taste.max_certification([profile])
        pairs = KID_DUEL_PAIRS if max_cert else DUEL_PAIRS
        left_genre, right_genre = pairs[duel["round"] % len(pairs)]
        exclude = set(duel["shown"]) | {w["id"] for w in profile["watched"]}
        left = await self._duel_pick(left_genre, right_genre, max_cert, exclude)
        right = await self._duel_pick(right_genre, left_genre, max_cert, exclude | {left["id"]})
        genres = await self._tmdb.genres()
        duel["pair"] = [self._card(left, genres), self._card(right, genres)]
        duel["shown"] += [left["id"], right["id"]]
        return duel

    async def start_duel(self, name: str, rounds: int = 5) -> dict:
        profile, _ = await self._ensure_profile(name)
        state = await self.get_state()
        state["duel"] = {"profile": profile["id"], "name": profile["name"], "round": 0, "total": max(1, min(rounds, 8)), "shown": [], "pair": []}
        duel = await self._next_duel_round(state, profile)
        await self._save_state(state, screen="duel", message=f"{profile['name']}, pick a poster")
        return {"duel": self._duel_view(duel)}

    @staticmethod
    def _duel_view(duel: dict) -> dict:
        return {
            "name": duel["name"],
            "round": duel["round"] + 1,
            "total": duel["total"],
            "left": {k: duel["pair"][0][k] for k in ("id", "title", "genres")},
            "right": {k: duel["pair"][1][k] for k in ("id", "title", "genres")},
        }

    async def record_duel_choice(self, pick: Literal["left", "right"]) -> dict:
        state = await self.get_state()
        duel = state["duel"]
        if not duel:
            raise PopcornError("There is no poster duel running.")
        profile = await self._require_profile(duel["profile"])
        winner, loser = (duel["pair"][0], duel["pair"][1]) if pick == "left" else (duel["pair"][1], duel["pair"][0])
        taste.nudge(profile["genres"], set(winner["genre_ids"]) - set(loser["genre_ids"]), 0.35)
        taste.nudge(profile["genres"], set(loser["genre_ids"]) - set(winner["genre_ids"]), -0.2)
        profile["duel_rounds"] += 1
        await self._save_profile(profile)

        duel["round"] += 1
        if duel["round"] >= duel["total"]:
            await self._save_state(state, screen="couch", duel=None, message=f"Got it! {profile['name']}'s taste is saved.")
            return {"done": True, "picked": winner["title"], "profile": await self.summarize(profile)}
        await self._next_duel_round(state, profile)
        await self._save_state(state)
        return {"done": False, "picked": winner["title"], "duel": self._duel_view(duel)}
