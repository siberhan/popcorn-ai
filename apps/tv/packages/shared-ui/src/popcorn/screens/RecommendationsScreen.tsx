import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Image, StyleSheet, Animated, Easing } from 'react-native';
import {
  SpatialNavigationFocusableView,
  SpatialNavigationNode,
  SpatialNavigationNodeRef,
  DefaultFocus,
} from 'react-tv-space-navigation';
import { TVState, MovieCard } from '../types';
import { scaledPixels } from '../../hooks/useScale';
import {
  consoleColors,
  consoleLayout,
  consoleType,
  consoleReel,
  consoleReelType,
  consoleReelMotion,
  consoleReelColors,
  consoleGenreTints,
} from '../../theme/console';
import {
  ConsoleBackdrop,
  ConsoleHeader,
  getKidFilterLabel,
  householdOrder,
  discColorIn,
  nameSlug,
  discInitialsForName,
  useBackKey,
  useClock,
} from '../components';

export interface RecommendationsScreenProps {
  state: TVState;
  /** OK on the focused film. */
  onOpen?: (movieId: number) => void;
  /** A film held focus for a second (voice hook). */
  onFilmSettled?: (movieId: number) => void;
  /** OK on the couch avatars in the header: the couch screen. */
  onOpenCouch?: () => void;
  /** Back key or the "Back" pill: the previous screen ("what do you feel like tonight?"). */
  onBack?: () => void;
  /** "New picks" pill in the header: ask for a fresh set without tonight's films. */
  onNewPicks?: () => void;
  /** A picks call is in flight (this TV or another): the header and the empty state say so. */
  picksLoading?: boolean;
  /** A speech item is playing or waiting; narration waits for it. */
  speaking?: boolean;
  /** URL of the narration clip playing now (bars on the focused film move while it plays). */
  narrating?: string | null;
  /** Play a film's `why_audio` (returns false when something else plays). */
  onNarrate?: (path: string) => boolean;
  /** Stop the film narration (focus moved, screen left). */
  onStopNarration?: () => void;
}

interface DisplayItem {
  movie: MovieCard;
  fadingOut: boolean;
}

type Timer = ReturnType<typeof setTimeout>;

const FADE_MS = 1800;
const SWAP_MS = FADE_MS + 100;

const px = scaledPixels;
const R = consoleReel;
const SAFE_X = px(consoleLayout.safeX);
const SAFE_Y = px(consoleLayout.safeY);

// Reel geometry. Every row is laid out at band size and scaled down (from its top-left corner)
// when it is a ghost, so the slide only animates transform and opacity.
const POSTER_W = px(R.posterWidth);
const POSTER_H = px(R.posterHeight);
const GHOST_SCALE = R.ghostPosterWidth / R.posterWidth;
const GHOST_SHIFT_X = (-(1 - GHOST_SCALE) * POSTER_W) / 2;
const GHOST_SHIFT_Y = (-(1 - GHOST_SCALE) * POSTER_H) / 2;
const INFO_SHIFT = px(R.posterWidth - R.ghostPosterWidth); // band text sits further right than ghost text
const Y_BAND = px(R.bandTop);
const Y_ABOVE = px(R.aboveTop);
const Y_BELOW = px(R.belowTop);
const Y_ABOVE_2 = Y_ABOVE - (Y_BAND - Y_ABOVE);
const Y_BELOW_2 = Y_BELOW + (Y_BELOW - Y_BAND);
const GHOST_INFO_H = px(R.ghostInfoHeight);
const GHOST_INFO_BELOW = px(R.ghostInfoInset); // next film: text at the top of its poster
const GHOST_INFO_ABOVE = px(R.ghostPosterHeight - R.ghostInfoInset) - GHOST_INFO_H; // previous film: at the bottom
const GHOST_INFO_BAND = (POSTER_H - GHOST_INFO_H) / 2;
const RING_OUT = px(R.ringGap + R.ring);
const RING_GAP = px(R.ringGap);
const RADIUS = px(R.posterRadius);

const RAIL_STEP = R.railDot + R.railGap;
const RAIL_GROW = R.railBar - R.railDot;
const BAND_CENTER = R.bandTop + R.posterHeight / 2;

const live = (list: MovieCard[]): DisplayItem[] => list.map((movie) => ({ movie, fadingOut: false }));
const picksOf = (state: TVState): MovieCard[] =>
  (Array.isArray(state.recommendations) ? state.recommendations : []).slice(0, R.maxPicks);

function tintFor(movie: MovieCard | undefined): string {
  const genres = movie && Array.isArray(movie.genres) ? movie.genres : [];
  const hit = genres.find((g) => consoleGenreTints[g]);
  return hit ? consoleGenreTints[hit] : consoleColors.fieldTeal;
}

function metaLine(movie: MovieCard): string {
  return [movie.year, ...(movie.genres || []).slice(0, 3)].filter(Boolean).join(' · ');
}

function ghostLine(movie: MovieCard): string {
  return [movie.year, (movie.genres || [])[0]].filter(Boolean).join(' · ');
}

/** "PG kid-safe" -> "Picks stay PG". */
function kidRule(label: string | null): string | null {
  if (!label) return null;
  return `Picks stay ${label.split(' ')[0]}`;
}

/** Dev log for the voice hook (a film held focus for a second). */
function logSettled(movie: MovieCard) {
  if (__DEV__) {
    console.log(`[reel] onFilmSettled ${movie.id} ${movie.title}`);
  }
}

/** Interpolate one row's value from the reel position. Outputs: two below, below, band, above, two above. */
function rowValue(pos: Animated.Value, i: number, out: [number, number, number, number, number]) {
  return pos.interpolate({
    inputRange: [i - 2, i - 1, i, i + 1, i + 2],
    outputRange: out,
    extrapolate: 'clamp',
  });
}

// ---------------------------------------------------------------------------------------------

function ReelPoster({ movie }: { movie: MovieCard }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [movie.poster]);
  const uri = typeof movie.poster === 'string' && movie.poster.startsWith('http') ? movie.poster : null;
  const showImage = Boolean(uri) && !failed;

  return (
    <View style={[styles.poster, { backgroundColor: tintFor(movie) }]}>
      {showImage ? null : (
        <View style={styles.fallback}>
          <Text style={styles.fallbackTitle} numberOfLines={4}>
            {movie.title || 'Untitled'}
          </Text>
          {movie.year ? <Text style={styles.fallbackYear}>{movie.year}</Text> : null}
        </View>
      )}
      {showImage ? (
        <Image
          source={{ uri: uri as string }}
          style={styles.posterImage}
          resizeMode="cover"
          onError={() => setFailed(true)}
        />
      ) : null}
    </View>
  );
}

function VoiceBars({ active }: { active: boolean }) {
  return (
    <View style={[styles.voice, active ? null : styles.voiceQuiet]}>
      {R.voiceBars.map((h, i) => (
        <View key={i} style={[styles.voiceBar, { height: px(h) }]} />
      ))}
    </View>
  );
}

interface ReelRowProps {
  item: DisplayItem;
  i: number;
  pos: Animated.Value;
  fade: Animated.Value;
  /** 1 while the D-pad focus is on the reel, 0 while it is up in the header. */
  reelFocus: Animated.Value;
  narrating: boolean;
}

function ReelRow({ item, i, pos, fade, reelFocus, narrating }: ReelRowProps) {
  const { movie, fadingOut } = item;
  const g = GHOST_SCALE;
  const ghost = R.ghostOpacity;

  const anim = useMemo(
    () => ({
      y: rowValue(pos, i, [Y_BELOW_2, Y_BELOW, Y_BAND, Y_ABOVE, Y_ABOVE_2]),
      opacity: rowValue(pos, i, [0, ghost, 1, ghost, 0]),
      scale: rowValue(pos, i, [g, g, 1, g, g]),
      shiftX: rowValue(pos, i, [GHOST_SHIFT_X, GHOST_SHIFT_X, 0, GHOST_SHIFT_X, GHOST_SHIFT_X]),
      shiftY: rowValue(pos, i, [GHOST_SHIFT_Y, GHOST_SHIFT_Y, 0, GHOST_SHIFT_Y, GHOST_SHIFT_Y]),
      ring: rowValue(pos, i, [0, 0, 1, 0, 0]),
      bandText: pos.interpolate({
        inputRange: [i - 1, i - 0.4, i, i + 0.4, i + 1],
        outputRange: [0, 0, 1, 0, 0],
        extrapolate: 'clamp',
      }),
      bandTextX: rowValue(pos, i, [-INFO_SHIFT, -INFO_SHIFT, 0, -INFO_SHIFT, -INFO_SHIFT]),
      ghostText: pos.interpolate({
        inputRange: [i - 1, i - 0.6, i, i + 0.6, i + 1],
        outputRange: [1, 0, 0, 0, 1],
        extrapolate: 'clamp',
      }),
      ghostTextX: rowValue(pos, i, [0, 0, INFO_SHIFT, 0, 0]),
      ghostTextY: rowValue(pos, i, [
        GHOST_INFO_BELOW,
        GHOST_INFO_BELOW,
        GHOST_INFO_BAND,
        GHOST_INFO_ABOVE,
        GHOST_INFO_ABOVE,
      ]),
    }),
    [pos, i, g, ghost],
  );

  const opacity = fadingOut ? Animated.multiply(anim.opacity, fade) : anim.opacity;
  const why = fadingOut ? 'Not for this couch' : movie.why || movie.overview || '';
  const rating = typeof movie.rating === 'number' && movie.rating > 0 ? movie.rating : null;

  return (
    <Animated.View pointerEvents="none" style={[styles.row, { opacity, transform: [{ translateY: anim.y }] }]}>
      <Animated.View
        style={[
          styles.posterBox,
          { transform: [{ translateX: anim.shiftX }, { translateY: anim.shiftY }, { scale: anim.scale }] },
        ]}
      >
        <Animated.View style={[styles.decor, { opacity: Animated.multiply(anim.ring, reelFocus) }]}>
          <View style={styles.ring} />
          <View style={styles.gap} />
        </Animated.View>
        <ReelPoster movie={movie} />
      </Animated.View>

      <Animated.View
        style={[
          styles.ghostInfo,
          { opacity: anim.ghostText, transform: [{ translateX: anim.ghostTextX }, { translateY: anim.ghostTextY }] },
        ]}
      >
        <Text style={styles.ghostTitle} numberOfLines={1}>
          {movie.title}
        </Text>
        <Text style={styles.ghostMeta} numberOfLines={1}>
          {fadingOut ? 'Not for this couch' : ghostLine(movie)}
        </Text>
      </Animated.View>

      <Animated.View style={[styles.bandInfo, { opacity: anim.bandText, transform: [{ translateX: anim.bandTextX }] }]}>
        <Text style={styles.title} numberOfLines={2}>
          {movie.title}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {metaLine(movie)}
        </Text>
        {rating !== null ? (
          <View style={styles.chips}>
            <View style={styles.ratingPill}>
              <Text style={styles.ratingText}>{`TMDB ${rating.toFixed(1)}`}</Text>
            </View>
          </View>
        ) : null}
        {why ? (
          <View style={styles.why}>
            {fadingOut ? null : <VoiceBars active={narrating} />}
            <Text style={[styles.whyText, fadingOut ? styles.whyRemoved : null]} numberOfLines={3}>
              {why}
            </Text>
          </View>
        ) : null}
      </Animated.View>
    </Animated.View>
  );
}

function Rail({ count, index, pos }: { count: number; index: number; pos: Animated.Value }) {
  const height = (count - 1) * RAIL_STEP + R.railBar;
  const top = BAND_CENTER - height / 2;
  const bar = pos.interpolate({
    inputRange: [0, Math.max(count - 1, 1)],
    outputRange: [0, px(Math.max(count - 1, 1) * RAIL_STEP)],
    extrapolate: 'clamp',
  });
  return (
    <>
      <View pointerEvents="none" style={[styles.rail, { top: px(top), height: px(height) }]}>
        {Array.from({ length: count }, (_, i) => (
          <Animated.View
            key={i}
            style={[
              styles.railDot,
              {
                top: px(i * RAIL_STEP),
                transform: [
                  {
                    translateY: pos.interpolate({
                      inputRange: [i - 1, i],
                      outputRange: [px(RAIL_GROW), 0],
                      extrapolate: 'clamp',
                    }),
                  },
                ],
              },
            ]}
          />
        ))}
        <Animated.View style={[styles.railBar, { transform: [{ translateY: bar }] }]} />
      </View>
      <Text style={[styles.position, { top: px(top + height + 28) }]}>{`${index + 1} of ${count}`}</Text>
    </>
  );
}

interface HeaderPillProps {
  onSelect?: () => void;
  onFocus: () => void;
  children: (focused: boolean) => React.ReactElement;
}

function HeaderFocusable({ onSelect, onFocus, children }: HeaderPillProps) {
  return (
    <SpatialNavigationFocusableView onSelect={() => onSelect?.()} onFocus={onFocus}>
      {({ isFocused }) => children(isFocused)}
    </SpatialNavigationFocusableView>
  );
}

type HeaderSpot = 'back' | 'picks' | 'couch';

interface HeaderRightProps {
  state: TVState;
  onOpenCouch?: () => void;
  onBack?: () => void;
  onNewPicks?: () => void;
  picking: boolean;
  onFocus: (what: HeaderSpot) => void;
}

/** Header right side: "Back", "New picks", then the couch discs and names (OK opens the couch screen), then the clock. */
function HeaderRight({ state, onOpenCouch, onBack, onNewPicks, picking, onFocus }: HeaderRightProps) {
  const clock = useClock();
  const order = householdOrder(state);
  const seated = (Array.isArray(state.members) ? state.members : []).filter((m) => m && m.name);
  return (
    <SpatialNavigationNode orientation="horizontal">
      <View style={styles.headerRight}>
        {onBack ? (
          <HeaderFocusable onSelect={onBack} onFocus={() => onFocus('back')}>
            {(focused) => (
              <View style={[styles.headerPill, focused ? styles.headerPillFocused : null]}>
                <Text style={[styles.headerPillText, focused ? styles.onLight : null]}>Back</Text>
              </View>
            )}
          </HeaderFocusable>
        ) : null}
        <HeaderFocusable onSelect={picking ? undefined : onNewPicks} onFocus={() => onFocus('picks')}>
          {(focused) => (
            <View style={[styles.headerPill, focused ? styles.headerPillFocused : null, picking ? styles.headerPillQuiet : null]}>
              <Text style={[styles.headerPillText, focused ? styles.onLight : null]}>
                {picking ? 'Picking...' : 'New picks'}
              </Text>
            </View>
          )}
        </HeaderFocusable>
        <HeaderFocusable onSelect={onOpenCouch} onFocus={() => onFocus('couch')}>
          {(focused) => (
            <View style={[styles.couchChip, focused ? styles.headerPillFocused : null]}>
              {seated.map((m) => (
                <View
                  key={nameSlug(m.name)}
                  style={[styles.couchDisc, { backgroundColor: discColorIn(order, m.name) }]}
                >
                  <Text style={styles.couchDiscText}>{discInitialsForName(m.name)}</Text>
                </View>
              ))}
              <Text style={[styles.couchNames, focused ? styles.onLight : null]} numberOfLines={1}>
                {seated.length > 0 ? seated.map((m) => m.name).join(', ') : 'Who\u2019s watching?'}
              </Text>
            </View>
          )}
        </HeaderFocusable>
        <Text style={styles.headerClock}>{clock}</Text>
      </View>
    </SpatialNavigationNode>
  );
}

interface HeaderProps {
  state: TVState;
  kidLabel: string | null;
  kept: number | null;
  loading: boolean;
  right: React.ReactNode;
}

function Header({ state, kidLabel, kept, loading, right }: HeaderProps) {
  const rule = kidRule(kidLabel);
  const status = loading
    ? 'Popcorn is picking new films...'
    : [state.message, kept !== null ? `Kept ${kept} kid-safe pick${kept === 1 ? '' : 's'}` : '']
        .filter(Boolean)
        .join(' · ');

  return (
    <>
      <ConsoleHeader state={state} right={right} />
      {status || rule ? (
        <View style={styles.subHeader}>
          {status ? (
            <Text style={styles.status} numberOfLines={1}>
              {status}
            </Text>
          ) : null}
          {rule ? <Text style={styles.rule}>{rule}</Text> : null}
        </View>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------------------------

export default function RecommendationsScreen({
  state,
  onOpen,
  onFilmSettled,
  onOpenCouch,
  onBack,
  onNewPicks,
  picksLoading,
  speaking,
  narrating,
  onNarrate,
  onStopNarration,
}: RecommendationsScreenProps) {
  const members = Array.isArray(state.members) ? state.members : [];
  const kidLabel = getKidFilterLabel(members);
  const kidLabelRef = useRef(kidLabel);
  kidLabelRef.current = kidLabel;

  const [items, setItems] = useState<DisplayItem[]>(() => live(picksOf(state)));
  const [index, setIndex] = useState(0);
  const [focusTarget, setFocusTarget] = useState<number | null>(null);
  const [kept, setKept] = useState<number | null>(null);

  const pos = useRef(new Animated.Value(0)).current;
  const reelFocus = useRef(new Animated.Value(1)).current;
  const [headerFocus, setHeaderFocus] = useState<HeaderSpot | null>(null);
  const fade = useRef(new Animated.Value(1)).current;
  const fadeAnim = useRef<Animated.CompositeAnimation | null>(null);

  const itemsRef = useRef(items);
  itemsRef.current = items;
  const indexRef = useRef(index);
  indexRef.current = index;
  const slotRefs = useRef<(SpatialNavigationNodeRef | null)[]>([]);

  const prevPicks = useRef<MovieCard[]>(picksOf(state));
  const prevVersion = useRef(state.version);
  const pending = useRef<MovieCard[] | null>(null);
  const swapTimer = useRef<Timer | null>(null);
  const keptTimer = useRef<Timer | null>(null);

  const moveTo = (i: number) => {
    indexRef.current = i;
    setIndex(i);
    Animated.timing(pos, {
      toValue: i,
      duration: consoleReelMotion.slideMs,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  };

  /** Jump without a slide (the list itself changed) and move the D-pad focus there. */
  const placeAt = (i: number) => {
    indexRef.current = i;
    setIndex(i);
    pos.setValue(i);
    setFocusTarget(i);
  };

  // After the fade: show the new list. The focused film keeps focus if it survived,
  // otherwise focus stays at the same position, clamped to the shorter list.
  const swapIn = () => {
    swapTimer.current = null;
    const next = pending.current || [];
    pending.current = null;
    const current = itemsRef.current[indexRef.current];
    const same = current && !current.fadingOut ? next.findIndex((m) => m.id === current.movie.id) : -1;
    const target = next.length === 0 ? 0 : same >= 0 ? same : Math.min(indexRef.current, next.length - 1);
    setItems(live(next));
    if (next.length > 0) placeAt(target);
    else {
      indexRef.current = 0;
      setIndex(0);
      pos.setValue(0);
    }
  };

  useEffect(() => {
    if (state.version === prevVersion.current) return;
    prevVersion.current = state.version;
    const incoming = picksOf(state);
    const prev = prevPicks.current;
    prevPicks.current = incoming;

    const nextIds = new Set(incoming.map((m) => m.id));
    const removedIds = new Set(prev.filter((m) => !nextIds.has(m.id)).map((m) => m.id));

    if (removedIds.size > 0) {
      // Removed films stay in their rows and fade out; the swap runs on a timer, never on the
      // animation's end callback (on Vega that callback may never fire).
      setItems(
        prev.map((m) => ({
          movie: incoming.find((n) => n.id === m.id) || m,
          fadingOut: removedIds.has(m.id),
        })),
      );
      pending.current = incoming;
      fadeAnim.current?.stop();
      fade.setValue(1);
      fadeAnim.current = Animated.timing(fade, { toValue: 0, duration: FADE_MS, useNativeDriver: true });
      fadeAnim.current.start();
      if (swapTimer.current) clearTimeout(swapTimer.current);
      swapTimer.current = setTimeout(swapIn, SWAP_MS);

      if (kidLabelRef.current) {
        setKept(incoming.length);
        if (keptTimer.current) clearTimeout(keptTimer.current);
        keptTimer.current = setTimeout(() => {
          keptTimer.current = null;
          setKept(null);
        }, consoleReelMotion.keptMs);
      }
      return;
    }

    if (swapTimer.current) {
      // A fade is running: this list replaces the one waiting to swap in.
      pending.current = incoming;
      return;
    }

    const wasEmpty = itemsRef.current.length === 0;
    setItems(live(incoming));
    if (incoming.length > 0 && (wasEmpty || indexRef.current >= incoming.length)) {
      placeAt(wasEmpty ? 0 : incoming.length - 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once per server version
  }, [state.version]);

  // Imperative focus after the list swapped; runs after the slots (re)registered.
  useEffect(() => {
    if (focusTarget === null) return;
    try {
      slotRefs.current[focusTarget]?.focus();
    } catch {
      // not registered; the D-pad still works
    }
    setFocusTarget(null);
  }, [focusTarget]);

  const onFilmSettledRef = useRef(onFilmSettled);
  onFilmSettledRef.current = onFilmSettled;

  // Voice hook: one call per film that holds focus for a second. Every move restarts the wait.
  const focused = items[index];
  const settledKey = focused && !focused.fadingOut ? `${index}:${focused.movie.id}` : null;
  useEffect(() => {
    if (!settledKey || !focused) return;
    const movie = focused.movie;
    const id = setTimeout(() => {
      logSettled(movie);
      onFilmSettledRef.current?.(movie.id);
    }, consoleReelMotion.settleMs);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the settled film only
  }, [settledKey]);

  // Narration: a film that holds focus for 1.5 s plays its `why_audio` once nothing else plays
  // (it waits for speech to finish). Moving focus, or the film fading out, stops it.
  const onNarrateRef = useRef(onNarrate);
  onNarrateRef.current = onNarrate;
  const onStopRef = useRef(onStopNarration);
  onStopRef.current = onStopNarration;
  const [narrateKey, setNarrateKey] = useState<string | null>(null);
  const narratedKey = useRef<string | null>(null);
  const narrateTarget = settledKey && headerFocus === null ? settledKey : null;
  useEffect(() => {
    narratedKey.current = null;
    setNarrateKey(null);
    onStopRef.current?.();
    if (!narrateTarget) return;
    const id = setTimeout(() => setNarrateKey(narrateTarget), consoleReelMotion.narrateMs);
    return () => clearTimeout(id);
  }, [narrateTarget]);
  useEffect(() => {
    if (!narrateKey || narrateKey !== narrateTarget || speaking) return;
    if (narratedKey.current === narrateKey) return;
    const audio = focused && !focused.fadingOut ? focused.movie.why_audio : null;
    if (!audio) return;
    if (onNarrateRef.current?.(audio)) narratedKey.current = narrateKey;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the wait ends or speech stops
  }, [narrateKey, speaking]);

  useBackKey(() => (onBack ? onBack() : onOpenCouch?.()));

  const focusReel = (i: number) => {
    setHeaderFocus(null);
    Animated.timing(reelFocus, { toValue: 1, duration: 160, useNativeDriver: true }).start();
    moveTo(i);
  };
  const focusHeader = (what: HeaderSpot) => {
    setHeaderFocus(what);
    Animated.timing(reelFocus, { toValue: 0, duration: 160, useNativeDriver: true }).start();
  };

  useEffect(
    () => () => {
      onStopRef.current?.();
      if (swapTimer.current) clearTimeout(swapTimer.current);
      if (keptTimer.current) clearTimeout(keptTimer.current);
      fadeAnim.current?.stop();
    },
    [],
  );

  const tint = tintFor(focused ? focused.movie : undefined);
  const multiple = items.length > 1;

  const hint =
    headerFocus === 'back'
      ? 'OK: change what you feel like \u00B7 Down: back to the films'
      : headerFocus === 'couch'
      ? 'OK: change who\u2019s watching \u00B7 Down: back to the films'
      : headerFocus === 'picks'
        ? picksLoading
          ? 'Picking new films... \u00B7 Down: back to the films'
          : 'OK: ask Popcorn for new picks \u00B7 Down: back to the films'
        : items.length === 0
          ? 'Up: new picks or the couch \u00B7 Back: go back'
          : `${multiple ? 'Up/Down: change film \u00B7 ' : ''}OK: details \u00B7 Up from the top: more \u00B7 Back: go back`;

  return (
    <View style={styles.screen}>
      <ConsoleBackdrop tint={tint} layout="reel" />

      {items.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>{picksLoading ? 'Picking tonight’s films' : 'No picks yet'}</Text>
          <Text style={styles.emptySub}>
            {picksLoading
              ? 'Popcorn is asking for a fresh set. This takes a moment.'
              : 'Go back to the couch and press Popcorn.'}
          </Text>
        </View>
      ) : (
        <>
          {items.map((item, i) => (
            <ReelRow
              key={item.movie.id}
              item={item}
              i={i}
              pos={pos}
              fade={fade}
              reelFocus={reelFocus}
              narrating={
                i === index && Boolean(narrating && item.movie.why_audio && narrating.endsWith(item.movie.why_audio))
              }
            />
          ))}
          {multiple ? <Rail count={items.length} index={index} pos={pos} /> : null}
        </>
      )}
      <Text style={styles.hint}>{hint}</Text>

      {/* Focus order: the header row first, then the reel. Up from the first film reaches the header. */}
      <SpatialNavigationNode orientation="vertical">
        <View style={styles.headerLayer} pointerEvents="box-none">
          <Header
            state={state}
            kidLabel={kidLabel}
            kept={kept}
            loading={Boolean(picksLoading)}
            right={
              <HeaderRight
                state={state}
                onOpenCouch={onOpenCouch}
                onBack={onBack}
                onNewPicks={onNewPicks}
                picking={Boolean(picksLoading)}
                onFocus={focusHeader}
              />
            }
          />
          {items.length > 0 ? (
            /* One invisible focus slot per film: Up and Down move between them, the ends clamp,
             and the reel above follows whichever slot is focused. */
            <SpatialNavigationNode orientation="vertical">
              <View style={styles.slots}>
                {items.map((_, i) => (
                  <DefaultFocus key={`slot-${i}`} enable={i === 0}>
                    <SpatialNavigationFocusableView
                      ref={(node) => {
                        slotRefs.current[i] = node;
                      }}
                      onFocus={() => focusReel(i)}
                      onSelect={() => {
                        const item = itemsRef.current[i];
                        if (item && !item.fadingOut && onOpen) onOpen(item.movie.id);
                      }}
                    >
                      <View style={styles.slot} />
                    </SpatialNavigationFocusableView>
                  </DefaultFocus>
                ))}
              </View>
            </SpatialNavigationNode>
          ) : null}
        </View>
      </SpatialNavigationNode>
    </View>
  );
}

const T = consoleReelType;

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: consoleColors.ground,
    overflow: 'hidden',
  },

  headerLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 10,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
    marginLeft: px(48),
  },
  headerPill: {
    height: px(R.headerPillHeight),
    borderRadius: px(R.headerPillHeight / 2),
    paddingHorizontal: px(24),
    borderWidth: px(2),
    borderColor: consoleReelColors.pillOutline,
    justifyContent: 'center',
    marginRight: px(16),
  },
  headerPillQuiet: {
    opacity: 0.55,
  },
  headerPillFocused: {
    backgroundColor: consoleColors.cta,
    borderColor: consoleColors.cta,
    transform: [{ scale: 1.06 }],
    shadowColor: consoleColors.shadow,
    shadowOpacity: 0.45,
    shadowRadius: px(20),
    shadowOffset: { width: 0, height: px(10) },
  },
  headerPillText: {
    color: consoleColors.text,
    fontSize: px(T.header),
    fontWeight: consoleType.weight.semibold,
  },
  onLight: {
    color: consoleColors.onLight,
  },
  couchChip: {
    height: px(R.headerPillHeight),
    borderRadius: px(R.headerPillHeight / 2),
    paddingLeft: px(6),
    paddingRight: px(20),
    borderWidth: px(2),
    borderColor: 'transparent',
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
  },
  couchDisc: {
    width: px(R.disc),
    height: px(R.disc),
    borderRadius: px(R.disc / 2),
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: px(8),
  },
  couchDiscText: {
    color: consoleColors.text,
    fontSize: px(T.initials),
    fontWeight: consoleType.weight.semibold,
  },
  couchNames: {
    marginLeft: px(6),
    flexShrink: 1,
    color: consoleColors.secondary,
    fontSize: px(T.header),
    fontWeight: consoleType.weight.medium,
  },
  headerClock: {
    marginLeft: px(12),
    color: consoleColors.secondary,
    fontSize: px(T.header),
    fontWeight: consoleType.weight.medium,
  },

  // Header (the top row is ConsoleHeader)
  subHeader: {
    position: 'absolute',
    top: SAFE_Y + px(R.disc + 16),
    right: SAFE_X,
    left: px(800),
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  status: {
    flexShrink: 1,
    color: consoleColors.secondary,
    fontSize: px(T.header),
    fontWeight: consoleType.weight.medium,
  },
  rule: {
    marginLeft: px(24),
    color: consoleColors.secondary,
    fontSize: px(T.small),
    fontWeight: consoleType.weight.medium,
  },

  // Reel rows
  row: {
    position: 'absolute',
    top: 0,
    left: SAFE_X,
    width: px(1920 - consoleLayout.safeX * 2),
    height: POSTER_H,
  },
  posterBox: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: POSTER_W,
    height: POSTER_H,
  },
  decor: {
    ...StyleSheet.absoluteFillObject,
  },
  ring: {
    position: 'absolute',
    top: -RING_OUT,
    left: -RING_OUT,
    width: POSTER_W + RING_OUT * 2,
    height: POSTER_H + RING_OUT * 2,
    borderRadius: RADIUS + RING_OUT,
    borderWidth: px(R.ring),
    borderColor: consoleColors.ring,
  },
  gap: {
    position: 'absolute',
    top: -RING_GAP,
    left: -RING_GAP,
    width: POSTER_W + RING_GAP * 2,
    height: POSTER_H + RING_GAP * 2,
    borderRadius: RADIUS + RING_GAP,
    backgroundColor: consoleColors.ground,
    shadowColor: consoleColors.shadow,
    shadowOpacity: 0.6,
    shadowRadius: px(60),
    shadowOffset: { width: 0, height: px(36) },
    elevation: 16,
  },
  poster: {
    width: POSTER_W,
    height: POSTER_H,
    borderRadius: RADIUS,
    overflow: 'hidden',
  },
  posterImage: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: POSTER_W,
    height: POSTER_H,
  },
  fallback: {
    flex: 1,
    justifyContent: 'flex-end',
    padding: px(32),
  },
  fallbackTitle: {
    color: consoleColors.text,
    fontSize: px(T.fallbackTitle),
    lineHeight: px(48),
    fontWeight: consoleType.weight.semibold,
    letterSpacing: -px(0.6),
  },
  fallbackYear: {
    marginTop: px(10),
    color: consoleColors.text,
    fontSize: px(T.meta),
    fontWeight: consoleType.weight.medium,
  },
  ghostInfo: {
    position: 'absolute',
    top: 0,
    left: px(R.ghostPosterWidth + R.posterGap),
    width: px(R.ghostInfoWidth),
    height: GHOST_INFO_H,
    justifyContent: 'center',
  },
  ghostTitle: {
    color: consoleColors.text,
    fontSize: px(T.ghostTitle),
    lineHeight: px(52),
    fontWeight: consoleType.weight.semibold,
    letterSpacing: -px(0.8),
  },
  ghostMeta: {
    marginTop: px(8),
    color: consoleColors.secondary,
    fontSize: px(T.count),
    fontWeight: consoleType.weight.medium,
  },
  bandInfo: {
    position: 'absolute',
    top: 0,
    left: px(R.posterWidth + R.posterGap),
    width: px(R.infoWidth),
    height: POSTER_H,
    justifyContent: 'center',
  },
  title: {
    color: consoleColors.text,
    fontSize: px(T.title),
    lineHeight: px(68),
    fontWeight: consoleType.weight.semibold,
    letterSpacing: -px(1.2),
  },
  meta: {
    marginTop: px(16),
    color: consoleColors.secondary,
    fontSize: px(T.meta),
    lineHeight: px(34),
    fontWeight: consoleType.weight.medium,
  },
  chips: {
    marginTop: px(26),
    flexDirection: 'row',
    alignItems: 'center',
  },
  ratingPill: {
    height: px(R.pillHeight),
    paddingHorizontal: px(22),
    borderRadius: px(R.pillHeight / 2),
    borderWidth: px(2),
    borderColor: consoleReelColors.pillOutline,
    justifyContent: 'center',
  },
  ratingText: {
    color: consoleColors.text,
    fontSize: px(T.count),
    fontWeight: consoleType.weight.semibold,
  },
  why: {
    marginTop: px(40),
    maxWidth: px(R.whyWidth),
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  voice: {
    height: px(43),
    marginRight: px(22),
    flexDirection: 'row',
    alignItems: 'center',
  },
  voiceQuiet: {
    opacity: 0.45,
  },
  voiceBar: {
    width: px(R.voiceBarWidth),
    borderRadius: px(R.voiceBarWidth / 2),
    backgroundColor: consoleColors.text,
    marginRight: px(6),
  },
  whyText: {
    flexShrink: 1,
    color: consoleColors.text,
    fontSize: px(T.why),
    lineHeight: px(43),
    fontWeight: consoleType.weight.medium,
  },
  whyRemoved: {
    color: consoleColors.secondary,
  },

  // Focus slots (no visuals; the reel draws the focused film)
  slots: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 0,
    height: 0,
    overflow: 'hidden',
  },
  slot: {
    width: 0,
    height: 0,
  },

  // Position rail
  rail: {
    position: 'absolute',
    left: px(R.railX),
    width: px(R.railDot),
  },
  railDot: {
    position: 'absolute',
    left: 0,
    width: px(R.railDot),
    height: px(R.railDot),
    borderRadius: px(R.railDot / 2),
    backgroundColor: consoleReelColors.railDot,
  },
  railBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: px(R.railDot),
    height: px(R.railBar),
    borderRadius: px(R.railDot / 2),
    backgroundColor: consoleColors.text,
  },
  position: {
    position: 'absolute',
    left: px(R.railX + R.railDot / 2 - 60),
    width: px(120),
    textAlign: 'center',
    color: consoleColors.placeholder,
    fontSize: px(T.count),
    fontWeight: consoleType.weight.medium,
  },
  hint: {
    position: 'absolute',
    right: SAFE_X,
    bottom: SAFE_Y,
    color: consoleColors.placeholder,
    fontSize: px(T.small),
    fontWeight: consoleType.weight.medium,
  },

  // Empty
  empty: {
    position: 'absolute',
    left: SAFE_X,
    top: px(R.bandTop + 200),
    right: SAFE_X,
  },
  emptyTitle: {
    color: consoleColors.text,
    fontSize: px(consoleType.info),
    fontWeight: consoleType.weight.semibold,
  },
  emptySub: {
    marginTop: px(14),
    color: consoleColors.secondary,
    fontSize: px(consoleType.secondary),
    fontWeight: consoleType.weight.medium,
  },
});
