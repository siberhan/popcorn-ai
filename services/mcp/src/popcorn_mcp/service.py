"""Popcorn AI domain logic: couch, person memory, candidate pools, poster duel, speech, family rating.

The "TV state" document is what the TV app polls. Every tool that changes what
the TV should show writes it, so voice commands appear on screen.
"""

import asyncio
import base64
import hashlib
import logging
import re
import time
from typing import Literal, Protocol

from . import taste
from .store import Store
from .tmdb import TMDB, backdrop_url, cert_allowed, poster_url, providers_for, us_certification

Reaction = Literal["loved", "liked", "meh", "disliked", "hated"]
REACTION_DELTA = {"loved": 0.3, "liked": 0.15, "meh": 0.0, "disliked": -0.2, "hated": -0.4}
REACTION_ACK = {"loved": "Loved it, noted", "liked": "Liked it, noted", "meh": "Okay, noted",
                "disliked": "Not a fan, noted", "hated": "Hated it, noted"}
Answer = Literal["voice", "hand", "skip"]
SCREENS_BACK = ("recommendations", "couch")  # where go_to may send the TV
GENDERS = ("male", "female")
VOICE_STATES = ("idle", "listening", "thinking")

LIVE_MAX, QUOTE_MAX = 300, 120
NOTES_MAX, NOTE_LEN, ROLE_LEN = 12, 140, 40
DUEL_HISTORY_MAX = 30
WHY_MAX, SPEECH_MAX, SPEECH_KEEP = 220, 600, 6
POOL_MAX, POOL_MIN_VOTES, DUEL_POOL_SIZE = 40, 150, 50
AUDIO_PIECE = 200_000  # raw bytes per stored item (base64 stays under DynamoDB's 400 KB)
VOICE_TTL, DAY = 2 * 24 * 3600, 24 * 3600
VOICE_MIN_GAP = 0.25  # at most 4 voice writes per second
SHA1 = re.compile(r"[0-9a-f]{40}")

# Genre groups for the duel pool ("|" = any of), so the list is spread across tastes.
DUEL_GROUPS = ["28|12", "35", "18|10749", "878|14", "27|53", "80|9648", "16|10751"]
KID_DUEL_GROUPS = ["16", "10751", "12|14", "35", "878|28"]

PROFILE_DEFAULTS = {
    "age": None, "kid": False, "genres": {}, "liked": [], "disliked": [], "watched": [], "notes": [],
    "duel_rounds": 0, "role": None, "gender": None, "named": True, "duel_history": [], "duel_skipped": False,
}
STATE_DEFAULTS = {
    "version": 0, "updated_at": 0, "members": [], "screen": "couch", "message": "", "recommendations": [],
    "boost": [], "duel": None, "details": None, "watching": None, "rating": None, "focus": None,
    "speech": [], "voice": {"state": "idle", "text": "", "speaker": None, "at": 0}, "pool": None,
}

log = logging.getLogger(__name__)


class PopcornError(Exception):
    """A problem the user can fix. The message is shown to them."""


class Speaker(Protocol):
    voice: str
    engine: str

    async def synthesize(self, text: str) -> bytes: ...


def slug(name: str) -> str:
    return " ".join(name.split()).casefold()


def clean(text: str, limit: int) -> str:
    """One line of text, cut at a word boundary when too long."""
    text = " ".join((text or "").split())
    return text if len(text) <= limit else text[: limit - 3].rsplit(" ", 1)[0] + "..."


def _fresh(value):
    return value.copy() if isinstance(value, (list, dict)) else value


def title_year(item: dict) -> str:
    return f"{item['title']} ({item['year']})" if item.get("year") else item["title"]


def duel_line(entry: dict) -> str:
    return f"picked {title_year(entry['picked'])} over {title_year(entry['over'])}"


def upgrade_profile(profile: dict) -> dict:
    """Fill fields added after a profile was stored."""
    for key, value in PROFILE_DEFAULTS.items():
        profile.setdefault(key, _fresh(value))
    for entry in profile["watched"]:
        entry.setdefault("year", "")
        entry.setdefault("reaction", None)
        entry.setdefault("quote", "")
    return profile


class Popcorn:
    def __init__(self, store: Store, tmdb: TMDB, household: str, watch_region: str = "US",
                 speaker: Speaker | None = None) -> None:
        self._store = store
        self._tmdb = tmdb
        self._household = household
        self._watch_region = watch_region
        self._speaker = speaker
        self._certs: dict[int, str | None] = {}  # US certification per film, for this process

    def _key(self, *parts: str) -> str:
        return ":".join((self._household, *parts))

    # ---------- profiles ----------

    async def _profile(self, name: str) -> dict | None:
        profile = await self._store.get(self._key("profile", slug(name)))
        return upgrade_profile(profile) if profile else None

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

    async def _ensure_profile(self, name: str, age: int | None = None, kid: bool | None = None,
                              role: str | None = None, gender: str | None = None,
                              named: bool | None = None) -> tuple[dict, bool]:
        display = " ".join((name or "").split())
        if not display:
            raise PopcornError("I need a name (or a label like \"Ahmet's son\").")
        if gender is not None and gender not in GENDERS:
            raise PopcornError("gender must be 'male', 'female' or null")
        profile = await self._profile(display)
        created = profile is None
        if created:
            profile = upgrade_profile({"id": slug(display), "name": display})
            ids = await self._profile_ids()
            await self._store.put(self._key("profiles"), {"ids": [*ids, profile["id"]]})
        changed = created
        if age is not None:
            if not 0 <= age <= 120:
                raise PopcornError("age must be between 0 and 120")
            profile["age"], profile["kid"] = age, age < 13
            changed = True
        for key, value in (("kid", kid), ("gender", gender), ("named", named),
                           ("role", clean(role, ROLE_LEN) or None if role is not None else None)):
            if value is not None:
                profile[key] = value
                changed = True
        if changed:
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

    async def memory(self, profile: dict) -> dict:
        """What the agent (and the TV) sees for a person: compact, no ids."""
        genres = await self._tmdb.genres()
        ranked = sorted(profile["genres"].items(), key=lambda kv: -kv[1])
        label = lambda g: genres.get(int(g), g)  # noqa: E731
        watched = [title_year(w) + (f": {w['reaction']}" if w.get("reaction") else "") for w in profile["watched"][-30:]]
        return {
            "name": profile["name"],
            "named": profile["named"],
            "age": profile["age"],
            "role": profile["role"],
            "gender": profile["gender"],
            "kid": profile["kid"],
            "loves": [label(g) for g, w in ranked if w >= 0.5],
            "likes": [label(g) for g, w in ranked if 0.2 <= w < 0.5],
            "dislikes": [label(g) for g, w in ranked if taste.VETO < w <= -0.3],
            "never": [label(g) for g, w in ranked if w <= taste.VETO],
            "notes": profile["notes"][-NOTES_MAX:],
            "duel": [duel_line(h) for h in profile["duel_history"][-10:]],
            "duel_skipped": profile["duel_skipped"],
            "watched": watched,
            "new": not profile["genres"] and not profile["notes"] and not profile["duel_history"]
            and profile["duel_rounds"] == 0,
        }

    async def get_profiles(self, names: list[str] | None = None) -> list[dict]:
        if names:
            profiles = [await self._require_profile(n) for n in names]
        else:
            profiles = [p for p in [await self._profile(i) for i in await self._profile_ids()] if p]
        return [await self.memory(p) for p in profiles]

    @staticmethod
    def _add_note(profile: dict, note: str) -> None:
        text = clean(note, NOTE_LEN)
        if text:
            notes = [n for n in profile["notes"] if n.casefold() != text.casefold()]
            profile["notes"] = [*notes, text][-NOTES_MAX:]

    async def update_taste(
        self,
        name: str,
        loves: list[str] | None = None,
        likes: list[str] | None = None,
        dislikes: list[str] | None = None,
        hates: list[str] | None = None,
        note: str | None = None,
        role: str | None = None,
        gender: str | None = None,
        age: int | None = None,
    ) -> dict:
        profile, _ = await self._ensure_profile(name, age=age, role=role, gender=gender)
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
            self._add_note(profile, note)
        await self._save_profile(profile)
        result = {"memory": await self.memory(profile)}
        if unknown:
            result["unknown_genres"] = unknown
        return result

    async def rename_person(self, name: str, new_name: str) -> dict:
        profile = await self._require_profile(name)
        display = " ".join((new_name or "").split())
        if not display:
            raise PopcornError("The new name is empty.")
        old_id, old_name, new_id = profile["id"], profile["name"], slug(display)
        if new_id != old_id and (other := await self._profile(new_id)):
            raise PopcornError(f"There is already someone called {other['name']}. Pick another name.")
        profile.update(id=new_id, name=display, named=True)
        await self._save_profile(profile)
        if new_id != old_id:
            await self._store.put(self._key("profiles"), {"ids": [new_id if i == old_id else i for i in await self._profile_ids()]})
            await self._store.delete(self._key("profile", old_id))
            if pool := await self._store.get(self._key("duelpool", old_id)):
                await self._store.put(self._key("duelpool", new_id), pool, ttl_seconds=DAY)
                await self._store.delete(self._key("duelpool", old_id))
        state = await self.get_state()
        state["members"] = [new_id if m == old_id else m for m in state["members"]]
        if state["duel"] and state["duel"]["profile"] == old_id:
            state["duel"].update(profile=new_id, name=display)
        if rating := state["rating"]:
            rename = lambda n: display if n == old_name else n  # noqa: E731
            rating["people"] = [rename(n) for n in rating["people"]]
            rating["asking"] = rating["asking"] and rename(rating["asking"])
            rating["answers"] = {rename(n): a for n, a in rating["answers"].items()}
        await self._save_state(state, message=f"{old_name} is now {display}")
        return {"renamed": old_name, "memory": await self.memory(profile)}

    # ---------- TV state ----------

    async def get_state(self) -> dict:
        state = await self._store.get(self._key("tv")) or {}
        for key, value in STATE_DEFAULTS.items():  # older stored states lack the newer keys
            state.setdefault(key, _fresh(value))
        return state

    async def _save_state(self, state: dict, **changes) -> dict:
        state.update(changes)
        state["version"] += 1
        state["updated_at"] = int(time.time())
        await self._store.put(self._key("tv"), state)
        return state

    async def tv_state(self) -> dict:
        """The state plus `household`: every known person, so the TV can offer people who are not on the couch."""
        state = await self.get_state()
        household = {i: await self.memory(p) for i in await self._profile_ids() if (p := await self._profile(i))}
        members = [household[m] for m in state["members"] if m in household]
        return {**state, "members": members, "household": list(household.values())}

    # ---------- couch ----------

    async def _members(self, state: dict) -> list[dict]:
        return [p for p in [await self._profile(m) for m in state["members"]] if p]

    async def _couch_result(self, state: dict, created: list[str]) -> dict:
        members = await self._members(state)
        result = {"couch": [p["name"] for p in members], "kid_filter": taste.max_certification(members)}
        if created:
            result["new_people"] = created
            result["hint"] = "New people have no memory yet. Offer the poster duel (duel_candidates, then start_duel)."
        return result

    async def _after_couch_change(self, state: dict, created: list[str], message: str) -> dict:
        """On the reel, cards that no longer fit the couch fade out (no refill). Elsewhere, show the couch."""
        if state["screen"] == "recommendations" and state["members"]:
            before = state["recommendations"]
            members = await self._members(state)
            fits = await asyncio.gather(*(self._fits(card, members) for card in before))
            recs = [card for card, ok in zip(before, fits) if ok]
            await self._save_state(state, recommendations=recs, message=message, details=None)
            result = await self._couch_result(state, created)
            result["removed_from_screen"] = [card["title"] for card, ok in zip(before, fits) if not ok]
            return result
        await self._save_state(state, screen="couch", message=message)
        return await self._couch_result(state, created)

    async def set_couch(self, people: list[dict]) -> dict:
        state = await self.get_state()
        created, members, profiles = [], [], []
        for person in people:
            profile, new = await self._ensure_profile(
                person["name"], person.get("age"), person.get("kid"), person.get("role"), person.get("gender"), person.get("named"))
            if new:
                created.append(profile["name"])
            if profile["id"] not in members:
                members.append(profile["id"])
                profiles.append(profile)
        state["members"] = members
        await self._save_state(state, screen="couch", recommendations=[], duel=None, details=None, message="",
                               watching=None, rating=None, pool=None)
        result = await self._couch_result(state, created)
        result["memory"] = [await self.memory(p) for p in profiles]
        return result

    async def add_to_couch(self, name: str, age: int | None = None, kid: bool | None = None, role: str | None = None,
                           gender: str | None = None, named: bool | None = None) -> dict:
        state = await self.get_state()
        profile, new = await self._ensure_profile(name, age, kid, role, gender, named)
        if profile["id"] not in state["members"]:
            state["members"].append(profile["id"])
        result = await self._after_couch_change(state, [profile["name"]] if new else [], f"{profile['name']} joined")
        result["memory"] = await self.memory(profile)
        return result

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
        return {
            "id": movie["id"],
            "title": movie["title"],
            "year": (movie.get("release_date") or "")[:4],
            "genres": [genres[g] for g in genre_ids if g in genres],
            "genre_ids": genre_ids,
            "rating": round(movie.get("vote_average") or 0, 1),
            "overview": clean(movie.get("overview") or "", 240),
            "poster": poster_url(movie.get("poster_path")),
        }

    @staticmethod
    def _candidate(movie: dict, genres: dict[int, str]) -> dict:
        """One pool item for the agent: enough to choose, nothing more."""
        return {
            "id": movie["id"],
            "title": movie["title"],
            "year": (movie.get("release_date") or "")[:4],
            "genres": [genres[g] for g in movie.get("genre_ids") or [] if g in genres],
            "rating": round(movie.get("vote_average") or 0, 1),
            "votes": movie.get("vote_count") or 0,
            "overview": clean(movie.get("overview") or "", 160),
        }

    @staticmethod
    def _seen(members: list[dict]) -> set[int]:
        return {w["id"] for p in members for w in p["watched"]} | {m for p in members for m in p["disliked"]}

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

    async def _kid_safe(self, movies: list[dict], max_cert: str | None) -> list[dict]:
        """Keep movies whose US certification (from the details) fits. Discover's filter alone lets a few through."""
        if max_cert is None:
            return movies
        gate = asyncio.Semaphore(16)

        async def allowed(movie: dict) -> bool:
            if movie["id"] not in self._certs:
                async with gate:
                    self._certs[movie["id"]] = await self._tmdb.certification(movie["id"])
            return cert_allowed(self._certs[movie["id"]], max_cert)

        flags = await asyncio.gather(*(allowed(m) for m in movies), return_exceptions=True)
        return [m for m, ok in zip(movies, flags) if ok is True]

    async def _fits(self, card: dict, members: list[dict]) -> bool:
        """Can this card stay on screen for the new couch?"""
        if card["id"] in self._seen(members) or set(card["genre_ids"]) & taste.vetoed(members):
            return False
        return bool(await self._kid_safe([card], taste.max_certification(members)))

    async def _keywords(self, words: list[str]) -> tuple[list[int], list[str]]:
        ids = await asyncio.gather(*(self._tmdb.keyword_id(w) for w in words))
        return [i for i in dict.fromkeys(ids) if i], [w for w, i in zip(words, ids) if not i]

    async def find_candidates(
        self,
        genres: list[str] | None = None,
        without_genres: list[str] | None = None,
        keywords: list[str] | None = None,
        without_keywords: list[str] | None = None,
        year_from: int | None = None,
        year_to: int | None = None,
        exclude_ids: list[int] | None = None,
    ) -> dict:
        """Films on a streaming service in the region that fit the couch. Stores the pool for show_picks."""
        state = await self.get_state()
        members = await self._members(state)
        if not members:
            raise PopcornError("The couch is empty. Tell me who is watching first.")
        names = await self._tmdb.genres()
        want, unknown = await self._resolve_genres(genres or [])
        avoid, unknown_avoid = await self._resolve_genres(without_genres or [])
        avoid_all = set(avoid) | taste.vetoed(members)
        with_kw, unknown_kw = await self._keywords(keywords or [])
        without_kw, unknown_without_kw = await self._keywords(without_keywords or [])
        max_cert = taste.max_certification(members)
        common = {
            "without_genres": ",".join(map(str, sorted(avoid_all))) or None,
            "max_certification": max_cert,
            "min_votes": POOL_MIN_VOTES,
            "with_keywords": "|".join(map(str, with_kw)) or None,
            "without_keywords": ",".join(map(str, without_kw)) or None,
            "year_from": year_from,
            "year_to": year_to,
            "watch_region": self._watch_region,
            "monetization": "flatrate",
        }
        if want:
            queries = [("|".join(map(str, want)), 1), ("|".join(map(str, want)), 2)]
        else:
            weights = taste.group_genre_weights(members)
            top = [g for g, w in sorted(weights.items(), key=lambda kv: -kv[1]) if w > 0 and g not in avoid_all][:3]
            queries = [(str(g), 1) for g in top] + [(None, 1), (None, 2)]
        pages = await asyncio.gather(*(self._tmdb.discover(with_genres=g, page=p, **common) for g, p in queries))

        skip = self._seen(members) | set(exclude_ids or [])
        merged = {m["id"]: m for page in pages for m in page}
        movies = sorted(merged.values(), key=lambda m: -(m.get("popularity") or 0))
        movies = [m for m in movies if m["id"] not in skip and not set(m.get("genre_ids") or []) & avoid_all]
        movies = (await self._kid_safe(movies[: POOL_MAX + 20], max_cert))[:POOL_MAX]
        candidates = [self._candidate(m, names) for m in movies]

        state = await self.get_state()  # re-read: the TV may have written meanwhile
        await self._save_state(state, pool={"ids": [c["id"] for c in candidates], "kid_filter": max_cert,
                                            "genres": [names[g] for g in want]})
        result = {"kid_filter": max_cert, "candidates": candidates}
        if unknown + unknown_avoid:
            result["unknown_genres"] = unknown + unknown_avoid
        if unknown_kw + unknown_without_kw:
            result["unknown_keywords"] = unknown_kw + unknown_without_kw
        if not candidates:
            result["hint"] = "Nothing matched. Try fewer filters."
        return result

    async def show_picks(self, picks: list[dict]) -> dict:
        """Put the agent's picks on the TV reel, each with its spoken `why` line."""
        if not 4 <= len(picks) <= 8:
            raise PopcornError("Show 4 to 8 films.")
        state = await self.get_state()
        members = await self._members(state)
        if not members:
            raise PopcornError("The couch is empty. Tell me who is watching first.")
        kid_filter, pool = taste.max_certification(members), state["pool"]
        if not pool or pool["kid_filter"] != kid_filter:
            raise PopcornError("The couch changed since the last list. Call find_candidates again first.")
        allowed, chosen = set(pool["ids"]), {}
        for pick in picks:
            if pick["movie_id"] not in allowed:
                raise PopcornError(f"Movie id {pick['movie_id']} is not in the last find_candidates list. Use only ids from it.")
            chosen.setdefault(pick["movie_id"], pick)
        genres = await self._tmdb.genres()
        details = await asyncio.gather(*(self._tmdb.movie(i) for i in chosen))
        seen = self._seen(members)
        cards, dropped = [], []
        for pick, movie in zip(chosen.values(), details):
            if movie["id"] in seen or not cert_allowed(us_certification(movie), kid_filter):
                dropped.append(movie["title"])
                continue
            card = self._card(movie, genres)
            card["match"] = max(50, min(99, int(round(pick.get("match") or 0))))
            card["why"] = clean(pick.get("why") or "", WHY_MAX)
            cards.append(card)
        if not cards:
            raise PopcornError("None of these films fit this couch now. Call find_candidates again.")
        audio = await asyncio.gather(*(self.speak(c["why"]) for c in cards))
        for card, path in zip(cards, audio):
            card["why_audio"] = path
        state = await self.get_state()
        await self._save_state(state, screen="recommendations", recommendations=cards, boost=pool.get("genres") or [],
                               duel=None, details=None, watching=None, rating=None, message="")
        result = {"shown": [title_year(c) for c in cards], "kid_filter": kid_filter}
        if dropped:
            result["dropped"] = dropped
            result["dropped_reason"] = "not kid-safe for this couch or already seen"
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
                "backdrop": backdrop_url(details.get("backdrop_path")),
                **await self._providers(details["id"]),
            }
        )
        if show_on_tv:
            await self._save_state(state, screen="details", details=card)
        return card

    async def _providers(self, movie_id: int) -> dict:
        """Where to watch in the configured region. A TMDB failure gives an empty list, never an error."""
        try:
            providers, link = providers_for(await self._tmdb.watch_providers(movie_id), self._watch_region)
        except Exception as exc:  # noqa: BLE001 - details must still work
            log.warning("watch providers for %s failed: %r", movie_id, exc)
            providers, link = [], None
        return {"providers": providers, "providers_region": self._watch_region, "providers_link": link}

    @staticmethod
    def _add_watched(profile: dict, movie: dict, reaction: str | None = None, quote: str = "") -> None:
        """One entry per film, newest last. A new reaction moves the entry to the end."""
        entry = next((w for w in profile["watched"] if w["id"] == movie["id"]), None)
        if entry and not reaction:
            return
        if entry:
            profile["watched"].remove(entry)
        profile["watched"].append({"id": movie["id"], "title": movie["title"], "year": (movie.get("release_date") or "")[:4],
                                   "reaction": reaction or (entry or {}).get("reaction"), "quote": quote if reaction else "",
                                   "at": int(time.time())})

    async def mark_watched(self, movie: str, reactions: dict[str, Reaction] | None = None, who: list[str] | None = None,
                           quotes: dict[str, str] | None = None) -> dict:
        details = await self._find_movie(movie)
        genre_ids = [g["id"] for g in details.get("genres", [])]
        state = await self.get_state()
        watchers = [slug(n) for n in who] if who else list(state["members"])
        reactions = {slug(k): v for k, v in (reactions or {}).items()}
        quotes = {slug(k): v for k, v in (quotes or {}).items()}
        updated = []
        for person in dict.fromkeys(watchers + list(reactions)):
            profile = await self._require_profile(person)
            reaction = reactions.get(person)
            self._add_watched(profile, details, reaction, quotes.get(person, ""))
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

    async def mark_seen(self, names: list[str] | None, movie_ids: list[int], back_to_reel: bool = False) -> dict:
        """Films people have already seen (no reaction). Their cards leave the reel."""
        if not movie_ids:
            raise PopcornError("Which films? Send at least one movie id.")
        state = await self.get_state()
        profiles = [await self._require_profile(n) for n in names] if names else await self._members(state)
        if not profiles:
            raise PopcornError("The couch is empty. Tell me who has seen it.")
        movies = await asyncio.gather(*(self._tmdb.movie(i) for i in dict.fromkeys(movie_ids)))
        for profile in profiles:
            for movie in movies:
                self._add_watched(profile, movie)
            await self._save_profile(profile)
        ids = {m["id"] for m in movies}
        state = await self.get_state()
        removed = [c["title"] for c in state["recommendations"] if c["id"] in ids]
        changes = {"recommendations": [c for c in state["recommendations"] if c["id"] not in ids],
                   "message": f"Seen: {', '.join(m['title'] for m in movies)}"}
        if back_to_reel:
            changes.update(screen="recommendations", details=None, watching=None)
        await self._save_state(state, **changes)
        return {"saved_for": [p["name"] for p in profiles], "movies": [title_year(self._card(m, {})) for m in movies],
                "removed_from_screen": removed}

    # ---------- poster duel ----------

    async def duel_candidates(self, name: str) -> dict:
        """About 50 well-known films for one person's duel, spread across genre groups."""
        profile, _ = await self._ensure_profile(name)
        state = await self.get_state()
        # The whole couch sees the posters, so a kid on the couch keeps the duel kid-safe.
        max_cert = taste.max_certification([profile, *await self._members(state)])
        groups = KID_DUEL_GROUPS if max_cert == "PG" else DUEL_GROUPS
        pages = await asyncio.gather(*(
            self._tmdb.discover(with_genres=g, max_certification=max_cert, min_votes=500, sort_by="vote_count.desc", page=p)
            for g in groups for p in (1, 2, 3)))
        seen = self._seen([profile]) | {h[side]["id"] for h in profile["duel_history"] for side in ("picked", "over")}
        queues = [[m for page in pages[i * 3:(i + 1) * 3] for m in page if m.get("poster_path") and m["id"] not in seen]
                  for i in range(len(groups))]
        chosen: dict[int, dict] = {}
        while len(chosen) < DUEL_POOL_SIZE + 10 and any(queues):  # round-robin across groups, a few spare for the kid check
            for queue in queues:
                while queue:
                    movie = queue.pop(0)
                    if movie["id"] not in chosen:
                        chosen[movie["id"]] = movie
                        break
        movies = (await self._kid_safe(list(chosen.values()), max_cert))[:DUEL_POOL_SIZE]
        genres = await self._tmdb.genres()
        await self._store.put(self._key("duelpool", profile["id"]),
                              {"kid_filter": max_cert, "cards": {str(m["id"]): self._card(m, genres) for m in movies}},
                              ttl_seconds=DAY)
        return {"name": profile["name"], "kid_filter": max_cert, "candidates": [self._candidate(m, genres) for m in movies]}

    async def start_duel(self, name: str, pairs: list[list[int]]) -> dict:
        if not 3 <= len(pairs) <= 6:
            raise PopcornError("A duel has 3 to 6 pairs.")
        profile = await self._require_profile(name)
        pool = await self._store.get(self._key("duelpool", profile["id"]))
        if not pool:
            raise PopcornError(f"Call duel_candidates for {profile['name']} first.")
        state = await self.get_state()
        if pool["kid_filter"] != taste.max_certification([profile, *await self._members(state)]):
            raise PopcornError(f"The couch changed. Call duel_candidates for {profile['name']} again.")
        used, built = set(), []
        for pair in pairs:
            if len(pair) != 2:
                raise PopcornError("Each pair is [left_id, right_id].")
            for movie_id in pair:
                if str(movie_id) not in pool["cards"]:
                    raise PopcornError(f"Movie id {movie_id} is not in {profile['name']}'s last duel_candidates list.")
                if movie_id in used:
                    raise PopcornError(f"Movie id {movie_id} is used twice. Every film can appear once.")
                used.add(movie_id)
            built.append([pool["cards"][str(pair[0])], pool["cards"][str(pair[1])]])
        state["duel"] = {"profile": profile["id"], "name": profile["name"], "round": 0, "total": len(built),
                         "pairs": built, "pair": built[0], "shown": list(used)}
        await self._save_state(state, screen="duel", message=f"{profile['name']}, pick a poster")
        return {"duel": self._duel_view(state["duel"])}

    @staticmethod
    def _duel_view(duel: dict) -> dict:
        return {
            "name": duel["name"],
            "round": duel["round"] + 1,
            "total": duel["total"],
            "left": {k: duel["pair"][0][k] for k in ("id", "title", "year", "genres")},
            "right": {k: duel["pair"][1][k] for k in ("id", "title", "year", "genres")},
        }

    async def record_duel_choice(self, pick: Literal["left", "right", "skip"]) -> dict:
        state = await self.get_state()
        duel = state["duel"]
        if not duel:
            raise PopcornError("There is no poster duel running.")
        if pick not in ("left", "right", "skip"):
            raise PopcornError("pick must be 'left', 'right' or 'skip'")
        profile = await self._require_profile(duel["profile"])
        if pick == "skip":
            if duel["round"] == 0:
                profile["duel_skipped"] = True
                await self._save_profile(profile)
            await self._save_state(state, screen="couch", duel=None, message=f"{profile['name']} skipped the duel")
            return {"done": True, "skipped": True, "rounds_done": duel["round"], "memory": await self.memory(profile)}

        winner, loser = (duel["pair"][0], duel["pair"][1]) if pick == "left" else (duel["pair"][1], duel["pair"][0])
        taste.nudge(profile["genres"], set(winner["genre_ids"]) - set(loser["genre_ids"]), 0.35)
        taste.nudge(profile["genres"], set(loser["genre_ids"]) - set(winner["genre_ids"]), -0.2)
        brief = lambda c: {k: c.get(k, "") for k in ("id", "title", "year", "genres")}  # noqa: E731
        entry = {"picked": brief(winner), "over": brief(loser), "at": int(time.time())}
        profile["duel_history"] = [*profile["duel_history"], entry][-DUEL_HISTORY_MAX:]
        profile["duel_rounds"] += 1
        profile["duel_skipped"] = False
        await self._save_profile(profile)

        duel["round"] += 1
        pairs = duel.get("pairs") or []  # duels started before v2 have no pairs: they end here
        if duel["round"] >= min(duel["total"], len(pairs)):
            await self._save_state(state, screen="couch", duel=None, message=f"Got it! {profile['name']}'s taste is saved.")
            return {"done": True, "picked": duel_line(entry), "memory": await self.memory(profile)}
        duel["pair"] = pairs[duel["round"]]
        await self._save_state(state)
        return {"done": False, "picked": duel_line(entry), "duel": self._duel_view(duel)}

    # ---------- speech and voice ----------

    async def speak(self, text: str) -> str | None:
        """Audio path for this text, synthesized once and cached. None when TTS is off or failed."""
        if self._speaker is None or not text:
            return None
        voice = f"{self._speaker.voice}/{self._speaker.engine}"
        sha = hashlib.sha1(f"{voice}\n{text}".encode()).hexdigest()
        key = self._key("voice", sha)
        try:
            if await self._store.get(key) is None:
                audio = await self._speaker.synthesize(text)
                # WAV is big and DynamoDB items stop at 400 KB: store it in pieces, head item last
                pieces = [audio[i:i + AUDIO_PIECE] for i in range(0, len(audio), AUDIO_PIECE)] or [b""]
                for n, piece in enumerate(pieces[1:], 1):
                    await self._store.put(f"{key}#{n}", {"audio": base64.b64encode(piece).decode("ascii")}, ttl_seconds=VOICE_TTL)
                await self._store.put(key, {"audio": base64.b64encode(pieces[0]).decode("ascii"), "parts": len(pieces)},
                                      ttl_seconds=VOICE_TTL)
        except Exception as exc:  # noqa: BLE001 - the TV shows the caption without audio
            log.warning("speech for %r failed: %r", text[:40], exc)
            return None
        return f"/api/voice/{sha}.{getattr(self._speaker, 'ext', 'wav')}"

    async def voice_audio(self, sha: str) -> bytes | None:
        if not SHA1.fullmatch(sha):
            return None
        doc = await self._store.get(self._key("voice", sha))
        if not doc:
            return None
        out = base64.b64decode(doc.get("audio") or doc.get("mp3") or "")
        for n in range(1, int(doc.get("parts") or 1)):
            piece = await self._store.get(self._key("voice", sha) + f"#{n}")
            if piece is None:
                return None
            out += base64.b64decode(piece["audio"])
        return out or None

    @staticmethod
    def _add_speech(state: dict, text: str, audio: str | None) -> dict:
        speech = state["speech"]
        item = {"id": (speech[-1]["id"] + 1) if speech else 1, "text": text, "audio": audio}
        state["speech"] = [*speech, item][-SPEECH_KEEP:]
        return item

    async def push_speech(self, text: str) -> dict:
        """Something for the TV to say (agent replies). Leaves the voice state idle."""
        text = " ".join((text or "").split())
        if not text or len(text) > SPEECH_MAX:
            raise PopcornError(f"text must be 1 to {SPEECH_MAX} characters")
        audio = await self.speak(text)
        state = await self.get_state()
        item = self._add_speech(state, text, audio)
        await self._save_state(state, voice={**state["voice"], "state": "idle", "at": round(time.time(), 3)})
        return {"speech": item}

    async def set_voice(self, voice_state: str, text: str | None = None, speaker: str | None = None) -> dict:
        """Listening / thinking / idle, with the words heard so far. On the rating screen they are also `rating.live`."""
        if voice_state not in VOICE_STATES:
            raise PopcornError(f"state must be one of: {', '.join(VOICE_STATES)}")
        now = time.time()
        new = {"state": voice_state, "text": " ".join((text or "").split())[:LIVE_MAX],
               "speaker": " ".join(speaker.split()) or None if speaker else None, "at": round(now, 3)}
        state = await self.get_state()
        old, rating = state["voice"], state["rating"]
        copy_live = (text is not None and state["screen"] == "rating" and rating and not rating["done"]
                     and rating["live"] != new["text"])
        if all(old.get(k) == new[k] for k in ("state", "text", "speaker")) and not copy_live:
            return {"voice": old, "changed": False}
        if old["state"] == new["state"] and old.get("speaker") == new["speaker"] and now - (old.get("at") or 0) < VOICE_MIN_GAP:
            return {"voice": old, "changed": False}  # a text-only update within 250 ms: the next one lands
        if copy_live:
            rating["live"] = new["text"]
        await self._save_state(state, voice=new)
        return {"voice": new, "changed": True}

    # ---------- TV navigation ----------

    async def open_details(self, movie_id: int) -> dict:
        """OK on a film in the reel: show its details screen."""
        return await self.get_movie_details(str(movie_id), show_on_tv=True)

    async def go_to(self, screen: str) -> dict:
        """Back button: show the picks or the couch, and drop details, watching and rating."""
        if screen not in SCREENS_BACK:
            raise PopcornError(f"screen must be one of: {', '.join(SCREENS_BACK)}")
        state = await self.get_state()
        await self._save_state(state, screen=screen, details=None, watching=None, rating=None)
        return {"screen": screen}

    async def set_focus(self, movie_id: int) -> dict:
        """The reel settled on a film. No screen change; the voice page reads it to narrate."""
        state = await self.get_state()
        focus = {"movie_id": movie_id, "at": int(time.time())}
        await self._save_state(state, focus=focus)
        return {"focus": focus}

    async def start_watching(self, movie_id: int, provider: str) -> dict:
        """The family picked a provider and went to watch. The details screen shows it."""
        state = await self.get_state()
        if not (state["details"] and state["details"]["id"] == movie_id):
            await self.get_movie_details(str(movie_id), show_on_tv=True)
            state = await self.get_state()
        title = state["details"]["title"]
        provider = " ".join(provider.split())
        watching = {"movie_id": movie_id, "title": title, "provider": provider, "started_at": int(time.time())}
        await self._save_state(state, screen="details", watching=watching, message=f"Enjoy {title} on {provider}")
        return {"watching": watching}

    # ---------- family rating ----------

    async def start_rating(self, movie: str | None = None) -> dict:
        """Ask everyone on the couch how they liked the film: `movie`, else the one being watched, else the details one."""
        state = await self.get_state()
        if movie:
            film = self._card(await self._find_movie(movie), await self._tmdb.genres())
        elif state["watching"]:
            film = self._card(await self._tmdb.movie(state["watching"]["movie_id"]), await self._tmdb.genres())
        elif state["details"]:
            film = state["details"]
        else:
            raise PopcornError("Which movie did you watch? Tell me the title.")
        people = [p["name"] for p in await self._members(state)]
        if not people:
            raise PopcornError("The couch is empty. Tell me who watched first.")
        rating = {
            "movie": {k: film[k] for k in ("id", "title", "year", "poster", "genres")},
            "people": people,
            "asking": people[0],
            "answers": {},
            "live": "",
            "done": False,
        }
        text = f"How was {film['title']}? {people[0]}, what did you think?"
        self._add_speech(state, text, await self.speak(text))
        await self._save_state(state, screen="rating", rating=rating, watching=None, message=f"How was {film['title']}?")
        return {"rating": rating}

    async def _running_rating(self, state: dict) -> dict:
        rating = state["rating"]
        if not rating:
            raise PopcornError("No rating is running. Say you are back from the movie first.")
        if rating["done"]:
            raise PopcornError(f"The rating for {rating['movie']['title']} is already saved.")
        return rating

    async def record_reaction(self, name: str, reaction: Reaction | None, quote: str = "", by: Answer = "voice") -> dict:
        """Save one person's answer (None = skip). Changing an answer overwrites it. The last answer saves everything.

        `by="skip"` is a skip by hand (no spoken ack); a voice skip says "Skipped".
        """
        if reaction is not None and reaction not in REACTION_DELTA:
            raise PopcornError(f"reaction must be one of: {', '.join(REACTION_DELTA)}")
        state = await self.get_state()
        rating = await self._running_rating(state)
        person = next((p for p in rating["people"] if slug(p) == slug(name)), None)
        if person is None:
            raise PopcornError(f"{' '.join(name.split())} is not in this rating. Watching: {', '.join(rating['people'])}.")
        skipped = reaction is None
        rating["answers"][person] = {
            "reaction": reaction,
            "quote": "" if skipped or by != "voice" else " ".join(quote.split())[:QUOTE_MAX],
            "skipped": skipped,
            "by": "skip" if skipped else by,
        }
        rating["asking"] = next((p for p in rating["people"] if p not in rating["answers"]), None)
        rating["live"] = ""
        ack = REACTION_ACK[reaction] if reaction else ("Skipped" if by == "voice" else None)
        if rating["asking"] is None:
            return await self._finish(state, ack)
        text = f"{ack}. {rating['asking']}, what about you?" if ack else f"{rating['asking']}, what about you?"
        self._add_speech(state, text, await self.speak(text))
        await self._save_state(state, rating=rating)
        return {"saved": person, "reaction": reaction, "next": rating["asking"], "done": False}

    async def skip_turn(self, name: str | None = None) -> dict:
        """Skip someone by hand (default: whose turn it is)."""
        if name is None:
            name = (await self._running_rating(await self.get_state()))["asking"]
        return await self.record_reaction(name, None, "", "skip")

    async def set_live(self, text: str) -> dict:
        """Words heard so far for the person being asked. Writes only when the text changed."""
        state = await self.get_state()
        rating = await self._running_rating(state)
        text = " ".join(text.split())[:LIVE_MAX]
        if text == rating["live"]:
            return {"live": text, "changed": False}
        rating["live"] = text
        await self._save_state(state, rating=rating)
        return {"live": text, "changed": True}

    async def finish_rating(self) -> dict:
        """Save what is answered now. Everyone in the rating counts as having watched the film."""
        state = await self.get_state()
        rating = state["rating"]
        if rating and rating["done"]:
            return {"saved": None, "done": True, "movie": rating["movie"]["title"]}
        await self._running_rating(state)
        return await self._finish(state)

    async def _finish(self, state: dict, ack: str | None = None) -> dict:
        rating = state["rating"]
        reactions = {n: a["reaction"] for n, a in rating["answers"].items() if a["reaction"]}
        quotes = {n: a["quote"] for n, a in rating["answers"].items() if a["quote"]}
        saved = await self.mark_watched(str(rating["movie"]["id"]), reactions or None, who=rating["people"], quotes=quotes)
        text = f"{ack}. Saved, thanks everyone." if ack else "Saved, thanks everyone."
        audio = await self.speak(text)
        state = {**await self.get_state(), "rating": {**rating, "asking": None, "live": "", "done": True}}
        self._add_speech(state, text, audio)
        await self._save_state(state, message=f"Saved: {rating['movie']['title']}")
        return {"done": True, "movie": saved["movie"], "updated": saved["updated"], "next": None}
