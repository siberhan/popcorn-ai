# Rules for every agent

You are one of three agents. The orchestrator (Claude Code, in another tab) planned the work,
will review it, integrate it, and commit it. Stay inside your own task.

## Project in one paragraph

Popcorn AI is a hackathon entry (Amazon "Build, Ship, Shape", deadline 2026-10-23). A family says
by voice who is on the couch tonight; the app remembers each person's movie taste and shows
picks on a Fire TV screen. Parts:
- `services/mcp/` (done, do not change): Python MCP server, stateless Streamable HTTP at
  `http://127.0.0.1:8000/mcp`. 10 tools: set_couch, add_to_couch, remove_from_couch, get_profiles,
  update_taste, start_duel, record_duel_choice, recommend_for_couch, mark_watched, get_movie_details.
  Also `GET /api/state` (what the TV shows). The orchestrator keeps ONE copy running on port 8000
  (DynamoDB, household `dev`). Do not start another one on port 8000. Check it with
  `curl -s http://127.0.0.1:8000/health`; if it is down, say so in your terminal output and start it with
  `cd services/mcp && POPCORN_HOUSEHOLD=dev uv run popcorn-mcp`.
- `services/agent/` (ajan2, new): the voice agent. Strands Agents SDK + OpenRouter LLM, uses the MCP tools,
  speaks with Amazon Polly.
- `apps/alexa-web/` (ajan3, new): a "Simulated Alexa+" web page: microphone in, voice out.
- `apps/tv/` (later): the TV app.

## Hard rules

1. Only change files in your own folder (and your report file in `briefs/`). Never edit
   `services/mcp/`, `PLAN.md`, `FRICTION_LOG.md`, `CLAUDE.md`, `AGENTS.md`, `.env`, `.env.example`.
   If you need a change there, write it in your report.
2. Never run `git commit`, `git push`, `git add`, or any command that changes git state.
3. Secrets: keys live in the repo root `.env` (OPENROUTER_API_KEY, OPENROUTER_MODEL, TMDB_API_READ_TOKEN,
   AWS_REGION=eu-north-1, AWS_PROFILE=popcorn). Load them in code; never print, log, or copy a key value
   anywhere (not in files, not in your output, not in reports).
4. AWS: the AWS project is fixed to Region `eu-north-1`, AWS CLI profile `popcorn` (signed in with
   `aws login`). You may call read-only APIs and Polly `SynthesizeSpeech`/`DescribeVoices`.
   Do NOT create, change, or delete any AWS resource (no tables, functions, roles, buckets).
   If the CLI says the session expired, stop and tell the user to run `aws login --profile popcorn`.
5. Python: use `uv`, Python >=3.12, pin exact versions in `pyproject.toml`, follow the style of
   `services/mcp/src/popcorn_mcp/` (small modules, short docstrings, type hints). No emojis in code or output.
   boto3: use `botocore[crt]` as a dev dependency (needed locally for `aws login` credentials).
6. Branding: never use the Alexa logo, Amazon logos, an Alexa-like blue/cyan light ring, or an
   Alexa-like voice. The only allowed wording is the plain text label "Simulated Alexa+".
   Never save movie poster images in the repo (hot-link TMDB URLs at runtime only).
7. Verify facts against the installed package source or official docs, not memory. Library versions
   change; check what is actually installed.
8. Friction log (counts for the hackathon score): any problem with an Amazon/AWS tool, SDK, or doc
   (Strands, Polly, boto3, AWS CLI, Lambda tools, docs) goes into your report with: tool + version,
   what you tried, expected vs actual, EXACT error text, workaround. Do not write FRICTION_LOG.md yourself.

## When you finish

Write your report file (path in `briefs/README.md`) with:
- What you built (files) and how to run it, with exact commands.
- How you tested it, with the real output (short).
- What does not work yet, open questions, and decisions you made on your own.
- Friction entries (see rule 8).
Then stop and say "DONE" in your terminal output.
