# ajan4: v2 phone microphone page, Day 6

Read `briefs/rules.md` and the "Phone page" and "Speech and voice" parts of `briefs/v2-contract.md`.
Hard rules 1-8 apply; your folder is `services/mcp/src/popcorn_mcp/static/phone/` only (plain
`index.html`, `app.js`, `styles.css`; no build step, no libraries). Report: `briefs/reports/ajan4-v2-phone.md`.
You may read `apps/alexa-web/app.js` for the Web Speech code that already works.

## Work

- Portrait phone layout: "Popcorn" wordmark (text only), "Who's talking?" chips from `household`
  (tap again to clear; remembered in localStorage, try/catch), one big round talk button in the
  middle (tap to start/stop, stops on ~1.5 s silence or `onend`), a one-line status
  ("Tap and talk", "Listening...", "Sent", "Popcorn is answering on the TV", errors in plain words),
  the last thing heard in small text. Dark, calm, large touch targets, respects safe areas.
- Speech: `SpeechRecognition || webkitSpeechRecognition`, `lang = 'en-US'`, interim results.
  Unsupported browser -> a short message and a text box + Send button fallback.
- Calls exactly as the contract (throttle interim posts to 4/s; final: voice thinking, then agent
  `/chat`; on agent error set voice idle and show the error). Agent URL from `?agent=`; API = `location.origin`.
- No audio playback, no Alexa wording, logos or blue/cyan light ring.

## Verify

Serve the folder with `python3 -m http.server 5180` and test in Playwright (Chromium, iPhone and
Pixel viewports) with mocked `/api/state`, `/api/voice`, and the agent `/chat` (inject a fake
SpeechRecognition to drive interim/final results). Check the request bodies and throttling.
Shots into `briefs/reports/ajan4-v2-phone-shots/`: idle, speaker chosen, listening with words, sent,
unsupported fallback. Open every PNG once.

Report: files, how to test, shots, open questions. End with `DONE`.
