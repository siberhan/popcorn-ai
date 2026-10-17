# Popcorn AI — 10-Foot Fire TV Design Spec (`1920x1080`)

This document extends `DESIGN.md` and `tokens.json` ("Cinema at Home") to the 10-foot living-room Fire TV surface (`apps/tv/`).

---

## 1. 10-Foot Canvas & Safe Area Rules

- **Reference Canvas**: `1920 x 1080` (`16:9` landscape), scaled proportionally via `scaledPixels(size)`.
- **Overscan / Action-Safe Area (`5%`)**:
  - Horizontal padding: `96px` left and right (`5%` of `1920px`).
  - Vertical padding: `54px` top and bottom (`5%` of `1080px`).
  - Usable stage: `1728 x 972`. No text, badge, or focus ring may cross the `5%` boundary.
- **Top Chrome (`CouchBar`)**:
  - Persistent across all four screens at the top of the safe area (`height: 88px`).
  - Left: `Popcorn AI` wordmark + active screen pill (`COUCH`, `POSTER DUEL`, `TONIGHT'S PICKS`, `MOVIE DETAILS`).
  - Center: Member chips (deterministic colored circle with initials + name + `KID` badge) and Kid-Safe certification badge (`PG KID-SAFE` when any member has `kid: true` or `age < 13`; `PG-13 KID-SAFE` when any member has `13 <= age < 17`).
  - Right: `state.message` status toast pill when non-empty (e.g., `"Saved: Inception"`).

---

## 2. Typography & Minimum Text Sizes

- **Faces**: System UI / Display on Vega OS (`fontWeight: '600' | '700'`); `Fraunces` (display) and `Plus Jakarta Sans` (body) on Web TV when loaded.
- **10-Foot Minimums** (on `1920x1080` reference):
  - **Minimum readable text / badge (`xs`)**: `18px` (`scaledPixels(18)`) — uppercase tracking for `KID` / certification pills only.
  - **Metadata / secondary copy (`sm`)**: `22px` (`scaledPixels(22)`) — genres, years, "why" lines.
  - **Body / overview / member tastes (`md`)**: `26px` (`scaledPixels(26)`), line-height `36px`.
  - **Card titles & primary buttons (`lg`)**: `30px` (`scaledPixels(30)`).
  - **Section headers & duel prompt (`xl`)**: `42px` (`scaledPixels(42)`).
  - **Hero movie title (`2xl`)**: `54px` (`scaledPixels(54)`).

---

## 3. D-Pad Focus & Motion Rules

- **Spatial Navigation**: Powered by `SpatialNavigationFocusableView` and `DefaultFocus` (`react-tv-space-navigation`).
- **Focus Ring & Elevation**:
  - Unfocused border: `3px solid #2C221C` (or `#3D2F26` on interactive cards).
  - Focused border: `4px solid #F5B942` (Popcorn Gold, `--color-accent-popcorn`).
  - Focused surface: `#2A201A` with warm ambient shadow (`shadowColor: '#F5B942'`, `shadowOpacity: 0.65`, `shadowRadius: 18`, `elevation: 10`).
  - Focused scale: `1.05x` on standard cards/buttons, `1.06x` on Duel posters (animated via React Native `Animated.spring` / `Animated.timing`).
- **Strict No-Cyan Rule**: Focus indicators use warm gold `#F5B942` and cream `#FFF1D0` only—never cyan or blue.

---

## 4. Layout of the Four Screens

### 1. `CouchScreen` (`screen === 'couch'`)
- **Header**: Persistent `CouchBar` + headline `"Who's on the couch tonight?"`.
- **Center Grid**: Large horizontal row of focusable member cards (`width: 360px`, `height: 430px`):
  - `96px` circular avatar in deterministic warm hue (`hash(name.toLowerCase()) % 8`) with bold initials.
  - Member name (`34px`) + `KID` pill badge (`#E8993E`) when `member.kid` or `age < 13`.
  - Taste summary:
    - If `member.new === true`: warm amber callout pill `"No taste memory yet"` + hint `"Say 'start a poster duel' to learn their taste"`.
    - Otherwise: top `loves` / `likes` genre pills and a subtle `"Dislikes: ..."` line.
  - Focusing and pressing Select (`Enter` / D-pad center) on a member card prompts/triggers removal (`onRemoveMember(member.name)`), with a clear focus caption `"Press Select to remove from couch"`.
- **Bottom Action Bar**: Default-focused primary CTA button `"Show picks for this couch"` (`onShowPicks()`), styled in Popcorn Gold `#F5B942` with dark `#140E09` text.

### 2. `DuelScreen` (`screen === 'duel'`)
- **Header**: Persistent `CouchBar` + centered prompt `"<duel.name>, pick a poster"` and progress pill `"Round <round + 1> of <total>"`.
- **Stage**: Two oversized poster cards side by side (`width: 560px`, `height: 700px`, gap `96px`), with a subtle `"OR"` medallion between them:
  - Left card (`DefaultFocus`, `onSelect={() => onPick('left')}`) and Right card (`onSelect={() => onPick('right')}`).
  - Each card renders a large `2:3` TMDB poster (`340 x 500`), movie title (`32px`), year, and genre pills.
  - D-pad Left/Right moves focus between the two posters; the focused poster scales to `1.06x` with a bright `#F5B942` border and warm spotlight halo.

### 3. `RecommendationsScreen` (`screen === 'recommendations'`)
- **Header**: Persistent `CouchBar` + subheader row with tonight's mood chips (`state.boost`, e.g. `Mood: comedy`) and active Kid-Safe filter pill (`PG KID-SAFE` / `PG-13 KID-SAFE`).
- **Grid**: 3-column x 2-row card grid (`6` picks, `width: 548px`, `height: 360px` horizontal cinema cards so all 6 fit inside the `1920x1080` safe area without clipping):
  - Left of card: `190 x 285` poster (`PosterCard` with typographic fallback when `poster` is null or fails).
  - Right of card: `MatchPill` (`96% MATCH` in `#F5B942`), movie title (`30px`), release year + TMDB rating, genre tags, and the highlighted `"why"` explanation line (`"Bedirhan loves science fiction · Ayse loves comedy"`).
- **Kid-Joins Fade-Out Transition**:
  - Tracks previous recommendation list across `state.version` updates. When a movie disappears from `state.recommendations` (e.g., an adult movie filtered out when a child joins the couch), the removed card remains rendered briefly while animating `opacity: 1 -> 0` and `scale: 1 -> 0.92` over `450ms` (`Animated.timing`) with a `"Filtered for kid-safe couch"` badge before unmounting.

### 4. `DetailsScreen` (`screen === 'details'`)
- **Header**: Persistent `CouchBar`.
- **2-Column Cinema Stage**:
  - **Left Column (`460px`)**: Large high-impact poster (`420 x 630`) with warm elevation shadow.
  - **Right Column (`1200px`)**:
    - Prominent safety banner when `details.ok_for_this_couch === false`: high-contrast terracotta alert bar (`#C84B31` / `#E56B55`) reading `"Not OK for this couch — exceeds kid-safe rating"`. When `true`, shows `"OK for everyone on the couch"`.
    - Movie title (`54px`) + tagline (`26px` italic secondary).
    - Metadata row: Year, US Certification badge (`PG`, `PG-13`, `R`), Runtime (`118 min`), TMDB Rating (`8.1 / 10`), and Genre pills.
    - Full plot `overview` (`28px`, max 4 lines comfortable measure).
    - Credits block: **Director** and top **Cast** pills.
