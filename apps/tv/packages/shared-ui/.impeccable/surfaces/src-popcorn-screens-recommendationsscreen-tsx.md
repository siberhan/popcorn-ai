---
version: 1
slug: "src-popcorn-screens-recommendationsscreen-tsx"
primary_target: "src/popcorn/screens/RecommendationsScreen.tsx"
related_targets: ["src/popcorn/components/ConsoleBackdrop.tsx","src/theme/console.ts"]
---

# Recommendations screen ("Tonight's picks")

Scope: the TV recommendations screen and the parts it owns (the reel, the focused film band, the ghost rows, the position rail, the voice glyph). It reuses ConsoleBackdrop and the console theme from the couch screen. Mode: Operate. Audience and constraints live in PRODUCT.md.

Job: the couch sees one recommended film at a time, why Popcorn picked it for these people, and moves through the up to six picks with Up and Down. Selecting does nothing yet (tv-contract.md). Later, 1 s after a film settles in focus, a pre-generated voice line reads the why aloud; this build only leaves the hook for it.

## Direction contract

THESIS: Tonight's picks as a console film reel (Apple TV, PS5 and Google TV detail pages as the bar): one film fills a calm band in the middle of the screen, the previous and next films peek in faded above and below, and the reel slides vertically. It refuses the old 3x2 grid, the warm-brown and gold theme and poster-scale type.

OWN-WORLD: The couch screen's console world, unchanged: ground #0B0D12, ConsoleBackdrop soft teal and rust fields (here centred low behind the band, not on the right), system UI face at 500/600, text #FFFFFF, secondary #B4BCCB, dim #8F98AB for counts and hints only. Focus: the poster carries the 6 px white ring with a ground-coloured gap and a soft drop shadow. White "92% match" pill with near-black text; TMDB rating as an outline pill. No gold, amber, glow, glass or gradient text.

STORY: The screen opens on pick 1 of 6. The family reads the title, the match and the why line next to a small voice glyph. Down slides the reel: the next film rises into the band, the old one becomes the faded row above. When a kid joins the couch and the server drops unsafe films, they fade out of the reel and the band lands on the nearest surviving pick, with a short "Kept 4 kid-safe picks" line. With no picks: "No picks yet" and "Ask Popcorn AI to find movies for everyone on the couch."

FIRST VIEWPORT: 1920x1080, safe area 96/54. Header: "Popcorn AI" 28/500 top left; top right the couch as small 40 px discs (household index colours, same as the couch screen) plus names and the clock at 24 secondary; the kid rule ("Picks stay PG") and mood chips sit in the header under the couch, small. Focused band at y about 250, x 96: poster 380x570, gap 56, then the info column: "Tonight's picks · 1 of 6" 24 dim, title 60/600, meta 26 secondary (year · up to three genres), chips row (match pill 52 tall, TMDB pill), and the why block 40 below: four white voice bars (idle, static) left of the why text 32/500, max width about 900, at most three lines. Ghost rows: the previous film above (only its lower part visible, top cut off by the screen edge) and the next film below (only its upper part visible), each as a 220x330 poster plus title 44/600 and a one-line meta, at opacity about 0.16; no ghost above pick 1 or below the last pick. Position rail on the right edge at x about 1800: one dot per pick, the current one a 42 px tall white bar, the others 10 px dots at 30% white. Hint bottom right: "Up and Down: change film" 22 dim.

Signature move: the vertical reel slide. Up or Down moves every row by one step in about 450 ms (ease out, transform and opacity only, native driver): the band's film eases to ghost opacity as it leaves, the incoming ghost rises to full opacity and its poster grows to 380x570, the rail bar moves to the new dot, and the backdrop tint crossfades (consoleMotion.tintMs) to a colour picked from the focused film's poster or genre. No logic may depend on an Animated end callback; timers own every state swap.

Voice hook: after a film has held focus for 1000 ms (timer cleared on every move), call one handler `onFilmSettled(movie)` that does nothing yet. The voice bars stay static for now; the TTS build will animate them while audio plays.

FORM: dealt structure "vertical reel" (option 2), chosen by the user over Depth Stack and Orbit in the recommendations surface round; seed:53541c604c8c77ca.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
