# ajan3: Design + the "Simulated Alexa+" voice page (`apps/alexa-web`)

Read `briefs/rules.md` and `briefs/api-contract.md` first. You own the DESIGN of Popcorn AI.
This page will be on screen in the demo video next to the TV app, so it must look polished, calm, and
clearly "a living room movie night" product. ajan2 builds the backend in parallel; you build against
the contract, with a mock mode so you never wait for it.

## Part 1: Design system (do this first, ~20 min)

Create `apps/alexa-web/design/` with:
- `tokens.css`: CSS custom properties for colors, type scale, spacing, radius, shadows, motion
  (durations/easing). The TV app (React Native, later) will copy these values, so also write
  `tokens.json` with the same values.
- `DESIGN.md`: the visual direction in one page: mood, palette with hex values and where each is used,
  typography (Google Fonts only; one display + one text face), the voice orb states, motion rules,
  accessibility (contrast >= 4.5:1 for text), and "do not" rules.

Direction (you decide the details): a dark, warm "cinema at home" look. Deep night background, warm
popcorn/amber/cream accents, soft glow, big readable type (TV distance). It must NOT look like Alexa or
an Echo device: no cyan/blue light ring, no Alexa logo or colors, no Amazon smile. Person avatars are
simple colored circles with initials (color derived from the name), kids get a small "kid" badge.

## Part 2: The voice page

Plain HTML/CSS/JS in `apps/alexa-web/` (no build step, no framework; ES modules are fine; Google Fonts
is the only external resource). Files: `index.html`, `styles.css`, `app.js`, `config.js`.

Layout (desktop 1280x720 is what the video shows; it must also work at phone width):
- Header: product name "Popcorn AI" and, small and plain, the text label "Simulated Alexa+".
- Center: a large voice button/orb. States: idle, listening (live mic level or gentle pulse),
  thinking (agent working), speaking (audio playing), error. Space bar = push to talk.
- Live transcript of what the user is saying (interim results), then the conversation as bubbles.
- "Agent at work" panel: the tool steps from the stream appear live (`tool_start` -> spinner,
  `tool_end` -> check or cross with ms), with friendly labels (set_couch -> "Updating the couch",
  recommend_for_couch -> "Finding movies for everyone", etc.). This panel is a key demo moment.
- Optional small "TV preview" card that polls the TV state (see contract) and shows the couch members
  and the current screen (titles + match %). Use poster URLs only as `<img src>` from TMDB at runtime.
- A text input fallback (type instead of speak) and a "Who is talking?" name field (saved in localStorage).

Behavior:
- Speech to text: Web Speech API (`webkitSpeechRecognition`/`SpeechRecognition`), `en-US`, interim results.
  If not supported, show the text input only, with a short note.
- Remove a leading wake word from the transcript before sending: "alexa", "hey popcorn", "popcorn" (case-insensitive, with optional comma).
- Send to `POST {AGENT_URL}/chat/stream` with `speaker` and `conversation_id`; render events live.
  Parse SSE from `fetch` + `ReadableStream` (EventSource cannot POST).
- On `done`, call `POST {AGENT_URL}/speak` and play the MP3; orb shows "speaking"; a click stops it.
- "New night" button resets `conversation_id`.
- `config.js`: `AGENT_URL` (default `http://127.0.0.1:8100`) and `TV_STATE_URL`
  (default `http://127.0.0.1:8000/api/state`), both overridable with `?agent=` and `?tv=` query params.
- Mock mode `?mock=1`: no backend needed; fakes a realistic stream (start, 2 tool steps with delays,
  text deltas, done) and uses the browser's speechSynthesis instead of `/speak`. Build and polish
  everything in mock mode first.

## Test it

- Serve with `python3 -m http.server 5173` from `apps/alexa-web` and open `http://127.0.0.1:5173/?mock=1`.
- Check in Chrome: mic permission flow, all orb states, a long reply, an error event, phone width (375 px),
  keyboard only (Tab/Space/Enter). No console errors.
- Take screenshots of: idle, listening, agent at work, reply (desktop), and phone width. Save them in
  `briefs/reports/ajan3-shots/` (screenshots are fine there; never commit poster images in the app folder).
- When ajan2's service is up on port 8100 (check `GET /health`), test once against it for real.
