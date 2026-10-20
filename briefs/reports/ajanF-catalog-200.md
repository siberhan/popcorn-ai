# ajanF: 200 different films per genre in the duel catalog

## Change in short

`services/mcp/src/popcorn_mcp/service.py`:

- `CATALOG_PER_GENRE, CATALOG_PAGES, CATALOG_VOTES = 200, 20, 300` (was 100, a fixed page tuple 1..5, 300).
  `CATALOG_PAGES` is now the page limit per sort, a backstop only.
- `_build_catalog` loops over page 1..20 and, inside each page, asks one `popularity.desc` page and one
  `vote_count.desc` page. Every film with a poster that is not in the list yet is certification checked
  right there, page by page (same semaphore of 16), and only a card whose check worked is added. The loop
  stops at 200 cards, or when both sorts return an empty page (a thin genre keeps what it found), or at
  the 20-page cap. A film whose check failed is marked as seen, so it is checked once and dropped, not
  retried on the other sort. Film order stays as fetched (interleaved), so `_duel_pool` behaviour is the same.
- The stored doc gains `"size": CATALOG_PER_GENRE`. `seed_duel_catalog` now skips a stored catalog only
  when its size matches, so the old 100-film docs (which have no `size`) are rebuilt by the next seed;
  no new endpoint, no new command.
- `SEED_SECONDS` stays 20: the deadline is checked between genres and `deploy.py` already calls the seed
  again for what is left, so a slower genre costs more calls, not a bigger one. One genre is now about 2x
  the work; the Lambda timeout is 30 s (`infra/deploy.py`), so if a genre ever overruns the call, lower
  `SEED_SECONDS` (and/or raise `SEED_CALLS` in `infra/deploy.py`) as a follow-up outside this brief.

`briefs/v3-contract.md`, the catalog sentence only: up to 200 different films from the two discover sorts
(`popularity.desc` and `vote_count.desc`), `vote_count.gte=300`, poster and US certification as before.

## TMDB calls one genre now makes

- Discover: one page per sort per turn, so 2 pages per turn and at most 40 pages per genre (20 per sort).
  A genre with enough films needs about 10 discover pages (5 turns of 20 + 20 films) when the sorts
  overlap little, and a few turns more when they share films or checks fail. Before: 5 popularity pages.
- Certification: one check per film with a poster and not yet considered — about 200 for a full genre
  (plus up to a page of candidates past the 200th, and the films whose check failed). Before: exactly 100.
- Both response kinds are cached in the store (`tmdb:` keys) and certifications are cached per process, so
  films shared by several genres cost one check per process, not one per genre.

## New tests (`services/mcp/tests/test_service.py`)

The fake TMDB now honours `page` (20 films per page) and `sort_by` (different film sets per sort) and can
serve generated films for the big catalogs via `FakeTMDB(synthetic=..., shared=...)`; `make()` gained an
optional `tmdb=`. The existing seed test was updated for the new page/sort calls and the `size` field.

- `test_a_catalog_holds_200_different_films_from_both_sorts` — exactly 200 unique cards, from both sorts.
- `test_a_film_in_both_sorts_is_stored_once_and_the_list_still_reaches_200` — 40 shared films stored and
  certified once, list still 200.
- `test_a_failed_certification_drops_the_film_and_the_list_still_reaches_200` — failing checks are tried,
  the films are absent, the list still 200.
- `test_a_thin_genre_stops_when_its_pages_run_out_and_keeps_what_it_found` — 60 films kept, asks page 3
  once per sort (empty), then stops; no page 4.
- `test_seed_rebuilds_a_catalog_of_an_old_size_and_skips_a_current_one` — an old `size: 100` Comedy doc is
  rebuilt to 200, the current one is skipped with no TMDB calls.

## Test result

`cd services/mcp && .venv/bin/python -m pytest -q` -> `69 passed in 0.98s`.

## Rebuild the live catalog

After deploying the new code, the next seed rebuilds every genre's old 100-film doc (the `size` check):

```
cd infra && uv run deploy.py deploy
```

`deploy` uploads the service and runs the seed; if it stops after its 15 seed calls with genres still
`remaining`, run `cd infra && uv run deploy.py seed` once more. If the code is already deployed:
`cd infra && uv run deploy.py seed`. No other step, no DynamoDB cleanup needed.

DONE
