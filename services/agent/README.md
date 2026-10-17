# Popcorn AI Voice Agent Service (`services/agent`)

Popcorn AI voice agent service built with the Strands Agents SDK, OpenRouter LLM, Amazon Polly voice synthesis, and MCP tools over Streamable HTTP.

## Architecture

- **Framework**: Starlette + uvicorn
- **Agent Framework**: `strands-agents==1.61.1`
- **Model Provider**: `OpenAIModel` configured for OpenRouter (`OPENROUTER_MODEL`, default `openai/gpt-6-luna`)
- **Tools**: MCP server over Streamable HTTP (`MCP_URL`, default `http://127.0.0.1:8000/mcp`)
- **Voice Output**: Amazon Polly (`SynthesizeSpeech` in `eu-north-1`, default voice `Brian` with fallback to `Matthew`, `standard` engine)
- **Conversation State**: `InMemoryConversationStore` with 30-minute idle TTL and 20-message capping

## Endpoints

- `GET /health`: Service health and active configuration
- `POST /chat`: JSON request/response agent conversation
- `POST /chat/stream`: Server-Sent Events (SSE) streaming
- `POST /speak`: Polly MP3 text-to-speech synthesis

## Running Locally

```bash
cd services/agent
uv run popcorn-agent
```

Or from the repository root:
```bash
cd services/agent && uv run pytest
```
