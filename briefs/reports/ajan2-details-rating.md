# ajan2 report: details, where to watch, family rating (Day 5)

## Files changed

- `services/mcp/src/popcorn_mcp/tmdb.py`: `backdrop_url` (w1280), `logo_url` (w92), `TMDB.watch_providers(movie_id)`
  (cached through `_get` like every other call, fresh for 1 day), `providers_for(data, region, limit=4)` (pure mapping).
- `services/mcp/src/popcorn_mcp/config.py`: `watch_region` from `POPCORN_WATCH_REGION` (default `US`).
- `services/mcp/src/popcorn_mcp/service.py`: `get_movie_details` adds `backdrop`, `providers`, `providers_region`,
  `providers_link`; state keys `watching`, `rating`, `focus` (old stored states get them via `setdefault`);
  `set_couch`/`recommend` clear `watching`+`rating`; new methods `open_details`, `go_to`, `set_focus`, `start_watching`,
  `start_rating`, `record_reaction`, `skip_turn`, `set_live`, `finish_rating` (+ private `_finish`, `_providers`).
  The orchestrator's uncommitted `tv_state`/`household` change is kept as it was.
- `services/mcp/src/popcorn_mcp/server.py`: MCP tools `start_rating`, `record_reaction` (12 tools now, the 10 old ones
  unchanged); HTTP routes for every row of the actions table, plus one extra read route `GET /api/rating`
  (see Decisions). Bad JSON / bad fields -> 400 `{"error"}`.
- `services/mcp/tests/test_service.py`: FakeTMDB gets `watch_providers` and `backdrop_path`; 11 new tests.
- `services/agent/src/popcorn_agent/prompts.py`: `RATING_RULES` section and `rating_context(rating)`.
- `services/agent/src/popcorn_agent/agent.py`: reads `GET {mcp base}/api/rating` before each turn; schema
  unwrapping moved to `unwrap_nullable()` and now keeps `null` as an enum value for nullable enums.
- `services/agent/tests/test_prompts.py` (new): 5 tests.

## Real watch providers response (live call, Rocky 1366)

```
{"id": 1366, "results": {           # 134 region keys (ISO 3166-1)
  "US": {"link": "https://www.themoviedb.org/movie/1366-rocky/watch?locale=US",
         "flatrate": [{"logo_path": "/gMZ...png", "provider_id": 9, "provider_name": "Amazon Prime Video", "display_priority": 3}, ...],
         "rent": [...same item shape...], "buy": [...]},
  "TR": {"link": "...", "rent": [...], "flatrate": [...]}, ...}}
```
Lists come sorted by `display_priority`; a provider (Amazon Video, Apple TV Store) appears in both `rent` and `buy`;
a region may miss any list. TMDB docs also list `free` and `ads` lists (not seen in this call).

## Tests

`uv run pytest`: mcp 18 passed, agent 19 passed.

Curl flow against a local MCP on port 8123, household `ajan2-test` (DynamoDB table from `.env`, data writes only):
```
== profiles before   [('Bedirhan', [], [], []), ('Ayse', [], [], []), ('Can', [], [], [])]
== recommend         [(980431, 'Avatar Aang: The Last Airbender'), (129, 'Spirited Away'), (105, 'Back to the Future')]
== focus             {"focus":{"movie_id":980431,"at":1792337288}}
== details 105       Back to the Future https://image.tmdb.org/t/p/w1280/5bzPWQ2dFUl2aZKkp7ILJVVkRed.jpg US https://www.themoviedb.org/movie/105-back-to-the-future/watch?locale=US
  {'id': 10, 'name': 'Amazon Video', 'logo': 'https://image.tmdb.org/t/p/w92/jn6TLbtaTZntTRX9UYucHJvpQx1.png', 'kind': 'rent'}
  {'id': 2, 'name': 'Apple TV Store', ..., 'kind': 'rent'}
  {'id': 3, 'name': 'Google Play Movies', ..., 'kind': 'rent'}
  {'id': 192, 'name': 'YouTube', ..., 'kind': 'rent'}
== watch             {"watching":{"movie_id":980431,"title":"Avatar Aang: The Last Airbender","provider":"Paramount Plus Premium",...}}
== rating/start      ('Avatar Aang: The Last Airbender', ['Bedirhan', 'Ayse', 'Can'], 'Bedirhan')
== live              {"live":"I really","changed":true} / same text again -> {"live":"I really","changed":false}
== answer Bedirhan   {"saved":"Bedirhan","reaction":"loved","next":"Ayse","done":false}
== answer Ayse       {"saved":"Ayse","reaction":"meh","next":"Can","done":false}
== skip (Can)        (True, [{'name': 'Bedirhan', 'reaction': 'loved'}, {'name': 'Ayse', 'reaction': 'meh'}, {'name': 'Can', 'reaction': None}])
== state             ('rating', 'Saved: Avatar Aang: The Last Airbender', True, None, {'Bedirhan': ('loved','hand'), 'Ayse': ('meh','hand'), 'Can': (None,'skip')})
== profiles after    [('Bedirhan', ['Avatar Aang...'], [], ['Animation','Adventure','Fantasy','Action']), ('Ayse', ['Avatar Aang...'], [], []), ('Can', ['Avatar Aang...'], [], [])]
```
(Ayse "meh" has delta 0, so her genres did not move; Can skipped, so only `watched`.)

Live agent turn (agent on 8124 -> MCP 8123, rating for Rocky, Bedirhan already rated by hand, asking = Ayse):
```
POST /chat {"text":"honestly a bit long but I loved Rocky","speaker":"Ayse"}
reply: "Saved, thanks everyone."
steps: [{"tool":"record_reaction","input":{"name":"Ayse","reaction":"loved","quote":"Honestly a bit long but I loved Rocky."},"ok":true,"ms":2204}]
state: Saved: Rocky, done true
```
Also live: "we are back, the movie is over" -> `start_rating {"movie": ""}` -> reply "Welcome back!";
"pass" / "no comment" -> `record_reaction {"reaction": null}` (after the enum fix below);
"it was okay I guess" -> `meh`; last person -> "Saved, thanks everyone.". Turns take 4-8 s.

## Decisions

- **How the agent knows the screen:** it did not (it never read state; the voice page only sends `text` + `speaker`).
  Cheapest fix without touching the voice page: before every turn the agent does `GET {MCP base}/api/rating`
  (3 s timeout, failures ignored) and, if `screen == "rating"`, adds a block to the system prompt naming the film,
  the people, who answered and who is answering now. `/api/state` was first used but took 0.8-2.6 s on DynamoDB
  (it summarizes every household profile one by one) and timed out at 1.5 s; the new `GET /api/rating` is one store
  read (0.1-0.6 s). It is an addition, not in tv-contract.md; the TV does not need it.
- **Nullable enum for `reaction`:** the existing agent unwrap turned `anyOf [enum, null]` into a plain string enum,
  so the model could not send null and mapped "no comment" to `meh`. Nullable enums now become
  `{"enum": [..., null]}`; verified live with the OpenRouter model (other nullable params are unchanged).
- Providers: `flatrate`, then `free`, `ads` all map to `stream`; then `rent`, then `buy`. First kind wins per provider id.
  Output order = kind order, TMDB order inside. Any provider exception (TMDB down, no cache) -> `providers: []`, `providers_link: null`.
- `start_watching` loads details if the TV is not already showing that film. `start_rating` clears `watching`
  and takes `people` from the couch (empty couch -> error). With `watching`, the film is reloaded from TMDB (cached).
- `record_reaction` after `done` is an error ("already saved") so a late answer cannot nudge genres twice;
  `finish_rating` after `done` is a harmless no-op. Quotes: voice only, whitespace collapsed, max 120 chars;
  hand and skip store `""`. Any answer clears `live`. `set_live` with no rating running -> 400.
- `_finish` calls `mark_watched` first (it writes the state itself), then reloads state and writes the final rating,
  so the finish costs two `version` bumps.
- MCP tool `record_reaction` passes `by="voice"` (or `skip` for null). INSTRUCTIONS text mentions the rating flow.

## Not done / open

- Did not touch port 8000 (it was down when I checked: `curl /health` -> no answer). Not deployed.
- Household `ajan2-test` data stays in the DynamoDB table (profiles Bedirhan, Ayse, Can; TV state).
- One early live turn ("pass", while the agent could not read the state) hung past my 90 s curl timeout and
  ended up saving Bedirhan as `loved`; after the `/api/rating` change it did not recur, but the voice page should
  keep its own timeout.
- ajan4 needs no change for the agent side; it only needs `POST /api/rating/live` and `speaker = asking`.

## Friction

- **Strands Agents 1.61.1, `strands.models.openai.OpenAIModel`** (OpenRouter): every multi-tool turn logs
  `reasoningContent is not supported in multi-turn conversations with the Chat Completions API.`
  (strands/models/openai.py:409). Expected: reasoning content kept or silently dropped. Actual: a warning per
  message, reasoning dropped. Workaround: none needed, it still works; noise in logs.
- **Strands MCP tool schemas + OpenRouter constrained sampling** (follow-up to the earlier entry): Pydantic's
  `X | None` becomes `anyOf [X, null]`; unwrapping it to X (earlier workaround) makes null impossible for a
  required nullable enum. Workaround: keep null inside the enum list (`unwrap_nullable` in agent.py).

DONE
