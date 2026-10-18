---
version: 1
slug: "src-popcorn-screens-couchscreen-tsx"
primary_target: "src/popcorn/screens/CouchScreen.tsx"
related_targets: ["src/popcorn/components/ProfileAvatar.tsx","src/popcorn/components/AddMemberForm.tsx","src/popcorn/components/PopcornButton.tsx"]
---

# Couch screen ("Who's watching?")

Scope: the TV welcome / couch screen and the components it owns (profile avatars, add tile, add-member form, Popcorn button, backdrop). Mode: Operate. Audience and constraints live in PRODUCT.md.

Job: the family sees who is on the couch, seats or unseats people with OK, adds someone with "+", sees the kid rule, and moves on with Popcorn.

## Direction contract

THESIS: The couch picker as a console home screen (PS5 home, Apple TV tvOS, Google TV as the bar): a calm dark stage, a soft colour field drifting slowly behind round profiles that lift on focus. It refuses the old warm-brown spotlight theme, gold accents and poster-scale type.

OWN-WORLD: Cool ink ground #0B0D12. Backdrop: two or three large, very soft colour fields (bundled blurred blob image, tinted), muted deep teal and rust at low opacity, kept to the right two thirds; the left third stays near-solid ground under a scrim. System UI face, weights 500/600; sizes 60 title, 40 info, 30 names, 26 secondary, 20 credit. Text #FFFFFF, secondary #B4BCCB. Each person a deep solid disc colour that keeps white initials at 4.5:1 or better. Focus: scale 1.22, 6 px white ring, soft drop shadow. Seated: white check badge. White pill CTA with near-black text. No gold, amber, glow, glass or gradient text.

STORY: The family recognises themselves at once, moves along one row with the D-pad, seats people with OK (check badge appears, name turns white), sees "3 people on the couch · Can is 9, so picks stay PG", and presses Popcorn to go on. "+" opens the add form in the same world.

FIRST VIEWPORT: 1920x1080, safe area 96/54. Top left "Popcorn AI" 28/500, top right clock 28 secondary. "Who's watching?" left-aligned at about y 250, 60/600. One profile row from x 96 at about y 390: "+" disc first, then household discs 180 px, gap 44; names below, focused name white 600. Bottom left: info block (count 40/600, kid rule 26 secondary, empty state "Nobody on the couch yet"), TMDB credit line 20 below it. Bottom right: white pill "Popcorn", 88 tall, with the popcorn mark in near-black, 40% opacity until someone is seated. Seven or more people switch to compact discs.

Signature move: the backdrop field drifts slowly (translate and scale loop, 20 to 30 s, native driver) and its tint crossfades to the focused person's colour in about 600 ms. No logic may depend on an Animated end callback.

FORM: the category standard (canon card), chosen by the user in the safer re-roll round 1 over Taste Light, Key Art Drift and Hi-fi refined; seed:52c0da25c3048b04.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
