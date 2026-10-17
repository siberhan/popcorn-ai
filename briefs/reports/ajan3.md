# ajan3 Report — Popcorn AI Design System & Simulated Alexa+ Voice Page

## 1. What Was Built & How to Run

### Part 1: Design System (`apps/alexa-web/design/`)
- `apps/alexa-web/design/tokens.css`: CSS custom properties for the **"Cinema at Home"** palette (deep espresso night backgrounds `#0D0A08` / `#16110E` / `#1F1814`, buttery cream text `#FAF3E8` / `#D1C2B0` / `#9E8C78` with WCAG AA/AAA contrast >= 4.5:1, warm popcorn gold `#F5B942` and projector amber `#E8882D` accents, 5 voice orb state tokens, 8 deterministic warm person avatar colors, typography scale, 4px spacing scale, border radii, shadows/glows, and motion curves).
- `apps/alexa-web/design/tokens.json`: Exact same design token values in structured JSON format so the React Native Fire TV app (`apps/tv/`) can consume them directly.
- `apps/alexa-web/design/DESIGN.md`: One-page visual direction specification covering mood, hex palette and usage, Google Fonts pairing (`Fraunces` display + `Plus Jakarta Sans` text), the 5 voice orb states (`idle`, `listening`, `thinking`, `speaking`, `error`), motion rules, accessibility, and strict "do not" rules (no Alexa/Amazon logos or smile, no cyan/blue rings, no emojis, no committed poster images).

### Part 2: Simulated Alexa+ Voice Page (`apps/alexa-web/`)
- `apps/alexa-web/config.js`: Configurable `AGENT_URL` (`http://127.0.0.1:8100`, overridable via `?agent=`), `TV_STATE_URL` (`http://127.0.0.1:8000/api/state`, overridable via `?tv=`), `MOCK_MODE` (`?mock=1`), friendly labels and input formatters for all 10 MCP tools (`set_couch` -> `"Updating the couch"`, `recommend_for_couch` -> `"Finding movies for everyone"`, etc.), wake word stripper (`"alexa"`, `"hey popcorn"`, `"popcorn"`, case-insensitive with optional comma/punctuation), and deterministic name-to-color/initials avatar helpers.
- `apps/alexa-web/index.html`: Zero-build semantic HTML layout optimized for `1280x720` desktop video capture and `375px` mobile width. Includes header with `"Popcorn AI"` and plain `"Simulated Alexa+"` label, `"Who is talking?"` persisted input with live initial avatar, `"New night"` session reset button, central voice orb, live interim transcript bar, conversation log, text fallback composer, `"Agent at work"` live tool step panel, and `"TV preview"` card.
- `apps/alexa-web/styles.css`: Complete styling using `tokens.css`, custom keyframes for each orb state, reduced-motion support, and responsive breakpoints for tablet and `375px` phone widths.
- `apps/alexa-web/app.js`:
  - Web Speech API (`SpeechRecognition` / `webkitSpeechRecognition`, `en-US`, `interimResults: true`) with live Web Audio API microphone volume meter and automatic fallback note when unsupported.
  - Push-to-talk via `Space` bar (when not focused in a text input) or tap-to-talk on the orb.
  - Wake word stripping before dispatching to `POST {AGENT_URL}/chat/stream`.
  - Streaming SSE parser built on `fetch` + `ReadableStream` handling `start`, `tool_start`, `tool_end`, `text`, `done` (works with or without `text` deltas), and `error`.
  - Audio playback via `POST {AGENT_URL}/speak` (`audio/mpeg` MP3 from Amazon Polly) in live mode and `window.speechSynthesis` in `?mock=1` mode; clicking the orb or pressing `Space` during `speaking` immediately stops audio.
  - Live `GET {TV_STATE_URL}` polling every `1.5s` rendering couch member avatars (`KID` badge for children), poster duels, movie details, and recommendations using runtime TMDB poster URLs.

### Exact Commands to Run
```bash
# Serve the voice page on port 5173
cd apps/alexa-web && python3 -m http.server 5173 --bind 127.0.0.1

# Open in Mock Mode (no backend required):
# http://127.0.0.1:5173/?mock=1

# Open in Live Mode (talks to agent on :8100 and polls TV state on :8000):
# http://127.0.0.1:5173/
```

---

## 2. How It Was Tested & Real Output

### A. Mock Mode (`?mock=1`) & Screenshot Verification in Headless Chrome
Tested via Chrome DevTools Protocol (`1280x720` desktop and `375x812` phone width) verifying all 5 orb states (`idle`, `listening`, `thinking`, `speaking`, `error`), wake word stripping, `Space` push-to-talk, click-to-stop speaking, long reply wrapping, error banner, `"New night"` session reset, and zero console errors:
```text
Initial check: {"title":"Popcorn AI — Simulated Alexa+","orbState":"idle","modeBadge":"Mock Mode (?mock=1)","simulatedLabel":"Simulated Alexa+","speaker":"Bedirhan"}
Listening state after Space keydown: listening
Agent at work check: {"orbState":"thinking","stepStatuses":[{"tool":"set_couch","status":"done","label":"Updating the couch","sub":"Bedirhan, Ayse, Can (kid)","ms":"412 ms"},{"tool":"recommend_for_couch","status":"running","label":"Finding movies for everyone","sub":"Mood: comedy","ms":"running..."}]}
Reply desktop check: {"orbState":"speaking","conversationId":"Session: c_mock_94e2a1","bubbles":["Bedirhan · wake word removed it's me, Ayse, and 9-year-old Can tonight. Find something funny for all of us.","Popcorn AI All set — Bedirhan, Ayse, and Can are on the couch with kid-safe mode on. Top picks on the TV are Luca at 96% match and Paddington 2 at 94% match."],"steps":[{"tool":"set_couch","status":"done","ms":"412 ms"},{"tool":"recommend_for_couch","status":"done","ms":"576 ms"}],"tvMembers":["BE Bedirhan","AY Ayse","CA Can KID"],"tvScreen":"PICKS","tvMovies":["Luca(2021)","Paddington 2(2017)","Coco(2017)"]}
Orb state after click-to-stop speaking: idle
Long reply character length: 404
Error state check: {"orbState":"error","errorBannerHidden":false,"errorText":"The movie database is not answering right now. Try again in a moment.","failedStepStatus":"error"}
After New Night reset: {"orbState":"idle","sessionPill":"Session: new night"}
Console errors count: 0
```

Screenshots saved in `briefs/reports/ajan3-shots/`:
- `briefs/reports/ajan3-shots/idle.png`
- `briefs/reports/ajan3-shots/listening.png`
- `briefs/reports/ajan3-shots/agent-at-work.png`
- `briefs/reports/ajan3-shots/reply-desktop.png`
- `briefs/reports/ajan3-shots/phone-375px.png`

### B. Live End-to-End Integration Test Against Port 8100 (`services/agent`) & Port 8000 (`services/mcp`)
Checked `GET http://127.0.0.1:8100/health` and ran a full live turn from `http://127.0.0.1:5173/` without `?mock=1`:
```json
Live header: {"modeBadge":"Live · Brian","modeAttr":"live"}
Live end-to-end result: {
  "orbState": "speaking",
  "session": "Session: c_e58577838edb",
  "reply": "Hoppers is a great fit: it mixes comedy with science fiction, which you both enjoy. Despicable Me is another fun comedy with a sci-fi twist.",
  "steps": [
    {
      "tool": "set_couch",
      "label": "Updating the couch",
      "status": "done",
      "ms": "694 ms"
    },
    {
      "tool": "recommend_for_couch",
      "label": "Finding movies for everyone",
      "status": "done",
      "ms": "939 ms"
    }
  ],
  "tvScreen": "PICKS",
  "tvMembers": [
    "BE Bedirhan",
    "AY Ayse"
  ],
  "tvMovies": [
    "Hoppers(2026)",
    "Despicable Me(2010)",
    "Runner(2026)",
    "The Love Hypothesis(2026)"
  ]
}
Live console errors: 0
```

---

## 3. Limitations, Open Questions & Decisions Made

- **Decisions Made**:
  - **Typography**: Selected `Fraunces` (optical-size warm serif display face) paired with `Plus Jakarta Sans` (clean geometric sans text face) from Google Fonts to evoke a warm cinema marquee feel while maintaining high legibility at both handheld and 10-foot Fire TV distances.
  - **Quick Demo Chips**: Added 4 subtle one-click sample utterance chips (`Family couch + picks`, `Poster duel`, `Long reply`, `Test error`) in the conversation header so the demo video presenter can trigger voice-equivalent turns reliably even in environments without a live microphone.
  - **Poster Fallback Layer**: Rendered a warm typographic fallback badge underneath every runtime TMDB `<img>` so the TV preview card looks complete immediately while images load or if offline.
  - **Immediate TV Refresh on `tool_end`**: In addition to the `1.5s` background poll of `GET /api/state`, `app.js` triggers an immediate poll whenever a `tool_end` or `done` SSE event arrives so the TV preview updates with zero perceived lag.
- **What Does Not Work Yet / Browser Caveats**:
  - Web Speech API (`webkitSpeechRecognition`) in desktop Chrome requires microphone permission and an active audio input device; when denied or run in unsupported browsers (e.g., Firefox/Safari without flags), the page automatically displays the fallback notice and focuses on the text composer.
  - Browser autoplay policies can block `HTMLAudioElement.play()` on `/speak` if the page has not received a prior user gesture (click or keypress); normal usage (clicking the orb, clicking a prompt chip, or pressing `Space`/`Enter`) satisfies the user-gesture requirement.

---

## 4. Friction Entries

None encountered in `apps/alexa-web` (frontend-only scope; Amazon Polly audio bytes from `POST /speak` decoded and played cleanly via standard `audio/mpeg` Blob URLs in Chrome).
