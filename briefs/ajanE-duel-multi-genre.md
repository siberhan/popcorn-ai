# ajanE: duel prefers films that match more of the person's genres (services/mcp)

YAGNI. Do not overengineer. This is a small change in one function plus tests.

## What the user wants

On the "Pick the one you'd rather watch" screen (the poster duel), when a person chose several genres
(for example Comedy + Romance), the duel should show films that have those genres together first. A film
with 2 of the person's genres says more about their taste than a film with 1. With one chosen genre,
nothing changes.

## Where

`services/mcp/src/popcorn_mcp/service.py`, `Popcorn._duel_pool` (about line 658). Today it collects
every kid-safe catalog card from the person's genres into `own`, shuffles it, and tops up from `rest`
when it is thin. Each card already has `genre_ids` (see `_card`), and `wanted` already holds the
person's genre ids. `_duel_pairs` and the catalog stay as they are.

## How to code it (principles)

- Change only `_duel_pool`. Give each `own` card a score: how many of `wanted` are in its `genre_ids`.
- Order `own` by that score, highest first. Keep it random inside the same score (shuffle first, then a
  stable sort by score is enough). The `rest` top-up stays the same and comes after.
- No new settings, no weights, no new constants, no new catalog data, no extra TMDB or LLM calls, no
  new helper classes. A few lines; match the style of the code around it (short docstring, few comments).
- Update the docstring of `_duel_pool` in one line.
- Do not change `_duel_pairs`: when the first card has all the wanted genres, every other `own` card
  shares a genre with it, so its partner is simply the next best card.
- Update the "Poster duel" step in `briefs/v3-contract.md` with one sentence about this rule. No other
  brief edits.

## Tests (`services/mcp/tests/test_service.py`)

Add one small test next to the other duel tests (around line 340), using the fakes the file already
uses. A person with two genres; the catalog has some films with both genres and many with one. The
first pairs of the duel use the two-genre films. Keep the existing tests passing; do not rewrite them.

## Boundaries

- Edit only `services/mcp/src/popcorn_mcp/service.py`, `services/mcp/tests/test_service.py`,
  `briefs/v3-contract.md` (one sentence) and your report. No git commands. No deploy. No TV changes.

## Verify / report

- `cd services/mcp && .venv/bin/python -m pytest -q` passes.
- Report in `briefs/reports/ajanE-duel-multi-genre.md`: the diff in short, the new test, the test result.
  End with DONE.
