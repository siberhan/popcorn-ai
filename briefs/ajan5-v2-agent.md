# ajan5: v2 agent service (stateful session, cache-friendly context, flow prompt), Day 6

Read `briefs/rules.md`, then `briefs/v2-contract.md` (binding), then `briefs/api-contract.md`.
Hard rules 1-8 apply; your folder is `services/agent/`. Report: `briefs/reports/ajan5-v2-agent.md`.

ajan2 is changing the MCP server at the same time (new tools in the contract). Build against the
contract; do not wait for it.

## Work

1. **Session store** (`store.py`): DynamoDB document `<household>:session` in table `POPCORN_TABLE`
   (same schema as `services/mcp/src/popcorn_mcp/store.py`: pk + doc JSON string + expires_at),
   env `POPCORN_TABLE`, `POPCORN_HOUSEHOLD`, region from config. Keep an in-memory version for tests
   and for local runs without the env. Size rule from the contract. Idle > 3 h -> fresh session.
2. **Context layout** (`agent.py`, `prompts.py`): static system prompt; the per-turn line
   `[speaker: ...] [tv: ...]` in front of the user text (read `GET {MCP base}/api/state` for screen,
   rating asking/people; never fail the turn if it is down). Remove `build_system_prompt(speaker, rating)`
   dynamics. Keep `unwrap_nullable`.
3. **Speaking to the TV:** after each turn, `POST {MCP base}/api/speech` per the contract rules
   (skip for rating turns and empty replies; apology text on failure). `/chat` and `/event` must
   still return their JSON even if the speech post fails.
4. **Endpoints:** `/event`, `/session/new`; `/chat` uses the household session when no
   `conversation_id` is sent. Event sentences exactly as the contract examples.
5. **Prompt:** write the v2 flow as short rules. It must cover: creating people by conversation
   (ask once for a missing name; accept a label like "Ahmet's son" with `named: false`; collect age,
   role, gender when offered, never interrogate), saving taste sentences as notes (`update_taste note`,
   short, in the person's own spirit: "Loves superhero films, even more mixed with horror"),
   offering the duel to new people one at a time (`duel_candidates` then `start_duel` with 5 pairs:
   pairs 1-2 maximally different films, pairs 3-5 probe tone inside the person's likely taste, e.g.
   grounded vs spectacle sci-fi; respect a skip), after `duel_done` writing 1-3 notes from the
   "picked X over Y" history and moving on (next new person's duel, else ask about mood),
   recommending (`find_candidates` with args from mood/feedback/notes, then `show_picks` 6 picks,
   each `why` one spoken sentence for the people on the couch, specific to the film and to them,
   no spoilers, no "X loves genre" template; `match` honest 50-99), feedback -> new search with
   `exclude_ids` of what was shown, "I've seen it" -> `mark_seen`, rating rules from the old prompt
   (reply empty during the rating round), kid safety is handled by the tools (never argue with it).
   Replies: English, 1-2 short spoken sentences, no lists or markdown.
6. Tool-call limit per turn and a turn timeout (about 60 s) so a loop cannot hang the Lambda.

## Verify

- `uv run pytest` with a fake MCP (no network): session reuse across turns, `/session/new`, idle
  reset, size trimming, per-turn context line, speech post rules, `/event` sentences.
- Live: run locally on port 8110 with `MCP_URL=http://127.0.0.1:8010/mcp` if ajan2's server is up
  there (check `/health`; do not start it yourself), real OpenRouter, in-memory session store. If it
  is not up, say so and stop the live part. Show one real transcript: create two people (one a
  10-year-old whose name is withheld), start a duel, `duel_done` event, picks with the `why` lines.
  DynamoDB: you may get/put/delete only keys starting with `v2-test:` to test the store; delete them.
- Do not deploy.

Report: per-file changes, the final prompt (full text), test output, live transcript, timings per
turn, open questions, friction. End with `DONE`.
