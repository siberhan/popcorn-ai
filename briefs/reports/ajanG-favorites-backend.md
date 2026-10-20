# ajanG: Favorite Films Backend & Phone Page Report

## Changes in Short

1. **`services/mcp/src/popcorn_mcp/service.py`**:
   - Completely removed all poster duel logic and state: `start_duel`, `record_duel_choice`, `_duel_pool`, `_duel_pairs`, `_duel_view`, `duel_line`, `duel` state, `duel_history`/`duel_done`, `DUEL_*`, the per-genre duel catalog (`seed_duel_catalog`, `_build_catalog`, `_catalog_key`, `_catalog`, `CATALOG_*`, `SEED_SECONDS`).
   - Added favorites onboarding logic: `start_favorites`, `toggle_favorite`, `query_favorites`, `done_favorites`, `get_favorites_catalog`, `seed_catalog`, `_fav_card`.
   - Updated `Member` memory representation: removed `duel` and `duel_done`; added `favorites: string[]` (`title_year` format) and `favorites_done: bool`. Updated `new` condition (`not profile["genres"] or not profile["favorites_done"]`).
   - Updated `PROFILE_DEFAULTS` (`favorites: []`, `favorites_done: False`) and `STATE_DEFAULTS` (`favorites: None`).
   - Updated `save_genres`: opens screen `favorites` when `favorites_done` is false.
   - Updated `open_ask`: resumes unfinished `favorites` (or starts it) before opening `ask`.
   - Updated `_recommend_messages`: replaced `"Duel picks: ..."` with `"Favorite films: ..."` (joining all favorite films).
   - Preserved `state.favorites` on `go_to("couch")` so Popcorn can restore earlier picks. Handled rename and delete cleanup for `favorites`.

2. **`services/mcp/src/popcorn_mcp/tmdb.py`**:
   - Added `trending(self, page: int = 1) -> list[dict]` for `/trending/movie/week`.

3. **`services/mcp/src/popcorn_mcp/server.py`**:
   - Added `GET /api/favorites/catalog` and `POST /api/favorites` (`start`, `toggle`, `query`, `done`).
   - Removed `/api/duel` and `/api/duel/start` routes and the corresponding MCP tools.
   - Updated `POST /events` payload to expect `{"popcorn": "seed_catalog"}` and call `popcorn.seed_catalog`.

4. **`infra/deploy.py`**:
   - Updated `SEED_PAYLOAD` to `{"popcorn": "seed_catalog"}`.

5. **`services/mcp/src/popcorn_mcp/static/phone/`**:
   - Rewrote `index.html`, `styles.css`, and `app.js` to implement the favorites mode as specified in the contract.
   - Entire page restyled in the TV console theme: ground `#0B0D12`, field `#1C2230`, text `#FFFFFF`, secondary `#B4BCCB`, white pill buttons with `#0B0D12` text, danger `#F28B82`, white focus/selection ring.
   - Real-time 1s polling keeps TV and phone synchronized.
   - 400ms debounce on search input. Picked films appear at the top in "Your picks", leaving their source catalog or search lists.
   - Preserved rating and ask modes.

6. **`briefs/v3-contract.md`**:
   - Added one line at the top: `Duel replaced by favorites: see v4-favorites-contract.md`.

---

## TMDB Calls One Seed Makes

One seed call (`seed_catalog()`) generates the `favcat` document containing `popular` (60 films) and `best` (60 films):

1. **Genres**: 1 call to `/genre/movie/list` (if not already cached).
2. **Popular** (`/trending/movie/week`):
   - 3 page requests (`page=1..3`, 20 movies each) = 3 calls.
   - ~60 certification requests (`/movie/{id}/release_dates`) = ~60 calls.
3. **Best of all time** (`/discover/movie?sort_by=vote_average.desc&vote_count.gte=5000`):
   - 3 page requests (`page=1..3`, 20 movies each) = 3 calls.
   - ~60 certification requests (`/movie/{id}/release_dates`, deduplicated against popular) = ~60 calls.

**Total**: ~127 TMDB API calls per seed.
All certification calls run concurrently using `asyncio.Semaphore(16)`.

---

## Tests

All duel tests were removed and replaced with dedicated test suites covering all contract requirements:
- `test_genres_save_opens_favorites`: Verifies saving genres opens `favorites` screen with 0 picks.
- `test_toggle_pick_and_unpick`: Verifies toggle adds to picks in pick order, and toggling again removes the film.
- `test_26th_pick_refused`: Verifies picking up to 25 works, and the 26th pick raises 400 "You can pick up to 25 films".
- `test_done_with_fewer_than_5_refused_with_5_saves_and_goes_to_couch`: Verifies `< 5` raises 400 "Pick at least 5 films", while 5 picks saves `favorites` + `favorites_done: True` and returns to `couch`.
- `test_back_keeps_picks_and_popcorn_reopens_them`: Verifies Back keeps `state.favorites`, and `open_ask` reopens the page with existing picks.
- `test_search_results_kid_filtered`: Verifies kid searches filter out non-kid-allowed films (e.g. R-rated), while adult searches return them.
- `test_catalog_doc_built_with_no_film_twice_and_kid_filtered_on_read`: Verifies no duplicates across `popular` and `best`, and reading `GET /api/favorites/catalog` kid-filters cards based on profile age.
- `test_recommender_prompt_has_favorite_films`: Verifies recommender prompt includes "Favorite films: ..." and no "Duel picks:".
- Updated all HTTP tests: `/api/favorites`, `/api/favorites/catalog`, `/events`, removed `/api/duel` routes.

Result:
```
62 passed in 0.76s (test_service.py)
9 passed in 0.04s (test_llm.py)
Total: 71 passed
```

---

## Screenshot

Captured phone screenshot in favorites mode with stub/fake state using Playwright (phone size 390x844):
- File: `briefs/reports/favorites-shots/phone.png`

---

## Anything Not Done

None. All contract specifications and brief requirements are implemented and verified.

DONE
