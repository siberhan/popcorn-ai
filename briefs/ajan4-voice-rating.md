# ajan4: Voice page drives the rating questions and the "why" narration (Day 5)

Read `briefs/rules.md`, `briefs/api-contract.md` and the `watching`/`rating`/`focus` parts of
`briefs/tv-contract.md`. Hard rules 1-8 apply. Only `apps/alexa-web/` and your report.

## Why

The Fire TV app cannot play audio without a new native package, so all speech comes from the
"Simulated Alexa+" page (microphone in, Polly out). The TV only shows. The page already can poll
the MCP `GET /api/state`; make that polling always on (1 s while `screen` is `rating` or
`recommendations`, else 1.5 s).

## 1. Why narration on the reel

- When `recommendations` changes, pre-generate one MP3 per film with `POST {AGENT}/speak`, text:
  `"<title>. <why as a sentence>"` (split `why` on " · ", join with ", and"). Keep blob URLs in a map
  by movie id, revoke old ones. At most 2 requests at a time.
- When `focus` changes (new `movie_id` or `at`) and `screen` is `recommendations`, play that film's
  clip; stop the previous one first. Never talk over the user: skip when the mic is open or a reply is
  playing.

## 2. Rating questions

- When `screen` is `rating` and `rating.asking` changes to a name (not done): speak
  `"<Name>, what did you think of <title>?"` for the first person, `"<Name>, your turn."` after that.
  Then open the mic automatically (no wake word) with the speaker set to that name.
- Interim results -> `POST {MCP}/api/rating/live {"text"}`, throttled to 4/s. The final result goes to
  `/chat/stream` as a normal turn with `speaker: asking`. Speak the agent's short reply.
- No speech for 8 s: close the mic, say nothing; the TV still offers Rate by hand and Skip. If
  `asking` changes while listening (someone pressed Skip or rated by hand on the TV), stop listening.
- `done` -> nothing extra (the agent already said "Saved, thanks everyone.").
- Show the current rating state in the page's TV preview panel (whose turn, answers).

## Verify

Mock Mode must keep working without servers. Test live against a local MCP + agent if ajan2's are up
(ask in your report which ports you used); otherwise mock `/api/state` with a small local fixture
and show in the console log: clips pre-generated, focus plays the right clip, asking -> question
spoken -> mic opens -> live posts throttled. Screenshots in `briefs/reports/ajan4-shots/`.

Report: `briefs/reports/ajan4-voice-rating.md` (changes, timings, what you could not test, friction).
End with `DONE`.
