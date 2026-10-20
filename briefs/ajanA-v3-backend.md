# ajanA: v3 backend (services/mcp)

Read first: `briefs/v3-contract.md` (binding), `briefs/rules.md` (hard rules 2, 3, 4, 5, 7 apply; ignore its
"do not change services/mcp" line, services/mcp is YOUR folder now). Then read all of
`services/mcp/src/popcorn_mcp/` and `services/mcp/tests/`.

## Do

1. `service.py` / `taste.py` / `tmdb.py`: implement the contract's profile, Member view, TV state fields,
   couch -> genres -> duel flow, duel catalog (`seed_duel_catalog`, duel from catalog), recommender,
   rating voice summary, reviews instead of watched. Delete the removed features listed in the contract
   (code, constants, tests), do not leave dead code behind.
2. New module `llm.py`: a small async OpenRouter JSON chat client (httpx, like `voice_stt.py`), with the
   Cerebras pin, `reasoning`, `usage`, a 20 s timeout, JSON extraction from the reply. `Popcorn` gets it
   injected (Protocol) so tests use a fake. Config: `POPCORN_REC_MODEL` in `config.py`.
3. `server.py`: routes from the contract table; update the MCP tool list to the new service functions
   (remove tools for removed features; add `recommend`, keep the rest that still exist). `/events` handles
   `seed_duel_catalog` only.
4. `static/phone/`: the rating-only phone page from the contract. Keep its current look and recorder code.
5. Tests: update/replace `services/mcp/tests/` for everything above with the fake TMDB and a fake LLM:
   genres flow, duel from catalog (genres only, kid filter, no TMDB calls), recommend (12 asked -> 10 kept,
   dedupe, id-based why, cert drop, `more` sends shown titles, kid rule line in the prompt, no "use names"
   instruction), rating voice (summary saved, bad JSON -> 400), seed (missing only, `remaining`).

## Boundaries

- Edit only `services/mcp/**` and your report `briefs/reports/ajanA-v3-backend.md`.
- Do not touch `infra/`, `services/agent/`, `apps/`, `.env`. No git commands. No AWS writes, no deploy.
  Do not run against real TMDB/OpenRouter except one optional manual smoke test of `llm.py` with the
  `.env` key (never print the key).
- Match the existing style and comment density. No new dependencies unless unavoidable (say why).
- Something in the contract impossible or contradicting the code: stop and write it in the report.

## Verify

`cd services/mcp && .venv/bin/python -m pytest -q` must pass. Report: changed files with what changed,
decisions you made, test output (short), anything not done. End with DONE.
