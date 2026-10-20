// Tokens for the console-style couch, favorites, and recommendations screens and their components.
// The details screen still uses colors.ts / typography.ts.

export const consoleColors = {
  ground: '#0B0D12',
  text: '#FFFFFF',
  secondary: '#B4BCCB',
  placeholder: '#8F98AB', // 5.5:1 on field
  onLight: '#0B0D12', // near-black on white pills
  ring: '#FFFFFF',
  shadow: '#000000',
  cta: '#FFFFFF',
  addDisc: 'rgba(255, 255, 255, 0.08)',
  addDiscFocused: 'rgba(255, 255, 255, 0.16)',
  field: '#1C2230',
  fieldEditing: '#262D3D',
  outline: 'rgba(255, 255, 255, 0.55)',
  danger: '#F28B82', // 8.1:1 on ground
  // Backdrop fields (tinted copies of one white blob image)
  fieldTeal: '#2C5C78',
  fieldRust: '#96582E',
};

/**
 * Person discs: deep, slightly cool, every one keeps white initials at 4.5:1 or better.
 * Order matters: the name hash picks the index (see avatarUtils.consoleDiscColorForName).
 */
export const consoleDiscs = [
  '#8A5A12', // ochre      5.91:1
  '#4A5A72', // slate      7.01:1
  '#A3415F', // rose       6.04:1
  '#2B5EAE', // blue       6.33:1
  '#6B3F4E', // plum-brown 8.58:1
  '#1F6475', // deep teal  6.69:1
  '#226B55', // green      6.36:1
  '#8E4A2E', // brick      6.63:1
];

export const consoleType = {
  title: 60,
  info: 40,
  name: 30,
  header: 28,
  secondary: 26,
  credit: 20,
  chip: 18,
  weight: {
    medium: '500' as const,
    semibold: '600' as const,
  },
};

export const consoleLayout = {
  safeX: 96,
  safeY: 54,
  titleTop: 170,
  rowTop: 390,
  disc: 180,
  discGap: 44,
  discCompact: 128,
  discGapCompact: 28,
  focusScale: 1.22,
  ring: 6,
  checkBadge: 48,
  ctaHeight: 88,
  fieldHeight: 80,
};

export const consoleMotion = {
  focusMs: 160,
  tintMs: 600,
  driftMs: 26000,
};

export const consoleBackdrop = {
  fieldOpacity: 0.55,
  rustOpacity: 0.35,
};

/** Recommendations reel: one film in the band, its neighbours as faded ghost rows. */
export const consoleReel = {
  maxPicks: 6,
  posterWidth: 380,
  posterHeight: 570,
  ghostPosterWidth: 220,
  ghostPosterHeight: 330,
  posterRadius: 14,
  posterGap: 56, // poster to info column
  ghostOpacity: 0.16,
  bandTop: 250,
  aboveTop: -150, // previous film: only its lower part shows
  belowTop: 950, // next film: only its upper part shows
  infoWidth: 1180,
  whyWidth: 900,
  ghostInfoWidth: 700,
  ghostInfoHeight: 100,
  ghostInfoInset: 20, // ghost text sits on the visible side of the ghost poster
  ringGap: 6,
  ring: 6,
  pillHeight: 52,
  chipHeight: 40,
  disc: 40,
  railX: 1800,
  railDot: 10,
  railBar: 42,
  railGap: 14,
  voiceBars: [16, 32, 22, 12],
  voiceBarWidth: 6,
  headerPillHeight: 52,
};

export const consoleReelType = {
  title: 60,
  ghostTitle: 44,
  why: 32,
  meta: 26,
  header: 24,
  count: 24,
  small: 22,
  initials: 20,
  fallbackTitle: 40,
};

export const consoleReelMotion = {
  slideMs: 450,
  settleMs: 1000, // a film has to hold focus this long before the voice hook runs
  narrateMs: 1500, // ...and this long before its spoken sentence plays
  keptMs: 4000,
};

export const consoleReelColors = {
  pillOutline: 'rgba(255, 255, 255, 0.35)',
  railDot: 'rgba(255, 255, 255, 0.3)',
};

/**
 * Backdrop tint per TMDB genre name, all muted and deep. White keeps 5.8:1 or better on every one,
 * so they also serve as the no-poster tile colour. The first listed genre of a film that has an
 * entry wins; anything else falls back to the couch teal.
 */
export const consoleGenreTints: Record<string, string> = {
  'Science Fiction': '#1F5F6B', // deep teal   7.22:1
  Animation: '#2C5A96', // blue        6.98:1
  Action: '#8A4526', // rust        7.09:1
  Drama: '#5E3B4C', // plum-brown  9.52:1
  Comedy: '#80601F', // ochre       5.82:1
  Horror: '#5E2A22', // red-brown  11.47:1
  Fantasy: '#4B4278', // violet      8.94:1
  Family: '#2F6650', // green       6.69:1
  Thriller: '#3D4C63', // slate       8.71:1
  Romance: '#7A3D4F', // rose-brown  8.05:1
  Adventure: '#3F6146', // forest      6.98:1
};

/** Film details: the TMDB backdrop as the hero, info column on a ground scrim, provider pills low. */
export const consoleDetails = {
  backdropLeft: 640,
  backdropWidth: 1280,
  infoTop: 260,
  infoWidth: 960,
  // Left-to-right scrim stops (x as a share of the width, ground opacity).
  scrimStops: [
    [0, 1],
    [0.33, 1],
    [0.48, 0.85],
    [0.75, 0.2],
    [1, 0.2],
  ] as [number, number][],
  scrimStrips: 40,
  bottomScrimShare: 0.35, // bottom scrim fades from 0.8 to clear over this share of the height
  bottomScrimOpacity: 0.8,
  bottomScrimStrips: 18,
  topScrimHeight: 220, // keeps the header names readable over a bright backdrop
  topScrimOpacity: 0.75,
  topScrimStrips: 36,
  longTitleChars: 30, // longer titles may wrap to two lines; the overview drops to 3 lines
  chipHeight: 48,
  watchBottom: 120,
  pillHeight: 84,
  pillPadding: 34,
  pillGap: 20,
  pillNameMax: 300,
  logo: 44,
  logoRadius: 10,
  focusScale: 1.06,
  footerBottom: 40,
  disc: 40,
};

export const consoleDetailsType = {
  title: 64,
  meta: 26,
  chip: 22,
  overview: 28,
  overviewLine: 40,
  credits: 24,
  watchLabel: 26,
  pillName: 28,
  pillKind: 22,
  handoff: 32,
  footer: 22,
};

export const consoleDetailsColors = {
  pill: 'rgba(28, 34, 48, 0.9)',
  kindOnLight: '#3A4150', // 9.9:1 on white
  chipOutline: 'rgba(255, 255, 255, 0.4)',
  logoFallback: '#1C2230',
};

export const consoleDetailsMotion = {
  backdropMs: 600,
  backdropScale: 1.04,
  riseMs: 520,
  rise: 24,
  staggerMs: 80,
};

/** Family rating: the film above, one person in the spotlight, five written answers, the QR aside. */
export const consoleRating = {
  filmTop: 70,
  posterWidth: 120,
  posterHeight: 180,
  posterRadius: 10,
  titleGap: 26,
  centerTop: 280,
  disc: 140,
  discGap: 8,
  discRing: 5,
  quoteGap: 24,
  quoteWidth: 1100,
  quoteLines: 2,
  barsHeight: 50,
  barWidth: 8,
  barGap: 8,
  bars: [16, 40, 28, 46, 20, 12], // peak heights while they talk on the phone
  barIdle: 8,
  pillHeight: 76,
  pillGap: 20,
  pillPadding: 30,
  skipGap: 20,
  qrTop: 340,
  hintBottom: 50,
  fieldOpacity: 0.75,
  focusScale: 1.06,
  quietOpacity: 0.4,
};

export const consoleRatingType = {
  initials: 52,
  filmTitle: 46,
  question: 38,
  quote: 48,
  quoteLine: 62,
  quoteSpoken: 34,
  pill: 28,
  hint: 22,
  status: 40,
};

export const consoleRatingColors = {
  pillOutline: 'rgba(255, 255, 255, 0.3)',
};

export const consoleRatingMotion = {
  liveMs: 1200, // bars move while `live` changed this recently
  barMs: [210, 260, 190, 240, 280, 200],
};

/** Voice bar: the bottom strip for captions, "Listening..." and "Thinking...", on every screen. */
export const consoleVoice = {
  bottom: 96, // above the screens' bottom hint lines
  maxWidth: 1240,
  minHeight: 76,
  radius: 38,
  padX: 36,
  padY: 16,
  bars: [14, 30, 22, 34, 18], // peak heights while listening
  barsHeight: 34,
  barWidth: 6,
  barGap: 6,
  barIdle: 6,
  dot: 10,
  dotGap: 8,
  captionLines: 2,
  listenStaleMs: 15000, // "Listening..." with no new words this long: hide
  thinkStaleMs: 60000,
};

export const consoleVoiceType = {
  label: 24,
  text: 30,
  textLine: 40,
};

export const consoleVoiceColors = {
  bar: 'rgba(11, 13, 18, 0.92)',
  outline: 'rgba(255, 255, 255, 0.14)',
};

export const consoleVoiceMotion = {
  inMs: 220,
  barMs: [230, 280, 200, 260, 300],
  dotMs: 420,
};

/** The phone QR on the rating screen: one code and the one line under it. */
export const consoleQr = {
  rating: 300,
  pad: 16, // white frame around the code (on top of its own quiet zone)
  radius: 18,
};

export const consoleQrType = {
  caption: 26,
};

/** Genres screen: a five-column grid of genre pills, then Continue. */
export const consoleGenres = {
  gridTop: 366,
  cellHeight: 88,
  gapX: 20,
  gapY: 20,
  chipPadX: 26,
  ring: 4, // focus ring drawn inside the cell, with a gap of ground
  ringGap: 4,
  tick: 3, // stroke of the check mark on a chosen genre
  ctaRing: 9, // the Continue button draws its ring outside its pill
};

export const consoleGenresType = {
  chip: 26,
  sub: 26,
  count: 30,
};

/** Favorite films screen: 5-column grid of posters, count line, search. */
export const consoleFavorites = {
  columns: 5,
  // 5 posters fit between the side Back/Done buttons: sideX + 5 * posterWidth + 4 * gapX + sideX = 1920
  sideX: 140,
  posterWidth: 296,
  posterHeight: 418,
  posterRadius: 14,
  gapX: 40,
  gapY: 36,
  badgeSize: 36,
  ring: 4,
  focusScale: 1.04,
};

export const consoleFavoritesType = {
  title: 48,
  sub: 26,
  count: 26,
  section: 32,
  cardTitle: 22,
  cardMeta: 18,
};
