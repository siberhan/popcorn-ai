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
IMAGE_BASE = "https://image.tmdb.org/t/p/w342"
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

    async def discover(
        self,
        with_genres: str | None = None,
        without_genres: str | None = None,
        max_certification: str | None = None,
        min_votes: int = 300,
        page: int = 1,
    ) -> list[dict]:
        params = {
            "with_genres": with_genres,
            "without_genres": without_genres,
            "sort_by": "popularity.desc",
            "vote_count.gte": min_votes,
            "include_adult": "false",
            "language": "en-US",
            "page": page,
        }
        if max_certification:
            params["certification_country"] = "US"
            params["certification.lte"] = max_certification
        data = await self._get("/discover/movie", params)
        return [m for m in data["results"] if not m.get("adult")]

    async def search(self, title: str) -> list[dict]:
        data = await self._get("/search/movie", {"query": title, "include_adult": "false", "language": "en-US"})
        return [m for m in data["results"] if not m.get("adult")]

    async def movie(self, movie_id: int) -> dict:
        return await self._get(
            f"/movie/{movie_id}", {"language": "en-US", "append_to_response": "release_dates,credits"}, fresh_for=7 * DAY
        )


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
