# ajan2: Agent service (`services/agent`)

Read `briefs/rules.md` and `briefs/api-contract.md` first. You build the backend that the voice page
calls. ajan1 is researching Strands details in parallel and writes them to
`briefs/research-results.md`; read it when it appears (check it before you lock in Strands APIs).
Until then, read the installed package source yourself.

## Build

A Python service in `services/agent/` (uv project, package `popcorn_agent`, script `popcorn-agent`
that serves on `HOST`/`PORT`, default `127.0.0.1:8100`), implementing EXACTLY `api-contract.md`:
`GET /health`, `POST /chat`, `POST /chat/stream` (SSE), `POST /speak`.

- Framework: Starlette + uvicorn (same as the MCP server), pinned versions.
- Agent: `strands-agents==1.61.1` with an OpenAI-compatible model provider pointed at OpenRouter
  (`OPENROUTER_API_KEY`, `OPENROUTER_MODEL` from the repo `.env`; load `.env` the same way as
  `services/mcp/src/popcorn_mcp/config.py`).
- Tools: ONLY the MCP server's tools, via Strands' MCP client over Streamable HTTP. `MCP_URL` env,
  default `http://127.0.0.1:8000/mcp`. Do not copy the tool logic into the agent.
- Conversations: keep context per `conversation_id` (in memory is fine for now, behind a small
  interface so it can move to DynamoDB later; cap at the last ~20 messages; expire after 30 min idle).
- `speaker`: put it in the prompt so "me/I/my" map to that name.
- Voice: `/speak` uses Amazon Polly `SynthesizeSpeech` in `AWS_REGION` (eu-north-1), MP3 output,
  voice from `POLLY_VOICE` env (use ajan1's recommendation as the default; until it arrives use
  `Matthew` with the neural engine and fall back to the standard engine if neural is not supported).
  boto3 rules: one client created once, typed exceptions, no swallowing errors.
- Errors follow the contract (safe messages, no stack traces or keys to the client; log details server-side).

## System prompt (write it in `prompts.py`, tune it, keep it short)

The agent is "Popcorn", a friendly movie-night helper for a family living room, talking out loud.
- Replies are spoken: 1-2 short sentences, no lists, no markdown, no emojis, no URLs. The TV shows details.
- Always use the tools for couch, taste, picks, and watched movies; never invent movies or profiles.
- When someone says who is watching, call set_couch (or add/remove). If a person is new, suggest the poster
  duel on the TV (start_duel) for them, or ask what they like.
- When people state tastes ("I hate horror"), call update_taste.
- For picks, call recommend_for_couch, then say the top 2 titles with their short "why".
- When a child joins, say the list is now kid-safe.
- After a movie ("we watched X, Ayse loved it"), call mark_watched.
- If a tool returns an error, say the error message simply and suggest the next step.

## Test it

1. The MCP server is already running on port 8000 (see rules.md). Start your service.
2. With curl, run this conversation through `/chat` with one conversation id, and show the replies and steps:
   - speaker Bedirhan: "it's me and Ayse tonight"
   - "Ayse loves comedy and hates horror"
   - "I'm into sci-fi. What should we watch?"
   - "Can joined us, he's 8"
   - "We watched Back to the Future, Ayse loved it"
3. Same first message through `/chat/stream` with `curl -N`, show the raw events.
4. `/speak` with a short sentence; save to `/tmp/popcorn-speak.mp3` and report its size and the voice/engine used.
5. Add a few pytest tests that do not need the network (e.g. contract shape, SSE formatting, conversation store expiry).

Measure and report the latency of each `/chat` call. The demo needs answers in a few seconds; if it is
slow, say where the time goes (LLM vs tools).
