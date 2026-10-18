# ajan4 report: v2 phone microphone page

## Files
`services/mcp/src/popcorn_mcp/static/phone/` : `index.html`, `app.js`, `styles.css` (plain, no build, no libraries).

## Behavior
- Wordmark, "Who's talking?" chips from `GET {origin}/api/state` `household[].name` (tap again clears; stored in localStorage key `popcorn.phone.speaker`, try/catch; hidden if no household or fetch fails).
- One round talk button: tap starts, tap stops; also stops after 1.5 s without a result, or on `onend`.
- Status line: Tap and talk / Listening... / Sent / Popcorn is answering on the TV (back to Tap and talk after 5 s) / plain-word errors (mic blocked, no connection, agent unreachable, missing `?agent=`, nothing heard).
- Interim text -> `POST /api/voice {state:"listening",text,speaker?}` throttled to 4/s (leading + trailing, newest wins); one initial post with empty text on start.
- Final -> `POST /api/voice {state:"thinking",text,speaker?}` then `POST {agent}/chat {text,speaker?}`. On any failure -> `POST /api/voice {state:"idle"}` and the error is shown. Empty result -> idle post and "Didn't catch that".
- No SpeechRecognition -> mic button hidden, text box + Send (same final path).
- No audio, no Alexa wording/logos; amber on dark, no blue/cyan.

## How to test
`cd services/mcp/src/popcorn_mcp/static/phone && python3 -m http.server 5180`, open `http://localhost:5180/index.html?agent=http://127.0.0.1:8001` (needs `/api/state`, `/api/voice` on the same origin, so for the real flow open it via the MCP server at `/phone/?agent=...` once ajan2 serves it).
Playwright (python3.11 at /opt/homebrew, Chromium, iPhone 14 and Pixel 7) with routed `/api/state`, `/api/voice`, agent `/chat` and a fake SpeechRecognition.

## Results
- 5 interim events within 200 ms produced 2 listening posts (+1 initial), gaps 252 ms and 251 ms (<= 4/s). Same on Pixel.
- Bodies seen: `{"state":"listening","text":"","speaker":"Leyla"}`, `{"state":"listening","text":"show me something funny please","speaker":"Leyla"}`, `{"state":"thinking","text":"show me something funny please","speaker":"Leyla"}`, chat `{"text":"show me something funny please","speaker":"Leyla"}`.
- Silence stop worked (final result, no tap, page sent after ~1.5 s). Chip toggle and localStorage verified.
- Fallback: `{"state":"thinking","text":"what should we watch"}` then chat `{"text":"what should we watch"}`.
- Not tested on real iOS Safari / Android Chrome (no device); the real SpeechRecognition was not exercised, only a fake.

## Shots (`briefs/reports/ajan4-v2-phone-shots/`, all opened)
idle, speaker, listening, sent, unsupported (iPhone); pixel-idle/speaker/listening/sent. The "sent" shot was taken after the mocked chat returned, so it shows "Popcorn is answering on the TV" (the brief "Sent" text is shown only while the request is in flight).

## Open questions / notes
- The fallback screen shows two similar lines ("Voice is not supported here" and "Voice is not available in this browser. Type instead."); harmless, can trim.
- iOS Safari needs HTTPS (or localhost) for the microphone; the phone page served from a LAN `http://` MCP address will not get mic permission. Needs HTTPS or a tunnel for the demo. This is the main risk.
- `chat` is called cross-origin from the MCP origin: agent CORS must allow it (contract says CORS as now).
- Friction entries: none.

DONE
