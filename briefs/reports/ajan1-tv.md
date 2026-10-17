# Report: ajan1 (TV App Research - Day 3 Preparation)

## 1. What was Researched & Built

Researched Amazon's `react-native-multi-tv-app-sample` codebase at `/private/tmp/claude-501/-Users-bedirhan-Documents-Projects-popcorn-ai/047f9d42-0d0e-4226-934b-0be89bf43b7f/scratchpad/mtv/` and verified against official Vega documentation. Published the complete technical reference for the TV builder at:
- `briefs/tv-research.md`

All file paths and line numbers cited in `briefs/tv-research.md` correspond directly to the sample repository and official Vega documentation pages (`https://developer.amazon.com/docs/vega/0.24/app-manifest.html`, `https://developer.amazon.com/docs/react-native-vega/0.72/network.html`).

### Exact Verification Commands
```bash
# 1. Environment configuration
eval "$(fnm env)"
fnm use 24
source ~/vega/env

# 2. Inspect sample workspace
cd /private/tmp/claude-501/-Users-bedirhan-Documents-Projects-popcorn-ai/047f9d42-0d0e-4226-934b-0be89bf43b7f/scratchpad/mtv

# 3. Web target run command
yarn dev:web # starts Expo Web on port 8082

# 4. Vega target build & launch commands
yarn build:vega
vega device launch-app --appName com.giolaq.multitv.vega.main
```

---

## 2. Key Findings & Architecture Recommendations

1. **Workspace & Structure**:
   - `packages/shared-ui`: Contains all cross-platform UI, navigation, theme, and focus components (Source: `packages/shared-ui/package.json` lines 1-23).
   - `apps/expo-multi-tv`: Expo SDK 54 + React Native 0.81 (tvOS) + React 19.1.0 (Source: `apps/expo-multi-tv/package.json` lines 33, 44, 46).
   - `apps/vega`: Amazon Vega SDK + Kepler React Native 0.72.0 + React 18.2.0 (Source: `apps/vega/package.json` lines 25, 37, 38).
2. **Screen Replacement Strategy for Popcorn AI**:
   - Replace complex Drawer + Stack navigation with a single state-driven component `TVStateScreen` that polls `/api/state` and renders `CouchScreen`, `DuelScreen`, `RecommendationsScreen`, or `DetailsScreen` based on `tvState.screen`.
   - Safely delete video player components (`packages/shared-ui/src/screens/PlayerScreen.tsx`, `components/player/`), explore/settings stubs, and mock catalog loaders.
3. **Spatial Navigation & Focus**:
   - Library: `react-tv-space-navigation` (v6.0.0-beta1) with `@bam.tech/lrud` (Source: `packages/shared-ui/src/app/configureRemoteControl.ts`).
   - Wrapped focusable component: `<SpatialNavigationFocusableView onSelect={...}>` with `<DefaultFocus>` for initial focus.
   - Web uses `window.addEventListener('keydown')`, Vega uses `TVEventHandler` (Source: `packages/shared-ui/src/app/remote-control/RemoteControlManager.kepler.ts` lines 26-42).
4. **Data & Cleartext HTTP**:
   - Standard `fetch()` and `<Image source={{ uri }} />` work across both targets (Source: `packages/shared-ui/src/data/moviesData.ts` lines 71-83).
   - **Cleartext Status**: The Vega 0.24 manifest specification does not document any `[network-traffic-policy.cleartext]` table. React Native 0.72 Vega docs show standard `fetch()` and `XMLHttpRequest`. Status is **UNVERIFIED**; builder must test plain HTTP (`http://10.0.2.2:8000`) on the Vega Virtual Device on Day 3.
5. **State Polling Pattern**:
   - Custom `useTVState(url, 1000)` hook with recursive `setTimeout` and `AbortController`. Prevents request piling and unmount memory leaks, and only triggers re-renders when `data.version` increments.
6. **Design Tokens & Animation**:
   - Popcorn design tokens from `apps/alexa-web/design/tokens.json` (lines 8-85) map cleanly into `packages/shared-ui/src/theme/colors.ts`.
   - Core React Native `Animated` is universally supported on both Web and Vega for card fade/scale transitions.

---

## 3. Decisions & Open Questions

1. **Navigation Paradigm**:
   - **Decision**: Recommend a single reactive screen controller over multi-route navigation for Day 3. Popcorn AI's TV screen is driven primarily by living-room voice interactions (orchestrated by the backend `/api/state`), so routing based on backend `screen` state is much simpler and avoids state desynchronization.
2. **React Version Compatibility**:
   - **Decision**: All code in `packages/shared-ui` must strictly adhere to React 18 APIs (avoid React 19 hooks) because Vega OS Kepler runtime is pinned to React 18.2.0.
3. **Font Strategy**:
   - **Decision**: On Web, load Google Fonts (`Fraunces` and `Plus Jakarta Sans`). On Vega, use system sans-serif fonts to avoid Kepler custom font asset pipeline compilation issues.

---

## 4. Friction Log Entries (Rule 8)

### Friction 1: `vega run-app` hangs on launch
- **Tool + version**: Amazon Vega CLI (`vega` v0.24.12112)
- **What tried**: Running `vega run-app <pkg>` to install and launch on device.
- **Expected**: Installs and launches the application.
- **Actual**: Command frequently hangs or times out without launching the interactive component.
- **EXACT error text**: not reproduced (known issue reported by orchestrator; not run on live device in this turn)
- **Workaround**: Build package via `yarn build:vega` (`react-native build-kepler --build-type Release`), then launch explicitly with `vega device launch-app --appName <component-id>`.

### Friction 2: Plain HTTP cleartext policy on Vega OS
- **Tool + version**: Vega OS / Kepler Runtime (`manifest.toml`)
- **What tried**: Searching for cleartext HTTP permissions or domain allowlists in Vega 0.24 manifest documentation.
- **Expected**: Documented manifest configuration for cleartext HTTP permissions.
- **Actual**: No `[network-traffic-policy.cleartext]` or similar section exists in the official Vega 0.24 manifest documentation (`https://developer.amazon.com/docs/vega/0.24/app-manifest.html`).
- **EXACT error text**: not reproduced (unverified assumption; no cleartext manifest configuration exists in Vega 0.24 docs; must be tested on the Vega Virtual Device on Day 3)
- **Workaround**: Mark section UNVERIFIED in `tv-research.md`. Test plain HTTP (`http://10.0.2.2:8000`) on the Vega Virtual Device on Day 3; fall back to HTTPS tunnel or Lambda URL if blocked.

### Friction 3: Monorepo React version mismatch (React 18 vs 19)
- **Tool + version**: Amazon Kepler SDK / Expo SDK 54 / Yarn Workspaces
- **What tried**: Comparing package dependencies across `@multi-tv/shared-ui`, `apps/expo-multi-tv`, and `apps/vega`.
- **Expected**: Consistent React runtime version.
- **Actual**: `apps/expo-multi-tv` requires React 19.1.0, while Amazon Kepler SDK (`@amazon-devices/react-native-kepler`) is locked to React 18.2.0 and React Native 0.72.0.
- **EXACT error text**: not reproduced (static dependency analysis; package.json inspection only, no build failure run in this turn)
- **Workaround**: Set `packages/shared-ui` peerDependencies to `"react": "*"` and `"react-native": "*"`, and strictly restrict all shared components to React 18-compatible primitives.

TV FIXES DONE
