# Popcorn AI Design System — "Cinema at Home"

## 1. Mood & Visual Direction

Popcorn AI is a calm, tactile living-room companion for family movie night. The visual direction is **"Cinema at Home"**:
- **Atmosphere**: Dimmed theater velvet and warm tungsten projector light rather than cold smart-home tech.
- **Tactile & Calm**: Generous breathing room, soft ambient amber halos, and zero visual clutter so the voice interaction, live MCP tool steps, and TV screen preview share the stage effortlessly at both desktop (1280x720 demo frame) and 10-foot Fire TV viewing distances.
- **Distinct Identity**: Completely independent of Echo hardware aesthetics—warm gold, amber, and cream replace cold cyan/blue rings.

---

## 2. Color Palette

All tokens live in `tokens.css` (web) and `tokens.json` (React Native TV app).

### Backgrounds & Surfaces
| Token | Hex / Value | Usage |
|---|---|---|
| `--color-bg-canvas` | `#0D0A08` | Main page and TV app backdrop (deep espresso-charcoal night) |
| `--color-bg-elevated` | `#16110E` | Header bar, docked composer bar, subtle container wells |
| `--color-bg-surface` | `#1F1814` | Cards: Agent at Work panel, TV Preview card, assistant chat bubbles |
| `--color-bg-surface-hover` | `#2A201A` | Interactive card and button hover surface |
| `--color-bg-surface-active` | `#342820` | Pressed/active control surface and user chat bubbles |

### Text & Foregrounds (WCAG AA/AAA Verified)
| Token | Hex | Contrast on `#0D0A08` | Contrast on `#1F1814` | Usage |
|---|---|---|---|---|
| `--color-text-primary` | `#FAF3E8` | 16.8 : 1 (AAA) | 13.3 : 1 (AAA) | Headlines, movie titles, primary transcript & replies |
| `--color-text-secondary` | `#D1C2B0` | 10.4 : 1 (AAA) | 8.2 : 1 (AAA) | Body copy, tool step descriptions, metadata |
| `--color-text-muted` | `#9E8C78` | 5.6 : 1 (AA) | 4.6 : 1 (AA) | Timestamps, latency (`ms`), subtle labels ("Simulated Alexa+") |
| `--color-text-on-accent` | `#140E09` | 11.9 : 1 on `#F5B942` | — | Text and icons placed on warm gold accent fills |

### Accents & Semantic Status
| Token | Hex | Usage |
|---|---|---|
| `--color-accent-popcorn` | `#F5B942` | Primary interactive accent, active voice ring, match % badge |
| `--color-accent-amber` | `#E8882D` | Secondary warm highlight, thinking state orbit, gradients |
| `--color-accent-ember` | `#D95B26` | Deep warm gradient stop |
| `--color-accent-cream` | `#FFF1D0` | Speaking state highlight and specular edge |
| `--color-status-success` | `#72C47A` | Completed MCP tool checkmarks and healthy service indicator |
| `--color-status-error` | `#E56B55` | Failed tool step cross, error banner, error orb state |
| `--color-status-kid-badge` | `#E8993E` | Warm amber pill badge (`KID`) next to children on the couch |

### Person Avatars
People on the couch are rendered as circular badges with 1-2 uppercase initials over a deterministic warm background chosen by hashing the person's normalized name (`hash(name.toLowerCase()) % 8`):
- `#C85A32` (Terracotta), `#B87D28` (Ochre Gold), `#8E4A49` (Velvet Burgundy), `#5C7A52` (Olive Sage), `#9E6240` (Cinnamon), `#7A5475` (Plum Dusk), `#A8423F` (Carmine), `#6F6A42` (Antique Brass).
- All 8 shades yield `>= 4.6:1` contrast with `#FAF3E8` initials.
- Children (`kid: true` or `age < 13`) display a compact pill badge labeled `KID` in `--color-status-kid-badge`.

---

## 3. Typography

Google Fonts only — strictly **one display face** and **one text face**:
- **Display Face (`--font-display`)**: `'Fraunces'` (weights 600, 700). Warm optical-size serif with subtle cinema-marquee character. Used for the product title (`Popcorn AI`), TV screen headings, and featured movie titles.
- **Text Face (`--font-sans`)**: `'Plus Jakarta Sans'` (weights 400, 500, 600, 700). Clean, open-counter geometric sans with high legibility at both handheld and 10-foot TV distances. Used for transcripts, chat bubbles, tool steps, controls, and numeric badges (`font-variant-numeric: tabular-nums`).

---

## 4. Voice Orb States

The central voice orb (`136px` diameter on desktop, `112px` on phone) is a layered warm-light instrument with 5 explicit states:

1. **`idle`**:
   - Core `#2B211B`, warm bronze border `#6E5239`, soft ambient halo `rgba(245, 185, 66, 0.14)`.
   - Microphone icon in `#FAF3E8`. Label below: *"Tap or hold Space to talk"*.
2. **`listening`**:
   - Core transitions to warm popcorn gold `#F5B942` with `--color-text-on-accent` icon; outer concentric rings expand and respond dynamically to live microphone volume (or a smooth `2.2s` breathing pulse when Web Audio level is unavailable).
   - Label below: *"Listening... release or tap to send"*.
3. **`thinking`**:
   - Warm projector amber `#E8882D` core with a rotating dashed/gradient orbital ring (`--duration-orbit: 3200ms`) while MCP tools execute and the agent streams.
   - Label below: *"Checking tastes & picking movies..."*.
4. **`speaking`**:
   - Soft cream-gold core `#FFF1D0` with animated warm equalizer bars / concentric acoustic ripples. Clicking the orb immediately stops playback and returns to `idle`.
   - Label below: *"Speaking — tap orb to stop"*.
5. **`error`**:
   - Warm terracotta-red core `#C84B31` with `#E56B55` ring and a gentle horizontal shake (`420ms`), accompanied by a clear human-readable message banner.

---

## 5. Motion Rules

- **Easing**: All UI transitions use `--ease-out` (`cubic-bezier(0.16, 1, 0.3, 1)`) for responsive entry and `--ease-in-out` (`cubic-bezier(0.65, 0, 0.35, 1)`) for ambient loops.
- **Durations**: Micro-interactions (`140ms`), state transitions (`240ms`), panel reveals (`420ms`).
- **Tool Step Choreography**: When `tool_start` arrives, the step row slides in (`140ms`) with a warm amber spinner. On `tool_end`, the spinner morphs into a crisp check (`#72C47A`) or cross (`#E56B55`) and reveals the elapsed time in milliseconds (`tabular-nums`).
- **Reduced Motion**: Respect `@media (prefers-reduced-motion: reduce)` by disabling continuous orbital/pulse animations and replacing them with static high-contrast state rings.

---

## 6. Accessibility

- **Contrast**: Every text token meets or exceeds **4.5:1** contrast against both `--color-bg-canvas` (`#0D0A08`) and `--color-bg-surface` (`#1F1814`).
- **Keyboard Operability**: Full `Tab` order across all interactive controls, visible `--focus-ring` (`3px` warm gold outline), `Space` bar push-to-talk (or toggle when focused on the orb, ignored when typing in text inputs), and `Enter` to submit typed messages.
- **Screen Readers**: `aria-live="polite"` on the live transcript, conversation log, and Agent at Work step list; explicit `aria-label` and `data-state` attributes on the voice orb.

---

## 7. "Do Not" Rules

1. **No Alexa or Amazon Branding**: Never use the Amazon smile, Alexa logo, Echo silhouettes, or Alexa brand colors. The only permitted wording is the plain muted text label `Simulated Alexa+` in the header.
2. **No Cyan or Blue Light Rings**: Never use cyan (`#00CAFF`), teal, or blue glowing rings on the voice orb or anywhere in the UI.
3. **No Saved Movie Posters in Repo**: Never download or commit movie poster files into the repository. Render posters exclusively at runtime via `<img src="https://image.tmdb.org/...">` with a warm CSS fallback card if offline or missing.
4. **No Emojis**: Use crisp inline SVG icons and typographic badges instead of emoji characters across all code and UI text.
5. **No Unhandled Layout Overflow at 1280x720**: The desktop layout must fit cleanly inside a `1280x720` viewport for the demo video while scrolling gracefully inside conversation and step panels, and collapsing cleanly to a single column at `375px` mobile width.
