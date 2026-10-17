# ajan2 — Review fixes for services/agent

Good work: tests pass, the contract matches. The orchestrator review found four things to fix.
Same rules as before (`briefs/rules.md`). Only touch `services/agent/`.

## 1. History cap can break tool pairs (bug)

`InMemoryConversationStore.save_messages` keeps `messages[-20:]`. A cut can land between an
assistant `toolUse` and the user `toolResult` that answers it. The next turn then sends a history
that starts with a `toolResult` without its `toolUse`, and the LLM API rejects it.

Fix: after the cut, drop messages from the front until the first message is a `user` message
with no `toolResult` block. Add a test with a 24-message history that has tool pairs and check
that the saved history starts with a plain user text message.

## 2. Reactions are lost in mark_watched (prompt)

In your turn-5 transcript, "Ayse loved it" gave `mark_watched` with `reactions: null`.
In `prompts.py`, make the rule explicit: when people say how they liked a movie, pass
`reactions` as a map of name to one of `loved`, `liked`, `meh`, `disliked`, `hated`
(check the exact `Reaction` values in `services/mcp/src/popcorn_mcp/service.py`), using the
speaker's name for "I". Re-run that one turn live and paste the tool input in your report.

## 3. Polly: no neural attempt

eu-north-1 has no neural voices, so every `/speak` call wastes one failed request first.
Add `POLLY_ENGINE` to config (default `standard`) and call Polly once with that engine.
Remove the neural-then-standard loop. Keep the 1500-char check.

## 4. Latency numbers

Add `ms_total` to the `done` event and to the `/chat` response (wall time of the whole turn).
The voice page will show it. Update `briefs/api-contract.md` only in the `done` event and `/chat`
response lines.

## Done when

- `uv run pytest` passes with the new test.
- One live `/chat/stream` turn with "we watched <a movie on screen>, I loved it" (speaker Ayse)
  shows `reactions` filled.
- Restart your running `popcorn-agent` on 8100 so it serves the new code.
- Append a "Fixes" section to `briefs/reports/ajan2.md` and end it with the line `FIXES DONE`.
