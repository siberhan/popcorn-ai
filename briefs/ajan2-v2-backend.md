# ajan2: v2 backend (MCP server), Day 6

Read `briefs/rules.md`, then `briefs/v2-contract.md` (binding), then `briefs/tv-contract.md`.
Hard rules 2-8 apply. **Override of rule 1:** this task changes `services/mcp/` (except
`src/popcorn_mcp/static/phone/`, which ajan4 owns; only add the routes that serve it). Report:
`briefs/reports/ajan2-v2-backend.md`.

## Work

1. **Person memory v2:** new fields with defaults for old documents, `memory(profile)`, notes rules.
   `set_couch` / `add_to_couch` / `update_taste` / `get_profiles` return memory as the contract says.
   New `rename_person`, `mark_seen`.
2. **Candidate pool:** `find_candidates` (streaming-only via `watch_region` +
   `with_watch_monetization_types=flatrate`, couch kid filter in code, exclusions, keywords via
   `/search/keyword`). Extend `TMDB.discover` for the new params; keep the cache.
3. **`show_picks`:** checks ids against `state.pool` (built for the current couch kid filter),
   builds cards with the agent's `why` and `match`, synthesizes all `why` lines in parallel, sets
   screen `recommendations`. Remove `recommend_for_couch` and the formula path (`_rank`, `match_percent`,
   `why_line` usage) only where nothing else needs them; `/api/recommend` may stay but must not be
   used by the TV any more. Couch changes on the reel: cards that no longer fit fade out, no refill.
4. **Duel v2:** `duel_candidates`, `start_duel(name, pairs)`, history with titles, `skip`.
   Keep the weight nudges (they still drive `loves/likes` and the default pool genres).
5. **Speech:** `polly.py` in the MCP package (boto3 `polly`, region from config, voice/engine from
   env, defaults Brian/standard), cache in the store (base64, TTL), routes `/api/speech`,
   `/api/voice`, `/api/voice/<sha1>.mp3`. Rating round speech exactly as the contract says.
   State gains `speech`, `voice`, `pool`; `get_state` defaults for old documents.
6. **QR + phone routes:** `segno` (pin the exact version you install), `/api/qr.png`, `/phone/` and
   `/phone/<file>` from `static/phone/` (only known file names; 404 otherwise; correct content types).
   Create the folder with a placeholder `index.html` only if ajan4 has not created it yet.
7. MCP tool descriptions: short, written for the LLM (when to call, what the args mean).

## Verify

- `uv run pytest` in `services/mcp`: extend the fake TMDB in `tests/test_service.py`; tests for memory
  defaults, pool exclusions + kid filter, show_picks id check, duel pairs/skip/history, rating speech
  text, voice/speech routes (Polly faked), qr route.
- One live run: `POPCORN_HOUSEHOLD=v2-test POPCORN_PORT=8010` (or the way `main()` takes a port;
  add it if missing) against real TMDB and real Polly (allowed: `SynthesizeSpeech`), with the real
  DynamoDB table but only household `v2-test`. Show real `find_candidates` output for a couch with a
  10-year-old (titles + count) and one `/api/voice/<sha>.mp3` byte size. Delete your `v2-test` keys at
  the end. Do not start anything on port 8000.
- Do not deploy, do not touch Lambda or IAM (the orchestrator adds Polly permission and deploys).

Report: per-file changes, tool list with final signatures, test output, live output, open questions,
friction. End with `DONE`.
