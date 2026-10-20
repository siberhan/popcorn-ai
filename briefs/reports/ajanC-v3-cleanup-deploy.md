# ajanC: v3 cleanup and deploy

v2 Strands agent removed, `infra/deploy.py` now deploys only the MCP server (plus the v2 cleanup and the
duel-catalog seed), and the live deployment was rebuilt and smoke tested.

## Changed files

- `infra/deploy.py` — rewritten for v3:
  - only the MCP server is deployed: `deploy_agent`, the `mcp|agent` targets, the agent in `status`, the
    arg validation for targets, the module-level `scheduler` client and `ensure_schedule` are gone.
  - `POPCORN_REC_MODEL` added to the function environment: the `.env` value when the key exists there, else
    `openai/gpt-oss-120b:nitro`. (`.env` has no such key, so the deployed function got the default.)
  - `remove_v2_leftovers()` — idempotent, called by both `deploy` (first) and `destroy`. Deletes, if present:
    the `popcorn-duel-pools` schedule (first, because Scheduler still targets the role), the `popcorn-agent`
    function with its Function URL and `/aws/lambda/popcorn-agent` log group, the `popcorn-agent-role` and
    `popcorn-mcp-scheduler-role` roles (all inline and attached policies removed before the role). A missing
    resource is skipped, not an error. The Scheduler client is created only inside `delete_schedule`.
  - new `seed` command: `POST {"popcorn": "seed_duel_catalog"}` to `<mcp url>/events` with `urllib`, prints
    `built` / `remaining` per call, repeats until `remaining` is empty, max 15 calls; one retried call, a
    second failure exits with `seed call failed twice: ...`. `deploy` runs it at the end.
  - `AWS_LWA_PASS_THROUGH_PATH` dropped from the environment: it existed so Lambda Web Adapter could post
    the schedule's non-HTTP event to `/events`, and there is no schedule in v3. The seed posts plain HTTP.
  - `destroy` keeps the DynamoDB table and now also deletes the v2 leftovers.
  - module docstring and `--help` rewritten (commands, cleanup, seeding, caching, secrets); `reset` docstring
    now says the duel catalog stays too.

- `README.md` — short "Parts" and "Deploy" sections (the old text was a WIP stub; nothing there pointed at
  the agent).
- `.env.example` — added `POPCORN_REC_MODEL=` (empty = `openai/gpt-oss-120b:nitro`).

## Deleted

- `services/agent/` (whole folder: `pyproject.toml`, `uv.lock`, `src/`, `tests/`, `README.md`).
- `infra/run-agent.sh` (the agent's Lambda start script).

## AWS resources deleted

Seen before the deploy, gone after it (checked with `aws lambda list-functions`,
`aws scheduler list-schedules`, `aws iam list-roles`, `aws logs describe-log-groups`):

- function `popcorn-agent` (and with it its Function URL and its public-URL permissions)
- log group `/aws/lambda/popcorn-agent`
- role `popcorn-agent-role` (inline policy `popcorn` deleted first)
- schedule `popcorn-duel-pools`
- role `popcorn-mcp-scheduler-role` (inline policy `popcorn` deleted first)

Created/updated: function `popcorn-mcp` (`code:16bb8d12eab8b8c7 config:22f1aad255180efb`), its Function
URL, role `popcorn-mcp-role`, log group `/aws/lambda/popcorn-mcp`, layer `popcorn-mcp-deps:1` reused
("dependencies unchanged"). A second run printed `no v2 leftovers` — the cleanup is idempotent.

Not touched (left as is, outside the resources named in the brief): the Lambda layer `popcorn-agent-deps`
(version 1) is still there. Nothing else was created, changed or deleted; the `popcorn-ai` table was only
written through `reset`.

## Seed output (`uv run deploy.py deploy`, tail)

```
no v2 leftovers
dependencies unchanged (popcorn-mcp-deps:1)
function popcorn-mcp unchanged
popcorn-mcp: https://5ylcrhgrmbi44tjoqhv2oqbipm0ljqdg.lambda-url.eu-north-1.on.aws
  /health -> 200 {"ok":true}
seed 1/15: built Action, Adventure, Animation, Comedy, Crime, Documentary, Drama | remaining Family, Fantasy, History, Horror, Music, Mystery, Romance, Science Fiction, Thriller, War, Western
seed 2/15: built Family, Fantasy, History, Horror, Music, Mystery, Romance | remaining Science Fiction, Thriller, War, Western
seed 3/15: built Science Fiction, Thriller, War, Western | remaining -
duel catalog complete
```

The first `deploy` run of the session did the real work (`updated function popcorn-mcp (code, config)`,
4 deletions) and then crashed in my own code (`TypeError: ensure_url() takes 1 positional argument but 2 were
given`, a signature I had changed and not its call site). Fixed, re-run; the second run found the code hash
already applied, which is why it says "unchanged". A standalone `uv run deploy.py seed` afterwards printed
`seed 1/15: built - | remaining -` / `duel catalog complete` (18 genres already stored).

## Run order and results

1. `uv run deploy.py reset` — `deleted 91 items of household demo`.
2. `uv run deploy.py deploy` — as above.
3. Smoke test with `curl` against `https://5ylcrhgrmbi44tjoqhv2oqbipm0ljqdg.lambda-url.eu-north-1.on.aws`:

| Step | Status | Result |
|---|---|---|
| `GET /health` | 200 | `{"ok":true}` |
| `GET /api/genres` | 200 | 18 genres (Action, Adventure, Animation, Comedy, ...) |
| `GET /api/state` | 200 | `screen` `couch`, no members |
| `POST /api/couch {"add":"Smoke","age":30}` | 200 | — |
| `GET /api/state` | 200 | `screen` `genres`, `genres_for` `Smoke` |
| `POST /api/person {"name":"Smoke","genres":["Comedy"]}` | 200 | profile saved (`kid: false`, `duel_done: false`) |
| `GET /api/state` | 200 | `screen` `duel` |
| `POST /api/duel {"pick":"left"}` x5 | 200 each | — |
| `GET /api/state` | 200 | `screen` `couch`, `duel_done: true`, 5 duel lines |
| `POST /api/ask {}` | 200 | `screen` `ask` (`{"screen":"ask"}`) |
| `GET /api/state` | 200 | `screen` `ask` |
| `POST /api/ask {"text":"this year's new films in cinemas"}` | 200 | `ok: false`, `reply: "Sorry, I can't help with that. I don't know films from the last two years or what's in cinemas now."` |
| `POST /api/ask {"text":"a light comedy"}` | 200 | `ok: true`, 10 recommendations (SpongeBob Movie: Search for SquarePants, Toy Story, Toy Story 4, Despicable Me 2, Shaun the Sheep Movie, Paddington, The Grand Budapest Hotel, Crazy Rich Asians, The Intern, Pitch Perfect), every card with `why_audio` |
| `POST /api/screen {"screen":"ask"}` | 200 | — |
| `POST /api/screen {"screen":"couch"}` | 200 | — |
| `uv run deploy.py reset` | — | `deleted 14 items of household demo`; `GET /api/state` -> `screen` `couch`, `members: []`, `recommendations: 0` |

4. `uv run deploy.py status` — `popcorn-mcp: https://5ylcrhgrmbi44tjoqhv2oqbipm0ljqdg.lambda-url.eu-north-1.on.aws`,
   `/health -> 200 {"ok":true}`.

Live MCP URL: **https://5ylcrhgrmbi44tjoqhv2oqbipm0ljqdg.lambda-url.eu-north-1.on.aws**

## Verify

- `cd infra && uv run python -c "import ast, pathlib; ast.parse(pathlib.Path('deploy.py').read_text())"` — OK.
- `cd services/mcp && .venv/bin/python -m pytest -q` — **62 passed, 1 failed**:
  `test_http_qr_and_phone_routes_and_mcp_tools`, line 1028,
  `assert 'Open the rating on the TV to talk' in page.text`, actual page text has
  `Press Popcorn or open the rating on the TV to talk` (`services/mcp/src/popcorn_mcp/static/phone/index.html`
  line 15 and `static/phone/app.js` line 8). The v3 contract (Phone page) and the test both want
  "Open the rating on the TV to talk"; the page ships a longer line. This is a pre-existing services/mcp
  mismatch (`index.html` 04:57, the test 04:56, before this task), not caused by these changes, and it does
  not affect the deployment or the smoke steps. Left untouched per the brief.

## Not done / open

- `apps/alexa-web/` still points at the deleted agent: `config.js` line 11 has
  `AGENT_URL = ... https://5h3jfj5ivg6nddn5lgygk4y4fm0rsnho.lambda-url.eu-north-1.on.aws`, used by
  `app.js` (`/speak`, `/chat/stream`, `/health`). That URL is dead now. It is the v2 phone page, replaced in
  v3 by the phone page served by the MCP server (`/phone/`), so the whole `apps/alexa-web/` folder looks
  dead. Not touched: the brief does not allow editing `apps/**`. Recommend deleting it (or, if it should
  live on, rewriting it against the MCP HTTP API).
- `PLAN.md` still lists `services/agent/` (line 51) and the Strands agent. Not edited: hard rule 1.
- `services/mcp/tests/test_service.py:966` asserts `{"popcorn": "refresh_duel_pools"}` is a 400 — that is the
  v3 behaviour (only the seed payload is accepted), so it is a valid negative test, not a leftover to fix.
- The `popcorn-agent-deps` Lambda layer remains (see above).
- The `.env` key `OPENROUTER_MODEL` is no longer read by anything in the repo except `.local/setup_keys.py`;
  the deployed model comes from `POPCORN_REC_MODEL`. `.env` itself was not edited.

## Friction entries

None with an AWS tool, SDK or doc in this task. The AWS CLI calls, Lambda/IAM/Scheduler/Lambda-URL calls and
the seed/HTTP round trips all behaved as documented; the one crash was my own refactor slip (recorded above).

DONE
