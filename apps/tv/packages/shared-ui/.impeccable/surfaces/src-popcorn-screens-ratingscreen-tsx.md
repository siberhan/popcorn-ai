---
version: 1
slug: "src-popcorn-screens-ratingscreen-tsx"
primary_target: "src/popcorn/screens/RatingScreen.tsx"
related_targets: ["src/theme/console.ts","src/popcorn/components/ConsoleBackdrop.tsx"]
---

# Family rating screen ("How was it?")

Scope: the TV rating screen and the parts it owns (spotlight disc, question line, live transcript, voice bars, the hand-rating panel, the Skip control, the progress row, the saved view). Reuses the console theme. Mode: Operate. Audience and constraints live in PRODUCT.md.

Job: after the film, Popcorn asks each person on the couch, one at a time and out loud (through the voice page), what they thought. The TV shows whose turn it is and their words as they speak. Anyone can rate by hand instead, or skip their turn. When everyone is done, the answers are saved into each person's taste memory.

## Direction contract

THESIS: One person in the spotlight (console profile pickers and the PS5 party screen as the bar): a large disc in the person's colour in the centre, the question above their words, their spoken answer arriving live in large type. Everyone else waits as small discs in a row at the bottom. It refuses forms, star grids and per-person tables.

OWN-WORLD: The console world: ground #0B0D12, a blurred field tinted with the current person's disc colour (household index colour, opacity about 0.75) plus a faint rust field, system UI face at 500/600, text #FFFFFF, secondary #B4BCCB, dim #8F98AB for hints only. Focus is the white fill on pills. No gold, amber, glow, glass or gradient text.

STORY: The screen opens on the first person. Popcorn's question shows as `Popcorn: "Ayse, what did you think?"`; while they talk, the transcript appears in 52/600, the unfinished tail in secondary; six white voice bars move while the voice page listens. Once their answer is understood, a white reaction chip ("Loved it") appears next to their small disc in the progress row and the spotlight moves to the next person. Two quiet outline pills under the bars: "Rate by hand" and "Skip" (focused by default: "Rate by hand"). OK on "Rate by hand" opens five pills in place of the transcript: Loved it, Liked it, It was fine, Didn't like it, Hated it; Back closes them. OK on "Skip" moves to the next person without an answer (their small disc shows "Skipped" in dim). After the last person: a saved view with every disc and their chip, "Saved to everyone's taste" 40/600 and "Back to the couch" as one white pill.

FIRST VIEWPORT: 1920x1080, safe area 96/54. Header: "Popcorn AI" 28/500 left; right a 44x66 poster thumbnail plus "Project Hail Mary · 23:12" 24 secondary. Centre column from y 180: disc 200 px with an 8 px ground gap and a 6 px white ring, question 30/500 secondary 44 below, transcript 52/600 max width 1200, at most 3 lines, voice bars 50 tall, pills 60 tall radius 30 with a 2 px 30% white inset ring. Progress row centred at bottom 110: 44 px discs, the current one ringed, later ones at 0.45 opacity, chips 34 tall white, then "2 of 3" 24 secondary. Hint row bottom 50: "Back: finish and save" left, nothing on the right (Skip is a visible control now).

Signature move: the spotlight hand-off. When the turn moves, the current disc shrinks and slides down into its place in the progress row while the next person's disc grows up from the row into the centre (about 500 ms, transform and opacity), and the field tint crossfades to their colour. Timers own every state swap.

Voice hook: the voice page reads `state.rating.asking` and speaks the question; the TV only shows `state.rating.live` (the words so far) and animates the bars while `live` changes.

FORM: dealt structure "voice spotlight" (option 1), chosen by the user over Voice roster and Voice columns in the rating surface round, with the user's addition of a visible Skip on every person's turn; seed:b7a836694459a4dc.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
