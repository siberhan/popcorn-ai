# ajan2 report: v2 backend (MCP server), Day 6

All work is in `services/mcp/` (I did not touch `static/phone/`, which ajan4 had already created). No git commands, no deploy, no changes to Lambda or IAM.

## Per-file changes

- `pyproject.toml` / `uv.lock`: new dependency `segno==1.6.6` (exact pin).
- `config.py`: `polly_voice` (env `POLLY_VOICE`, default `Brian`) and `polly_engine` (env `POLLY_ENGINE`, default `standard`).
- `polly.py` (new): `Polly(region, voice, engine).synthesize(text) -> bytes`. Uses boto3 `polly` `SynthesizeSpeech` (MP3) in a worker thread. The Region comes from settings (`AWS_REGION`).
- `tmdb.py`:
  - `discover()` gains `sort_by`, `with_keywords`, `without_keywords`, `year_from`/`year_to` (sent as `primary_release_date.gte/lte`), `watch_region` and `monetization` (sent as `with_watch_monetization_types`). It still goes through the same store-backed cache.
  - New `keyword_id(word)`: TMDB `/search/keyword`, first match.
  - New `certification(movie_id)`: TMDB `/movie/{id}/release_dates`, a small response used for the kid check (see the speed note below).
- `store.py`: DynamoDB client `max_pool_connections=32` (pools read many cached films at once).
- `taste.py`: removed `member_score`, `why_line` and `match_percent` (nothing uses them now). Kept `group_score`, `group_genre_weights` and `vetoed`, which still feed the default pool genres.
- `service.py`, mostly rewritten:
  - **Person memory v2.** `upgrade_profile()` fills defaults on every load: `role`, `gender`, `named`, `duel_history`, `duel_skipped`, and `year`/`reaction`/`quote` on old `watched` entries.
  - `memory(profile)` follows the contract exactly; `summarize()` is gone.
  - Notes: whitespace trimmed, cut to 140 characters, case-insensitive dedupe (a repeated note moves to the end), at most 12, newest last.
  - New `rename_person`: moves the profile key, the index, couch members, a running duel and a running rating.
  - **Couch.** `set_couch` returns `{"couch": [names], "kid_filter", "memory": [...], "new_people"?, "hint"?}`. `add_to_couch` returns the same plus `memory` (one person) and `removed_from_screen`.
  - On the reel, cards that no longer fit fade out with no refill. The fit check covers watched/disliked, vetoed genres and the US certification.
  - **find_candidates.** Follows the pool rules:
    - Streaming only: `watch_region` plus `flatrate`, `vote_count.gte=150`.
    - Without genres: the couch's top 3 positive genres plus 2 pages with no genre. With genres: 2 pages of "any of".
    - Results merged by popularity and capped at 40.
    - Exclusions: anything the couch watched or disliked, `exclude_ids`, and vetoed or `without_genres` genres (sent to TMDB and also filtered in code).
    - **The kid filter is also checked in code** against each film's US certification (see the live numbers).
    - Writes `state.pool = {ids, kid_filter, genres}`.
  - **show_picks.**
    - Accepts 4-8 picks; duplicate ids are dropped.
    - Fails if the pool's `kid_filter` differs from the current couch's ("call find_candidates again"), or if an id is not in the pool (the error names the id).
    - Fetches the details in parallel and drops any film that is now not kid-safe or already seen (`dropped` in the result).
    - Each card gets `why` (cut to 220 characters), `match` (clamped 50-99) and `why_audio`. All `why` lines are synthesized in parallel.
    - Sets the screen to `recommendations` and `boost` to the pool's genres.
  - `mark_seen(names, movie_ids, back_to_reel=False)`: adds `watched` entries with no reaction; empty `names` means the couch. The cards fade out.
  - `recommend()` / `_rank` / `_rescore` / `_score` are removed.
  - `mark_watched` keeps one entry per film (with year, reaction and quote, newest last). It gains `quotes`, which the rating round passes on.
  - **Duel v2:**
    - `duel_candidates`: genre groups (kid groups when the strictest of person and couch is PG), `sort_by=vote_count.desc`, pages 1-3, poster required, round-robin across groups. It skips films the person watched or disliked, and anything already in their duel history. Kid check in code. Up to 50 films.
    - The pool is stored as `<household>:duelpool:<id>` (TTL 1 day), not in the TV state.
    - `start_duel(name, pairs)`: 3-6 pairs, ids must come from that pool, no film twice. Fails if the couch kid filter changed since the pool was built.
    - `record_duel_choice` accepts `left`/`right`/`skip`. It keeps the weight nudges and writes history `{picked, over, at}` (max 30). `picked` = `"picked X (year) over Y (year)"`. `skip` ends the duel and sets `duel_skipped: true` only when no round was done.
  - **Speech:**
    - `speak(text)` caches the MP3 in `<household>:voice:<sha1>`, where the sha1 is of `"<voice>/<engine>\n<text>"` (base64, TTL 2 days). It returns `/api/voice/<sha1>.mp3`, or `None` if Polly or the store fails.
    - `push_speech` keeps the last 6 items (ids keep going up) and sets voice to idle.
    - `set_voice` writes at most 4 times a second for text-only changes; a change of state always goes through. On a running rating it also copies the text to `rating.live`.
    - Rating speech:
      - `start_rating`: "How was T? A, what did you think?"
      - Each answer: "<ack>. B, what about you?". A voice skip says "Skipped"; a skip by hand has no ack.
      - Last answer or finish: "<ack>. Saved, thanks everyone." / "Saved, thanks everyone."
  - `get_state` fills defaults for every key, including the new `speech`, `voice` and `pool`.
- `server.py`:
  - New tools and new args (pydantic models `Person`, `Pick`); `recommend_for_couch` removed; tool descriptions rewritten for the LLM; new INSTRUCTIONS.
  - New routes: `POST /api/seen`, `POST /api/speech`, `POST /api/voice`, `GET /api/voice/{sha1}.mp3` (`audio/mpeg`, max-age 1 day, 404 when missing), `GET /api/qr.png?url=` (segno, error level M, scale 10, border 2, black on white, 400 unless an `http(s)` URL of at most 300 characters), and `GET /phone/` plus `/phone/{file}` (only `index.html`, `app.js` and `styles.css`, correct content types, `no-cache`; anything else is 404).
  - `/api/duel` accepts `skip`. `/api/recommend` now returns 410 with an error text, so an old TV shows a toast.
  - `main()` reads `POPCORN_PORT` first, then `PORT`.
- `tests/test_service.py`:
  - The fake TMDB takes the new params, records its calls, has keywords and `certification()`, and contains one "leaky" R film that it returns even under a PG filter.
  - New `FakePolly`.
  - The formula tests were replaced by v2 tests.

## Remote parity addition

`POST /api/seen {"movie_id": n}` calls `mark_seen(None, [id], back_to_reel=True)`. For everyone on the couch it marks the film watched with no reaction, removes the card, sets the screen to `recommendations`, and clears `details` and `watching`. A bad body gives 400. Test: `test_http_seen_route_marks_couch_and_goes_back_to_reel`.

## Tools (final signatures)

```
set_couch(people: [{name, age?, kid?, role?, gender?: "male"|"female", named?}])
add_to_couch(name, age?, kid?, role?, gender?, named?)
remove_from_couch(name)
get_profiles(names?: [str])                 -> {"profiles": [memory], "on_couch": [names]}
update_taste(name, loves?, likes?, dislikes?, hates?, note?, role?, gender?, age?)  -> {"memory", "unknown_genres"?}
rename_person(name, new_name)               -> {"renamed", "memory"}
find_candidates(genres?, without_genres?, keywords?, without_keywords?, year_from?, year_to?, exclude_ids?)
                                            -> {"kid_filter", "candidates": [{id,title,year,genres,rating,votes,overview}], "unknown_genres"?, "unknown_keywords"?, "hint"?}
show_picks(picks: [{movie_id, why, match}]) -> {"shown": ["Title (year)"], "kid_filter", "dropped"?, "dropped_reason"?}
mark_seen(names: [str], movie_ids: [int])   -> {"saved_for", "movies", "removed_from_screen"}
duel_candidates(name)                       -> {"name", "kid_filter", "candidates": [...]}
start_duel(name, pairs: [[left_id, right_id]])  -> {"duel": {name, round, total, left, right}}
record_duel_choice(pick: "left"|"right"|"skip") -> {"done", "picked"?, "memory"?, "duel"?, "skipped"?, "rounds_done"?}
mark_watched(movie, reactions?, who?)
get_movie_details(movie, show_on_tv=True)
start_rating(movie?)
record_reaction(name, reaction | null, quote="")
```
16 tools.

## Tests

`cd services/mcp && uv run pytest -q`:
```
............................                                             [100%]
28 passed in 0.66s
```
New tests:
- pool: streaming params, top genre plus open query, kid filter in code, exclusions by watched / `exclude_ids` / veto
- pool genres + keywords (with an unknown keyword)
- `show_picks`: id check, count check, card build with clamp, cut and audio
- `show_picks` fails after a kid joins
- kid joining fades cards with no refill
- `mark_seen`
- `/api/seen`
- memory defaults for an old profile, and the notes rules
- `set_couch` memory, and `rename_person`
- duel pool kid safety, pair checks, history, and exclusion of films already seen in a duel
- duel skip, before any round and after a round
- rating speech texts
- speech keeps 6 items and survives a Polly failure
- speech / voice / mp3 routes with Polly faked (including the cache hit)
- voice throttle and the copy to `rating.live`
- QR, phone, 410, and the exact tool list
- old state defaults

## Live run (household `v2-test`, port 8010, real TMDB + Polly + DynamoDB)

Started with `cd services/mcp && POPCORN_HOUSEHOLD=v2-test POPCORN_PORT=8010 uv run popcorn-mcp`. I ran the service directly with a scratch script, plus HTTP calls against port 8010. Couch: Ahmet (43, dad) and "Ahmet's son" (10, `named: false`). Ahmet loves action and likes sci-fi; the son loves animation and hates horror.

`find_candidates()` returned **40 films, kid_filter=PG**:
Toy Story 5, Zootopia 2, The Nightmare Before Christmas, Harry Potter and the Philosopher's Stone, The Wild Robot, Inside Out 2, Avatar Aang: The Last Airbender, Corpse Bride, Inside Out, Coco, The Super Mario Bros. Movie, Star Wars, Spirited Away, Wicked: For Good, Raiders of the Lost Ark, Despicable Me, The Sheep Detectives, Hoppers, Transformers One, The Super Mario Galaxy Movie, Harry Potter and the Chamber of Secrets, Shrek Forever After, A Minecraft Movie, Howl's Moving Castle, Turning Red, Despicable Me 2, Harry Potter and the Prisoner of Azkaban, Spider-Man: Across the Spider-Verse, Ice Age: Dawn of the Dinosaurs, Ice Age: Continental Drift, KPop Demon Hunters, Toy Story 2, Toy Story, Zootopia, Shrek the Third, Big Hero 6, How to Train Your Dragon 2, Swapped, 2001: A Space Odyssey, Sonic the Hedgehog 3.

The TMDB `certification.lte=PG` filter still let PG-13/R films through. The code check dropped them:
- default pool: "My Fault", "Spider-Man" (2 of 60)
- `keywords=["superhero"]` pool: "Spider-Man", "Code 8", "The Toxic Avenger Unrated" (3 of 40)
- duel pool: "Spider-Man", "Ted", "Casino Royale" (3 of 60)

Other results:
- `find_candidates(keywords=["superhero"])`: 37 films (Spider-Man: Across the Spider-Verse, Big Hero 6, Into the Spider-Verse, The Incredibles, Incredibles 2, ...).
- `show_picks` with 4 of those ids: shown. A stale id was rejected with "Movie id 1084244 is not in the last find_candidates list", over MCP as well.
- `duel_candidates("Ahmet's son")`: 50 films, PG (Inside Out, Up, Harry Potter 1, Back to the Future, Star Wars, Coco, Finding Nemo, ...).
- `GET /api/voice/188bd270dd57f70bb940e09fcdad071f530d99eb.mp3`: 200, `audio/mpeg`, **23711 bytes**.
- `POST /api/speech`, `/api/voice`, `/api/qr.png` (200, image/png, 695 bytes) and `/phone/` (200) all OK.
- Speed of `find_candidates` (kid couch): about 2.5-2.9 s from a cold process and about 1.2 s warm, after switching the kid check to `/release_dates`. Before that it took 14-17 s, because the cached `/movie/{id}` docs are about 100 KB each (credits) and 60 of them were read from DynamoDB over a home connection.
- Cleanup: 10 `v2-test:*` items deleted (5 voice, 1 duelpool, 2 profiles, tv, profiles index). A scan shows 0 left.
- Note: TMDB cache keys (`tmdb:...`) are shared across households by design, so the run added cache entries there. I left them, because they are shared cache, not test data.

The dev server on port 8000 was **down** when I checked (`curl /health` got no answer). I did not start it, because this brief says not to start anything on port 8000.

## Open questions / decisions I made

1. `set_couch` result: `couch` is now a list of names, and memory lives only in `memory`, to avoid saying the same thing twice in the LLM context. `update_taste` returns `{"memory", "unknown_genres"?}`.
2. `memory.dislikes` no longer repeats the `never` genres. `never` is still listed separately.
3. The kid filter is checked in code on every pool (it costs one small cached TMDB call per film, and a per-process cache of certifications). Without it, PG pools contained R films.
4. The duel pool is stored outside the TV state (`<household>:duelpool:<id>`), because 50 cards would bloat the doc the TV polls.
5. The voice cache sha1 covers `voice/engine + text`, so changing the engine does not reuse old audio.
6. `speech` ids keep going up across `set_couch`. On app start the TV should take the current highest id as "already played", or it will replay the last 6. ajan3 should know this.
7. `/api/recommend` returns 410 (it does not disappear), so an old TV build shows a toast instead of failing silently.
8. The TV contract `Member.watched` items are now strings like `"Coco (2017): loved"` (from `memory`). The TV only uses the length today.
9. For the orchestrator:
   - The MCP Lambda role needs `polly:SynthesizeSpeech`.
   - The deploy package must include `static/phone/` and the new `segno` dependency.
   - `POLLY_VOICE` / `POLLY_ENGINE` can be left at their defaults.
   - Polly items of up to 600 characters are at most about 320 KB in base64, under DynamoDB's 400 KB item limit.

## Friction

None with Amazon/AWS tools in this task: Polly `SynthesizeSpeech` (boto3 1.43.114, `eu-north-1`, Brian/standard) and DynamoDB worked on the first try. The slow `find_candidates` was my own design: large cached documents read from DynamoDB over a home connection. No AWS defect.

DONE
