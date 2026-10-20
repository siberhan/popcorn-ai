# ajanF: duel catalog with 200 different films per genre (services/mcp)

YAGNI. Do not overengineer. Change the catalog build, a constant and the tests. Nothing else.

## What the user wants

Each genre's duel catalog holds **exactly 200 different films** (net, after duplicates are removed),
from two kinds of films for variety:
- films popular now (TMDB discover `sort_by=popularity.desc`),
- well-known films from all years (TMDB discover `sort_by=vote_count.desc`).

Today `_build_catalog` takes 5 popularity pages and keeps up to 100, so overlap and failed certification
checks make lists shorter. A film may be in several genres' lists (Comedy + Romance): that is wanted, the
duel's multi-genre rule needs it. Inside one list a film is never twice.

## Where

`services/mcp/src/popcorn_mcp/service.py`: `CATALOG_PER_GENRE, CATALOG_PAGES, CATALOG_VOTES` (line 35),
`_build_catalog` (about line 639), `seed_duel_catalog`. `tmdb.py` `discover` already takes `sort_by` and
`min_votes`.

## How to code it (principles)

- `CATALOG_PER_GENRE = 200`.
- Build the list with a loop: take pages in turn, one popularity page, one vote_count page, then the next
  pair, and add a film only when it has a poster and is not already in the list. Stop at 200.
- A film counts only after its certification check worked (as today: a failed check drops the film), so
  the loop keeps going until 200 films with a certification result. Check certifications page by page, not
  all at the end, so the loop knows the real count. Keep the existing semaphore for the checks.
- When both sorts run out of pages (a rare genre such as Western or Documentary), keep what you have.
  Do not lower the vote limit and do not add fallbacks; just stop. Put a page limit so it never loops
  forever (for example 20 pages per sort).
- The film order stays: interleaved, as fetched. `_duel_pool` shuffles anyway.
- The seed already stops after `SEED_SECONDS` and the deploy calls it again for the rest. One genre now
  costs about 2x the work. Keep this model; change `SEED_SECONDS` only if one genre can no longer fit
  in a single call (Lambda timeout: read `infra/deploy.py`).
- Rebuilding: `seed_duel_catalog` skips a genre that already has a catalog. Add the smallest way to rebuild
  the old 100-film lists: skip a stored catalog only when it was built with the current size (for
  example store `"size": CATALOG_PER_GENRE` in the doc and rebuild when it differs). No new endpoint,
  no new command.
- Match the code style around it: short docstrings, few comments, no new classes or helpers unless one
  small function makes the loop clearer.
- Update the catalog sentence in `briefs/v3-contract.md` (about 100 -> 200, two sorts). One sentence.

## Tests (`services/mcp/tests/test_service.py`)

Use the existing fakes (update the fake TMDB `discover` to honour `sort_by` and `page` if it does not).
- A genre with enough films gets exactly 200 different films, from both sorts.
- Films that appear in both sorts are stored once and the list still reaches 200.
- A failed certification check does not lower the count below 200 when more films exist.
- A thin genre stops without an endless loop and keeps what it found.
- An old catalog (built before, other size) is rebuilt by the seed; a current one is skipped.
Keep the existing tests passing; change them only where they assumed 100.

## Boundaries

- Edit only `services/mcp/src/popcorn_mcp/service.py`, `services/mcp/src/popcorn_mcp/tmdb.py` (only if
  needed), `services/mcp/tests/**`, `briefs/v3-contract.md` (one sentence) and your report.
- No git commands. No deploy, no AWS calls (the user deploys later). No TV changes.

## Verify / report

- `cd services/mcp && .venv/bin/python -m pytest -q` passes.
- Report in `briefs/reports/ajanF-catalog-200.md`: the change in short, the TMDB calls one genre now
  makes (number of discover pages and certification checks), the new tests, the test result, and what
  the user must run to rebuild the live catalog. End with DONE.
