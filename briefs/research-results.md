# Research Results: Strands + OpenRouter, MCP, Polly, Lambda

*Researched and verified by ajan1 on 2026-10-17 against `strands-agents==1.61.1`, MCP server (`services/mcp`), and AWS region `eu-north-1`.*

---

## 1. Strands + OpenRouter

### Provider Class & Imports
- **Class**: `OpenAIModel`
- **Import**: `from strands.models.openai import OpenAIModel` (or `from strands.models import OpenAIModel`)
- **Package extra**: `strands-agents[openai]==1.61.1` (installs `openai<3.0.0,>=1.68.0`)
- **Source**: `strands/models/openai.py` lines 47-140

### Constructor Arguments
```python
import os
from strands.models.openai import OpenAIModel

model = OpenAIModel(
    client_args={
        "api_key": os.environ["OPENROUTER_API_KEY"],
        "base_url": "https://openrouter.ai/api/v1",
    },
    model_id=os.environ.get("OPENROUTER_MODEL", "openai/gpt-4o-mini"),
    params={
        "max_tokens": 500,
        "temperature": 0.0,
    },
)
```
*Alternative with pre-configured client*:
```python
import openai
from strands.models.openai import OpenAIModel

client = openai.AsyncOpenAI(
    api_key=os.environ["OPENROUTER_API_KEY"],
    base_url="https://openrouter.ai/api/v1",
)
model = OpenAIModel(
    client=client,
    model_id=os.environ.get("OPENROUTER_MODEL", "openai/gpt-4o-mini"),
    params={"max_tokens": 500, "temperature": 0.0},
)
```

### Verified One-Tool Round Trip (Smoke Test 2)
Tested with `OPENROUTER_MODEL=openai/gpt-6-luna` and a custom `@tool add(a, b)`:
```python
from strands import Agent, tool
from strands.models.openai import OpenAIModel

@tool
def add(a: int, b: int) -> int:
    """Add two numbers together.

    Args:
        a: First number.
        b: Second number.
    """
    print(f"TOOL CALLED: add({a}, {b})")
    return a + b

agent = Agent(
    model=model,
    tools=[add],
    system_prompt="You are a helpful assistant. Always use tools to calculate math problems."
)

res = agent("What is 42 + 58?")
```
**Real output**:
```
Tool #1: add
TOOL CALLED: add(42, 58)
42 + 58 = 100.
AGENT RESULT: 42 + 58 = 100.
```
*Model tool-calling works reliably on `openai/gpt-6-luna`. Cheap fallback if needed: `openai/gpt-4o-mini`.*

---

## 2. Strands + our MCP Server

### Remote Connection over Streamable HTTP
- **Class**: `MCPClient` (`from strands.tools.mcp import MCPClient`)
- **Transport function under the hood**: `from mcp.client.streamable_http import create_mcp_http_client, streamable_http_client` (wrapped inside `strands.tools.mcp._compat.streamable_http_transport`).
- **Connection syntax**:
  ```python
  from strands.tools.mcp import MCPClient

  mcp_client = MCPClient(url="http://127.0.0.1:8000/mcp")
  ```
- **Passing into Agent**:
  `MCPClient` implements `ToolProvider`. Pass it directly into `Agent(tools=[mcp_client])`.

### Lifecycle, Web Server Sharing, & Critical Bug Workaround
- **Thread Model**: `MCPClient` runs an internal background thread with its own asyncio loop to manage the connection.
- **CRITICAL CAVEAT / BUG**:
  **Do NOT use `with mcp_client:` when passing `mcp_client` to `Agent(tools=[mcp_client])`.**
  - **Reason**: `__enter__()` calls `start()`, but fails to set `self._tool_provider_started = True`. When `Agent.__init__` runs, `load_tools()` sees `_tool_provider_started == False` and calls `start()` again, which raises:
    `strands.types.exceptions.MCPClientInitializationError: the client session is currently running`.
- **Recommended Pattern for Web Server (ajan2)**:
  1. Create a single `mcp_client = MCPClient(url=os.getenv("MCP_URL", "http://127.0.0.1:8000/mcp"))` during server lifespan startup.
  2. Pass `tools=[mcp_client]` to each `Agent` instance. The first agent automatically connects the client and caches the discovered tools.
  3. The same `mcp_client` can be shared across all conversations and multiple `Agent` instances.
  4. On server shutdown (lifespan exit), call `mcp_client.stop(None, None, None)`.

### Compatibility with Stateless JSON Response
- Our server returns JSON (`application/json`) rather than SSE. Strands and `mcp==2.1.1` handle this without any errors.
- Discovered 10 tools on `http://127.0.0.1:8000/mcp`:
  `set_couch`, `add_to_couch`, `remove_from_couch`, `get_profiles`, `update_taste`, `start_duel`, `record_duel_choice`, `recommend_for_couch`, `mark_watched`, `get_movie_details`.

### Verified Agent MCP Call (`get_profiles`)
```python
from strands import Agent
from strands.models.openai import OpenAIModel
from strands.tools.mcp import MCPClient

mcp_client = MCPClient(url="http://127.0.0.1:8000/mcp")
agent = Agent(
    model=model,
    tools=[mcp_client],
    system_prompt="You are Popcorn AI. Use tools when asked about household profiles."
)
response = agent("What profiles are available in the household? Use the get_profiles tool.")
```
**Real output**:
```
Tool #1: get_profiles
There are no profiles in the household yet.
Agent response:
 There are no profiles in the household yet.
```

---

## 3. Streaming Events (`Agent.stream_async`)

### Method Signature
```python
async for event in agent.stream_async(prompt):
    ...
```

### Event Types & Keys for API Contract
`agent.stream_async(...)` yields dictionary events:

| Contract Event | How to Detect in Strands | Key Fields to Extract |
|---|---|---|
| `start` | First event in stream or start of loop | `conversation_id` (managed by server) |
| `tool_start` | `event.get("event", {}).get("contentBlockStart", {}).get("start", {}).get("toolUse")` OR `event.get("message")` with `role == "assistant"` and `c.get("toolUse")` | `tool = toolUse["name"]`, `input = toolUse.get("input", {})` |
| `tool_end` | `event.get("message")` with `role == "user"` and `c.get("toolResult")` | `tool`: match by `toolUseId`, `ok = not toolResult.get("isError", False)`, calculate `ms` duration |
| `text` | `event.get("data")` is non-empty string OR `event.get("event", {}).get("contentBlockDelta", {}).get("delta", {}).get("text")` | `delta = event["data"]` |
| `done` | `event.get("result")` (instance of `AgentResult`) | `reply = event["result"].message["content"][0]["text"]` |

### Real Event Trace Sample (Trimmed)
```json
// 1. Tool Call Start:
{
  "role": "assistant",
  "content": [
    {
      "toolUse": {
        "toolUseId": "call_BTxSzo16AFG4yFTQRRREfEdv",
        "name": "get_profiles",
        "input": {
          "names": null
        }
      }
    }
  ]
}

// 2. Tool Call End:
{
  "role": "user",
  "content": [
    {
      "toolResult": {
        "status": "success",
        "toolUseId": "call_BTxSzo16AFG4yFTQRRREfEdv",
        "content": [
          {
            "text": "{\n  \"profiles\": []\n}"
          }
        ],
        "isError": false
      }
    }
  ]
}

// 3. Text Deltas:
{"data": "There"}
{"data": " are"}
{"data": " no"}
{"data": " profiles"}
{"data": " yet."}

// 4. Terminal Result:
AgentResult(
  stop_reason='end_turn',
  message={'role': 'assistant', 'content': [{'text': 'There are no profiles yet.'}]}
)
```

---

## 4. Conversation Memory

### Patterns Tested & Evaluated
1. **In-Memory Agent Registry (Recommended for Starlette service)**:
   ```python
   # Dictionary storing active Agent instances per conversation_id
   agents: dict[str, Agent] = {}
   ```
   - An `Agent` retains full conversation context in `agent.messages` automatically across successive calls: `res1 = agent(prompt1)`, `res2 = agent(prompt2)`.
   - Expire after 30 minutes of inactivity using a timestamp dictionary.
   - Cap history by trimming `agent.messages` to the last 20 messages if needed.
2. **Passing `messages` manually**:
   - `Agent(model=model, tools=[mcp_client], messages=stored_messages)`
   - After each turn, inspect `agent.messages` and persist them.
3. **Built-in Session Managers**:
   - `FileSessionManager(session_id=..., storage_dir=...)` from `strands.session`: writes JSON files under `~/.strands/sessions/session_<id>/`. Works across server restarts. *(Note: Must instantiate a fresh `FileSessionManager` per Agent, otherwise `SessionException: The agent_id of an agent must be unique in a session` is raised).*
   - `S3SessionManager(session_id=..., bucket=...)` from `strands.session`: persists session state in S3.
   - **DynamoDB**: **There is NO built-in DynamoDB session manager in Strands.**

### Note on OpenRouter Multi-Turn
When models emit `reasoningContent`, Strands automatically strips reasoning blocks from previous turns before sending to OpenRouter and logs:
`reasoningContent is not supported in multi-turn conversations with the Chat Completions API.`
Multi-turn works properly despite this log warning.

---

## 5. Amazon Polly in eu-north-1

### AWS CLI Voices Discovery
Command executed:
`aws polly describe-voices --region eu-north-1 --profile popcorn`

### CRITICAL FINDING: Engine Support in eu-north-1
- In `eu-north-1` (Stockholm), **ONLY the `standard` engine is supported**.
- There are **ZERO neural, generative, or long-form voices** available in `eu-north-1`.
- Testing `synthesize-speech --engine neural` in `eu-north-1` results in:
  `ValidationException: The selected engine is not supported in this region`

### English Voices in eu-north-1 (All `standard` Engine only)
- `en-US`:
  - `Matthew` (Male)
  - `Justin` (Male)
  - `Joey` (Male)
  - `Joanna` (Female)
  - `Salli` (Female)
  - `Kimberly` (Female)
  - `Kendra` (Female)
  - `Ivy` (Female)
- `en-GB`:
  - `Brian` (Male)
  - `Amy` (Female)
  - `Emma` (Female)
- `en-GB-WLS`: `Geraint` (Male)
- `en-AU`: `Russell` (Male), `Nicole` (Female)
- `en-IN`: `Aditi` (Female), `Raveena` (Female)

### Voice Recommendations for Popcorn AI
- **Primary Voice Recommendation**: **`Brian`** (`LanguageCode='en-GB'`, `Gender='Male'`, `Engine='standard'`).
  - Warm, clear, friendly British male voice.
  - Very distinct from Alexa (which is US female).
- **Fallback Voice Recommendation**: **`Matthew`** (`LanguageCode='en-US'`, `Gender='Male'`, `Engine='standard'`).
  - Standard US male voice.
- **Boto3 Implementation Snippet for ajan2**:
  ```python
  import boto3

  polly = boto3.client("polly", region_name="eu-north-1")
  resp = polly.synthesize_speech(
      Text="Welcome to Popcorn AI!",
      OutputFormat="mp3",
      VoiceId=os.getenv("POLLY_VOICE", "Brian"),
      Engine="standard",  # MUST be 'standard' in eu-north-1!
  )
  mp3_bytes = resp["AudioStream"].read()
  ```
- **Verified Synthesis**: Successfully synthesized speech to `/tmp/test_brian.mp3` and `/tmp/test_matthew.mp3` in `eu-north-1`.

---

## 6. AWS Lambda Deployment (Day 4 Reference)

### AWS Lambda Web Adapter (LWA) & Response Streaming
- **Does LWA support response streaming?**: **YES**.
- **Mechanism**: With a Lambda Function URL configured with `InvokeMode: RESPONSE_STREAM`, LWA uses Lambda's `InvokeWithResponseStream` API to stream HTTP chunked responses / Server-Sent Events (SSE) directly to the client without buffering.
- **Required Configuration**:
  1. Environment variable: `AWS_LWA_INVOKE_MODE: RESPONSE_STREAM`
  2. Environment variable: `AWS_LAMBDA_EXEC_WRAPPER: /opt/bootstrap`
  3. Function URL configuration: `InvokeMode: RESPONSE_STREAM`
  4. Layer: `arn:aws:lambda:eu-north-1:753240598075:layer:LambdaAdapterLayerArm64:<version>` (or x86_64 equivalent)
  5. Application: Standard FastAPI/Starlette `StreamingResponse(content, media_type="text/event-stream")`.

### Supported Python Runtimes
- Currently supported managed runtimes in AWS Lambda:
  - `python3.14` (supported on Amazon Linux 2023)
  - `python3.13` (supported on Amazon Linux 2023)
  - `python3.12` (supported on Amazon Linux 2023)
  - `python3.11` (supported on Amazon Linux 2)
  - `python3.10` (supported on Amazon Linux 2)
- Container base images available on ECR Public: `public.ecr.aws/lambda/python:3.14` and `public.ecr.aws/lambda/python:3.13`.
- **Is python3.14 available?**: **YES**, both as a managed runtime (`Runtime: python3.14`) and container base image.
