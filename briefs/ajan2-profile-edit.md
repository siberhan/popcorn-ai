# ajan2 — profile edit/delete + duel without the agent (MCP backend)

Repo: services/mcp. Read `briefs/v2-contract.md` first. Do not commit or deploy. Never print secrets.

## Why
The couch screen ("Who's watching?") gets an edit (pencil) and a delete (X) bubble on the focused
avatar. A profile added with the TV form (remote only, no voice) must go straight into its poster duel.

## Routes (exact shapes; the TV agent codes against these)

1. `POST /api/person {"delete": "<name>"}` → `{"deleted": "<display name>"}`
   - Removes the profile for good: profile item, id from the profiles list, duel pool, from couch members.
   - If a duel for that person is running: end it (`duel=None`, screen `couch`).
   - If a rating is running: drop them from `rating.people`/`answers`; if they were `asking`, move to the next person
     (or finish the rating if nobody is left). Keep it simple and consistent with the existing skip code.
   - If the screen is the reel: same as removing from couch (cards that no longer fit fade, `_after_couch_change`).
   - Message `"<name> was deleted"`. Unknown name → 400 with a plain message.
2. `POST /api/person {"edit": "<name>", "name": "<new name>"?, "age": <int|null>?}` → `{"memory": {...}}`
   - `name` given and different → reuse `rename_person`.
   - `age` int → set age and `kid = age < 13` (existing `_ensure_profile` does this).
     `age: null` → clear age (`age=None`) and keep `kid` as it is. Key missing → age unchanged.
   - Both optional; neither → 400.
3. `POST /api/duel/start {"name": "<name>"}` → `{"duel": <_duel_view>}`
   - Runs `duel_candidates(name)` then builds 5 pairs in code (no LLM): candidates come round-robin across genre
     groups, so pair them so the two posters of a pair are from different genres where possible; no film twice.
     Then `start_duel`. Fewer than 6 candidates → 400 "Not enough films for a duel right now."
   - Add a service method `start_auto_duel(name, pairs=5)`. Do not expose it as an MCP tool.

Service methods: `delete_person(name)`, `edit_person(name, new_name=None, age=<sentinel>)`, `start_auto_duel(name)`.
Do not add MCP tools for these (the agent keeps `rename_person`/`update_taste`).

## Tests
Add tests in `tests/test_service.py` for the three (delete with duel running and on the couch, edit name+age,
age null, auto duel pairs = 5 distinct films). `uv run pytest -q` must pass.

## Report
`briefs/reports/ajan2-profile-edit.md`: what changed, route examples, anything odd. Short.
