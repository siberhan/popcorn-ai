# ajan2: profile edit/delete + duel without the agent

Files: `services/mcp/src/popcorn_mcp/service.py`, `server.py`, `tests/test_service.py`. `uv run pytest -q`: 36 passed. Nothing committed or deployed; apps/tv untouched.

## Service
- `delete_person(name)`: removes profile item, id in the profiles list, duel pool, couch membership. Ends that person's duel (screen back to `couch`). In a running rating: drops them from `people`/`answers`; if they were `asking`, moves to the next unanswered person (speaks "<next>, what about you?"), or finishes the rating (saves, "Saved, thanks everyone.") if nobody is left, or clears the rating if nobody is left at all. On the reel it goes through `_after_couch_change` (unfit cards fade). Message "<name> was deleted". Unknown name: PopcornError ("I don't know X yet...").
- `edit_person(name, new_name=None, age=UNSET)`: `UNSET` sentinel exported from service.py. New name different from the current one: `rename_person`. int age: sets age and `kid = age < 13`. `age=None`: clears age, `kid` stays. Neither given: PopcornError. Age is validated (0-120) before the rename, so a bad age changes nothing. Bumps the TV version ("<name> was updated") on age change.
- `start_auto_duel(name, pairs=5)`: `duel_candidates`, then greedy pairing (left = first unused, right = first unused sharing no genre, else next one). 5 pairs, no film twice. Fewer than 6 candidates: "Not enough films for a duel right now." Not an MCP tool.

## Routes
```
POST /api/person {"delete": "Can"}                          -> {"deleted": "Can"}
POST /api/person {"edit": "Can", "name": "Cem", "age": 9}   -> {"memory": {...}}
POST /api/person {"edit": "Cem", "age": null}               -> {"memory": {...}}   (age key missing = unchanged)
POST /api/duel/start {"name": "Cem"}                        -> {"duel": {name, round, total: 5, left, right}}
```
All errors are 400 `{"error": msg}` (unknown name, neither name nor age, non-int age, non-string name, empty body).

## Odd
- Deleting while the screen is `rating`/`details` keeps that screen (only the reel and duel screens are touched); a deleted person who is the only member of a running rating clears the rating and goes to `couch`.
- In tests the fake catalog has only 5 kid-safe films, so the auto duel tests use adults (a real kid pool is 50 films).
- `edit` renames keep `named: true` (reuses `rename_person`).
