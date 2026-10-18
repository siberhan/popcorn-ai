"""Taste memory math.

A profile keeps one weight per TMDB genre id (stored as a string key), in [-1, 1].
Positive means "likes", negative means "dislikes". A weight at or below VETO
means "never show this genre when this person is on the couch".
"""

from statistics import mean

from .tmdb import CERT_ORDER

VETO = -0.7

GENRE_ALIASES = {
    "sci-fi": "science fiction",
    "scifi": "science fiction",
    "sf": "science fiction",
    "space": "science fiction",
    "funny": "comedy",
    "comedies": "comedy",
    "scary": "horror",
    "cartoon": "animation",
    "cartoons": "animation",
    "animated": "animation",
    "anime": "animation",
    "romantic": "romance",
    "love stories": "romance",
    "documentaries": "documentary",
    "musical": "music",
    "musicals": "music",
    "kids": "family",
    "historical": "history",
    "detective": "mystery",
    "superhero": "action",
    "superheroes": "action",
}


def resolve_genre(name: str, genres: dict[int, str]) -> int | None:
    wanted = " ".join(name.split()).casefold()
    wanted = GENRE_ALIASES.get(wanted, wanted)
    by_name = {label.casefold(): genre_id for genre_id, label in genres.items()}
    if wanted in by_name:
        return by_name[wanted]
    if wanted.endswith("s") and wanted[:-1] in by_name:
        return by_name[wanted[:-1]]
    return None


def nudge(weights: dict[str, float], genre_ids, delta: float) -> None:
    for genre_id in genre_ids:
        key = str(genre_id)
        weights[key] = round(max(-1.0, min(1.0, weights.get(key, 0.0) + delta)), 3)


def max_certification(profiles: list[dict]) -> str | None:
    """Strictest US certification allowed for this group, or None for no limit."""
    strictest = None
    for profile in profiles:
        age = profile.get("age")
        if profile.get("kid") or (age is not None and age < 13):
            limit = "PG"
        elif age is not None and age < 17:
            limit = "PG-13"
        else:
            continue
        if strictest is None or CERT_ORDER.index(limit) < CERT_ORDER.index(strictest):
            strictest = limit
    return strictest


def group_score(scores: list[float]) -> float:
    # Mostly the average, but one unhappy person pulls the pick down.
    return 0.6 * mean(scores) + 0.4 * min(scores)


def group_genre_weights(profiles: list[dict]) -> dict[int, float]:
    genre_ids = {int(g) for p in profiles for g in p["genres"]}
    return {g: group_score([p["genres"].get(str(g), 0.0) for p in profiles]) for g in genre_ids}


def vetoed(profiles: list[dict]) -> set[int]:
    return {int(g) for p in profiles for g, w in p["genres"].items() if w <= VETO}
