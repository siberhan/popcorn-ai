# ajan1: Research (Strands + OpenRouter + MCP, Polly, Lambda)

Read `briefs/rules.md` first. You change no project code. You produce facts that ajan2 (the agent
service) will build on, so be exact and quick. Target: finish in about 20 minutes.
Write results into `briefs/research-results.md` as soon as each section is ready (ajan2 reads it while
working), then your short report into `briefs/reports/ajan1.md`.

## How to research

- Make a scratch venv OUTSIDE the repo (e.g. `/tmp/popcorn-research`), `uv pip install strands-agents==1.61.1`
  (plus the extras the docs say are needed for OpenAI-compatible models and MCP), and read the installed
  source. The installed source is the truth; docs and blog posts come second.
- For every answer give: the source (file path in the installed package with line numbers, or URL),
  and a minimal code snippet you actually RAN (with its real output, keys never printed).
- Keys: load from the repo `.env` (`set -a; . ./.env; set +a` in the shell, never echo them).

## Questions

1. **Strands + OpenRouter.** Which Strands model provider class works with OpenRouter
   (`https://openrouter.ai/api/v1`, OpenAI-compatible)? Exact import, constructor arguments
   (base_url, api_key, model_id, params like max_tokens/temperature), and the pip extra needed.
   Run a one-tool round trip: an Agent with one `@tool` function (e.g. `add(a, b)`), model from
   `OPENROUTER_MODEL`, and show the tool was really called. This is "Smoke Test 2" of the project.
   If the model fails at tool calling, try one fallback model with tool support from
   `https://openrouter.ai/api/v1/models` (cheap one) and report it.
2. **Strands + our MCP server.** How does Strands connect to a remote MCP server over Streamable HTTP?
   Exact imports (`MCPClient`, the streamable HTTP client function from the `mcp` package),
   lifecycle (context manager? can one client stay open across many requests in a web server?
   thread-safety?), how to pass the tools into an Agent. Test it against our server: it is already running on port 8000
   (see rules.md), then list the tools and call `get_profiles` through a Strands agent.
   Note: our server is stateless and returns JSON (no SSE); check Strands is fine with that.
3. **Streaming events.** For `Agent.stream_async(...)` (or the current equivalent): what events/keys
   mark tool-call start (tool name + input), tool-call end (result, error status), and text deltas?
   Show a short real event dump from question 2's run (trim long values).
4. **Conversation memory.** How to keep multi-turn context per conversation id: reuse one Agent per
   conversation, or pass `messages`? What is the simplest safe pattern for a web server handling
   several conversations? Any built-in session manager (file / S3 / DynamoDB)?
5. **Amazon Polly in eu-north-1.** Run `aws polly describe-voices --region eu-north-1 --profile popcorn`
   and list English voices with their SupportedEngines (standard / neural / generative / long-form).
   Then call `synthesize-speech` once with a neural (or generative) en-US voice to prove it works in
   eu-north-1 (write the mp3 to /tmp, not to the repo). Recommend ONE voice that does not sound like
   Alexa (Alexa is a US female voice; prefer a warm male en-US or en-GB voice), and a fallback.
6. **Lambda later (short).** For Day 4 we will host the agent service on AWS Lambda in eu-north-1.
   Find: does AWS Lambda Web Adapter support response streaming (for our `/chat/stream` SSE) with a
   Function URL in `RESPONSE_STREAM` invoke mode, and what config it needs? Which Python runtimes does
   Lambda support today (is python3.14 available)? Sources only, no deployment.

Friction: any surprise with Strands, Polly, AWS CLI, or AWS docs goes into your report (rule 8).
