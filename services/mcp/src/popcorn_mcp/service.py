"""Popcorn AI domain logic: couch, person profiles, favorites catalog, LLM picks, family rating.

The "TV state" document is what the TV app polls. Every call that changes what
the TV should show writes it, so a remote press appears on screen.
"""

import asyncio
import base64
import hashlib
import logging
import re
import time
from typing import Any, Literal, Protocol

from . import taste
from .llm import LLM, LLMError
from .store import Store
from .tmdb import TMDB, TMDBError, backdrop_url, cert_allowed, poster_url, providers_for, us_certification

Reaction = Literal["loved", "liked", "meh", "disliked", "hated"]
REACTIONS = ("loved", "liked", "meh", "disliked", "hated")
REACTION_ACK = {"loved": "Loved it, noted", "liked": "Liked it, noted", "meh": "Okay, noted",
                "disliked": "Not a fan, noted", "hated": "Hated it, noted"}
Answer = Literal["voice", "hand", "skip"]
SCREENS_BACK = ("recommendations", "ask", "couch")  # where go_to may send the TV
VOICE_STATES = ("idle", "listening", "thinking")

LIVE_MAX = 300  # characters of live speech kept for the TV
SUMMARY_WORDS = 15  # a spoken rating comes back as at most this many words
REVIEWS_MAX = 30
WHY_MAX, SPEECH_MAX, SPEECH_KEEP = 220, 600, 6
FAVORITES_MIN, FAVORITES_MAX = 5, 25
CATALOG_SIZE = 60
GENRE_LIST_SIZE = 60  # films in each "for you" genre list of the favorites page
FAVCAT_KEY = "favcat"
PICKS, PICKS_MIN = 10, 4  # films kept on the reel, and the fewest worth showing at all
SHOWN_MAX = 50  # films remembered for "New picks" in one evening
EXCLUDED_GENRES = {"TV Movie"}  # nothing to show for it, so the genre grid leaves it out
AUDIO_PIECE = 200_000  # raw bytes per stored item (base64 stays under DynamoDB's 400 KB)
VOICE_TTL = 2 * 24 * 3600
VOICE_MIN_GAP = 0.25  # at most 4 voice writes per second
SHA1 = re.compile(r"[0-9a-f]{40}")
UNCLEAR = "I didn't catch that, try again or use the buttons"
REQUEST_MAX = 200  # characters of a wish for tonight sent on to the picks
ASK_SORRY = "Sorry, I can't help with that."
ASK_RECENT = "Sorry, I can't help with that. I don't know films from the last two years or what's in cinemas now."
ASK_RECENT = "Sorry, I can't help with that. I don't know films from the last two years or what's in cinemas now."

REC_SYSTEM = """\
You pick films for a group of people who watch one film together tonight.
Suggest 12 films, best first. If they say what they feel like tonight, every pick must fit that wish.
Answer only with JSON: {"picks": [{"title": "<original English title>", "year": <int>, "why": "<one spoiler-free sentence on why this group will enjoy it>"}]}"""

VOICE_SYSTEM = """\
You read one person's spoken opinion about a film they just watched for the first time, as speech to text.
Answer only with JSON: {"reaction": "loved" | "liked" | "meh" | "disliked" | "hated",
"summary": "<their opinion in at most 15 words, English, no spoilers>"}"""

ASK_SYSTEM = """\
You check one answer before a film recommender sees it. People on a couch were asked:
"What kind of film do you feel like watching tonight?" The answer comes from speech to text or a TV keyboard, in any language.
The recommender's film knowledge ends about two years ago. It cannot know new releases or what is in cinemas now.
"ok": the answer says what kind of film they want and the recommender can act on it: a genre, mood, theme, era,
length, a film it should be like, an actor, a director, a country, and so on.
"recent": it asks for films from the last two years, this year's or the latest releases, or what is in cinemas now.
"no": anything else: off topic, gibberish, harmful, or not about choosing a film.
Answer only with JSON: {"verdict": "ok" | "recent" | "no", "request": "<for ok: their wish as one short English sentence, else empty>"}"""

PROFILE_DEFAULTS = {"age": None, "kid": False, "genres": [], "favorites": [], "favorites_done": False, "reviews": []}
STATE_DEFAULTS = {
    "version": 0, "updated_at": 0, "members": [], "screen": "couch", "message": "", "recommendations": [],
    "genres_for": None, "picks_loading": False, "shown_tonight": [], "request": "", "ask_reply": "", "favorites": None, "details": None,
    "watching": None, "rating": None, "focus": None, "speech": [],
    "voice": {"state": "idle", "text": "", "speaker": None, "at": 0},
}

UNSET: Any = object()  # "argument not given", since None means "clear it" for age

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


def title_year(item: dict | str) -> str:
    if isinstance(item, str):
        return item
    return f"{item['title']} ({item['year']})" if item.get("year") else item["title"]


def brief(card: dict) -> dict:
    """The four fields a favorite entry keeps."""
    return {k: card.get(k, "") for k in ("id", "title", "year", "genres")}


def upgrade_profile(profile: dict) -> dict:
    """Fill fields added after a profile was stored."""
    for key, value in PROFILE_DEFAULTS.items():
        profile.setdefault(key, _fresh(value))
    return profile


class Popcorn:
    def __init__(self, store: Store, tmdb: TMDB, household: str, watch_region: str = "US",
                 speaker: Speaker | None = None, llm: LLM | None = None) -> None:
        self._store = store
        self._tmdb = tmdb
        self._household = household
        self._watch_region = watch_region
        self._speaker = speaker
        self._llm = llm
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

    async def _ensure_profile(self, name: str, age: int | None = None) -> tuple[dict, bool]:
        display = " ".join((name or "").split())
        if not display:
            raise PopcornError("I need a name.")
        if age is not None and (not isinstance(age, int) or isinstance(age, bool) or not 0 <= age <= 120):
            raise PopcornError("age must be between 0 and 120")
        profile = await self._profile(display)
        created = profile is None
        if created:
            profile = upgrade_profile({"id": slug(display), "name": display})
            ids = await self._profile_ids()
            await self._store.put(self._key("profiles"), {"ids": [*ids, profile["id"]]})
        if age is not None and age != profile["age"]:
            profile["age"], profile["kid"] = age, age < taste.KID_AGE
        if created or age is not None:
            await self._save_profile(profile)
        return profile, created

    async def _resolve_genres(self, names: list[str]) -> tuple[list[str], list[str]]:
        """The TMDB genre names we know, in the order given, plus the ones we do not."""
        genres = await self._tmdb.genres()
        found, unknown = [], []
        for name in names:
            genre_id = taste.resolve_genre(name, genres)
            label = genres.get(genre_id) if genre_id else None
            if label is None:
                unknown.append(name)
            elif label not in found:
                found.append(label)
        return found, unknown

    def memory(self, profile: dict) -> dict:
        """What the TV and the tools see for a person: their genres, favorites and reviews, never the id."""
        return {
            "name": profile["name"],
            "age": profile["age"],
            "kid": profile["kid"],
            "genres": list(profile["genres"]),
            "favorites": [title_year(f) for f in profile.get("favorites", [])],
            "favorites_done": profile.get("favorites_done", False),
            "reviews": [{k: r.get(k, "") for k in ("title", "year", "reaction", "summary")}
                        for r in profile["reviews"][-10:]],
            "new": not profile["genres"] or not profile.get("favorites_done", False),
        }

    async def get_profiles(self, names: list[str] | None = None) -> list[dict]:
        if names:
            profiles = [await self._require_profile(n) for n in names]
        else:
            profiles = [p for p in [await self._profile(i) for i in await self._profile_ids()] if p]
        return [self.memory(p) for p in profiles]

    async def save_genres(self, name: str, genres: list[str]) -> dict:
        """Save the genres a person picked; a person who has not finished favorites gets the page opened."""
        profile = await self._require_profile(name)
        picked, unknown = await self._resolve_genres(genres)
        if not picked:
            raise PopcornError("Pick at least one genre from the list.")
        profile["genres"] = picked
        await self._save_profile(profile)
        state = await self.get_state()
        screen = "couch" if state["screen"] == "genres" else state["screen"]
        await self._save_state(state, genres_for=None, screen=screen,
                               message=f"{profile['name']}'s genres are saved")
        result = {"memory": self.memory(profile)}
        if unknown:
            result["unknown_genres"] = unknown
        if not profile.get("favorites_done"):
            try:
                result.update(await self.start_favorites(profile["name"]))
            except PopcornError as exc:
                result["favorites_error"] = str(exc)
            except TMDBError as exc:
                log.warning("favorites for %s after saving genres failed: %r", profile["id"], exc)
                result["favorites_error"] = "The movie database is not answering right now."
        return result

    async def rename_person(self, name: str, new_name: str) -> dict:
        profile = await self._require_profile(name)
        display = " ".join((new_name or "").split())
        if not display:
            raise PopcornError("The new name is empty.")
        old_id, old_name, new_id = profile["id"], profile["name"], slug(display)
        if new_id != old_id and (other := await self._profile(new_id)):
            raise PopcornError(f"There is already someone called {other['name']}. Pick another name.")
        profile.update(id=new_id, name=display)
        await self._save_profile(profile)
        if new_id != old_id:
            await self._store.put(self._key("profiles"), {"ids": [new_id if i == old_id else i for i in await self._profile_ids()]})
            await self._store.delete(self._key("profile", old_id))
        state = await self.get_state()
        state["members"] = [new_id if m == old_id else m for m in state["members"]]
        if state["genres_for"] and slug(state["genres_for"]) == old_id:
            state["genres_for"] = display
        if state.get("favorites") and slug(state["favorites"]["name"]) == old_id:
            state["favorites"]["name"] = display
        if rating := state["rating"]:
            def rename(person: str) -> str:
                return display if person == old_name else person

            rating["people"] = [rename(n) for n in rating["people"]]
            rating["asking"] = rating["asking"] and rename(rating["asking"])
            rating["answers"] = {rename(n): a for n, a in rating["answers"].items()}
        await self._save_state(state, message=f"{old_name} is now {display}")
        return {"renamed": old_name, "memory": self.memory(profile)}

    async def delete_person(self, name: str) -> dict:
        """Remove a profile for good, and everywhere it is on the TV: couch, genres, favorites, rating."""
        profile = await self._require_profile(name)
        pid, display = profile["id"], profile["name"]
        await self._store.put(self._key("profiles"), {"ids": [i for i in await self._profile_ids() if i != pid]})
        await self._store.delete(self._key("profile", pid))
        state = await self.get_state()
        state["members"] = [m for m in state["members"] if m != pid]
        message = f"{display} was deleted"
        if state["genres_for"] and slug(state["genres_for"]) == pid:
            state.update(genres_for=None, screen="couch")
        if state.get("favorites") and slug(state["favorites"]["name"]) == pid:
            state["favorites"] = None
            if state["screen"] == "favorites":
                state["screen"] = "couch"
        if (rating := state["rating"]) and not rating["done"]:
            rating["people"] = [n for n in rating["people"] if slug(n) != pid]
            rating["answers"] = {n: a for n, a in rating["answers"].items() if slug(n) != pid}
            if not rating["people"]:
                state.update(rating=None, screen="couch")
            elif slug(rating["asking"] or "") == pid:
                rating["asking"] = next((n for n in rating["people"] if n not in rating["answers"]), None)
                rating["live"] = ""
                if rating["asking"] is None:
                    await self._save_state(state)
                    await self._finish(await self.get_state())
                    state = await self.get_state()
                else:
                    text = f"{rating['asking']}, what about you?"
                    self._add_speech(state, text, await self.speak(text))
        await self._save_state(state, message=message)
        return {"deleted": display}

    async def edit_person(self, name: str, new_name: str | None = None, age: Any = UNSET) -> dict:
        """Fix a name and/or age by hand. age=None clears the age (kid stays as it is); an int sets age and kid."""
        profile = await self._require_profile(name)
        display = " ".join((new_name or "").split())
        if new_name is None and age is UNSET:
            raise PopcornError("Send a new name, an age, or both.")
        if new_name is not None and not display:
            raise PopcornError("The new name is empty.")
        if age is not UNSET and age is not None and (not isinstance(age, int) or isinstance(age, bool)
                                                     or not 0 <= age <= 120):
            raise PopcornError("age must be between 0 and 120")
        if new_name is not None and display != profile["name"]:
            await self.rename_person(profile["name"], display)
            profile = await self._require_profile(display)
        if age is not UNSET:
            profile["age"] = age
            if age is not None:
                profile["kid"] = age < taste.KID_AGE
            await self._save_profile(profile)
            await self._save_state(await self.get_state(), message=f"{profile['name']} was updated")
        return {"memory": self.memory(profile)}

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
        household = {i: self.memory(p) for i in await self._profile_ids() if (p := await self._profile(i))}
        members = [household[m] for m in state["members"] if m in household]
        return {**state, "members": members, "household": list(household.values())}

    # ---------- genres and couch ----------

    async def genres(self) -> dict[int, str]:
        """The TMDB movie genres the TV offers, without "TV Movie"."""
        return {i: n for i, n in (await self._tmdb.genres()).items() if n not in EXCLUDED_GENRES}

    async def genres_list(self) -> dict:
        return {"genres": [{"id": i, "name": n} for i, n in (await self.genres()).items()]}

    async def _members(self, state: dict) -> list[dict]:
        return [p for p in [await self._profile(m) for m in state["members"]] if p]

    async def _couch_result(self, state: dict, created: list[str]) -> dict:
        members = await self._members(state)
        result = {"couch": [p["name"] for p in members], "kid_filter": taste.max_certification(members)}
        if created:
            result["new_people"] = created
            result["genres_for"] = created[0]
        return result

    async def _after_couch_change(self, state: dict, created: list[str], message: str) -> dict:
        """A new person picks genres first. Anyone else: the reel stays as it is, nothing to filter by.

        The TV cannot change the couch during favorites, so a running favorites is left alone.
        """
        state["shown_tonight"], state["request"] = [], ""  # a new couch is a new evening
        if created:
            await self._save_state(state, screen="genres", genres_for=created[0], recommendations=[],
                                   details=None, watching=None, rating=None, message=message)
        elif state["screen"] in ("recommendations", "favorites"):
            await self._save_state(state, message=message)
        else:
            await self._save_state(state, screen="couch", genres_for=None, message=message)
        return await self._couch_result(state, created)

    async def set_couch(self, people: list[dict]) -> dict:
        state = await self.get_state()
        created, members, profiles = [], [], []
        for person in people:
            profile, new = await self._ensure_profile(person["name"], person.get("age"))
            if new:
                created.append(profile["name"])
            if profile["id"] not in members:
                members.append(profile["id"])
                profiles.append(profile)
        state["members"] = members
        await self._save_state(state, screen="genres" if created else "couch",
                               genres_for=created[0] if created else None, recommendations=[], shown_tonight=[],
                               request="", ask_reply="", favorites=None, details=None, watching=None, rating=None, message="", picks_loading=False)
        result = await self._couch_result(state, created)
        result["memory"] = [self.memory(p) for p in profiles]
        return result

    async def add_to_couch(self, name: str, age: int | None = None) -> dict:
        state = await self.get_state()
        profile, new = await self._ensure_profile(name, age)
        if profile["id"] not in state["members"]:
            state["members"].append(profile["id"])
        result = await self._after_couch_change(state, [profile["name"]] if new else [],
                                              f"{profile['name']} joined")
        result["memory"] = self.memory(profile)
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

    # ---------- picks ----------

    async def _couch_ready(self, state: dict) -> list[dict]:
        """Everyone on the couch, or an error the person can fix."""
        members = await self._members(state)
        if not members:
            raise PopcornError("The couch is empty. Add who is watching first.")
        if self._llm is None:
            raise PopcornError("Picks are not set up on this server.")
        return members

    async def open_ask(self) -> dict:
        """The Popcorn button: "what do you feel like tonight?". Someone who left their genres or favorites
        unfinished (Back) goes on with it first, since neither can be skipped."""
        state = await self.get_state()
        members = await self._couch_ready(state)
        for person in members:
            if not person["genres"]:
                await self._save_state(state, screen="genres", genres_for=person["name"],
                                       message=f"{person['name']}, pick your genres first")
                return {"screen": "genres", "genres_for": person["name"]}
            if not person.get("favorites_done"):
                fav = state.get("favorites")
                if fav and fav.get("name") == person["name"]:
                    await self._save_state(state, screen="favorites", message=f"{person['name']}, pick films you like")
                    return {"screen": "favorites", "favorites": fav}
                return await self.start_favorites(person["name"])
        await self._save_state(state, screen="ask", ask_reply="", genres_for=None, details=None, watching=None,
                               rating=None, message="")
        return {"screen": "ask"}

    async def ask(self, text: str) -> dict:
        """Their answer to "what do you feel like tonight?". One LLM check (no profiles): a wish it can act on
        goes on to the picks; anything else stays on the ask screen with a fixed "sorry" line."""
        words = clean(text, REQUEST_MAX)
        state = await self.get_state()
        await self._couch_ready(state)
        verdict, wish = "no", ""
        if any(ch.isalpha() for ch in words):
            data = await self._llm.json_chat(
                [{"role": "system", "content": ASK_SYSTEM}, {"role": "user", "content": words}],
                temperature=0, effort="low")
            verdict = (data or {}).get("verdict")
            wish = clean(str((data or {}).get("request") or ""), REQUEST_MAX)
        if verdict != "ok":
            reply = ASK_RECENT if verdict == "recent" else ASK_SORRY
            self._add_speech(state, reply, await self.speak(reply))
            await self._save_state(state, screen="ask", ask_reply=reply)
            return {"ok": False, "reply": reply}
        result = await self.recommend(request=wish or words)
        return {"ok": True, "request": wish or words, **result}

    async def recommend(self, more: bool = False, request: str | None = None) -> dict:
        """Ten films for tonight from one LLM call (one retry), checked against TMDB, on the reel.

        `request` is tonight's wish ("" = skipped); None keeps the one already set (New picks)."""
        state = await self.get_state()
        members = await self._couch_ready(state)
        if request is not None:
            state["request"] = clean(request, REQUEST_MAX)
        await self._save_state(state, picks_loading=True, message="")
        try:
            cards = await self._recommend_cards(members, more, state["shown_tonight"], state["request"])
        except BaseException:  # a cancelled call must not leave the TV loading forever
            await self._save_state(await self.get_state(), picks_loading=False)
            raise
        audio = await asyncio.gather(*(self.speak(card["why"]) for card in cards))
        for card, path in zip(cards, audio):
            card["why_audio"] = path
        state = await self.get_state()
        shown = [*state["shown_tonight"],
                 *({"id": c["id"], "title": c["title"], "year": c["year"]} for c in cards)][-SHOWN_MAX:]
        await self._save_state(state, screen="recommendations", recommendations=cards, picks_loading=False,
                               shown_tonight=shown, genres_for=None, details=None, watching=None, rating=None,
                               ask_reply="", message="")
        return {"recommendations": cards}

    async def _recommend_cards(self, members: list[dict], more: bool, shown: list[dict], request: str = "") -> list[dict]:
        """Ask, check, and ask once more when the answer does not survive the checks."""
        messages = self._recommend_messages(members, more, shown, request)
        max_cert = taste.max_certification(members)
        for _ in range(2):
            cards = await self._picks_to_cards(await self._ask_picks(messages), max_cert)
            if len(cards) >= PICKS_MIN:
                return cards
        raise LLMError("I couldn't find enough films for you right now. Try again in a moment.")

    @staticmethod
    def _recommend_messages(members: list[dict], more: bool, shown: list[dict], request: str = "") -> list[dict]:
        """The static system message plus one block per person, then the rules for tonight."""
        blocks = []
        for p in members:
            lines = [f"{p['name']} ({p['age']})" if p["age"] is not None else p["name"],
                     "Genres: " + (", ".join(p["genres"]) or "not chosen yet")]
            if p.get("favorites"):
                lines.append("Favorite films: " + "; ".join(title_year(f) for f in p["favorites"]))
            if p["reviews"]:
                lines.append("Reviews: " + "; ".join(
                    f"{title_year(r)}: {r['reaction']}" + (f" - {r['summary']}" if r["summary"] else "")
                    for r in p["reviews"][-10:]))
            blocks.append("\n".join(lines))
        if request:
            blocks.append(f"Tonight they feel like: {request}")
        if rule := taste.kid_rule(members):
            blocks.append(rule)
        if more and shown:
            blocks.append("Do not suggest these again: " + ", ".join(title_year(s) for s in shown))
        return [{"role": "system", "content": REC_SYSTEM},
                {"role": "user", "content": "\n\n".join(blocks)}]

    async def _ask_picks(self, messages: list[dict]) -> list[dict]:
        """The films the model named, cleaned: title, year (or None) and one why line each."""
        data = await self._llm.json_chat(messages, temperature=0.5, effort="low")
        picks = (data or {}).get("picks")
        if not isinstance(picks, list):
            return []
        out = []
        for pick in picks:
            if not isinstance(pick, dict):
                continue
            title = " ".join(str(pick.get("title") or "").split())
            year = pick.get("year")
            if title:
                out.append({"title": title, "why": clean(str(pick.get("why") or ""), WHY_MAX),
                            "year": year if isinstance(year, int) and not isinstance(year, bool) else None})
        return out

    async def _picks_to_cards(self, picks: list[dict], max_cert: str | None) -> list[dict]:
        """Search every pick, then keep the first ten that exist, have a poster, are new and fit the couch."""
        genres = await self._tmdb.genres()
        found = await asyncio.gather(*(self._search_movie(p["title"], p["year"]) for p in picks),
                                     return_exceptions=True)
        whys: dict[int, str] = {}  # by film id: a film named twice keeps the line of its first pick
        for pick, movie in zip(picks, found):
            if isinstance(movie, dict):
                whys.setdefault(movie["id"], pick["why"])
        cards, seen = [], set()
        for movie in found:
            if not isinstance(movie, dict) or movie["id"] in seen:
                continue
            if not movie.get("poster_path") or not cert_allowed(us_certification(movie), max_cert):
                continue
            seen.add(movie["id"])
            card = self._card(movie, genres)
            card.update(why=whys.get(card["id"]) or "", why_audio=None)
            cards.append(card)
            if len(cards) == PICKS:
                break
        return cards

    async def _search_movie(self, title: str, year: int | None) -> dict | None:
        """The details of the first search hit for this title, trying the year first; None if there is none."""
        for query_year in ((year,) if year else ()) + (None,):
            results = await self._tmdb.search(title, query_year)
            if results:
                return await self._tmdb.movie(results[0]["id"])
        return None

    # ---------- favorites catalog and onboarding ----------

    async def _cert(self, movie_id: int) -> str | None:
        """US certification of a film, checked once per process."""
        if movie_id not in self._certs:
            self._certs[movie_id] = await self._tmdb.certification(movie_id)
        return self._certs[movie_id]

    @staticmethod
    def _fav_card(movie: dict, genres: dict[int, str]) -> dict:
        genre_ids = movie.get("genre_ids") or [g["id"] for g in movie.get("genres", [])]
        if isinstance(movie.get("genres"), list) and movie["genres"] and isinstance(movie["genres"][0], str):
            genre_names = movie["genres"]
        else:
            genre_names = [genres[g] for g in genre_ids if g in genres]
        return {
            "id": movie["id"],
            "title": movie["title"],
            "year": str(movie.get("year") or (movie.get("release_date") or "")[:4]),
            "poster": movie.get("poster") or poster_url(movie.get("poster_path")) or "",
            "rating": movie.get("rating") if "rating" in movie else round(movie.get("vote_average") or 0, 1),
            "genres": genre_names,
        }

    async def seed_catalog(self, force: bool = False) -> dict:
        """Build the favorites catalog once: popular + best of all time.
        One doc favcat -> {"popular": [card + "cert"], "best": [card + "cert"], "built_at"}.
        """
        doc = await self._store.get(FAVCAT_KEY)
        if not force and doc and (time.time() - (doc.get("built_at") or 0) < 86400):
            return {"built": [], "remaining": []}

        genres = await self._tmdb.genres()
        gate = asyncio.Semaphore(16)

        async def cert(movie_id: int) -> str | None:
            async with gate:
                return await self._cert(movie_id)

        seen: set[int] = set()

        # popular: TMDB /trending/movie/week, pages 1.. until 60 films
        popular: list[dict] = []
        page = 1
        while len(popular) < CATALOG_SIZE:
            found = await self._tmdb.trending(page=page)
            if not found:
                break
            candidates = [m for m in found if m.get("poster_path") and m["id"] not in seen]
            certs = await asyncio.gather(*(cert(m["id"]) for m in candidates), return_exceptions=True)
            for m, c in zip(candidates, certs):
                if m["id"] not in seen and len(popular) < CATALOG_SIZE:
                    seen.add(m["id"])
                    if not isinstance(c, BaseException):
                        popular.append({**self._fav_card(m, genres), "cert": c})
            page += 1
            if page > 10:
                break

        # best: TMDB discover sort_by=vote_average.desc, vote_count.gte=5000, pages 1.. until 60 films
        best: list[dict] = []
        page = 1
        while len(best) < CATALOG_SIZE:
            found = await self._tmdb.discover(sort_by="vote_average.desc", min_votes=5000, page=page)
            if not found:
                break
            candidates = [m for m in found if m.get("poster_path") and m["id"] not in seen]
            certs = await asyncio.gather(*(cert(m["id"]) for m in candidates), return_exceptions=True)
            for m, c in zip(candidates, certs):
                if m["id"] not in seen and len(best) < CATALOG_SIZE:
                    seen.add(m["id"])
                    if not isinstance(c, BaseException):
                        best.append({**self._fav_card(m, genres), "cert": c})
            page += 1
            if page > 10:
                break

        # the per-genre lists are built on demand by get_favorites_catalog and start empty again
        doc = {"popular": popular, "best": best, "genres": {}, "genre_size": GENRE_LIST_SIZE,
               "built_at": int(time.time())}
        await self._store.put(FAVCAT_KEY, doc)
        return {"built": ["favcat"], "remaining": []}

    async def _genre_list(self, genre: str, genres: dict[int, str]) -> list[dict]:
        """The best-known films of one genre (most votes first), each with its certification."""
        genre_id = next((i for i, n in genres.items() if n == genre), None)
        if genre_id is None:
            return []
        pages = await asyncio.gather(*(
            self._tmdb.discover(with_genres=str(genre_id), sort_by="vote_count.desc", min_votes=1000, page=page)
            for page in range(1, GENRE_LIST_SIZE // 20 + 1)))
        candidates, seen = [], set()
        for m in (m for found in pages for m in found):
            if m.get("poster_path") and m["id"] not in seen:
                seen.add(m["id"])
                candidates.append(m)
        candidates = candidates[:GENRE_LIST_SIZE]
        gate = asyncio.Semaphore(16)

        async def cert(movie_id: int) -> str | None:
            async with gate:
                return await self._cert(movie_id)

        certs = await asyncio.gather(*(cert(m["id"]) for m in candidates), return_exceptions=True)
        return [{**self._fav_card(m, genres), "cert": c}
                for m, c in zip(candidates, certs) if not isinstance(c, BaseException)]

    async def get_favorites_catalog(self) -> dict:
        """{"for_you": [{"genre", "films"}], "popular": FavCard[], "best": FavCard[]} for the person in
        state.favorites, kid-filtered by their own age (cert_allowed). for_you has one list per genre of
        the person; popular and best keep only films of those genres; no film shows twice on the page.
        400 when no favorites page is open."""
        state = await self.get_state()
        fav = state.get("favorites")
        if not fav:
            raise PopcornError("No favorites page is open.")
        profile = await self._require_profile(fav["name"])
        max_cert = taste.max_certification([profile])
        doc = await self._store.get(FAVCAT_KEY)
        if not doc or (time.time() - (doc.get("built_at") or 0) >= 86400):
            await self.seed_catalog()
            doc = await self._store.get(FAVCAT_KEY) or {}

        wanted = list(profile.get("genres") or [])
        if doc.get("genre_size") != GENRE_LIST_SIZE:  # lists built for another size are built again
            doc["genres"], doc["genre_size"] = {}, GENRE_LIST_SIZE
        lists = doc.setdefault("genres", {})
        missing = [g for g in wanted if g not in lists]
        if missing:
            genres = await self._tmdb.genres()
            built = await asyncio.gather(*(self._genre_list(g, genres) for g in missing))
            lists.update(zip(missing, built))
            await self._store.put(FAVCAT_KEY, doc)

        seen: set[int] = set()

        def films(cards: list[dict]) -> list[dict]:
            out = []
            for c in cards:
                if wanted and not set(c.get("genres") or []) & set(wanted):
                    continue  # only films of the genres the person picked
                if c["id"] not in seen and cert_allowed(c.get("cert"), max_cert):
                    seen.add(c["id"])
                    out.append({k: c[k] for k in ("id", "title", "year", "poster", "rating", "genres")})
            return out

        for_you = [{"genre": g, "films": films(lists.get(g, []))} for g in wanted]
        return {"for_you": [s for s in for_you if s["films"]],
                "popular": films(doc.get("popular", [])), "best": films(doc.get("best", []))}

    async def start_favorites(self, name: str) -> dict:
        """Open the favorites page for that person (screen favorites); keeps earlier picks if left with Back."""
        profile = await self._require_profile(name)
        state = await self.get_state()
        current = state.get("favorites")
        picked = current["picked"] if current and current.get("name") == profile["name"] else []
        fav = {
            "name": profile["name"],
            "picked": picked,
            "query": "",
            "results": [],
            "min": FAVORITES_MIN,
            "max": FAVORITES_MAX,
        }
        await self._save_state(state, screen="favorites", favorites=fav, genres_for=None,
                               message=f"{profile['name']}, pick films you like")
        return {"favorites": fav}

    async def toggle_favorite(self, movie_id: int) -> dict:
        """Pick or un-pick a film. Must be in catalog or in results (no TMDB call).
        26th pick -> 400 'You can pick up to 25 films'."""
        state = await self.get_state()
        fav = state.get("favorites")
        if not fav:
            raise PopcornError("No favorites page is open.")
        picked: list[dict] = fav["picked"]
        existing_idx = next((i for i, c in enumerate(picked) if c["id"] == movie_id), None)
        if existing_idx is not None:
            picked.pop(existing_idx)
            await self._save_state(state, favorites=fav)
            return {"favorites": fav}
        if len(picked) >= FAVORITES_MAX:
            raise PopcornError("You can pick up to 25 films")
        card = next((c for c in fav.get("results", []) if c["id"] == movie_id), None)
        if card is None:
            doc = await self._store.get(FAVCAT_KEY) or {}
            genre_lists = [c for cards in (doc.get("genres") or {}).values() for c in cards]
            for c in doc.get("popular", []) + doc.get("best", []) + genre_lists:
                if c["id"] == movie_id:
                    card = {k: c[k] for k in ("id", "title", "year", "poster", "rating", "genres")}
                    break
        if card is None:
            raise PopcornError(f"Film {movie_id} is not in the catalog or search results.")
        picked.append(card)
        await self._save_state(state, favorites=fav)
        return {"favorites": fav}

    async def query_favorites(self, query: str) -> dict:
        """TMDB search (tmdb.search), films with a poster, kid-filtered (certification checks only for kids),
        max 20 -> results. '' clears."""
        state = await self.get_state()
        fav = state.get("favorites")
        if not fav:
            raise PopcornError("No favorites page is open.")
        q = query.strip()
        if not q:
            fav["query"] = ""
            fav["results"] = []
            await self._save_state(state, favorites=fav)
            return {"favorites": fav}
        fav["query"] = query
        profile = await self._require_profile(fav["name"])
        max_cert = taste.max_certification([profile])
        genres = await self._tmdb.genres()
        results = await self._tmdb.search(q)
        with_poster = [m for m in results if m.get("poster_path")]
        if max_cert is not None:
            certs = await asyncio.gather(*(self._cert(m["id"]) for m in with_poster), return_exceptions=True)
            filtered = [
                m for m, c in zip(with_poster, certs)
                if not isinstance(c, BaseException) and cert_allowed(c, max_cert)
            ]
        else:
            filtered = with_poster
        fav["results"] = [self._fav_card(m, genres) for m in filtered[:20]]
        await self._save_state(state, favorites=fav)
        return {"favorites": fav}

    async def done_favorites(self) -> dict:
        """Fewer than 5 -> 400 'Pick at least 5 films'.
        Else save favorites + favorites_done: true, favorites: null, screen couch."""
        state = await self.get_state()
        fav = state.get("favorites")
        if not fav:
            raise PopcornError("No favorites page is open.")
        picked = fav["picked"]
        if len(picked) < FAVORITES_MIN:
            raise PopcornError("Pick at least 5 films")
        profile = await self._require_profile(fav["name"])
        profile["favorites"] = [brief(c) for c in picked]
        profile["favorites_done"] = True
        await self._save_profile(profile)
        await self._save_state(state, screen="couch", favorites=None,
                               message=f"Got it! {profile['name']}'s taste is saved.")
        return {"done": True, "memory": self.memory(profile)}

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

    async def set_voice(self, voice_state: str, text: str | None = None, speaker: str | None = None) -> dict:
        """Listening / thinking / idle, with the words heard so far. On the rating screen they are also `rating.live`."""
        if voice_state not in VOICE_STATES:
            raise PopcornError(f"state must be one of: {', '.join(VOICE_STATES)}")
        now = time.time()
        new = {"state": voice_state, "text": " ".join((text or "").split())[:LIVE_MAX],
               "speaker": " ".join(speaker.split()) if speaker else None, "at": round(now, 3)}
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
        """Back button: show the picks, the ask screen or the couch; drop details, watching, rating and the genre grid."""
        if screen not in SCREENS_BACK:
            raise PopcornError(f"screen must be one of: {', '.join(SCREENS_BACK)}")
        state = await self.get_state()
        await self._save_state(state, screen=screen, details=None, watching=None, rating=None, genres_for=None,
                               ask_reply="")
        return {"screen": screen}

    async def set_focus(self, movie_id: int) -> dict:
        """The reel settled on a film. No screen change; the TV plays that film's `why_audio`."""
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

    # ---------- family rating ----------

    @staticmethod
    def _summary(text: str) -> str:
        """A spoken opinion as one line of at most 15 words."""
        return " ".join(" ".join((text or "").split()).split()[:SUMMARY_WORDS])

    async def _save_reviews(self, film: dict, reactions: dict[str, str], summaries: dict[str, str]) -> list[dict]:
        """One review per film per person, newest last; a new reaction for a film replaces the old one."""
        updated = []
        for name, reaction in reactions.items():
            profile = await self._require_profile(name)
            entry = {"id": film["id"], "title": film["title"], "year": film["year"], "reaction": reaction,
                     "summary": self._summary(summaries.get(name, "")), "at": int(time.time())}
            reviews = [r for r in profile["reviews"] if r["id"] != film["id"]]
            profile["reviews"] = [*reviews, entry][-REVIEWS_MAX:]
            await self._save_profile(profile)
            updated.append({"name": profile["name"], "reaction": reaction})
        return updated

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

    async def record_reaction(self, name: str, reaction: Reaction | None, summary: str = "", by: Answer = "voice") -> dict:
        """Save one person's answer (None = skip). Changing an answer overwrites it. The last answer saves everything.

        `summary` is the LLM's line for a spoken answer, empty for a button; `by="skip"` is a skip by hand.
        """
        if reaction is not None and reaction not in REACTIONS:
            raise PopcornError(f"reaction must be one of: {', '.join(REACTIONS)}")
        state = await self.get_state()
        rating = await self._running_rating(state)
        person = next((p for p in rating["people"] if slug(p) == slug(name)), None)
        if person is None:
            raise PopcornError(f"{' '.join(name.split())} is not in this rating. Watching: {', '.join(rating['people'])}.")
        skipped = reaction is None
        rating["answers"][person] = {
            "reaction": reaction,
            "quote": "" if skipped or by != "voice" else self._summary(summary),
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

    async def voice_reaction(self, text: str, name: str | None = None) -> dict:
        """A spoken answer from the phone: the LLM turns the words into a reaction and a summary, then it is saved."""
        words = " ".join((text or "").split())
        if len(words) < 2 or not any(ch.isalpha() for ch in words):
            raise PopcornError(UNCLEAR)
        state = await self.get_state()
        rating = await self._running_rating(state)
        person = name or rating["asking"]
        if not person:
            raise PopcornError("Nobody is being asked right now.")
        if self._llm is None:
            raise PopcornError("Speaking a rating is not set up on this server. Use the buttons.")
        film = rating["movie"]
        data = await self._llm.json_chat(
            [{"role": "system", "content": VOICE_SYSTEM},
             {"role": "user", "content": f"Film: {title_year(film)}\nThey said: {clean(words, LIVE_MAX)}"}],
            temperature=0, effort="low")
        reaction = (data or {}).get("reaction")
        if reaction not in REACTIONS:
            raise PopcornError(UNCLEAR)
        summary = self._summary(str((data or {}).get("summary") or "")) or self._summary(words)
        return await self.record_reaction(person, reaction, summary, "voice")

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
        """Save what is answered now. Everyone with an answer gets a review of the film."""
        state = await self.get_state()
        rating = state["rating"]
        if rating and rating["done"]:
            return {"saved": None, "done": True, "movie": rating["movie"]["title"]}
        await self._running_rating(state)
        return await self._finish(state)

    async def _finish(self, state: dict, ack: str | None = None) -> dict:
        rating = state["rating"]
        reactions = {n: a["reaction"] for n, a in rating["answers"].items() if a["reaction"]}
        summaries = {n: a["quote"] for n, a in rating["answers"].items() if a["quote"]}
        updated = await self._save_reviews(rating["movie"], reactions, summaries)
        text = f"{ack}. Saved, thanks everyone." if ack else "Saved, thanks everyone."
        audio = await self.speak(text)
        state = {**await self.get_state(), "rating": {**rating, "asking": None, "live": "", "done": True}}
        self._add_speech(state, text, audio)
        await self._save_state(state, message=f"Saved: {rating['movie']['title']}")
        return {"done": True, "movie": rating["movie"]["title"], "updated": updated, "next": None}
