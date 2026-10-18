import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Image, StyleSheet, Animated, Easing, LayoutChangeEvent } from 'react-native';
import {
  SpatialNavigationFocusableView,
  SpatialNavigationNode,
  SpatialNavigationNodeRef,
  DefaultFocus,
} from 'react-tv-space-navigation';
import { TVState, Reaction, Rating, RatingAnswer } from '../types';
import { scaledPixels } from '../../hooks/useScale';
import {
  consoleColors,
  consoleLayout,
  consoleType,
  consoleGenreTints,
  consoleRating,
  consoleRatingType,
  consoleRatingColors,
  consoleRatingMotion,
} from '../../theme/console';
import {
  ConsoleBackdrop,
  ConsoleHeader,
  discColorIn,
  discInitialsForName,
  householdOrder,
  nameSlug,
  useBackKey,
  useClock,
} from '../components';

export interface RatingScreenProps {
  state: TVState;
  /** A hand-rating pill for the person being asked. */
  onRate?: (name: string, reaction: Reaction) => void;
  /** Skip the person being asked. */
  onSkip?: () => void;
  /** Back: save what is answered so far. */
  onFinish?: () => void;
  /** "Back to the couch" on the saved view. */
  onDone?: () => void;
}

type Timer = ReturnType<typeof setTimeout>;

const px = scaledPixels;
const R = consoleRating;
const T = consoleRatingType;
const MO = consoleRatingMotion;
const W = 1920;
const SAFE_X = px(consoleLayout.safeX);
const SAFE_Y = px(consoleLayout.safeY);

const REACTIONS: { reaction: Reaction; label: string }[] = [
  { reaction: 'loved', label: 'Loved it' },
  { reaction: 'liked', label: 'Liked it' },
  { reaction: 'meh', label: 'It was fine' },
  { reaction: 'disliked', label: 'Didn’t like it' },
  { reaction: 'hated', label: 'Hated it' },
];
const LABEL: Record<Reaction, string> = REACTIONS.reduce(
  (acc, r) => ({ ...acc, [r.reaction]: r.label }),
  {} as Record<Reaction, string>,
);

const HAND = 'hand';
const SKIP = 'skip';
const COUCH = 'couch';
const pillId = (r: Reaction) => `r-${r}`;

// The big disc box: disc, ground gap and ring.
const BIG_BOX = R.disc + 2 * (R.discGap + R.discRing);
const BIG_CX = W / 2;
const BIG_CY = R.centerTop + BIG_BOX / 2;
const SMALL_BOX = R.smallDisc + 2 * (R.smallGap + R.smallRing);
const FLY_SCALE = R.smallDisc / R.disc;

const TAIL_WORDS = 3; // the unfinished tail shown in secondary while they talk
const MAX_CHARS = 120; // about three lines at 52 px; older words drop off the front

const isUrl = (u: unknown): u is string => typeof u === 'string' && u.startsWith('http');

function trimFront(text: string): string {
  if (text.length <= MAX_CHARS) return text;
  const cut = text.slice(text.length - MAX_CHARS);
  const space = cut.indexOf(' ');
  return `…${space >= 0 ? cut.slice(space + 1) : cut}`;
}

function answerOf(rating: Rating | null, name: string): RatingAnswer | undefined {
  if (!rating || !rating.answers) return undefined;
  return rating.answers[name];
}

function namesLine(names: string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

// ---------------------------------------------------------------------------------------------

function BigDisc({ name, color }: { name: string; color: string }) {
  return (
    <View style={styles.bigRing}>
      <View style={styles.bigGap}>
        <View style={[styles.bigDisc, { backgroundColor: color }]}>
          <Text style={styles.bigInitials}>{discInitialsForName(name)}</Text>
        </View>
      </View>
    </View>
  );
}

function VoiceBars({ active }: { active: boolean }) {
  const values = useMemo(() => R.bars.map(() => new Animated.Value(R.barIdle / R.barsHeight)), []);
  const glow = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const idle = R.barIdle / R.barsHeight;
    if (!active) {
      const anims = values.map((v) =>
        Animated.timing(v, { toValue: idle, duration: 200, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      );
      const dim = Animated.timing(glow, { toValue: 0, duration: 200, useNativeDriver: true });
      anims.forEach((a) => a.start());
      dim.start();
      return () => {
        anims.forEach((a) => a.stop());
        dim.stop();
      };
    }
    const loops = values.map((v, i) => {
      const peak = R.bars[i] / R.barsHeight;
      const low = Math.max(idle, peak * 0.35);
      const ms = MO.barMs[i % MO.barMs.length];
      return Animated.loop(
        Animated.sequence([
          Animated.timing(v, { toValue: peak, duration: ms, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(v, { toValue: low, duration: ms, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ]),
      );
    });
    const lit = Animated.timing(glow, { toValue: 1, duration: 160, useNativeDriver: true });
    loops.forEach((l) => l.start());
    lit.start();
    return () => {
      loops.forEach((l) => l.stop());
      lit.stop();
    };
  }, [active, values, glow]);

  const opacity = glow.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] });
  return (
    <Animated.View style={[styles.bars, { opacity }]}>
      {values.map((v, i) => (
        <Animated.View key={i} style={[styles.bar, i > 0 ? styles.barGap : null, { transform: [{ scaleY: v }] }]} />
      ))}
    </Animated.View>
  );
}

interface QuietPillProps {
  label: string;
  onSelect: () => void;
  focusRef: (node: SpatialNavigationNodeRef | null) => void;
  big?: boolean;
  solid?: boolean; // white even without focus (the one action on the saved view)
}

function QuietPill({ label, onSelect, focusRef, big, solid }: QuietPillProps) {
  return (
    <SpatialNavigationFocusableView ref={focusRef} onSelect={onSelect}>
      {({ isFocused }) => (
        <View style={[styles.pill, big ? styles.pillBig : null, isFocused || solid ? styles.pillFocused : null]}>
          <Text style={[styles.pillText, big ? styles.pillTextBig : null, isFocused || solid ? styles.onLight : null]}>
            {label}
          </Text>
        </View>
      )}
    </SpatialNavigationFocusableView>
  );
}

function ResultChip({ answer }: { answer: RatingAnswer | undefined }) {
  if (!answer) return null;
  if (answer.skipped || !answer.reaction) {
    return <Text style={styles.skipped}>Skipped</Text>;
  }
  return (
    <View style={styles.chip}>
      <Text style={styles.chipText}>{LABEL[answer.reaction] || answer.reaction}</Text>
    </View>
  );
}

function FilmTag({ rating }: { rating: Rating | null }) {
  const clock = useClock();
  const [failed, setFailed] = useState(false);
  const movie = rating ? rating.movie : null;
  useEffect(() => setFailed(false), [movie ? movie.poster : null]);
  const genres = movie && Array.isArray(movie.genres) ? movie.genres : [];
  const tintHit = genres.find((g) => consoleGenreTints[g]);
  const tint = tintHit ? consoleGenreTints[tintHit] : consoleColors.fieldTeal;
  return (
    <View style={styles.film}>
      {movie ? (
        <View style={[styles.thumb, { backgroundColor: tint }]}>
          {isUrl(movie.poster) && !failed ? (
            <Image
              source={{ uri: movie.poster }}
              style={styles.thumbImage}
              resizeMode="cover"
              onError={() => setFailed(true)}
            />
          ) : null}
        </View>
      ) : null}
      <Text style={styles.filmText} numberOfLines={1}>
        {movie && movie.title ? `${movie.title} · ${clock}` : clock}
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------------------------

interface Flight {
  from: string;
  to: string;
}

interface Geom {
  fromDx: number;
  fromDy: number;
  toDx: number;
  toDy: number;
}

export default function RatingScreen({ state, onRate, onSkip, onFinish, onDone }: RatingScreenProps) {
  const rating = state.rating ?? null;
  const people = rating && Array.isArray(rating.people) ? rating.people : [];
  const asking = rating && !rating.done ? rating.asking : null;
  const done = Boolean(rating && rating.done);
  const live = rating && typeof rating.live === 'string' ? rating.live : '';

  const order = householdOrder(state);
  const colorOf = (name: string) => discColorIn(order, name, people);

  const [handOpen, setHandOpen] = useState(false);
  const [talking, setTalking] = useState(false);
  const [shown, setShown] = useState<string | null>(asking); // whose words the centre column shows
  const [flight, setFlight] = useState<Flight | null>(null);
  const [geom, setGeom] = useState<Geom | null>(null);
  const [focusTarget, setFocusTarget] = useState<string | null>(null);

  const nodeRefs = useRef<Record<string, SpatialNavigationNodeRef | null>>({});
  const slots = useRef<Record<string, { x: number; y: number }>>({});
  const rowY = useRef(0);
  const prevAsking = useRef(asking);
  const timers = useRef<Timer[]>([]);
  const liveTimer = useRef<Timer | null>(null);

  const fly = useRef(new Animated.Value(0)).current;
  const textFade = useRef(new Animated.Value(1)).current;
  const savedFade = useRef(new Animated.Value(done ? 1 : 0)).current;

  const later = (fn: () => void, ms: number) => {
    const id = setTimeout(() => {
      timers.current = timers.current.filter((t) => t !== id);
      fn();
    }, ms);
    timers.current.push(id);
  };
  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };

  // Voice bars move only while `live` changed in the last ~1.2 s.
  useEffect(() => {
    if (liveTimer.current) clearTimeout(liveTimer.current);
    liveTimer.current = null;
    if (!live) {
      setTalking(false);
      return;
    }
    setTalking(true);
    liveTimer.current = setTimeout(() => {
      liveTimer.current = null;
      setTalking(false);
    }, MO.liveMs);
  }, [live]);

  // The spotlight hand-off. Timers own every swap; nothing waits on an Animated end callback.
  useEffect(() => {
    const prev = prevAsking.current;
    prevAsking.current = asking;
    if (prev === asking) return;
    clearTimers();
    setHandOpen(false);

    if (!prev || !asking) {
      // First person, or the end: no flight.
      setFlight(null);
      setGeom(null);
      setShown(asking);
      textFade.setValue(1);
      return;
    }

    fly.setValue(0);
    setGeom(null);
    setFlight({ from: prev, to: asking });
    Animated.timing(textFade, {
      toValue: 0,
      duration: 150,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
    // Let the progress row lay out (the chip that just appeared) before reading the slots.
    later(() => {
      const a = slots.current[nameSlug(prev)];
      const b = slots.current[nameSlug(asking)];
      const cx = px(BIG_CX);
      const cy = px(BIG_CY);
      const y0 = rowY.current;
      setGeom({
        fromDx: a ? a.x - cx : 0,
        fromDy: a ? y0 + a.y - cy : 0,
        toDx: b ? b.x - cx : 0,
        toDy: b ? y0 + b.y - cy : 0,
      });
    }, MO.handoffSettleMs);
    later(() => {
      setShown(asking);
      Animated.timing(textFade, {
        toValue: 1,
        duration: MO.handoffMs - 150,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    }, 150);
    later(
      () => {
        setFlight(null);
        setGeom(null);
      },
      MO.handoffSettleMs + MO.handoffMs + 30,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on whose turn it is
  }, [asking]);

  useEffect(() => {
    if (!geom) return;
    const anim = Animated.timing(fly, {
      toValue: 1,
      duration: MO.handoffMs,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [geom, fly]);

  // The saved view fades in and takes the focus.
  const prevDone = useRef(done);
  useEffect(() => {
    if (prevDone.current === done) return;
    prevDone.current = done;
    if (done) {
      savedFade.setValue(0);
      Animated.timing(savedFade, {
        toValue: 1,
        duration: MO.savedMs,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
      setFocusTarget(COUCH);
    }
  }, [done, savedFade]);

  useEffect(() => {
    if (!focusTarget) return;
    try {
      nodeRefs.current[focusTarget]?.focus();
    } catch {
      // not registered; the D-pad still works
    }
    setFocusTarget(null);
  }, [focusTarget]);

  useEffect(
    () => () => {
      clearTimers();
      if (liveTimer.current) clearTimeout(liveTimer.current);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- unmount only
    [],
  );

  const openHand = () => {
    setHandOpen(true);
    setFocusTarget(pillId('loved'));
  };
  const closeHand = () => {
    setHandOpen(false);
    setFocusTarget(HAND);
  };

  useBackKey(() => {
    if (!rating || done) onDone?.();
    else if (handOpen) closeHand();
    else onFinish?.();
  });

  const refFor = (id: string) => (node: SpatialNavigationNodeRef | null) => {
    nodeRefs.current[id] = node;
  };

  const onSlotLayout = (name: string) => (e: LayoutChangeEvent) => {
    const { x, y, height } = e.nativeEvent.layout;
    const half = SMALL_BOX / 2;
    // Relative to the row; the row's own offset is added when read (children report layout first).
    slots.current[nameSlug(name)] = { x: x + px(half), y: y + height / 2 };
  };

  const tint = done || !rating ? consoleColors.fieldTeal : colorOf(asking || shown || people[0] || '');

  // ---- No rating in the state (should not happen on this screen)
  if (!rating) {
    return (
      <View style={styles.screen}>
        <ConsoleBackdrop tint={tint} layout="spotlight" fieldOpacity={R.fieldOpacity} />
        <ConsoleHeader state={state} right={<FilmTag rating={null} />} />
        <View style={styles.saved}>
          <Text style={styles.savedTitle}>Nothing to rate right now</Text>
          <View style={styles.savedAction}>
            <DefaultFocus>
              <QuietPill label="Back to the couch" big solid onSelect={() => onDone?.()} focusRef={refFor(COUCH)} />
            </DefaultFocus>
          </View>
        </View>
      </View>
    );
  }

  // ---- Saved view
  if (done) {
    const answered = people.filter((p) => {
      const a = answerOf(rating, p);
      return a && !a.skipped && a.reaction;
    });
    const missing = people.length - answered.length;
    const title =
      answered.length === 0
        ? 'Nothing to save this time'
        : missing === 0
          ? 'Saved to everyone’s taste'
          : `Saved for ${namesLine(answered)}`;
    return (
      <View style={styles.screen}>
        <ConsoleBackdrop tint={tint} layout="spotlight" fieldOpacity={R.fieldOpacity} />
        <ConsoleHeader state={state} right={<FilmTag rating={rating} />} />
        <Animated.View style={[styles.saved, { opacity: savedFade }]}>
          <View style={styles.savedRow}>
            {people.map((p, i) => {
              const a = answerOf(rating, p);
              return (
                <View key={nameSlug(p)} style={[styles.savedPerson, i > 0 ? styles.savedPersonGap : null]}>
                  <View style={[styles.savedDisc, { backgroundColor: colorOf(p) }]}>
                    <Text style={styles.savedInitials}>{discInitialsForName(p)}</Text>
                  </View>
                  <Text style={styles.savedName} numberOfLines={1}>
                    {p}
                  </Text>
                  <View style={styles.savedChip}>
                    {a ? <ResultChip answer={a} /> : <Text style={styles.skipped}>No answer</Text>}
                  </View>
                </View>
              );
            })}
          </View>
          <Text style={styles.savedTitle}>{title}</Text>
          <View style={styles.savedAction}>
            <DefaultFocus>
              <QuietPill label="Back to the couch" big solid onSelect={() => onDone?.()} focusRef={refFor(COUCH)} />
            </DefaultFocus>
          </View>
        </Animated.View>
        <View style={styles.hintRow}>
          <Text style={styles.hint}>Back: the couch</Text>
        </View>
      </View>
    );
  }

  // ---- Spotlight
  const textPerson = shown || asking;
  const words = (textPerson === asking ? live : '').trim();
  let head = words;
  let tail = '';
  if (words && talking) {
    const parts = words.split(/\s+/);
    const cut = Math.max(parts.length - TAIL_WORDS, 0);
    head = parts.slice(0, cut).join(' ');
    tail = parts.slice(cut).join(' ');
  }
  const trimmed = trimFront(head + (head && tail ? ' ' : '') + tail);
  const tailStart = Math.max(trimmed.length - tail.length, 0);
  const headText = tail ? trimmed.slice(0, tailStart) : trimmed;
  const tailText = tail ? trimmed.slice(tailStart) : '';

  const askingIdx = asking ? people.indexOf(asking) : -1;
  const count = askingIdx >= 0 ? askingIdx + 1 : Object.keys(rating.answers || {}).length;

  const g = geom || { fromDx: 0, fromDy: 0, toDx: 0, toDy: 0 };
  const outStyle = {
    transform: [
      { translateX: fly.interpolate({ inputRange: [0, 1], outputRange: [0, g.fromDx] }) },
      { translateY: fly.interpolate({ inputRange: [0, 1], outputRange: [0, g.fromDy] }) },
      { scale: fly.interpolate({ inputRange: [0, 1], outputRange: [1, FLY_SCALE] }) },
    ],
    opacity: fly.interpolate({ inputRange: [0, 0.85, 1], outputRange: [1, 1, 0] }),
  };
  const inStyle = {
    transform: [
      { translateX: fly.interpolate({ inputRange: [0, 1], outputRange: [g.toDx, 0] }) },
      { translateY: fly.interpolate({ inputRange: [0, 1], outputRange: [g.toDy, 0] }) },
      { scale: fly.interpolate({ inputRange: [0, 1], outputRange: [FLY_SCALE, 1] }) },
    ],
    opacity: geom ? fly.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, 1, 1] }) : 0,
  };

  return (
    <View style={styles.screen}>
      <ConsoleBackdrop tint={tint} layout="spotlight" fieldOpacity={R.fieldOpacity} />
      <ConsoleHeader state={state} right={<FilmTag rating={rating} />} />

      <View style={styles.center}>
        <View style={styles.discSlot}>
          {!flight && asking ? <BigDisc name={asking} color={colorOf(asking)} /> : null}
        </View>

        <Animated.View style={[styles.words, { opacity: textFade }]}>
          <Text style={styles.question} numberOfLines={1}>
            {textPerson ? `Popcorn: “${textPerson}, what did you think?”` : 'Popcorn is listening'}
          </Text>
          <View style={styles.transcriptBox}>
            {handOpen ? null : headText || tailText ? (
              <Text style={styles.transcript} numberOfLines={R.transcriptLines}>
                {'“'}
                {headText}
                {tailText ? <Text style={styles.transcriptTail}>{tailText}</Text> : null}
                {'”'}
              </Text>
            ) : (
              <Text style={styles.waiting}>Say it out loud, or rate by hand</Text>
            )}
          </View>
        </Animated.View>

        {/* Stable nodes keep the hand panel above the controls in D-pad order while it mounts and unmounts. */}
        <SpatialNavigationNode orientation="vertical">
          <View style={styles.lower}>
            <View style={styles.handArea}>
              <SpatialNavigationNode orientation="horizontal">
                <View style={styles.handRow}>
                  {handOpen
                    ? REACTIONS.map((r, i) => (
                        <View key={r.reaction} style={i > 0 ? styles.pillGap : null}>
                          <QuietPill
                            big
                            label={r.label}
                            focusRef={refFor(pillId(r.reaction))}
                            onSelect={() => {
                              if (asking) onRate?.(asking, r.reaction);
                              closeHand();
                            }}
                          />
                        </View>
                      ))
                    : null}
                </View>
              </SpatialNavigationNode>
            </View>
            <VoiceBars active={talking && !handOpen} />
            <SpatialNavigationNode orientation="horizontal">
              <View style={styles.controls}>
                <DefaultFocus>
                  <QuietPill
                    label="Rate by hand"
                    onSelect={() => (handOpen ? closeHand() : openHand())}
                    focusRef={refFor(HAND)}
                  />
                </DefaultFocus>
                <View style={styles.pillGap}>
                  <QuietPill label="Skip" onSelect={() => onSkip?.()} focusRef={refFor(SKIP)} />
                </View>
              </View>
            </SpatialNavigationNode>
          </View>
        </SpatialNavigationNode>
      </View>

      {flight ? (
        <>
          <Animated.View pointerEvents="none" style={[styles.flyer, outStyle]}>
            <BigDisc name={flight.from} color={colorOf(flight.from)} />
          </Animated.View>
          <Animated.View pointerEvents="none" style={[styles.flyer, inStyle]}>
            <BigDisc name={flight.to} color={colorOf(flight.to)} />
          </Animated.View>
        </>
      ) : null}

      <View
        style={styles.progress}
        onLayout={(e) => {
          rowY.current = e.nativeEvent.layout.y;
        }}
      >
        {people.map((p) => {
          const a = answerOf(rating, p);
          const now = p === asking;
          const landing = flight !== null && flight.from === p; // the flying disc lands here
          return (
            <View key={nameSlug(p)} style={styles.slot} onLayout={onSlotLayout(p)}>
              <View
                style={[
                  styles.smallRing,
                  now ? styles.smallRingNow : null,
                  !a && !now ? styles.later : null,
                  landing ? styles.hidden : null,
                ]}
              >
                <View style={[styles.smallDisc, { backgroundColor: colorOf(p) }]}>
                  <Text style={styles.smallInitials}>{discInitialsForName(p)}</Text>
                </View>
              </View>
              <ResultChip answer={a} />
            </View>
          );
        })}
        {people.length > 0 ? <Text style={styles.count}>{`${count} of ${people.length}`}</Text> : null}
      </View>

      <View style={styles.hintRow}>
        <Text style={styles.hint}>{handOpen ? 'Back: close' : 'Back: finish and save'}</Text>
      </View>
    </View>
  );
}

const BIG = px(R.disc);
const BIG_BOX_PX = px(BIG_BOX);
const SMALL = px(R.smallDisc);
const SMALL_BOX_PX = px(SMALL_BOX);
const PILL_H = px(R.pillHeight);
const HAND_H = px(R.handPillHeight);
const SAVED = px(R.savedDisc);
const QUESTION_LINE = 38;

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: consoleColors.ground,
    overflow: 'hidden',
  },

  // Header right: poster thumbnail, title and clock
  film: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
    marginLeft: px(48),
  },
  thumb: {
    width: px(R.thumbWidth),
    height: px(R.thumbHeight),
    borderRadius: px(R.thumbRadius),
    overflow: 'hidden',
    marginRight: px(18),
  },
  thumbImage: {
    width: px(R.thumbWidth),
    height: px(R.thumbHeight),
  },
  filmText: {
    flexShrink: 1,
    color: consoleColors.secondary,
    fontSize: px(T.header),
    fontWeight: consoleType.weight.medium,
  },

  // Spotlight column
  center: {
    position: 'absolute',
    top: px(R.centerTop),
    left: SAFE_X,
    right: SAFE_X,
    alignItems: 'center',
  },
  discSlot: {
    width: BIG_BOX_PX,
    height: BIG_BOX_PX,
  },
  bigRing: {
    width: BIG_BOX_PX,
    height: BIG_BOX_PX,
    borderRadius: BIG_BOX_PX / 2,
    backgroundColor: consoleColors.ring,
    padding: px(R.discRing),
    shadowColor: consoleColors.shadow,
    shadowOpacity: 0.5,
    shadowRadius: px(60),
    shadowOffset: { width: 0, height: px(30) },
    elevation: 14,
  },
  bigGap: {
    flex: 1,
    borderRadius: (BIG_BOX_PX - px(R.discRing) * 2) / 2,
    backgroundColor: consoleColors.ground,
    padding: px(R.discGap),
  },
  bigDisc: {
    width: BIG,
    height: BIG,
    borderRadius: BIG / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bigInitials: {
    color: consoleColors.text,
    fontSize: px(T.initials),
    fontWeight: consoleType.weight.semibold,
  },
  flyer: {
    position: 'absolute',
    top: px(R.centerTop),
    left: px(BIG_CX - BIG_BOX / 2),
    width: BIG_BOX_PX,
    height: BIG_BOX_PX,
  },
  words: {
    alignItems: 'center',
    alignSelf: 'stretch',
  },
  question: {
    marginTop: px(R.questionGap),
    color: consoleColors.secondary,
    fontSize: px(T.question),
    lineHeight: px(QUESTION_LINE),
    fontWeight: consoleType.weight.medium,
  },
  transcriptBox: {
    marginTop: px(22),
    width: px(R.transcriptWidth),
    height: px(T.transcriptLine * R.transcriptLines),
    justifyContent: 'center',
    alignItems: 'center',
  },
  transcript: {
    textAlign: 'center',
    color: consoleColors.text,
    fontSize: px(T.transcript),
    lineHeight: px(T.transcriptLine),
    fontWeight: consoleType.weight.semibold,
    letterSpacing: -px(0.5),
  },
  transcriptTail: {
    color: consoleColors.secondary,
  },
  waiting: {
    textAlign: 'center',
    color: consoleColors.placeholder,
    fontSize: px(T.question),
    fontWeight: consoleType.weight.medium,
  },
  // The hand panel sits over the transcript box (same place), pulled up from the bars.
  handArea: {
    position: 'absolute',
    top: -px(T.transcriptLine * R.transcriptLines), // over the transcript box, just above
    left: 0,
    right: 0,
    height: px(T.transcriptLine * R.transcriptLines),
    alignItems: 'center',
    justifyContent: 'center',
  },
  lower: {
    alignSelf: 'stretch',
    alignItems: 'center',
  },
  handRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  bars: {
    marginTop: px(30),
    height: px(R.barsHeight),
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bar: {
    width: px(R.barWidth),
    height: px(R.barsHeight),
    borderRadius: px(R.barWidth / 2),
    backgroundColor: consoleColors.text,
  },
  barGap: {
    marginLeft: px(R.barGap),
  },
  controls: {
    marginTop: px(34),
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  pillGap: {
    marginLeft: px(R.pillGap),
  },
  pill: {
    height: PILL_H,
    borderRadius: PILL_H / 2,
    paddingHorizontal: px(30),
    borderWidth: px(2),
    borderColor: consoleRatingColors.pillOutline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillBig: {
    height: HAND_H,
    borderRadius: HAND_H / 2,
    paddingHorizontal: px(34),
  },
  pillFocused: {
    backgroundColor: consoleColors.cta,
    borderColor: consoleColors.cta,
    transform: [{ scale: R.focusScale }],
    shadowColor: consoleColors.shadow,
    shadowOpacity: 0.45,
    shadowRadius: px(30),
    shadowOffset: { width: 0, height: px(16) },
    elevation: 10,
  },
  pillText: {
    color: consoleColors.secondary,
    fontSize: px(T.pill),
    fontWeight: consoleType.weight.medium,
  },
  pillTextBig: {
    color: consoleColors.text,
    fontSize: px(T.handPill),
    fontWeight: consoleType.weight.semibold,
  },
  onLight: {
    color: consoleColors.onLight,
  },

  // Progress row
  progress: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: px(R.progressBottom) - px(R.smallGap + R.smallRing),
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  slot: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: px(16),
  },
  smallRing: {
    width: SMALL_BOX_PX,
    height: SMALL_BOX_PX,
    borderRadius: SMALL_BOX_PX / 2,
    borderWidth: px(R.smallRing),
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  smallRingNow: {
    borderColor: consoleColors.ring,
  },
  later: {
    opacity: R.laterOpacity,
  },
  hidden: {
    opacity: 0,
  },
  smallDisc: {
    width: SMALL,
    height: SMALL,
    borderRadius: SMALL / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  smallInitials: {
    color: consoleColors.text,
    fontSize: px(T.smallInitials),
    fontWeight: consoleType.weight.semibold,
  },
  chip: {
    marginLeft: px(10),
    height: px(R.chipHeight),
    paddingHorizontal: px(14),
    borderRadius: px(R.chipHeight / 2),
    backgroundColor: consoleColors.cta,
    justifyContent: 'center',
  },
  chipText: {
    color: consoleColors.onLight,
    fontSize: px(T.chip),
    fontWeight: consoleType.weight.semibold,
  },
  skipped: {
    marginLeft: px(10),
    color: consoleColors.placeholder,
    fontSize: px(T.chip),
    fontWeight: consoleType.weight.medium,
  },
  count: {
    marginLeft: px(8),
    color: consoleColors.secondary,
    fontSize: px(T.count),
    fontWeight: consoleType.weight.medium,
  },

  hintRow: {
    position: 'absolute',
    left: SAFE_X,
    right: SAFE_X,
    bottom: px(R.hintBottom),
    flexDirection: 'row',
  },
  hint: {
    color: consoleColors.placeholder,
    fontSize: px(T.hint),
    fontWeight: consoleType.weight.medium,
  },

  // Saved view
  saved: {
    position: 'absolute',
    top: px(260),
    left: SAFE_X,
    right: SAFE_X,
    alignItems: 'center',
  },
  savedRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  savedPerson: {
    alignItems: 'center',
    width: px(200),
  },
  savedPersonGap: {
    marginLeft: px(24),
  },
  savedDisc: {
    width: SAVED,
    height: SAVED,
    borderRadius: SAVED / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  savedInitials: {
    color: consoleColors.text,
    fontSize: px(T.savedInitials),
    fontWeight: consoleType.weight.semibold,
  },
  savedName: {
    marginTop: px(16),
    color: consoleColors.text,
    fontSize: px(T.savedName),
    fontWeight: consoleType.weight.medium,
  },
  savedChip: {
    marginTop: px(12),
    height: px(R.chipHeight),
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: -px(10), // the chip carries a left margin for the progress row
  },
  savedTitle: {
    marginTop: px(64),
    color: consoleColors.text,
    fontSize: px(T.savedTitle),
    fontWeight: consoleType.weight.semibold,
    letterSpacing: -px(0.4),
  },
  savedAction: {
    marginTop: px(40),
  },
});
