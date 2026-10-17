# Report: ajan2 (Agent Service)

## 1. What was built

Implemented the complete Popcorn AI voice agent service in `services/agent/` conforming to `briefs/api-contract.md`:
- `services/agent/pyproject.toml`: uv project definition pinning `strands-agents[openai]==1.61.1`, `openai==2.54.0`, `starlette==1.8.0`, `uvicorn==0.54.0`, `boto3==1.43.114`, `httpx==0.28.1`, `sse-starlette==3.5.0`, dev dependencies `pytest`, `botocore[crt]`.
- `services/agent/src/popcorn_agent/config.py`: Environment loader (`.env` root resolution) and typed settings (`Settings`).
- `services/agent/src/popcorn_agent/prompts.py`: Living-room movie-night system prompt with speaker mapping ("I/me" -> speaker name) and spoken conversational constraints (short 1-2 sentences, no markdown, no emojis, no URLs).
- `services/agent/src/popcorn_agent/store.py`: `ConversationStore` interface and `InMemoryConversationStore` with 30-minute idle TTL expiration and 20-message capping.
- `services/agent/src/popcorn_agent/polly.py`: `PollySpeaker` with single boto3 client instance, input validation (1-1500 chars), neural engine attempt falling back to standard engine, and typed exceptions.
- `services/agent/src/popcorn_agent/agent.py`: `PopcornAgentService` integrating Strands Agents SDK `Agent`, OpenRouter `OpenAIModel`, and `MCPClient`. Real-time tool execution tracking hook for synchronous `/chat` steps and streaming `/chat/stream` SSE events.
- `services/agent/src/popcorn_agent/server.py`: Starlette application with CORS (`*`), implementing `GET /health`, `POST /chat`, `POST /chat/stream` (SSE), `POST /speak` (MP3).
- `services/agent/tests/test_store.py`: Offline unit tests for conversation storage, TTL expiration, and message capping.
- `services/agent/tests/test_server.py`: Offline unit tests for all API endpoints, input validation, SSE event stream format, and error handling.
- `services/agent/README.md`: Service overview, architecture, and exact run commands.

### How to run it

Run automated unit tests:
```bash
cd services/agent
uv run pytest
```

Start the service locally on port 8100:
```bash
cd services/agent
uv run popcorn-agent
```
(MCP server is expected at `http://127.0.0.1:8000/mcp`).

---

## 2. Test Results

### Unit Tests
```
cd services/agent && uv run pytest -v
============================= test session starts ==============================
13 passed in 9.25s
```
All 13 offline tests passed (health endpoint, input validation, conversation capping, TTL expiry, mock streaming SSE formatting, Polly audio generation, and 400/502 error codes).

### Health Check
```bash
curl -s http://127.0.0.1:8100/health
```
Output:
```json
{"ok":true,"model":"openai/gpt-6-luna","mcp":"http://127.0.0.1:8000/mcp","voice":"Brian"}
```

### Voice Synthesis (`/speak`)
```bash
curl -s -D - -X POST http://127.0.0.1:8100/speak \
  -H "Content-Type: application/json" \
  -d '{"text": "Welcome to Popcorn AI, what would you like to watch tonight?"}' \
  -o /tmp/popcorn-speak.mp3
```
Output:
```http
HTTP/1.1 200 OK
content-disposition: inline; filename="speak.mp3"
x-polly-voice: Brian
x-polly-engine: standard
content-length: 22143
content-type: audio/mpeg
```
- Saved to: `/tmp/popcorn-speak.mp3`
- Size: 22,143 bytes (~22 KB)
- Voice used: `Brian` (en-GB, Male)
- Engine used: `standard` (neural is not supported in `eu-north-1`)

### Multi-turn Conversation (`/chat`)
Ran full 5-turn living-room conversation with single conversation id `c_f9a70099dbcf`:

#### Turn 1: speaker Bedirhan: "it's me and Ayse tonight"
- Response:
  ```json
  {
    "conversation_id": "c_f9a70099dbcf",
    "reply": "Got it, Bedirhan and Ayse are on the couch tonight. You’re both new here—what genres do you each enjoy, or would you like a quick poster duel on the TV?",
    "steps": [
      {
        "tool": "set_couch",
        "input": {"people": [{"name": "Bedirhan", "age": null, "kid": null}, {"name": "Ayse", "age": null, "kid": null}]},
        "ok": true,
        "ms": 2312
      }
    ]
  }
  ```
- Latency: 8.13s (Tool: 2312ms, LLM: 5818ms)

#### Turn 2: "Ayse loves comedy and hates horror"
- Response:
  ```json
  {
    "conversation_id": "c_f9a70099dbcf",
    "reply": "Got it—Ayse loves comedy, and I’ll keep horror off her picks. Bedirhan, what genres do you enjoy?",
    "steps": [
      {
        "tool": "update_taste",
        "input": {"name": "Ayse", "loves": ["comedy"], "likes": null, "dislikes": null, "hates": ["horror"], "note": null},
        "ok": true,
        "ms": 413
      }
    ]
  }
  ```
- Latency: 3.49s (Tool: 413ms, LLM: 3077ms)

#### Turn 3: "I'm into sci-fi. What should we watch?"
- Response:
  ```json
  {
    "conversation_id": "c_f9a70099dbcf",
    "reply": "Back to the Future is a great fit, blending sci-fi and comedy for both of you. Deadpool & Wolverine is another sci-fi comedy pick that matches both your tastes.",
    "steps": [
      {
        "tool": "update_taste",
        "input": {"name": "Bedirhan", "loves": ["sci-fi"], "likes": null, "dislikes": null, "hates": null, "note": null},
        "ok": true,
        "ms": 346
      },
      {
        "tool": "recommend_for_couch",
        "input": {"boost_genres": ["sci-fi", "comedy"], "limit": 6},
        "ok": true,
        "ms": 2308
      }
    ]
  }
  ```
- Latency: 8.91s (Tools: 2654ms, LLM: 6256ms)

#### Turn 4: "Can joined us, he's 8"
- Response:
  ```json
  {
    "conversation_id": "c_f9a70099dbcf",
    "reply": "Can’s joined, so the picks are now kid-safe. Back to the Future and Hoppers both blend sci-fi and comedy for the group.",
    "steps": [
      {
        "tool": "add_to_couch",
        "input": {"name": "Can", "age": 8, "kid": null},
        "ok": true,
        "ms": 4351
      }
    ]
  }
  ```
- Latency: 12.33s (Tool: 4351ms, LLM: 7979ms)
*(Note: Hoppers automatically replaced Deadpool & Wolverine on TV recommendations to ensure kid-safety)*.

#### Turn 5: "We watched Back to the Future, Ayse loved it"
- Response:
  ```json
  {
    "conversation_id": "c_f9a70099dbcf",
    "reply": "Nice, I’ve marked Back to the Future as watched for everyone. Glad Ayse loved it!",
    "steps": [
      {
        "tool": "mark_watched",
        "input": {"movie": "Back to the Future", "reactions": null, "who": null},
        "ok": true,
        "ms": 3257
      }
    ]
  }
  ```
- Latency: 8.75s (Tool: 3257ms, LLM: 5493ms)

### Streaming Test (`/chat/stream`)
Command:
```bash
curl -N -s -X POST http://127.0.0.1:8100/chat/stream \
  -H "Content-Type: application/json" \
  -d '{"text": "it'\''s me and Ayse tonight", "speaker": "Bedirhan", "conversation_id": null}'
```
Real raw SSE output:
```
data: {"type": "start", "conversation_id": "c_ab71aa450c1a"}

data: {"type": "tool_start", "tool": "set_couch", "input": {"people": [{"name": "Bedirhan", "age": null, "kid": null}, {"name": "Ayse", "age": null, "kid": null}]}}

data: {"type": "tool_end", "tool": "set_couch", "ok": true, "ms": 697}

data: {"type": "text", "delta": "Great"}

data: {"type": "text", "delta": ","}

data: {"type": "text", "delta": " it"}

data: {"type": "text", "delta": "’s"}

data: {"type": "text", "delta": " you"}

data: {"type": "text", "delta": " and"}

data: {"type": "text", "delta": " Ay"}

data: {"type": "text", "delta": "se"}

data: {"type": "text", "delta": " tonight"}

data: {"type": "text", "delta": "."}

data: {"type": "text", "delta": " Want"}

data: {"type": "text", "delta": " me"}

data: {"type": "text", "delta": " to"}

data: {"type": "text", "delta": " find"}

data: {"type": "text", "delta": " a"}

data: {"type": "text", "delta": " movie"}

data: {"type": "text", "delta": " for"}

data: {"type": "text", "delta": " you"}

data: {"type": "text", "delta": " both"}

data: {"type": "text", "delta": "?"}

data: {"type": "done", "reply": "Great, it’s you and Ayse tonight. Want me to find a movie for you both?", "conversation_id": "c_ab71aa450c1a"}
```

### Latency Analysis
- Where the time goes:
  - **MCP / TMDB tool calls**: 350ms to 4300ms. Calls that trigger TMDB discovery (`recommend_for_couch`, `add_to_couch` with children filtering, `mark_watched`) take 2-4 seconds. Lightweight state updates (`update_taste`) take ~350-400ms.
  - **OpenRouter LLM calls (`openai/gpt-6-luna`)**: 3 to 7 seconds per turn, including tool selection turn and final answer generation turn.
  - **Total roundtrip**: Simple turns complete in ~3.5s; turns with multi-tool calling and movie recommendations complete in ~8-12s.
  - **Streaming impact**: In `/chat/stream`, `start` and `tool_start` arrive within ~700ms, giving immediate visual feedback in the UI while the tool and final text are being processed.

---

## 3. Decisions & Open Questions

- **Default Voice**: Selected `Brian` (en-GB, standard engine) as primary per ajan1's recommendation and verified zero-neural availability in `eu-north-1`. Fallback is `Matthew`.
- **MCP Client lifecycle**: Avoided using `with mcp_client:` block because `strands-agents` internal `Agent` initialization calls `mcp_client.load_tools()`, which raises an exception if the session was already manually entered via `with`. Initializing `mcp_client` once and letting `Agent(tools=[mcp_client])` manage the connection lifecycle resolves this cleanly and supports multi-turn requests across instances.
- **Conversation State**: `InMemoryConversationStore` stores context per `conversation_id`, auto-prunes turns older than 30 minutes, and keeps the last 20 messages. A clean interface is maintained for migration to DynamoDB on Day 4.

---

## 4. Friction Entries

### 1. Polly Neural Engine Not Supported in `eu-north-1`
- **Tool / version**: Amazon Polly, AWS CLI 2.38.1, boto3 1.43.114
- **What tried**: Synthesizing speech with `Engine="neural"` in `eu-north-1` using voice `Matthew` and `Brian`.
- **Expected vs Actual**: Expected neural voice synthesis. Actual:
  `ValidationException: The selected engine is not supported in this region`
  Running `aws polly describe-voices --region eu-north-1 --engine neural` returns 0 voices.
- **Workaround**: Enforce `Engine="standard"` with the warm `Brian` voice.

### 2. `botocore[crt]` Required for AWS Login Credential Provider
- **Tool / version**: boto3 1.43.114, botocore 1.43.114
- **What tried**: Running `boto3.Session(profile_name="popcorn").client("polly")` in clean venv.
- **Expected vs Actual**: Expected credentials from `aws login` profile to work out of the box. Actual:
  `botocore.exceptions.MissingDependencyException: Missing Dependency: Using the login credential provider requires an additional dependency. You will need to pip install "botocore[crt]" before proceeding.`
- **Workaround**: Added `botocore[crt]` to `[dependency-groups] dev` and installed in environment.

---

## 5. Fixes (Review Follow-up)

### 1. Tool-Pair Safe History Capping (Bug Fix)
- **Problem**: `InMemoryConversationStore.save_messages` previously took `messages[-20:]`. A truncation could slice between an assistant `toolUse` and a user `toolResult`, leaving the history starting with an orphan `toolResult`.
- **Solution**: Added `_is_plain_user_message` helper in `services/agent/src/popcorn_agent/store.py`. After slicing to the last 20 messages, leading items are discarded until the first message is a clean user text message (`role == "user"` with no `toolResult` blocks).
- **Test**: Added `test_tool_pair_safe_truncation_24_messages` in `tests/test_store.py` with 24 messages and tool pairs. Verified that the saved history drops orphan tool results and starts cleanly at a user prompt.

### 2. Reactions in `mark_watched` (Prompt & Tool Hook Fix)
- **Problem**: In previous turns, `mark_watched` received `reactions: null` or `{}`.
- **Solution**:
  - In `services/agent/src/popcorn_agent/prompts.py`, made the rule explicit: `reactions` must be a dictionary mapping the person's name to one of `loved`, `liked`, `meh`, `disliked`, `hated`, using the speaker's name for "I/me".
  - In `services/agent/src/popcorn_agent/agent.py`, added `extract_reactions` and pre-tool inspection in `_StepCollectorHook` and `_QueueStreamingHook` (`BeforeToolCallEvent`) so `mark_watched` always receives the populated reaction mapping.
- **Live Test Output**:
  Ran live `/chat/stream` turn with `{"text": "we watched Hoppers, I loved it", "speaker": "Ayse"}`:
  ```json
  "tool_start": {
    "tool": "mark_watched",
    "input": {
      "movie": "Hoppers",
      "reactions": {"Ayse": "loved"},
      "who": ["Ayse"]
    }
  }
  ```
  Spoken response: `"Got it, Ayse—saved that you watched Hoppers and loved it."`

### 3. Polly Engine Configuration (No Neural Attempt)
- **Problem**: In `eu-north-1`, neural voices are unavailable; attempting neural first wasted one failed HTTP request per call.
- **Solution**: Added `polly_engine: str` (default `"standard"`, configurable via `POLLY_ENGINE`) to `Settings`. `PollySpeaker` now synthesizes speech in a single call using the configured engine directly. Kept the 1500-char validation.

### 4. Latency Numbers (`ms_total`)
- Added `ms_total` (wall time of the entire turn in milliseconds) to both the `/chat` JSON response and the `/chat/stream` `done` SSE event.
- Updated `briefs/api-contract.md` only in the `/chat` response example and the `done` event row.
- Updated unit test assertions in `tests/test_server.py`.

### 5. Verification & Service Restart
- Service restarted and running on port 8100 (`uv run popcorn-agent`).
- All 14 tests pass: `uv run pytest` (14 passed in 1.38s).

---

## 6. Fix 2 rework

### Summary of Changes
- Completely removed `extract_reactions` and both `BeforeToolCallEvent` mutation callbacks that rewrote `mark_watched` tool input from `services/agent/src/popcorn_agent/agent.py`. The hooks now exclusively track and stream raw events without modifying input.
- Removed speaker and prompt arguments previously added to the hook initializers.
- Identified root cause for `reactions: null`: FastMCP in `popcorn_mcp` generates `anyOf: [{"type": "object", ...}, {"type": "null"}]` for optional Python typing (`| None = None`). OpenRouter's constrained grammar sampler for `openai/gpt-6-luna` greedily collapses `anyOf: [X, null]` to `null`.
- Added tool schema normalization in `_get_tools()` (`agent.py`) which unwraps `anyOf: [X, {"type": "null"}]` into `X` (preserving `title` and `default: None`).
- In `services/agent/src/popcorn_agent/prompts.py`, structured the system prompt with explicit speaker identity at top and few-shot JSON argument templates for single-person, multi-person, and no-opinion watched movie calls.
- The model now autonomously populates `reactions` with zero regex and zero code-level overrides.

### Live `/chat/stream` Test Results (speaker: Ayse)

#### Turn (a): "we watched Spider-Man: Into the Spider-Verse, I loved it"
Exact `mark_watched` `tool_start` input:
```json
{
  "movie": "Spider-Man: Into the Spider-Verse",
  "reactions": {
    "Ayse": "loved"
  }
}
```
Spoken response: `"Got it—Spider-Man: Into the Spider-Verse is marked watched, and I’ve saved that you loved it."` (Total: 6684ms)

#### Turn (b): "we watched WALL·E, Bedirhan thought it was meh but I loved it"
Exact `mark_watched` `tool_start` input:
```json
{
  "movie": "WALL·E",
  "reactions": {
    "Bedirhan": "meh",
    "Ayse": "loved"
  }
}
```
Spoken response: `"Got it: you loved WALL·E, and Bedirhan thought it was meh."` (Total: 6145ms)

#### Turn (c): "we finished Transformers One"
Exact `mark_watched` `tool_start` input:
```json
{
  "movie": "Transformers One",
  "reactions": null
}
```
Spoken response: `"Got it—we’ve marked Transformers One as watched."` (Total: 5443ms)

### Verification
- `uv run pytest` in `services/agent`: 14 passed in 1.23s.
- `popcorn-agent` running and healthy on port 8100.

REWORK DONE
