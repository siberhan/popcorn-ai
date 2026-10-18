---
version: 1
slug: "src-popcorn-screens-detailsscreen-tsx"
primary_target: "src/popcorn/screens/DetailsScreen.tsx"
related_targets: ["src/theme/console.ts","src/popcorn/components/ConsoleBackdrop.tsx"]
---

# Film details screen ("Where to watch")

Scope: the TV details screen and the parts it owns (backdrop hero, info column, provider pills, the handoff panel shown after a provider is chosen). Reuses the console theme and header from the couch and recommendations screens. Mode: Operate. Audience and constraints live in PRODUCT.md.

Job: OK on a film in the reel opens this screen. The couch reads what the film is, sees whether it fits everyone on the couch, and picks where to watch it. Choosing a provider shows a short handoff ("Enjoy it on Prime Video, come back when it's over") with one "We're back" button that starts the family rating. Back returns to tonight's picks.

## Direction contract

THESIS: A console film page with the film's own backdrop as the hero (Apple TV and Google TV film pages as the bar): the backdrop fills the right two thirds, a ground-coloured scrim carries the text on the left, and the providers sit low as large pills. It refuses poster-and-table layouts, the old warm-brown and gold theme and logo walls.

OWN-WORLD: The console world unchanged: ground #0B0D12, system UI face at 500/600, text #FFFFFF, secondary #B4BCCB, dim #8F98AB for hints and attribution only. The TMDB backdrop (w1280, hot-linked, never saved) sits at x 640, width 1280, full height, under a left-to-right scrim (solid ground to 33%, 0.85 at 48%, 0.2 at 75%) and a bottom scrim (0.8 to clear over 35%). No backdrop: ConsoleBackdrop fields tinted with the film's genre tint. Focus is the white fill: the focused pill turns white with near-black text and scales to 1.06. No gold, amber, glow, glass or gradient text.

STORY: The screen opens with the first provider pill focused. Title 64/600, meta line (year, up to two genres, runtime, certificate), chips ("92% match" white, "TMDB 8.6" outline, "Fine for this couch" outline or "Not for this couch" outline), overview at most 4 lines, credits. Left and Right move between providers. OK on a provider: the pills give way to the handoff panel in the same place (provider name, "Come back when it's over", a focused white "We're back" pill). Back from the handoff returns to the pills; Back from the pills returns to tonight's picks. No providers in the region: "Not streaming in the US right now" 26 secondary, and the "We're back" pill still shows so the family can rate a film watched elsewhere.

FIRST VIEWPORT: 1920x1080, safe area 96/54. Header: "Popcorn AI" 28/500 left; right the couch discs (40 px, household index colours), names and clock 24 secondary. Info at x 96, y 260, width 960. "Where to watch" 26/600 secondary at bottom 120, pills 84 tall, radius 42, padding 34, gap 20: provider logo 44 px rounded square, name 28/600, kind 22/500 ("Included", "Rent", "Buy"). Up to 4 pills. Footer bottom 40: "Back: tonight's picks" left, "Streaming data by JustWatch" right, both 22 dim.

Signature move: the hero settles in. On entry the backdrop fades from 0 to 1 over about 600 ms with a slow 1.04 to 1.0 scale, the info column rises 24 px while fading in, staggered 80 ms per block; transform and opacity only, native driver, timers own every swap.

Voice hook: none on this screen; the voice page speaks nothing here.

FORM: dealt structure "backdrop hero" (option 2), chosen by the user over Unfold and Providers-first in the details surface round; seed:3733de00f14491cd.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
