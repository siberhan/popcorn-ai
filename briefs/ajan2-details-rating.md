# ajan2: Details, where to watch and the family rating (backend, Day 5)

Read `briefs/rules.md`, then `briefs/tv-contract.md` (types, actions table, rating rules: binding).
Hard rules 2-8 apply. **Rule 1 is changed for this task:** you may edit `services/mcp/` and
`services/agent/` (and your report). Nothing else.

## Why

The TV now goes reel -> details (backdrop, where to watch) -> family away watching -> rating.
The rating is voice first: the voice page asks each person out loud, their answer goes through the
agent, and the TV shows it live. Hand rating and Skip come from the TV over HTTP. All of it must land
in each person's taste memory through the existing `mark_watched`.

## services/mcp

1. **tmdb.py:** `backdrop_url(path)` (w1280) and `logo_url(path)` (w92) next to `poster_url`.
   `watch_providers(movie_id)` calling `/movie/{id}/watch/providers` (check the real response with one
   live call; do not trust memory). Cache it like the other calls if there is a cache.
2. **get_movie_details:** add `backdrop`, `providers`, `providers_region`, `providers_link` exactly as
   in tv-contract.md. Region from env `POPCORN_WATCH_REGION`, default `US`. One entry per provider id,
   kind priority stream > rent > buy, keep TMDB's display order, max 4. A provider call failure must
   not break details: `providers: []`.
3. **State:** add `watching`, `rating`, `focus` (default `None`) to `get_state()`. `set_couch` and
   `recommend` clear `watching` and `rating`. Old stored states without these keys must still work.
4. **Service methods** (small, docstrings, like the rest): `open_details(movie_id)`,
   `go_to(screen)` (`recommendations` or `couch` only, clears `details`/`watching`/`rating`),
   `set_focus(movie_id)`, `start_watching(movie_id, provider)`, `start_rating(movie=None)` (uses
   `watching`, else `details`; error if neither and no movie), `record_reaction(name, reaction, quote,
   by)`, `skip_turn(name=None)`, `set_live(text)`, `finish_rating()`. Follow the rating rules in
   tv-contract.md. Names match people with `slug()`; an unknown name is a `PopcornError` with a
   readable message. `record_reaction` for someone who already answered overwrites it (people change
   their mind) and does not move `asking` backwards. `set_live` only writes when the text changed and
   caps it at 300 chars. `finish_rating` with nobody answered still marks everyone as watched.
5. **HTTP routes** in `add_tv_routes`: every row of the actions table, same `handle()` error style,
   400 on bad bodies.
6. **MCP tools:** `start_rating(movie: str | None = None)` and
   `record_reaction(name: str, reaction: Reaction | None, quote: str = "")` (null = skip), short
   docstrings that tell the LLM when to call them. Keep the existing 10 tools unchanged.
7. **Tests** (`services/mcp/tests/`): providers mapping (dedupe, priority, cap, failure -> []),
   the full rating flow (3 people: voice answer, hand answer, skip -> done, `mark_watched` effects on
   profiles: watched for all, liked/disliked and genre nudge only for answered), overwrite, finish
   early, unknown name, `go_to` clearing, `set_live` no-op on same text, old state without new keys.
   Use the fakes the existing tests use.

## services/agent

In `prompts.py`, add a short rating section:
- When the family says they are back / finished the film, call `start_rating` (no movie needed).
- While `screen` is `rating`, the voice page sends the answer of the person in `rating.asking` with
  `speaker` set to that name. Map it to one Reaction and call `record_reaction(name, reaction, quote)`
  with a short quote (their words, max 120 chars). "skip", "pass", "no comment" -> reaction null.
- Reply in 2 to 6 words that acknowledge only ("Loved it, noted."). Never ask the next person: the
  voice page does that. After the last person: "Saved, thanks everyone."
Check how the agent learns the current screen (does it read state, or should the voice page say it?);
if it cannot know, add `rating` awareness the cheapest way and explain it in the report.
Add a prompt test if the agent tests cover prompts.

## Done when

- `uv run pytest` passes in both services.
- Against a local MCP on a free port (not 8000) with household `ajan2-test`, a curl script runs the
  whole flow: recommend -> details (print providers) -> watch -> rating/start -> live -> answer ->
  skip -> state shows `done: true` and the profiles changed. Paste the short output.
- One live agent turn: speaker Ayse during rating says "honestly a bit long but I loved Rocky" ->
  `record_reaction` with `loved` (or `liked`) and a quote. Paste the tool input.
- Do NOT deploy and do not restart anything on 8000; the orchestrator deploys.

Report: `briefs/reports/ajan2-details-rating.md` (files changed, the real providers response shape,
decisions, friction entries). End with `DONE`.
