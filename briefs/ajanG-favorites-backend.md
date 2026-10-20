# ajanG: favorite films replace the duel (services/mcp backend + phone page)

YAGNI. Do not overengineer. Read `briefs/v4-favorites-contract.md` first: it is binding. ajanH builds the
TV side at the same time from the same contract, so follow its names and shapes exactly.

## Do

- `services/mcp/src/popcorn_mcp/service.py`: remove the duel (`start_duel`, `record_duel_choice`,
  `_duel_pool`, `_duel_pairs`, `_duel_view`, `duel` state, `duel_history`/`duel_done`, `DUEL_*`, the duel
  catalog, `seed_duel_catalog`, `_build_catalog`, `CATALOG_*`, `SEED_SECONDS` if unused). Add the
  favorites page (`start/toggle/query/done`), the `favcat` catalog and `seed_catalog`, the `Member`
  fields, the recommender line, and the `open_ask` / `save_genres` changes. Match the style around it.
- `services/mcp/src/popcorn_mcp/tmdb.py`: add only what is missing (`trending` week; `discover` already
  takes `sort_by`/`min_votes`).
- `services/mcp/src/popcorn_mcp/server.py`: the new routes, remove the duel routes, the `/events` payload.
- `infra/deploy.py`: the seed step sends `{"popcorn": "seed_catalog"}` (look for `seed_duel_catalog`).
- Phone page `services/mcp/src/popcorn_mcp/static/phone/` (`index.html`, `app.js`, `styles.css`): the
  favorites mode as in the contract, and the whole page in the TV console theme. Plain JS, no libraries,
  no build step. Keep the rating and ask modes working.
- Tests `services/mcp/tests/`: remove the duel tests, add tests for: genres save opens favorites; toggle
  pick/un-pick; 26th pick refused; done with <5 refused, with 5 saves and goes to couch; Back keeps the
  picks and Popcorn reopens them; search results kid-filtered; catalog doc built with no film twice and
  kid-filtered on read; recommender prompt has "Favorite films:". Use the existing fakes.
- Update `briefs/v3-contract.md` only by adding one line at the top: "Duel replaced by favorites: see
  v4-favorites-contract.md".

## Boundaries

- Edit only `services/mcp/**`, `infra/deploy.py` (seed payload), `briefs/v3-contract.md` (one line) and
  your report. No TV changes (`apps/tv` is ajanH's). No git commands. No deploy, no AWS calls.

## Verify / report

- `cd services/mcp && .venv/bin/python -m pytest -q` passes.
- One phone screenshot in favorites mode (run the server locally with fakes or a stub state if possible,
  Playwright: `/opt/homebrew/opt/python@3.11/bin/python3.11`, phone size 390x844) to
  `briefs/reports/favorites-shots/phone.png`. If you cannot run it, say so.
- Report in `briefs/reports/ajanG-favorites-backend.md`: changes in short, the TMDB calls one seed makes,
  the tests, the result, anything not done. End with DONE.
