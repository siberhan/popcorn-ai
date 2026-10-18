# ajan3: Console redesign of the couch screen (TV, Day 4)

Read `briefs/rules.md` and `briefs/tv-contract.md` first. Hard rules 1-8 still apply (no git, no secrets, no AWS changes). The TV app talks to the deployed server (`apps/tv/packages/shared-ui/src/popcorn/config.ts`); no local server is needed.

## Goal

Restyle the welcome / couch screen you built yesterday (`CouchScreen.tsx`, `ProfileAvatar.tsx`, `AddMemberForm.tsx`, `PopcornButton.tsx`) into a new visual world. The user rejected the current look (warm brown spotlight, gold, muted red/green/orange initials, gold pill) as "crude AI UI". They want the calm premium feel of the PS5 home screen and Apple TV, with a soft blurred backdrop and a slow, abstract colour flow behind the UI, and text sized for a TV app, not poster-sized.

**Behaviour does not change.** Keep everything that works: optimistic seat/unseat, household ordering, DefaultFocus rules, the add form flow and its spatial-navigation lock, compact mode at 7+ people, the Popcorn button waiting for in-flight requests.

## The contract (binding)

The direction contract is in `apps/tv/packages/shared-ui/.impeccable/surfaces/src-popcorn-screens-couchscreen-tsx.md`. Build exactly what its FIRST VIEWPORT, OWN-WORLD and signature move say. The chosen sketch is `apps/tv/packages/shared-ui/.impeccable/mocks/decision/canon.html` (open it in a browser at 1920x1080); match its composition, but follow the contract where they differ (the contract adds a real check badge, the clock, the info block states and the TMDB credit).

Also read `.claude/skills/impeccable/reference/craft-floor.md` before you edit, and do not do anything it bans: no eyebrows or kickers, no gradient text, no decorative glass, no nested cards, no emoji icons. Never copy the contract text into source code, comments, or rendered output.

## Specifics

1. **Tokens:** create `apps/tv/packages/shared-ui/src/theme/console.ts` with the new world's tokens (ground, text, secondary, disc colours, ring, CTA, scrim, sizes) and use only those on the couch screen and its components. Do **not** edit `theme/colors.ts` or `theme/typography.ts`; the duel, recommendations and details screens still use them and will be redone later.
2. **Font:** the system UI face (no `fontFamily`, or the platform default). Weights 500/600. Never under 18 px.
3. **Header:** on the couch screen, replace `CouchBar` with the console header: "Popcorn AI" top left, a clock (HH:MM, 24 h, refreshed every 30 s) top right. Leave `CouchBar` itself untouched; other screens use it.
4. **Disc colours:** replace the couch's use of `colors.avatar` with a console palette of 8 deep, slightly cool colours (blue, rose, ochre, green, slate, plum-brown and so on, never neon, never purple-blue AI gradients). Each must give white initials at least 4.5:1 contrast. Keep the deterministic name to colour mapping (`avatarUtils.ts` logic, new palette).
5. **States:** focus = scale 1.22 (keep your 160 ms `Animated` growth) + 6 px white ring + soft drop shadow. Seated = white check badge at the bottom right + white name. Unseated = secondary name. Kids: name shows "Can, 9"; keep a non-colour kid marker (a small "KID" or age chip in the console style). Seated must never be shown by colour alone.
6. **Backdrop (the signature move):** RN 0.72 has no CSS gradients or blur here (`PlatformLinearGradient` is a solid-colour fallback, and no new npm packages are allowed). So:
   - Generate one soft white radial blob PNG (about 512x512, alpha falling off to 0 at the edge, no visible banding) with a script (Python/PIL or ffmpeg). Put it in `apps/tv/packages/shared-ui/src/assets/images/`. Keep the generator script out of the repo (use your scratch directory).
   - Record its provenance: `.claude/skills/impeccable/scripts/impeccable embed-prompt <png> --prompt-file <file>`, where the file says how it was generated (procedural, script summary, parameters).
   - Draw two or three large copies (`Image`, `resizeMode="stretch"`, `tintColor`) behind the content: deep teal and rust at low opacity on the right two thirds, plus a left-to-right scrim (stacked semi-transparent Views) so the left third stays near-solid ground.
   - Motion: a slow drift loop (translate + scale, 20-30 s, `Animated.loop`, `useNativeDriver: true`), and a tint crossfade to the focused person's disc colour in about 600 ms (crossfade two layers with opacity if `tintColor` cannot animate). Nothing may depend on an `Animated` end callback (it may not fire on Vega).
   - Keep it cheap: no more than 4 image layers.
7. **Info block (bottom left):** count line 40/600 ("3 people on the couch", "1 person on the couch", empty: "Nobody on the couch yet"), kid line 26 secondary ("Can is 9, so picks stay PG"; for several kids name the youngest's rule, follow the kid filter in PRODUCT.md: under 13 → PG, under 17 → PG-13), then the credit line at 20 px: "This product uses the TMDB API but is not endorsed or certified by TMDB."
8. **Popcorn button (bottom right):** white pill, 88 tall, near-black label "Popcorn" with your popcorn mark in near-black, 40% opacity and inert while nobody is seated (still focusable).
9. **Add form:** restyle in the same world: dark fields (`#1C2230`-like) with a 2 px white focus ring, white pill "Add", outline pill "Cancel". Same focus order and keyboard behaviour as now.

## Verify (web preview only)

The Expo web preview is already running on http://localhost:8082 (do not start another; if it is down, tell me). **Do not touch the Vega Virtual Device or `vega` CLI**; the user tests Fire TV themselves.

Write down `state.members` from `GET /api/state` before you start and restore exactly that couch at the end.

With Playwright at 1920x1080 and only arrow keys / Enter, capture to `briefs/reports/ajan3-console-shots/`: default view, focus moved to another person, someone seated and unseated, the add form (empty and filled), a kid on the couch, empty household (intercept `/api/state` as you did before), and 7+ people compact (intercepted). Let the drift settle or pause it before each capture. Open every PNG once and check it shows what its name says.

Run `yarn typecheck` in `apps/tv`; the only allowed failures are the known ones in `DuelScreen.tsx` (lines 219 and 234).

## Report

Write `briefs/reports/ajan3-console.md`: what changed per file, the contrast values for the 8 disc colours, how the backdrop is drawn and animated, what you could not do, screenshot list, and any friction with tools (for me to log; do not edit `FRICTION_LOG.md`).
