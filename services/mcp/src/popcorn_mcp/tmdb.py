"""Small async TMDB client with a store-backed cache.

Every response is cached. A cached response is reused while it is fresh, and
also when TMDB is down or rejects the key, so the demo keeps working.
"""

import logging
import time
from urllib.parse import urlencode

import httpx

from .store import Store

DAY = 24 * 3600
IMAGE_ROOT = "https://image.tmdb.org/t/p/"
IMAGE_BASE = IMAGE_ROOT + "w342"
# TMDB watch provider lists -> our kinds, best first. free/ads are streams too.
PROVIDER_KINDS = [("flatrate", "stream"), ("free", "stream"), ("ads", "stream"), ("rent", "rent"), ("buy", "buy")]
CERT_ORDER = ["G", "PG", "PG-13", "R", "NC-17"]

log = logging.getLogger(__name__)


class TMDBError(Exception):
    pass


class TMDB:
    def __init__(self, token: str, store: Store, http: httpx.AsyncClient | None = None) -> None:
        self._store = store
        self._http = http or httpx.AsyncClient(
            base_url="https://api.themoviedb.org/3",
            headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
            timeout=10,
            transport=httpx.AsyncHTTPTransport(retries=2),
        )
        self._genres: dict[int, str] | None = None

    async def _get(self, path: str, params: dict | None = None, fresh_for: int = DAY) -> dict:
        params = {k: v for k, v in (params or {}).items() if v is not None}
        key = "tmdb:" + path + "?" + urlencode(sorted(params.items()))
        cached = await self._store.get(key)
        if cached and time.time() - cached["fetched_at"] < fresh_for:
            return cached["data"]
        try:
            response = await self._http.get(path, params=params)
            response.raise_for_status()
            data = response.json()
        except httpx.HTTPError as exc:
            log.warning("TMDB %s failed: %r", path, exc)
            if cached:
                return cached["data"]  # stale beats nothing
            raise TMDBError(f"TMDB request failed: {exc}") from exc
        await self._store.put(key, {"fetched_at": time.time(), "data": data}, ttl_seconds=30 * DAY)
        return data

    async def genres(self) -> dict[int, str]:
        if self._genres is None:
            data = await self._get("/genre/movie/list", {"language": "en"}, fresh_for=7 * DAY)
            self._genres = {g["id"]: g["name"] for g in data["genres"]}
        return self._genres

    async def trending(self, page: int = 1) -> list[dict]:
        """One page of /trending/movie/week."""
        data = await self._get("/trending/movie/week", {"language": "en-US", "page": page})
        return [m for m in data.get("results", []) if not m.get("adult")]

    async def discover(
        self,
        with_genres: str | None = None,
        min_votes: int = 300,
        page: int = 1,
        sort_by: str = "popularity.desc",
    ) -> list[dict]:
        """One page of /discover/movie, e.g. the best films of all time for the favorites catalog."""
        params = {
            "with_genres": with_genres,
            "sort_by": sort_by,
            "vote_count.gte": min_votes,
            "include_adult": "false",
            "language": "en-US",
            "page": page,
        }
        data = await self._get("/discover/movie", params)
        return [m for m in data["results"] if not m.get("adult")]

    async def search(self, title: str, year: int | None = None) -> list[dict]:
        """First page of /search/movie. With a year only films of that year come back."""
        params = {"query": " ".join(title.split()), "include_adult": "false", "language": "en-US",
                  "year": year if year else None}
        data = await self._get("/search/movie", params)
        return [m for m in data["results"] if not m.get("adult")]

    async def movie(self, movie_id: int) -> dict:
        return await self._get(
            f"/movie/{movie_id}", {"language": "en-US", "append_to_response": "release_dates,credits"}, fresh_for=7 * DAY
        )

    async def certification(self, movie_id: int) -> str | None:
        """US certification only: a small response, for checking many films at once."""
        data = await self._get(f"/movie/{movie_id}/release_dates", fresh_for=7 * DAY)
        return us_certification({"release_dates": data})

    async def watch_providers(self, movie_id: int) -> dict:
        """Where to watch, per region: {"id", "results": {"US": {"link", "flatrate"|"rent"|"buy": [...]}}}."""
        return await self._get(f"/movie/{movie_id}/watch/providers", fresh_for=DAY)


def us_certification(details: dict) -> str | None:
    for country in details.get("release_dates", {}).get("results", []):
        if country["iso_3166_1"] == "US":
            certs = [r["certification"] for r in country["release_dates"] if r.get("certification")]
            if certs:
                return certs[0]
    return None


def cert_allowed(cert: str | None, max_cert: str | None) -> bool:
    if max_cert is None:
        return True
    if cert not in CERT_ORDER:
        return False  # unrated: not safe to show to kids
    return CERT_ORDER.index(cert) <= CERT_ORDER.index(max_cert)


def poster_url(path: str | None) -> str | None:
    return IMAGE_BASE + path if path else None


def backdrop_url(path: str | None) -> str | None:
    return IMAGE_ROOT + "w1280" + path if path else None


def logo_url(path: str | None) -> str | None:
    return IMAGE_ROOT + "w92" + path if path else None


def providers_for(data: dict, region: str, limit: int = 4) -> tuple[list[dict], str | None]:
    """One entry per provider for a region, streams before rentals before purchases, in TMDB's order."""
    country = (data.get("results") or {}).get(region) or {}
    seen, providers = set(), []
    for key, kind in PROVIDER_KINDS:
        for item in country.get(key) or []:
            if item.get("provider_id") in seen or not item.get("provider_name"):
                continue
            seen.add(item["provider_id"])
            providers.append({"id": item["provider_id"], "name": item["provider_name"],
                              "logo": logo_url(item.get("logo_path")), "kind": kind})
    return providers[:limit], country.get("link")
