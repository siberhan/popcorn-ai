# ajan3: "Who's watching?" welcome screen (TV, Day 4)

Read `briefs/rules.md` and `briefs/tv-contract.md` first. Two things in `rules.md` are out of date:
the TV app now talks to the deployed MCP server on Lambda (`apps/tv/packages/shared-ui/src/popcorn/config.ts`),
so you do not need a local server on port 8000. Hard rules 1-8 still apply (no git, no secrets, no AWS changes).

## Goal

Replace the first TV screen (`screen: "couch"`, `CouchScreen.tsx`) with a "Who's watching?" profile
picker in the style of Peacock's profile screen. Reference image: `.local/welcome-reference-peacock.png`
(look at it; it is a third-party image, never copy it into the repo). The current screen is
`briefs/reports/ajan3-tv-shots/couch.png`. Today the family can only be changed by voice; this screen
must work fully with the remote.

## What the user asked for (do exactly this)

1. **Round profile avatars** in one horizontal row, centered, like the reference. One avatar per
   person in `state.household` (every known family member). Use `state.members` as the fallback
   when `household` is missing (the server is being redeployed; see below). Name under each avatar.
   Avatars stay initials on the deterministic color (`avatarUtils.ts`); no photos.
2. **"+" on the far left** of the row: a round tile with a plus, label "Add". Selecting it opens
   an add form in place of the row: name (TextInput, required), age (TextInput, numbers, optional),
   "Add" and "Cancel" buttons, all reachable with the D-pad. "Add" calls `addToCouch(name, age)`.
   The new person is created, joins the couch, and shows up selected.
3. **Select with the remote:** move to an avatar with the D-pad; the focused avatar grows (the
   reference's big center avatar). Pressing OK/Select toggles that person:
   - not on the couch -> `addToCouch(name)`; on the couch -> `removeFromCouch(name)`.
   - "On the couch" means the name is in `state.members`. Those avatars get a **green ring** (use
     `colors.status.success`) and a small check badge. Focus and selection must look different:
     focus = size (and a light outline if needed), selection = green ring.
   - Update the ring at once (optimistic), then follow `state.members` when the next `version` arrives.
     On an error, undo the optimistic change; the error text goes to the existing toast.
4. **Popcorn button below the row.** Pressing it calls `refreshPicks()`; the server then switches the
   TV to the recommendations screen. It is disabled (dimmed, still focusable, does nothing) while
   nobody is selected. Make it look like a popcorn button (a popcorn mark drawn with RN Views or the
   existing logo style, plus the label "Popcorn"); no new image assets.

Keep the `CouchBar` at the top and a title "Who's watching tonight?". Kids keep the `KID` badge
on their avatar. Remove the old member cards, the two-press remove, and the confirm banner.
Nothing else is required on this screen; keep it as clean as the reference.

## Where to change

- `apps/tv/packages/shared-ui/src/popcorn/screens/CouchScreen.tsx` (rewrite).
- New components under `.../popcorn/components/` if useful (export them from `index.ts`).
- `.../popcorn/PopcornRoot.tsx`: only to wire a new `onAddMember(name, age?)` prop through to
  `addToCouch` (same error handling as `handleRemoveMember`), and `onToggleMember` if you need it.
- `types.ts` already has `household: Member[]`; `api.ts` already has `addToCouch`. Do not change
  `api.ts`, `types.ts`, `useTVState.ts`, `config*.ts`, or anything outside `apps/tv/packages/shared-ui/src/popcorn/`.

## Constraints

- It must run on Vega: React 18.2, React Native 0.72, focus with `react-tv-space-navigation`
  (`SpatialNavigationNode`, `SpatialNavigationFocusableView`, `DefaultFocus`). No new npm packages.
- Default focus: the first person on the couch if any, otherwise the first avatar, otherwise "+".
- `Animated`: on Vega the animation end callback may never fire (see the comment in
  `RecommendationsScreen.tsx`); never wait on it for state changes.
- TextInput with the D-pad on Vega: check how focus and the on-screen keyboard work before you build
  it. Amazon has an MCP server with Vega docs: `npx -y @amazon-devices/amazon-devices-buildertools-mcp@latest`.
  If it is not clear, say so in your report; the orchestrator tests on the Vega simulator.
- 10-foot UI: text at least 18px, everything inside the 5% safe area, tokens from `theme/`.

## How to test

- The web preview already runs at `http://localhost:8082` (Expo, hot reload). Do not start another one.
- It reads the live server. The live data is a dev household; you may add and remove people while
  testing. When you finish, leave the couch empty (remove everyone you added to it), but do not
  worry about the profiles you created.
- Until the orchestrator redeploys the server, `/api/state` has no `household` field, so only
  couch members show. Check with `curl -s <API_BASE_URL>/api/state | python3 -m json.tool | head`.
- Run `yarn typecheck` and `yarn lint:all` in `apps/tv` (report the real output).
- Screenshots at 1920x1080 with headless Chromium, as you did on Day 3, into
  `briefs/reports/ajan3-welcome-shots/`: empty household, several people with some selected and
  one focused, the add form, and the disabled Popcorn button. Drive focus with arrow keys + Enter.

## Report

Write `briefs/reports/ajan3-welcome.md`: files changed, how it works with the remote, test output,
screenshots list, what you could not check (Vega TextInput), and decisions you made on your own.
