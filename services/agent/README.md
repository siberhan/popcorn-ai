# Popcorn AI Voice Agent Service (`services/agent`)

Popcorn AI voice agent service built with the Strands Agents SDK, OpenRouter LLM, Amazon Polly voice synthesis, and MCP tools over Streamable HTTP.

## Architecture

- **Framework**: Starlette + uvicorn
- **Agent Framework**: `strands-agents==1.61.1`
- **Model Provider**: `OpenAIModel` configured for OpenRouter (`OPENROUTER_MODEL`, default `openai/gpt-6-luna`)
- **Tools**: MCP server over Streamable HTTP (`MCP_URL`, default `http://127.0.0.1:8000/mcp`)
- **Voice Output**: Amazon Polly (`SynthesizeSpeech` in `eu-north-1`, default voice `Brian` with fallback to `Matthew`, `standard` engine)
- **Conversation State**: one running session per household in DynamoDB (`<household>:session` in `POPCORN_TABLE`, TTL 1 day, fresh after 3 h idle, doc kept under 300 KB). Without `POPCORN_TABLE` the session lives in memory.
- **Prompt**: static system prompt (`prompts.SYSTEM_PROMPT`); each user message starts with `[speaker: X] [tv: screen=..., asking=..., people=...]` read from the MCP `/api/state`.
- **Speech**: after every turn the reply is posted to the MCP `POST /api/speech` (the TV plays it); rating turns and empty replies only set the voice state idle.
- **Limits**: `MAX_TOOL_CALLS` (default 12) tool calls and `TURN_TIMEOUT` (default 60 s) per turn.

## Endpoints

- `GET /health`: Service health and active configuration
- `POST /chat`: JSON request/response agent conversation
- `POST /chat/stream`: Server-Sent Events (SSE) streaming
- `POST /event`: TV events (`duel_done`, `show_picks`, `app_opened`) as one turn
- `POST /session/new`: start a fresh household session, returns `{"id"}`
- `POST /speak`: Polly MP3 text-to-speech synthesis

## Running Locally

```bash
cd services/agent
uv run popcorn-agent
# in-memory session against a local MCP server on another port:
POPCORN_TABLE= PORT=8110 MCP_URL=http://127.0.0.1:8010/mcp uv run popcorn-agent
```

Or from the repository root:
```bash
cd services/agent && uv run pytest
```
