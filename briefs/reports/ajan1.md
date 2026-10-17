# Report: ajan1 (Research - Strands, OpenRouter, MCP, Polly, Lambda)

## 1. What was Built & Researched

Researched all 6 areas and published the complete reference document for ajan2 at:
- `briefs/research-results.md`

All tests were performed in a scratch virtual environment outside the repository at `/tmp/popcorn-research` with `strands-agents==1.61.1` and `openai==2.54.0`.

### Exact Commands to Verify

To reproduce the research findings:
```bash
# 1. Setup environment outside repo
uv venv /tmp/popcorn-research
uv pip install --python /tmp/popcorn-research/bin/python "strands-agents[openai]==1.61.1"

# 2. Test Strands + OpenRouter tool calling (Smoke Test 2)
# Ensure .env is populated with OPENROUTER_API_KEY and OPENROUTER_MODEL
/tmp/popcorn-research/bin/python -c '
import os
from strands import Agent, tool
from strands.models.openai import OpenAIModel

model = OpenAIModel(
    client_args={"api_key": os.environ["OPENROUTER_API_KEY"], "base_url": "https://openrouter.ai/api/v1"},
    model_id=os.environ.get("OPENROUTER_MODEL", "openai/gpt-4o-mini"),
    params={"max_tokens": 200, "temperature": 0.0}
)

@tool
def add(a: int, b: int) -> int:
    """Add numbers."""
    return a + b

agent = Agent(model=model, tools=[add])
print(agent("What is 42 + 58?"))
'

# 3. Test Strands + MCP Server on port 8000
/tmp/popcorn-research/bin/python -c '
import os
from strands import Agent
from strands.models.openai import OpenAIModel
from strands.tools.mcp import MCPClient

model = OpenAIModel(
    client_args={"api_key": os.environ["OPENROUTER_API_KEY"], "base_url": "https://openrouter.ai/api/v1"},
    model_id=os.environ.get("OPENROUTER_MODEL", "openai/gpt-4o-mini"),
)
mcp_client = MCPClient(url="http://127.0.0.1:8000/mcp")
agent = Agent(model=model, tools=[mcp_client])
print(agent("What profiles exist? Use get_profiles."))
mcp_client.stop(None, None, None)
'

# 4. Test Polly in eu-north-1
aws polly synthesize-speech \
  --region eu-north-1 \
  --profile popcorn \
  --voice-id Brian \
  --engine standard \
  --text "Hello from Popcorn AI" \
  --output-format mp3 /tmp/popcorn-test.mp3
```

---

## 2. Test Results & Real Output (Short)

1. **Strands + OpenRouter (`OPENROUTER_MODEL=openai/gpt-6-luna`)**:
   - Tool `add` executed successfully:
     ```
     Tool #1: add
     TOOL CALLED: add(42, 58)
     42 + 58 = 100.
     AGENT RESULT: 42 + 58 = 100.
     ```
2. **Strands + MCP Server (`http://127.0.0.1:8000/mcp`)**:
   - All 10 tools discovered: `set_couch`, `add_to_couch`, `remove_from_couch`, `get_profiles`, `update_taste`, `start_duel`, `record_duel_choice`, `recommend_for_couch`, `mark_watched`, `get_movie_details`.
   - Tool call to `get_profiles` succeeded and returned `{profiles: []}`.
   - MCP client reused successfully across multiple turns and multiple agent instances.
3. **Streaming Events (`stream_async`)**:
   - `contentBlockStart` / `message` event: detects `toolUse` with tool name and arguments.
   - `message` event with `toolResult`: captures tool outcome and `isError`.
   - `data` chunk: text delta.
   - `result`: terminal `AgentResult`.
4. **Conversation Memory**:
   - Multi-turn tested and working within `Agent` instance (`agent.messages` retained).
   - `FileSessionManager` tested and persists across instances when instantiated per agent.
5. **Polly in eu-north-1**:
   - Synthesized MP3 successfully with `Brian` (15 KB) and `Matthew` (15 KB) using `Engine='standard'`.

---

## 3. Decisions & Open Questions

1. **Polly Voice & Engine Selection**:
   - **Decision**: Set default `POLLY_VOICE` to `Brian` (en-GB, Male, standard engine) because it is warm, clear, and distinctly non-Alexa. Fallback is `Matthew` (en-US, Male).
   - **Critical Constraint**: `Engine='standard'` MUST be specified. Neural/generative engines do NOT exist in `eu-north-1`.
2. **MCPClient Lifecycle in Web Service**:
   - **Decision**: Avoid using Python's `with mcp_client:` context manager pattern. Create a single `MCPClient(url=...)` instance at server startup, pass `tools=[mcp_client]` to each `Agent`, and call `mcp_client.stop(None, None, None)` on server shutdown.
3. **Session Store for ajan2**:
   - **Decision**: Use an in-memory dictionary `dict[conversation_id, Agent]` with 30-minute idle TTL and message cap (last 20 messages). Strands has no built-in DynamoDB session manager.

---

## 4. Friction Log Entries (Rule 8)

### Friction 1: Strands `MCPClient` context manager conflicts with `Agent(tools=[...])`
- **Tool + version**: `strands-agents==1.61.1`
- **What tried**: Using standard documented context manager pattern:
  ```python
  mcp_client = MCPClient(url="http://127.0.0.1:8000/mcp")
  with mcp_client:
      agent = Agent(tools=[mcp_client])
  ```
- **Expected**: Agent initializes and uses the active MCP client session.
- **Actual**: `mcp_client.__enter__()` calls `start()`, but fails to set `self._tool_provider_started = True`. When `Agent.__init__` runs, `load_tools()` sees `_tool_provider_started == False` and attempts to call `start()` again. `start()` detects the session is already active and crashes.
- **EXACT error text**:
  ```
  strands.types.exceptions.MCPClientInitializationError: the client session is currently running
  ...
  ValueError: Failed to load tool <strands.tools.mcp.mcp_client.MCPClient object>: Failed to start MCP client: the client session is currently running
  ```
- **Workaround**: Do NOT use `with mcp_client:`. Pass `mcp_client` directly to `Agent(tools=[mcp_client])` and let `Agent.load_tools()` start it, or manually set `mcp_client._tool_provider_started = True`.

### Friction 2: Amazon Polly Neural engine unavailable in `eu-north-1`
- **Tool + version**: AWS CLI / Amazon Polly API in `eu-north-1`
- **What tried**: Synthesizing speech using `--engine neural` (e.g. `aws polly synthesize-speech --region eu-north-1 --voice-id Matthew --engine neural ...`).
- **Expected**: Neural voice synthesis succeeds or falls back.
- **Actual**: All 16 English voices in `eu-north-1` only support `standard`. Zero voices support `neural` or `generative`.
- **EXACT error text**:
  ```
  An error occurred (ValidationException) when calling the SynthesizeSpeech operation: The selected engine is not supported in this region
  ```
- **Workaround**: Must explicitly set `Engine="standard"` in boto3 Polly calls.

### Friction 3: `FileSessionManager` instance reuse raises `SessionException`
- **Tool + version**: `strands-agents==1.61.1`
- **What tried**: Passing the same `FileSessionManager` instance `sm` to multiple `Agent` instances sequentially to restore conversation state.
- **Expected**: New Agent restores session messages from `sm`.
- **Actual**: `AgentInitializedEvent` hook callback fails because `agent_id` is registered more than once in the same session manager instance.
- **EXACT error text**:
  ```
  strands.types.exceptions.SessionException: The `agent_id` of an agent must be unique in a session.
  ```
- **Workaround**: Instantiate a fresh `FileSessionManager(session_id=...)` object for each new `Agent` instance.

### Friction 4: Strands warning for Chat Completions API with reasoning models
- **Tool + version**: `strands-agents==1.61.1` (`strands.models.openai.OpenAIModel`)
- **What tried**: Multi-turn conversation with OpenRouter reasoning models (`openai/gpt-6-luna`).
- **Expected**: Silent handling of model output.
- **Actual**: SDK logs a warning to stderr:
  ```
  reasoningContent is not supported in multi-turn conversations with the Chat Completions API.
  ```
- **Workaround**: No code breaking; Strands filters out the `reasoningContent` blocks before sending to the model, but developers should be aware that this log line is expected.
