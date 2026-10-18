# ajan3: Console redesign of the recommendations screen (TV, Day 4)

Read `briefs/rules.md` and `briefs/tv-contract.md` first. Hard rules 1-8 still apply (no git, no secrets, no AWS changes). The TV app talks to the deployed server (`apps/tv/packages/shared-ui/src/popcorn/config.ts`).

## Goal

Rebuild `RecommendationsScreen.tsx` in the console world you built for the couch screen (`theme/console.ts`, `ConsoleBackdrop`). The user does not want the 3x2 grid. They want one film on screen at a time, with the films before and after it showing as faded shadows, moved with the arrow keys. They chose the **vertical reel** layout.

**Behaviour that must not change:** the live kid filter. When the server's `recommendations` change (for example a kid joins the couch), the removed films fade out instead of vanishing, and the new list swaps in on a timer, never on an `Animated` end callback. Today this is done by `displayItems`, `fadingOut` and `FADE_MS` in the current file; keep that logic and adapt it to the reel. Selecting a film still does nothing (tv-contract.md).

## The contract (binding)

The direction contract is in `apps/tv/packages/shared-ui/.impeccable/surfaces/src-popcorn-screens-recommendationsscreen-tsx.md`. Build exactly what its FIRST VIEWPORT, OWN-WORLD, STORY, signature move and voice hook say. The chosen sketch is `apps/tv/packages/shared-ui/.impeccable/mocks/decision/reel.html` (open it at 1920x1080). Match its composition, but follow the contract where they differ: the contract has no "OK: details" hint, it adds the kid rule and mood chips to the header, and the poster gradients in the sketch are stand-ins for real TMDB posters.

Also read `.claude/skills/impeccable/reference/craft-floor.md` before you edit, and do not do anything it bans. Never copy the contract text into source code, comments, or rendered output.

## Specifics

1. **Tokens:** use `theme/console.ts` only. Add the new tokens you need there (ghost opacity, reel sizes, reel slide time, genre tints). Do not edit `theme/colors.ts` or `theme/typography.ts`; the duel and details screens still use them.
2. **Header:** replace `CouchBar` on this screen with the console header: "Popcorn AI" left; right: the seated people as 40 px discs with initials, coloured by household index exactly as `CouchScreen` does it (`consoleDiscs[index % length]`, index in `state.household`), their names, and the clock. Under it, small: the kid rule (reuse `getKidFilterLabel`) and the mood chips from `state.boost` as outline pills. Show `state.message` there too while it is non-empty, in secondary 24. Leave `CouchBar` itself untouched.
3. **Reel:** up to 6 films. Focus moves with Up and Down only. You decide how to wire it with `react-tv-space-navigation` (for example one vertical node of focusable rows, where only the focused one is drawn as the band, or a single focusable that handles Up/Down itself). It must work with the D-pad only, keep the first film focused on entry, and clamp at both ends (no wrap). Left/Right do nothing.
4. **Signature move:** every row slides by one step in about 450 ms (transform and opacity, `useNativeDriver: true`). The leaving film eases to the ghost opacity, the arriving one to full, its poster grows from 220x330 to 380x570 (animate `scale`, not width/height), and the rail bar moves. Pass a tint to `ConsoleBackdrop` from a small genre map (for example sci-fi deep teal, animation blue, action rust, drama plum-brown, comedy ochre, horror deep red-brown), all muted, in `console.ts`. Move the backdrop fields so they sit low and centred behind the band; if `ConsoleBackdrop` needs a `layout` prop for that, add one and keep the couch screen's default.
5. **Posters:** use `PosterCard` (or the same Image logic) with the TMDB URL at runtime; never save posters. Its no-poster fallback must also be restyled for the console world (or drawn locally on this screen).
6. **Voice hook:** after a film has held focus for 1000 ms, call `onFilmSettled(movie)`; clear the timer on every move and on unmount. For now it is a no-op function in the screen. Do not add audio. The four voice bars stay static.
7. **Kid filter fade:** removed films show in the reel at ghost or band position with a "Not for this couch" line instead of the why, fade out over `FADE_MS`, then the reel swaps to the new list on a timer and focus lands on the nearest surviving film (same index, clamped). Show "Kept 4 kid-safe picks" (with the real count) in the header line for about 4 s after a kid-safe change.
8. **Empty:** "No picks yet" 40/600 and "Ask Popcorn AI to find movies for everyone on the couch." 26 secondary, left-aligned at the band's position.
9. **Text:** title at most 2 lines, why text at most 3 lines, nothing below 20 px. Long titles must not push the why block off screen.

## Verify (web preview only)

The Expo web preview is running on http://localhost:8082 (do not start another; if it is down, tell me). **Do not touch the Vega Virtual Device or the `vega` CLI**; the user tests Fire TV themselves.

Write down `state.members` and `state.screen` from `GET /api/state` before you start and restore exactly that state at the end. Prefer intercepting `/api/state` in Playwright over changing the server.

With Playwright at 1920x1080 and only arrow keys, capture to `briefs/reports/ajan3-recs-shots/`: pick 1 (no ghost above), pick 3 (both ghosts), the last pick (no ghost below), mid-slide (about 200 ms after Down), a film with no poster, a very long title, the kid-filter fade in progress and after it, the empty state, and a couch with 4 people plus mood chips plus a message. Open every PNG once and check it shows what its name says. Also log (console) that `onFilmSettled` fires once 1 s after you stop on a film and not while you move quickly.

Run `yarn typecheck` in `apps/tv`; the only allowed failures are the known ones in `DuelScreen.tsx` (lines 219 and 234).

## Report

Write `briefs/reports/ajan3-recs.md`: what changed per file, how the reel is wired to spatial navigation, how the slide and the kid fade are timed, the genre tint map with the colours, what you could not do, the screenshot list, and any friction with tools (for me to log; do not edit `FRICTION_LOG.md`).
