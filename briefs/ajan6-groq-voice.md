# ajan6: Groq speech-to-text and text-to-speech (user decision, not up for debate), Day 6

Read `briefs/rules.md` and the "Speech and voice" and "Phone page" parts of `briefs/v2-contract.md`.
Hard rules 2-8 apply. **Your folders:** `services/mcp/` (including `src/popcorn_mcp/static/phone/`)
and `services/agent/` only if something there must change. Report: `briefs/reports/ajan6-groq-voice.md`.

The user replaced the voice stack: Polly and the browser Web Speech API are out, Groq is in.
Key: `GROQ_API_KEY` in the repo `.env` (the user is adding it now; never print it). Use `httpx`
against Groq's OpenAI-compatible REST API (no new SDK): base `https://api.groq.com/openai/v1`.
Check the real request/response shapes in Groq's docs (https://console.groq.com/docs/speech-to-text,
https://console.groq.com/docs/text-to-speech) before coding.

## Work

1. **TTS (MCP):** replace `polly.py` usage with a `groq_tts.py`: `POST /audio/speech`,
   `model = canopylabs/orpheus-v1-english`, `voice = autumn` (env `GROQ_TTS_MODEL`, `GROQ_TTS_VOICE`),
   `response_format = wav` (use mp3 only if the docs say this model supports it). Same cache and
   `speech` / `why_audio` flow; the route becomes `/api/voice/<sha1>.<ext>` with the right content type
   (`audio/wav`). Long texts: if the model has an input limit, split on sentence ends and join the
   WAVs (same format) or keep the limit in mind for the 600-char `/api/speech` cap. Keep Polly
   code only if trivial to keep as a fallback when `GROQ_API_KEY` is missing; otherwise remove it.
2. **STT (MCP):** `POST /api/transcribe` (raw audio body, `Content-Type` from the browser, max
   10 MB; optional `?speaker=`): sends it to Groq `POST /audio/transcriptions` (multipart, `model =
   whisper-large-v3`, `temperature = 0`, `response_format = verbose_json`, `language = en`), returns
   `{"text"}`. Empty or noise-only result -> `{"text": ""}`. Errors -> `{"error"}` 502 in plain words.
3. **Phone page:** drop Web Speech. Record with `MediaRecorder` (pick a supported mimeType:
   `audio/webm;codecs=opus`, else `audio/mp4`, else default; iOS Safari gives mp4). Tap to start,
   tap to stop, auto stop after ~1.5 s of silence (WebAudio analyser level) or 30 s. While recording:
   `POST /api/voice {"state":"listening","text":"","speaker"}` once. On stop: `voice thinking`,
   upload to `/api/transcribe`, show the text, then `POST {AGENT}/chat {"text","speaker"}` as before.
   Empty text -> voice idle and "I didn't catch that". Keep the text-box fallback.
4. Tests: fake Groq (httpx MockTransport) for both routes; existing tests green.
5. Live check (allowed, Groq costs are small): one TTS call and one STT round trip (synthesize a
   sentence with Groq TTS, send that WAV to `/api/transcribe`, compare text). Local server on port
   8010, household `v2-test` only; delete `v2-test` keys after.

Do not deploy (the orchestrator adds `GROQ_API_KEY` to the Lambda env). Report: files, final
request shapes, test + live output (latency of each Groq call), friction. End with `DONE`.
