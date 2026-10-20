# ajan3b — taste test (poster duel) screen in the console world (TV)

Repo: apps/tv/packages/shared-ui. Read in order:
1. `apps/tv/packages/shared-ui/PRODUCT.md`
2. `apps/tv/packages/shared-ui/.impeccable/surfaces/src-popcorn-screens-duelscreen-tsx.md` — the direction contract. Build exactly this.
3. `apps/tv/packages/shared-ui/.impeccable/mocks/decision/duel-pick-strip.html` — the sketch the user chose (composition to match).
4. `.claude/skills/impeccable/reference/craft-floor.md` — the quality floor; read before editing UI.
5. Existing console code to reuse: `src/theme/console.ts`, `src/popcorn/components/ConsoleBackdrop.tsx`, `ConsoleHeader.tsx`, `src/popcorn/screens/RecommendationsScreen.tsx` (focus ring, motion, timers pattern), `avatarUtils` (disc colours).

Rewrite `src/popcorn/screens/DuelScreen.tsx` (keep its props: `state`, `onPick(side|'skip')`). Add console tokens for the duel to `console.ts` (e.g. `consoleDuel`). Add `pairs?: [MovieCard, MovieCard][]` and `picked?: MovieCard[]` to the `Duel` type in `types.ts` (server now sends them).
- Remote: Left/Right between posters (left focused first), OK picks, Up from a poster reaches Skip, Down returns. Back does what it does today.
- No voice hint text anywhere on this screen.
- Preload: current pair first, then all other `pairs` posters in order, one after another (RN `Image.prefetch`; works on web and Vega). Keep a module-level set of prefetched URLs so it never repeats.
- Empty state (no duel): calm one-liner in the console style.
- Another agent may be editing CouchScreen/PopcornRoot/RecommendationsScreen right now: do not edit those files. Only DuelScreen.tsx, console.ts, types.ts (Duel only), and a new component file if needed.

Verify: web screenshot at 1920x1080 with a mocked state (round 1, round 3 with 2 picked, Skip focused, a kid's duel with long titles, empty) into `briefs/reports/ajan3-duel-shots/`; `yarn build:vega` in apps/tv succeeds. Do not drive the Fire TV / VVD. No commits, no deploys, no posters saved in the repo (screenshots are fine), never print .env.

Report: `briefs/reports/ajan3-duel-console.md`, short, with screenshot list and any deviation from the contract.
