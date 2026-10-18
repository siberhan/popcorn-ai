# ajan4 report: voice page drives rating questions and "why" narration (Day 5)

## What changed (only `apps/alexa-web/`)

- `config.js`: `MCP_BASE_URL` (derived from `?tv=` / `TV_STATE_URL` by dropping `/api/state`),
  `TV_POLL_FAST_MS = 1000`, `RATING_SILENCE_MS = 8000`, `RATING_LIVE_THROTTLE_MS = 250`,
  `NARRATION_MAX_PARALLEL = 2`.
- `app.js`:
  - Polling is always on in live mode: a `setTimeout` loop, 1 s while `screen` is `rating` or
    `recommendations`, else 1.5 s. Out-of-order responses (loop + post-tool polls) are dropped by `version`.
  - `speakReply()` now returns a promise that resolves when playback ends or is stopped (old callers unaffected).
  - Why narration: on every change of `recommendations` (ids, titles, why), one `POST {AGENT}/speak`
    per film with `"<title>. <why>"` (why split on `" · "`, joined `"A, B, and C."`), max 2 in flight.
    Blob URLs kept in a `Map` by movie id; clips for films that left or changed text are revoked.
    On a new `focus` (`movie_id` or `at`) while `screen === "recommendations"`: stop the previous clip,
    play the new one; if its clip is still generating it plays when ready (unless focus moved on).
    Skipped (logged) while the mic is open, a rating mic is open, or a reply is thinking/speaking.
    Starting the mic or a reply stops any narration clip; leaving the reel screen stops it too.
  - Rating: when `(rating.movie.id, rating.asking)` changes on screen `rating` (not done), a question
    is queued: `"<Name>, what did you think of <title>?"` when `answers` is empty, else `"<Name>, your turn."`.
    It is spoken only once the page is idle (so it waits for the agent's spoken reply to the previous person),
    then the mic opens automatically with "Who is talking?" set to that name. Interim words ->
    `POST {MCP}/api/rating/live {"text"}`, throttled to one per 250 ms (latest text wins, duplicates dropped).
    The final result goes through the normal `/chat/stream` turn with `speaker: <asking>`; the reply is spoken.
    8 s with no speech closes the mic silently (Chrome's own `no-speech` end before 8 s just restarts
    recognition). If `asking` changes while listening (Skip / hand rating on TV), recognition is aborted
    without sending. `done` does nothing extra.
  - TV preview renders the rating screen: film, "<Name>'s turn" / "Saved, thanks everyone", and one row
    per person (answer + quote, Skipped, "by hand", "Asking now" / live words, Waiting).
  - All decisions log to the console with prefix `[voice]`.
- `styles.css`: `.tv-rating-list` / `.tv-rating-row` (existing tokens only).

Run: serve `apps/alexa-web/` statically (e.g. `python3 -m http.server 5173` in that folder) and open
`http://127.0.0.1:5173/?agent=http://127.0.0.1:8100&tv=http://127.0.0.1:8000/api/state`.
Mock: `?mock=1` (unchanged, no servers; the voice driver only runs on polled state).

## How I tested

MCP (8000) and agent (8100) were both down during my run (no `/health` answer), so per the brief I used
a local fixture server on port 8765 (scratchpad only, not in the repo) that serves the page, a scripted
`/api/state`, logs `/api/rating/live`, returns a 1.2 s silent MP3 for `/speak`, and a short SSE for
`/chat/stream`. Headless Chrome (Playwright, `channel="chrome"`) with a fake `SpeechRecognition`
that emits a phrase word by word every 80 ms (about 12 interim results/s), or a `no-speech` end after 3 s.
Full log: `briefs/reports/ajan4-shots/fixture-run.log`. Server-side timings (seconds from first state):

```
 5.46 speak "Hoppers. Bedirhan loves science fiction, and Ayse loves comedy."   <- 2 in parallel
 5.46 speak "Paddington 2. Ayse loves comedy."
 5.76 speak "Coco. Bedirhan loves animation, Ayse loves music, and kid-safe for Can."  <- after a slot freed
[voice] focus 103: playing clip "Coco. ..."
 9.47 speak "Bedirhan, what did you think of Hoppers?"     (state change at 9.38)
11.47 live "I"
11.72 live "I really loved it"                              <- 250 ms apart despite 12 results/s
11.97 live "I really loved it it was so"
12.16 chat {"text": "I really loved it it was so much fun", "speaker": "Bedirhan"}
12.32 speak "Got it, Bedirhan, saved."
15.50 speak "Ayse, your turn."            (asking changed at 14.8, reply audio had ended)
[voice] asking changed while listening to Ayse: stop listening   (Skip on TV at 18.4)
18.52 speak "Can, your turn."
[voice] no speech from Can for 8 s: closing mic   (before done at 29.5; recognition restarted after Chrome-style no-speech)
```

Latency: state change -> question audio request is at most one poll (<= 1 s) plus `/speak` time.
Focus 102 was set for only 0.4 s and was never seen by the 1 s poll, so only focus 103 played; that is
the expected behaviour for a reel that is still scrolling.

Screenshots in `briefs/reports/ajan4-shots/`: `01` reel with narration, `02` listening for Bedirhan,
`03` Ayse's turn with Bedirhan's answer in the TV preview, `04` after Can's silence timeout, `05` done,
`06` Mock Mode still working (no page errors).

## Not tested / open points

- Not tested against the real MCP + agent (both down; ajan2's `/api/rating/live`, `focus`, `rating`
  endpoints were not in `services/mcp/src/popcorn_mcp/server.py` yet when I looked). No ports used other than 8765.
- Real microphone / real Chrome Web Speech not tested (headless fake). Real Chrome's `no-speech` timing
  varies; the restart loop handles any value under 8 s.
- Browser autoplay: Polly audio started without a click only because the test used
  `--autoplay-policy=no-user-gesture-required`. In a normal Chrome tab, click the page once before the demo,
  otherwise the first question/clip is refused (logged as `play() refused`).
- Decision: the page ignores the `focus` and `asking` that already exist when it loads (baseline), so a
  page reload mid-rating does not re-ask; the TV still offers hand rating and Skip.
- Decision: the live caption is not cleared by the page after the final result; I assume the server
  clears `live` when the answer is recorded.
- Decision: narration is also skipped while an agent turn is "thinking" (a reply is about to play).

## Friction

None with Amazon/AWS tools in this task (no AWS calls; Polly only reached through the agent, which was down).

DONE
