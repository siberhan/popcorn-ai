# API contract: voice page <-> agent service

The voice page (`apps/alexa-web`, ajan3) talks only to the agent service (`services/agent`, ajan2).
The agent service talks to the MCP server. Both sides build against this contract in parallel.
Do not change it on your own; if something is missing, write it in your report.

Base URL (local): `http://127.0.0.1:8100`. CORS: allow all origins, methods GET/POST/OPTIONS,
header Content-Type. All JSON is UTF-8.

## GET /health

`200 {"ok": true, "model": "<OPENROUTER_MODEL>", "mcp": "<MCP_URL>", "voice": "<Polly voice id>"}`

## POST /chat  (simple, non-streaming)

Request:
```json
{"text": "it's me and Ayse tonight", "speaker": "Bedirhan", "conversation_id": null}
```
- `text` (required): what the user said, wake word already removed by the page.
- `speaker` (optional): name of the person talking. The agent uses it for "me", "I", "my".
- `conversation_id` (optional): send back the id from the last answer to keep context. `null` starts a new one.

Response `200`:
```json
{
  "conversation_id": "c_8f3a...",
  "reply": "Got it, Bedirhan and Ayse are on the couch. Ayse is new, so let's do a quick poster duel on the TV.",
  "steps": [
    {"tool": "set_couch", "input": {"people": [{"name": "Bedirhan"}, {"name": "Ayse"}]}, "ok": true, "ms": 412},
    {"tool": "start_duel", "input": {"name": "Ayse"}, "ok": true, "ms": 980}
  ],
  "ms_total": 1392
}
```
- `reply`: short, spoken style, 1-2 sentences (the TV shows the details).
- `steps`: every MCP tool call in order. `ok` false when the tool returned an error.
- `ms_total`: wall time of the whole turn in milliseconds.

Errors: `400 {"error": "..."}` for bad input, `502 {"error": "..."}` when the LLM or MCP server fails.
The `error` text is safe to show to the user (no stack traces, no keys).

## POST /chat/stream  (what the page uses)

Same request body as `/chat`. Response: `text/event-stream`. Each event is one line
`data: <json>` followed by a blank line. Event objects:

| type | fields | when |
|---|---|---|
| `start` | `conversation_id` | first event |
| `tool_start` | `tool`, `input` | a tool call begins |
| `tool_end` | `tool`, `ok`, `ms` | that tool call ends |
| `text` | `delta` | a piece of the reply text |
| `done` | `reply` (full text), `conversation_id`, `ms_total` | last event on success |
| `error` | `error` | last event on failure |

The page must work even if no `text` deltas arrive (it then uses `done.reply`).

## POST /speak

Request: `{"text": "..."}` (max 1500 characters). Response: `200 audio/mpeg` (MP3 bytes from Amazon Polly).
`400 {"error": ...}` for empty/too long text, `502 {"error": ...}` if Polly fails.

## TV state (read-only, optional for the page)

The page may show a small "TV screen" preview by polling the MCP server's
`GET http://127.0.0.1:8000/api/state` every 1.5 s. Useful fields: `version`, `screen`
(`couch` | `duel` | `recommendations` | `details`), `members[].name`, `members[].kid`,
`recommendations[]` (`title`, `year`, `match`, `why`, `poster`), `duel` (`name`, `round`, `total`, `pair[]`),
`details`, `message`. Make the URL configurable like the agent URL.
