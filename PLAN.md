# Popcorn AI — Build Plan

Hackathon: Build, Ship, Shape — Amazon Developer Hackathon
Deadline: 2026-10-23, 12:00 PDT (22:00 TSİ). Target: submit by 2026-10-23 noon TSİ.
Tracks: Fire TV + Alexa+ (one project, both tracks; can win only one). Mini challenge: AWS Builder.

## Decisions

| Topic | Decision |
|---|---|
| Fire TV | Vega OS app on Vega Virtual Device (VVD). Develop in browser (web target), demo on VVD. |
| Starter | `AmazonAppDev/react-native-multi-tv-app-sample` (one codebase: web + Vega) |
| Alexa+ | Self-hosted MCP server (spec 2025-11-25, Streamable HTTP). The v2 "Alexa simulator" page and the Strands agent were removed in v3 |
| Voice | Phone page (QR on the TV) only: OpenRouter Whisper (speech-to-text) + OpenRouter TTS |
| LLM | OpenRouter only: `openai/gpt-oss-120b:nitro` on Cerebras, one call for 10 picks |
| Backend language | Python |
| AWS services | Lambda (Function URL), DynamoDB |
| Scope | Focused: one strong flow |
| Who is on the couch | Picked with the remote on the TV couch; a new person is name + age |
| Cold start | Genre pick + 5-round poster duel from a stored per-genre catalog (both cannot be skipped) |
| Hosting | Must stay live until 2026-11-20 (end of judging). Judges must not need their own keys. |

## Demo Flow (v3)

1. Pick who is on the couch with the remote. A new person: name + age, then genres, then the poster duel.
2. Popcorn → "What do you feel like watching tonight?" (typed or said on the phone; skip allowed).
   Films from the last two years or in cinemas get a fixed "Sorry, I can't help with that." line.
3. One LLM call → 10 picks with a "why" line each. A child on the couch keeps only kid-safe films.
4. After watching, each person rates the film (5 buttons or voice on the phone). Reviews feed the next picks.

Every screen but the couch has a Back button. The binding spec is `briefs/v3-contract.md`.

## Architecture

```
[Phone page /phone/ (QR)]  --voice-->  [MCP server: Lambda + Function URL]  --> [DynamoDB]
                                         MCP tools + HTTP API for the TV         + TMDB API
[TV app on Vega]  --poll /api/state + remote actions (HTTP)-->                   + OpenRouter
```

MCP tools (v1 draft, see the v3 contract for today's): `set_couch`, `add_to_couch`, `remove_from_couch`, `get_profiles`, `update_taste`,
`record_duel_choice`, `recommend_for_couch` (taste intersection + age filter), `mark_watched`, `get_movie_details`.

## Repo Layout (draft)

```
apps/tv/            React Native multi-TV app (web + Vega)
services/mcp/       Python MCP server, HTTP API for the TV, phone page
infra/              deploy.py (boto3): Lambda + Function URL, duel catalog seed
FRICTION_LOG.md     Kept from day 1 (up to 10% bonus)
README.md, LICENSE
```

## Schedule

| Day | Date | Work |
|---|---|---|
| 0 | Sat 10-17 | Accounts (AWS Free plan, TMDB, OpenRouter), Node 24, start Vega SDK install (~20 GB), GitHub repo, FRICTION_LOG.md |
| 1 | Sun 10-18 | MCP server + TMDB client + storage; test with an MCP client |
| 2 | Mon 10-19 | Agent (Strands + OpenRouter) + Alexa web page (voice in/out). Office hours 19:00 TSİ |
| 3 | Tue 10-20 | TV app in browser: couch, recommendations grid, poster duel, D-pad focus |
| 4 | Wed 10-21 | Vega build on VVD; deploy to Lambda + DynamoDB; end-to-end |
| 5 | Thu 10-22 | Polish, README, TMDB About screen, license, product feedback; user records video |
| 6 | Fri 10-23 | Buffer; submit on Devpost before noon TSİ |

License: MIT.

## Day-0/1 Smoke Tests (do before building features)

1. Vega: install SDK, run sample on VVD, one `fetch` to the host machine and one TMDB poster load.
   The sample's README links Vega 0.21 docs while the installer is 0.24: pin the version the sample expects.
2. Strands (`strands-agents==1.61.1`) + OpenRouter: one tool-call round trip. Keep a second tool-capable model as fallback.
3. MCP (`mcp` 2.3.0): stateless Streamable HTTP server; check it answers protocol version 2025-11-25.
4. AWS Free plan: check Lambda, DynamoDB, Polly are usable. If Polly Neural is not, use Standard voices.
5. OpenRouter: free models are capped at 50 requests/day; add ≥10 credits (1000/day) or use a cheap paid model.

## Risks

| Risk | Mitigation |
|---|---|
| Vega networking / version mismatch | Smoke test 1 on day 0 |
| Strands + OpenRouter tool calling unverified | Smoke test 2; fallback model |
| MCP sessions lost on Lambda | Stateless mode + Lambda Web Adapter; short tool calls |
| Polly not on Free plan | Check console; fall back to browser speech synthesis |
| AWS Builder with a non-Bedrock LLM | No staff confirmation; may ask in forum |
| Movie posters (studio copyright) in app/video | Ask organizers in forum; build a "demo art" mode (generated cards, no TMDB images) for the video; never commit posters to the repo |
| Alexa branding | No Alexa logo, no Alexa-like voice, no "Alexa" in project name; plain-text "Simulated Alexa+" label |
