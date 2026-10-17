# TV App Research: `react-native-multi-tv-app-sample`

*Researched and verified by ajan1 on 2026-10-17 from the sample at `/private/tmp/claude-501/-Users-bedirhan-Documents-Projects-popcorn-ai/047f9d42-0d0e-4226-934b-0be89bf43b7f/scratchpad/mtv/` and official Vega documentation.*

---

## 1. Structure & Versions

### Monorepo Layout
Source: `package.json` (lines 5-8):
```json
  "workspaces": [
    "apps/*",
    "packages/*"
  ]
```
The monorepo contains:
- `apps/expo-multi-tv/`: Universal TV application targeting Web TV, Android TV, Fire TV (Fire OS), and Apple TV.
- `apps/vega/`: Fire TV Vega OS application built using the Amazon Vega SDK and `@amazon-devices/*` Kepler packages.
- `packages/shared-ui/`: Shared component library holding UI components, screens, theme, and navigation.

### Shared UI Package
- Source: `packages/shared-ui/package.json` (lines 1-23)
- Name: `@multi-tv/shared-ui`
- Entry point: `packages/shared-ui/src/index.ts`
- Peer dependencies: `packages/shared-ui/package.json` lines 13-17:
  ```json
  "peerDependencies": {
    "@react-navigation/native": "*",
    "react": "*",
    "react-native": "*"
  }
  ```
  Both `apps/expo-multi-tv/package.json` (line 27) and `apps/vega/package.json` (line 36) consume it via `"@multi-tv/shared-ui": "workspace:*"`.

### Versions Across Apps
- **Node.js**: `>=18` (managed via `eval "$(fnm env)"; fnm use 24`)
- **Yarn**: `4.5.0` (Source: `package.json` line 9: `"packageManager": "yarn@4.5.0"`)
- **React**:
  - `apps/expo-multi-tv`: `19.1.0` (Source: `apps/expo-multi-tv/package.json` line 44)
  - `apps/vega`: `18.2.0` (Source: `apps/vega/package.json` line 37)
- **React Native**:
  - `apps/expo-multi-tv`: `npm:react-native-tvos@~0.81.0-0` (Source: `apps/expo-multi-tv/package.json` line 46)
  - `apps/vega`: `0.72.0` via `@amazon-devices/react-native-kepler` `^2.0.0` (Source: `apps/vega/package.json` lines 25, 38)
- **React Navigation**:
  - `apps/expo-multi-tv`: `@react-navigation/*` `^7.0.0` (Source: `apps/expo-multi-tv/package.json` lines 28-30)
  - `apps/vega`: `@amazon-devices/react-navigation__*` `~7.0.0` (Source: `apps/vega/package.json` lines 30-34)
- **Spatial Navigation**:
  - `react-tv-space-navigation` `6.0.0-beta1` (Source: `apps/expo-multi-tv/package.json` line 54) / `*` (Source: `apps/vega/package.json` line 42)
- **TypeScript**:
  - `apps/expo-multi-tv`: `~5.7.0` (Source: `apps/expo-multi-tv/package.json` line 74)
  - `apps/vega`: `4.8.4` (Source: `apps/vega/package.json` line 71)

### Exact Build & Run Commands
Source: `package.json` lines 17-25, `README.md` lines 218-262:
- **Web Target**:
  ```bash
  # Start Web development server on port 8082:
  yarn dev:web
  # Or from app directory:
  cd apps/expo-multi-tv && yarn web

  # Production Web build:
  cd apps/expo-multi-tv && npx expo export --platform web && npx serve dist
  ```
- **Vega Target**:
  ```bash
  # Start Vega Metro bundler:
  yarn dev:vega
  # Or:
  cd apps/vega && yarn start

  # Build Vega package (Release):
  yarn build:vega
  # Or:
  cd apps/vega && yarn build    # executes: react-native build-kepler --build-type Release

  # Build Vega package (Debug):
  yarn build:vega:debug         # executes: react-native build-kepler --build-type Debug

  # Deploy & Launch on Device / Virtual Device:
  # (Note: vega run-app often fails to launch the interactive component; use launch-app):
  vega device launch-app --appName com.giolaq.multitv.vega.main
  ```

---

## 2. Screens and Navigation

### How Screens & Navigation are Defined
Navigation is organized into a Stack + Drawer hierarchy:
1. **App Shell**:
   - `packages/shared-ui/src/navigation/AppNavigator.tsx` (lines 37-43) wraps the application in `NavigationContainer`, `MenuProvider`, `GoBackConfiguration`, and `RootNavigator`.
   - On Vega, `apps/vega/src/navigation/VegaAppNavigator.tsx` (lines 38-42) wraps `VegaRootNavigator` using `@amazon-devices/react-navigation__native`.
2. **Root Stack Navigator**:
   - Source: `packages/shared-ui/src/navigation/RootNavigator.tsx` (lines 9-20):
     ```tsx
     <Stack.Navigator screenOptions={{ headerShown: false }}>
       <Stack.Screen name="DrawerNavigator" component={DrawerNavigator} />
       <Stack.Screen name="Details" component={DetailsScreen} />
       <Stack.Screen name="Player" component={PlayerScreen} />
     </Stack.Navigator>
     ```
   - On Vega: `apps/vega/src/navigation/VegaRootNavigator.tsx` (lines 8-19) imports from `@amazon-devices/react-navigation__native-stack` with routes `Main` (VegaDrawerNavigator), `Details`, and `Player`.
3. **Drawer Navigator**:
   - Source: `packages/shared-ui/src/navigation/DrawerNavigator.tsx` (lines 60-92) mounts a side drawer with routes `Home`, `Explore`, `TV`, `Settings`.
   - On Vega: `apps/vega/src/navigation/VegaDrawerNavigator.tsx` (lines 48-85) mounts `VegaCustomDrawerContent`.

### Smallest Way to Replace Sample Screens with Popcorn AI Screens
Popcorn AI's TV app displays the household state broadcast by the MCP server (`/api/state`), which specifies:
`screen: "couch" | "duel" | "recommendations" | "details"`.

Rather than complex drawer navigation, the cleanest replacement is a **State-Driven Screen Switcher**:
1. Keep `AppNavigator` / `VegaAppNavigator` structure.
2. In place of `DrawerNavigator`, mount a root `TVStateScreen` that subscribes to the polled backend state:
   ```tsx
   export default function TVStateScreen() {
     const state = useTVState(BACKEND_URL);

     switch (state?.screen) {
       case 'duel':
         return <DuelScreen duel={state.duel} />;
       case 'recommendations':
         return <RecommendationsScreen recommendations={state.recommendations} />;
       case 'details':
         return <DetailsScreen details={state.details} />;
       case 'couch':
       default:
         return <CouchScreen members={state?.members} message={state?.message} />;
     }
   }
   ```
3. Alternatively, keep standard stack navigation with routes `Couch`, `Duel`, `Recommendations`, `Details` and call `navigation.navigate(...)` whenever `state.screen` changes.

### What Can Be Deleted Safely
- **Video Player**:
  - `packages/shared-ui/src/screens/PlayerScreen.tsx`
  - `packages/shared-ui/src/screens/PlayerScreen.vega.tsx`
  - `packages/shared-ui/src/components/player/` (`VideoPlayer.tsx`, `VideoPlayer.vega.tsx`, `VideoOverlay.tsx`, `Controls.tsx`, `SeekBar.tsx`, `ExitButton.tsx`)
  - `packages/shared-ui/src/utils/VideoHandler.ts` and `VideoHandler.kepler.ts`
- **Placeholder Screens**:
  - `packages/shared-ui/src/screens/ExploreScreen.tsx`
  - `packages/shared-ui/src/screens/TVScreen.tsx`
  - `packages/shared-ui/src/screens/SettingsScreen.tsx`
- **Mock Data**:
  - `packages/shared-ui/src/data/moviesData.ts` (replaced with Popcorn TV state API)
- **Drawer Menu**:
  - `DrawerNavigator.tsx`, `VegaDrawerNavigator.tsx`, and `CustomDrawerContent.tsx` can be completely removed if a full-screen living-room TV interface is preferred over a left sidebar.

---

## 3. D-Pad Focus & Spatial Navigation

### TV Focus Library
- **Library**: `react-tv-space-navigation` (v6.0.0-beta1) built on top of `@bam.tech/lrud` (Source: `packages/shared-ui/package.json`, `apps/expo-multi-tv/package.json` line 54, `apps/vega/package.json` lines 35, 42).
- **Initialization**: `packages/shared-ui/src/app/configureRemoteControl.ts` (lines 5-28) registers the remote control subscriber with `SpatialNavigation.configureRemoteControl`.

### Remote Key Handling
- **Web TV**:
  - Source: `packages/shared-ui/src/app/remote-control/RemoteControlManager.ts` (lines 20-30).
  - Listens to `window.addEventListener('keydown')`, mapping `ArrowRight`, `ArrowLeft`, `ArrowUp`, `ArrowDown`, `Enter`, and `Backspace`.
- **Vega OS (Fire TV)**:
  - Source: `packages/shared-ui/src/app/remote-control/RemoteControlManager.kepler.ts` (lines 26-42).
  - Instantiates React Native's native `TVEventHandler`:
    ```typescript
    const { TVEventHandler } = require('react-native');
    this.tvEventHandler = new TVEventHandler();
    this.tvEventHandler.enable(this, this.handleHWEvent);
    ```
  - Maps hardware key events: `left`, `right`, `down`, `up`, `select`, `back`, `playpause`.
- **Back Key Navigation**:
  - Source: `packages/shared-ui/src/app/remote-control/GoBackConfiguration.tsx` (lines 21-29) intercepts `SupportedKeys.Back` and invokes `navigation.goBack()`.

### Minimal Custom Focusable Component in Sample Style
Adapted from `packages/shared-ui/src/components/FocusablePressable.tsx` (lines 19-49):
```tsx
import React from 'react';
import { Pressable, Text, StyleSheet, ViewStyle } from 'react-native';
import { SpatialNavigationFocusableView } from 'react-tv-space-navigation';
import { scaledPixels } from '../hooks/useScale';

interface FocusableCardProps {
  title: string;
  onSelect: () => void;
  style?: ViewStyle;
}

export const FocusableCard = React.memo(({ title, onSelect, style }: FocusableCardProps) => {
  return (
    <SpatialNavigationFocusableView onSelect={onSelect}>
      {({ isFocused }) => (
        <Pressable
          style={[styles.card, isFocused && styles.cardFocused, style]}
          onPress={onSelect}
        >
          <Text style={[styles.text, isFocused && styles.textFocused]}>
            {title}
          </Text>
        </Pressable>
      )}
    </SpatialNavigationFocusableView>
  );
});

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#1F1814',
    borderWidth: scaledPixels(3),
    borderColor: 'transparent',
    borderRadius: scaledPixels(14),
    padding: scaledPixels(20),
  },
  cardFocused: {
    borderColor: '#F5B942', // Popcorn Gold focus outline
    transform: [{ scale: 1.05 }],
    shadowColor: '#F5B942',
    shadowOpacity: 0.65,
    shadowRadius: scaledPixels(12),
    elevation: 8,
  },
  text: {
    color: '#FAF3E8',
    fontSize: scaledPixels(22),
  },
  textFocused: {
    color: '#FFFFFF',
    fontWeight: 'bold',
  },
});
```

### Initial Focus & Select/Back Keys
- **Initial Focus**: Wrap the default item or list in `<DefaultFocus>` inside `<SpatialNavigationNode>` (Source: `packages/shared-ui/src/screens/HomeScreen.tsx` lines 163-173):
  ```tsx
  <SpatialNavigationNode>
    <DefaultFocus>
      <SpatialNavigationFocusableView onSelect={...}>
        {({ isFocused }) => (...)}
      </SpatialNavigationFocusableView>
    </DefaultFocus>
  </SpatialNavigationNode>
  ```
- **Select Key**: Handled automatically by `onSelect` prop on `SpatialNavigationFocusableView` (triggered by Enter on Web or D-pad Center on Vega).
- **Back Key**: Intercepted globally by `GoBackConfiguration.tsx`.

---

## 4. Remote Data & Vega Network Configuration

### Data Fetching & Remote Images
- **Data Fetching**: Standard `fetch(url)` is used for remote endpoints (Source: `packages/shared-ui/src/data/moviesData.ts` lines 71-83).
- **Remote Images**: Standard React Native `<Image source={{ uri: item.headerImage }} />` (Source: `packages/shared-ui/src/screens/HomeScreen.tsx` lines 37-47).

### Manifest Network Declarations in Sample
Source: `apps/vega/manifest.toml` lines 101-124:
```toml
[[wants.service]]
id = "com.amazon.network.service"

[[needs.privilege]]
id = "com.amazon.network.privilege.net-info"
```
Source documentation:
- https://developer.amazon.com/docs/vega/0.24/app-manifest.html
- https://developer.amazon.com/docs/vega/0.24/manifest-needs.html
- https://developer.amazon.com/docs/vega/0.24/manifest-wants.html

These entries allow the app to query network state (used by `@react-native-community/netinfo` or `@amazon-devices/expo-network`).

### Plain HTTP Support on Vega OS (`http://10.0.2.2:8000`)
- **Official Documentation Check**:
  Official React Native Vega 0.72 documentation at https://developer.amazon.com/docs/react-native-vega/0.72/network.html documents standard `fetch()` and `XMLHttpRequest` usage, noting that CORS does not apply to native apps.
- **Cleartext Policy Status**: **[UNVERIFIED in Vega 0.24 docs]**
  There is no `[network-traffic-policy.cleartext]` in the official Vega 0.24 `manifest.toml` specification (nor in the sample's `apps/vega/manifest.toml`). Whether plain HTTP to `http://10.0.2.2:8000` requires special manifest flags or works transparently via standard `fetch()` is unverified in published documentation.
- **Action for Builder**: Test plain HTTP (`http://10.0.2.2:8000`) directly on the Vega Virtual Device on Day 3. If plain HTTP fails on the virtual device, configure an ngrok/cloudflared HTTPS tunnel or use the HTTPS Lambda URL.

---

## 5. Polling Pattern for TV State (`GET /api/state`)

The TV must poll `GET /api/state` every ~1 second and re-render when `version` changes.

### Recommended Hook Implementation
```typescript
import { useState, useEffect, useRef } from 'react';

export interface TVState {
  version: number;
  screen: 'couch' | 'duel' | 'recommendations' | 'details';
  members: Array<{ name: string; kid?: boolean }>;
  recommendations: Array<{
    title: string;
    year: number;
    match: number;
    why: string;
    poster?: string;
  }>;
  duel?: {
    name: string;
    round: number;
    total: number;
    pair: Array<{ title: string; poster: string; id: string }>;
  };
  details?: any;
  message?: string;
}

export function useTVState(stateUrl: string, intervalMs: number = 1000) {
  const [state, setState] = useState<TVState | null>(null);
  const versionRef = useRef<number>(-1);
  const isMountedRef = useRef<boolean>(true);

  useEffect(() => {
    isMountedRef.current = true;
    let timerId: ReturnType<typeof setTimeout> | null = null;
    let abortController: AbortController | null = null;

    const fetchState = async () => {
      try {
        abortController = new AbortController();
        const response = await fetch(stateUrl, {
          signal: abortController.signal,
          headers: { 'Cache-Control': 'no-cache' },
        });

        if (response.ok) {
          const data: TVState = await response.json();
          // Only trigger React state update if version changed
          if (data.version !== versionRef.current) {
            versionRef.current = data.version;
            if (isMountedRef.current) {
              setState(data);
            }
          }
        }
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          console.warn('[TV Polling] State fetch error:', err.message);
        }
      } finally {
        if (isMountedRef.current) {
          // Recursive setTimeout guarantees no overlapping network requests
          timerId = setTimeout(fetchState, intervalMs);
        }
      }
    };

    fetchState();

    return () => {
      isMountedRef.current = false;
      if (timerId) clearTimeout(timerId);
      if (abortController) abortController.abort();
    };
  }, [stateUrl, intervalMs]);

  return state;
}
```
- **Recursive `setTimeout`**: Prevents request pile-up if the server takes longer than 1 second to respond.
- **`AbortController` support**: Polyfilled in React Native core via `setUpXHR.js` (Source: `apps/vega/node_modules/react-native/Libraries/Core/setUpXHR.js` line 35).

---

## 6. Styling, Animation, & Design Tokens

### Theming System
Theme modules are located in `packages/shared-ui/src/theme/`:
- `colors.ts` (lines 1-46): Palette, background, text, borders, and focus glow colors.
- `typography.ts` (lines 1-29): Font sizes (16px to 56px) optimized for 10-foot viewing distances.
- `safeZones.ts`: Action-safe (5%) and title-safe (10%) TV boundaries.
- `useScale.ts`: `scaledPixels(size)` scaling utility based on standard 1920x1080 canvas.

### Mapping `apps/alexa-web/design/tokens.json` to TV Theme
Source: `apps/alexa-web/design/tokens.json` (lines 8-85).
Map directly into `packages/shared-ui/src/theme/colors.ts`:
```typescript
export const colors = {
  background: '#0D0A08',        // tokens.color.bg.canvas
  backgroundElevated: '#16110E',// tokens.color.bg.elevated
  card: '#1F1814',              // tokens.color.bg.surface
  cardElevated: '#2A201A',      // tokens.color.bg.surfaceHover
  
  text: '#FAF3E8',              // tokens.color.text.primary
  textSecondary: '#D1C2B0',     // tokens.color.text.secondary
  textMuted: '#9E8C78',         // tokens.color.text.muted
  
  primary: '#F5B942',           // tokens.color.accent.popcorn
  accentAmber: '#E8882D',       // tokens.color.accent.amber
  accentEmber: '#D95B26',       // tokens.color.accent.ember
  
  focus: '#F5B942',             // Popcorn Gold focus outline
  focusRing: 'rgba(245, 185, 66, 0.65)',
  
  borderSubtle: '#2C221C',      // tokens.color.border.subtle
  borderDefault: '#3D2F26',     // tokens.color.border.default
  
  kidBadge: '#E8993E',          // tokens.color.status.kidBadge
  kidBadgeBg: 'rgba(232, 153, 62, 0.18)',
};
```

### Animation Support on Vega
- **React Native `Animated`**: Core `Animated` (`Animated.timing`, `Animated.Value`) is fully supported on both Web and Vega OS without extra dependencies.
- **Reanimated**:
  - `apps/vega/package.json` line 26: `"@amazon-devices/react-native-reanimated": "~2.0.0"`
  - `apps/vega/manifest.toml` line 154: `[[needs.module]] id = "/com.amazon.kepler.reanimated_2@IReanimated_0"`
  - For small transitions (cards fading out when a kid joins), standard `Animated.timing` with `useNativeDriver: true` is recommended for 100% universal compatibility across targets.

### Fonts
- **Web**: Google Fonts (`Fraunces` and `Plus Jakarta Sans`) can be loaded via `@import` in `index.html` or via `expo-font` in `App.tsx`.
- **Vega**: In `apps/vega/src/App.tsx` (line 9), `fontsLoaded={true}` is hardcoded and uses standard System fonts (`fontFamily: 'System'`). Custom font loading on Vega requires compiling TTFs into the Kepler asset bundle. System fonts with appropriate weights (`'600'`, `'bold'`) are recommended for Day 3.

---

## 7. Known Gotchas & Troubleshooting

1. **`vega run-app` Execution Failure**:
   - `vega run-app` often hangs or fails to launch the interactive component on virtual devices.
   - **Workaround**: Build with `yarn build:vega`, then launch using `vega device launch-app --appName com.giolaq.multitv.vega.main`.
2. **Component ID Matching**:
   - The `--appName` flag in `launch-app` MUST match the component ID in `apps/vega/manifest.toml` line 18:
     `[[components.interactive]] id = "com.giolaq.multitv.vega.main"`.
3. **React 18 vs React 19 Version Mismatch**:
   - `apps/expo-multi-tv` runs **React 19.1.0** (`apps/expo-multi-tv/package.json` line 44).
   - `apps/vega` runs **React 18.2.0** (`apps/vega/package.json` line 37).
   - Any component in `packages/shared-ui` MUST be compatible with React 18 (do not use React 19-only hooks like `useActionState`).
4. **Spatial Navigation Active State Lock**:
   - If `SpatialNavigationRoot` receives `isActive={false}`, all keyboard and D-pad events are ignored. Ensure `isActive={true}` when the screen is focused.
5. **Web Spatial Navigation requires Keyboard Interaction**:
   - On Web TV, spatial navigation focus is initialized upon the first keyboard arrow key press. Mouse clicks do not automatically grant spatial navigation focus.
6. **Metro Port Collision**:
   - If port 8081 is busy, start with `--port 8082` (`yarn dev:web` defaults to 8082).
