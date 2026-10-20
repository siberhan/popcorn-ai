# ajanC: v3 cleanup and deploy (infra, services/agent)

Read first: `briefs/v3-contract.md` (binding), `briefs/rules.md` (hard rules 2, 3, 5 apply; rule 4 is
replaced below), `infra/deploy.py`, `services/mcp/src/popcorn_mcp/server.py` (`/events`) and
`services/mcp/src/popcorn_mcp/config.py`. The backend and the TV are done; do not change them.

## Do

1. Delete the whole `services/agent/` folder (the v2 Strands agent is gone in v3).
2. `infra/deploy.py`:
   - Deploy only the MCP server. Remove `deploy_agent`, the `mcp|agent` targets, the agent in `status`,
     `SCHEDULE`, `SCHEDULE_PAYLOAD`, `ensure_schedule`, the scheduler role, the `scheduler` client and the
     `lam.invoke(... refresh_duel_pools ...)` call.
   - Add `POPCORN_REC_MODEL` to the MCP function's environment: the `.env` value if the key exists there,
     else `openai/gpt-oss-120b:nitro`.
   - New idempotent step in `deploy` (also run by `destroy`): delete what v2 left in AWS if it exists:
     the `popcorn-agent` function, its Function URL, its log group `/aws/lambda/popcorn-agent`, the
     `popcorn-agent-role` role (inline policies first), the `popcorn-duel-pools` schedule and the
     `popcorn-mcp-scheduler-role` role. A missing resource is fine, not an error.
   - New command `seed`: POST `{"popcorn": "seed_duel_catalog"}` to `<mcp url>/events` (stdlib urllib or
     httpx if already a dependency), print `built`/`remaining`, repeat until `remaining` is empty (max 15
     calls, stop with an error if a call fails twice). `deploy` runs it at the end.
   - Update the module docstring and help text. Keep the style of the file.
3. Remove the other references to the agent service: grep the repo for `services/agent`, `popcorn-agent`,
   `AGENT_URL`, `popcorn_agent`, `refresh_duel_pools`, outside `briefs/` and `node_modules/`. Fix docs and
   config that still point at them (for example the root `README.md`, `.env.example`). Do not edit files
   in `briefs/` except your report, and never `.env`, `CLAUDE.md`, `AGENTS.md`, `FRICTION_LOG.md`.
4. Run, in this order, from `infra/` with the `popcorn` AWS profile:
   1. `uv run deploy.py reset` (wipes the old household data: approved by the user).
   2. `uv run deploy.py deploy` (deploys the MCP server, removes the v2 leftovers, seeds the duel catalog).
   3. Smoke test against the live URL with curl, then reset again so the household starts empty:
      - `GET /health`, `GET /api/genres` (about 18 genres), `GET /api/state` (`screen` `couch`);
      - `POST /api/couch {"add": "Smoke", "age": 30}` -> state `screen` `genres`;
      - `POST /api/person {"name": "Smoke", "genres": ["Comedy"]}` -> screen `duel`; 5 x
        `POST /api/duel {"pick": "left"}` -> screen `couch`;
      - `POST /api/ask {}` -> screen `ask`;
      - `POST /api/ask {"text": "this year's new films in cinemas"}` -> `ok: false`;
      - `POST /api/ask {"text": "a light comedy"}` -> `ok: true` and 10 (at least 4) recommendations;
      - `POST /api/screen {"screen": "ask"}` then `{"screen": "couch"}` -> 200;
      - `uv run deploy.py reset`.
   4. `uv run deploy.py status`.

## AWS (replaces rule 4)

Region `eu-north-1` only, profile `popcorn`. You may create, update and delete exactly the resources named
above (the `popcorn-mcp` function, its URL, role and log group; the v2 leftovers) and items of the
`popcorn-ai` DynamoDB table through `reset`. Never delete the table, never touch anything else. If the CLI
says the session expired, stop and write in your report that the user must run `aws login --profile popcorn`.

## Boundaries

- Edit `infra/**`, delete `services/agent/**`, docs/config found in step 3, and your report
  `briefs/reports/ajanC-v3-cleanup-deploy.md`. No git commands. Never print a secret.
- Do not change `services/mcp/**` or `apps/**`. A bug there: describe it in the report and stop.
- No screenshots, no UI work. Work fast; this is a short task.

## Verify / report

`cd services/mcp && .venv/bin/python -m pytest -q` still passes; `cd infra && uv run python -c "import ast,
pathlib; ast.parse(pathlib.Path('deploy.py').read_text())"`. Report: changed/deleted files, the AWS
resources deleted, the seed output, each smoke step with its HTTP status and a short result, the live MCP URL,
anything not done. End with DONE.
