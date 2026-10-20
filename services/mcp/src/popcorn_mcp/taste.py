"""Taste memory helpers: genre names, the age filter, and the kid rule for the picks.

A person's taste is the genres they chose (TMDB names) plus their poster duels and reviews. The only math
left is the age filter: the strictest US certification the group may watch, and who decides it.
"""

from .tmdb import CERT_ORDER

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

KID_AGE, TEEN_AGE = 13, 17


def resolve_genre(name: str, genres: dict[int, str]) -> int | None:
    wanted = " ".join(name.split()).casefold()
    wanted = GENRE_ALIASES.get(wanted, wanted)
    by_name = {label.casefold(): genre_id for genre_id, label in genres.items()}
    if wanted in by_name:
        return by_name[wanted]
    if wanted.endswith("s") and wanted[:-1] in by_name:
        return by_name[wanted[:-1]]
    return None


def max_certification(profiles: list[dict]) -> str | None:
    """Strictest US certification allowed for this group, or None for no limit."""
    strictest = None
    for profile in profiles:
        age = profile.get("age")
        if profile.get("kid") or (age is not None and age < KID_AGE):
            limit = "PG"
        elif age is not None and age < TEEN_AGE:
            limit = "PG-13"
        else:
            continue
        if strictest is None or CERT_ORDER.index(limit) < CERT_ORDER.index(strictest):
            strictest = limit
    return strictest


def youngest_minor(profiles: list[dict]) -> dict | None:
    """The youngest person under 17: their age is the one the kid rule talks about. None if all are adults."""
    minors = [p for p in profiles if p.get("kid") or (p.get("age") is not None and p["age"] < TEEN_AGE)]
    return min(minors, key=lambda p: p["age"] if p.get("age") is not None else 0, default=None)


def kid_rule(profiles: list[dict]) -> str | None:
    """The rule line the picks must follow when a child or teen is on the couch; the youngest decides."""
    minor, limit = youngest_minor(profiles), max_certification(profiles)
    if minor is None or limit is None:
        return None
    who = f"{minor['name']} is {minor['age']}" if minor.get("age") is not None else f"{minor['name']} is a child"
    return (f"{who}. Only films rated US {limit} or lower that suit that age: "
            "no horror, strong violence, sexual content or strong language.")
