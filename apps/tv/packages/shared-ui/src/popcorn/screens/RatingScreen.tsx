import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Image, StyleSheet, Animated, Easing } from 'react-native';
import {
  SpatialNavigationFocusableView,
  SpatialNavigationNode,
  SpatialNavigationNodeRef,
  DefaultFocus,
} from 'react-tv-space-navigation';
import { TVState, Reaction, Rating } from '../types';
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
  PhoneQr,
  discColorIn,
  discInitialsForName,
  householdOrder,
  useBackKey,
} from '../components';

export interface RatingScreenProps {
  state: TVState;
  /** A written-rating pill for the person being asked. */
  onRate?: (name: string, reaction: Reaction) => void;
  /** Skip the person being asked. */
  onSkip?: () => void;
  /** Back: save what is answered so far. */
  onFinish?: () => void;
  /** Back on a finished (or empty) rating: the couch. */
  onDone?: () => void;
}

type Timer = ReturnType<typeof setTimeout>;

const px = scaledPixels;
const R = consoleRating;
const T = consoleRatingType;
const MO = consoleRatingMotion;
const SAFE_X = px(consoleLayout.safeX);

// The five written answers, labelled as the contract names them.
const REACTIONS: { reaction: Reaction; label: string }[] = [
  { reaction: 'loved', label: 'Loved it' },
  { reaction: 'liked', label: 'Liked it' },
  { reaction: 'meh', label: 'It was okay' },
  { reaction: 'disliked', label: "Didn't like it" },
  { reaction: 'hated', label: 'Hated it' },
];

const SKIP = 'skip';
const COUCH = 'couch';
const BACK = 'back';
const pillId = (reaction: Reaction) => `r-${reaction}`;

const TAIL_WORDS = 3; // the unfinished tail shown in secondary while they talk
const MAX_CHARS = 90; // about two lines at 48 px; older words drop off the front

const isUrl = (u: unknown): u is string => typeof u === 'string' && u.startsWith('http');

function trimFront(text: string): string {
  if (text.length <= MAX_CHARS) return text;
  const cut = text.slice(text.length - MAX_CHARS);
  const space = cut.indexOf(' ');
  return `…${space >= 0 ? cut.slice(space + 1) : cut}`;
}

/** The last spoken answer's summary, so the family sees what Popcorn understood. */
function spokenSummary(rating: Rating | null): { name: string; quote: string } | null {
  if (!rating || !rating.answers) return null;
  const people = Array.isArray(rating.people) ? rating.people : [];
  for (let i = people.length - 1; i >= 0; i -= 1) {
    const answer = rating.answers[people[i]];
    if (answer && answer.by === 'voice' && answer.quote) return { name: people[i], quote: answer.quote };
  }
  return null;
}

function namesLine(names: string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

// ---------------------------------------------------------------------------------------------

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

  const opacity = glow.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });
  return (
    <Animated.View style={[styles.bars, { opacity }]}>
      {values.map((v, i) => (
        <Animated.View key={i} style={[styles.bar, i > 0 ? styles.barGap : null, { transform: [{ scaleY: v }] }]} />
      ))}
    </Animated.View>
  );
}

interface PillProps {
  label: string;
  onSelect: () => void;
  focusRef: (node: SpatialNavigationNodeRef | null) => void;
  solid?: boolean; // white even without focus (the one action on a finished rating)
  disabled?: boolean;
}

/** An outline pill; focused (or solid) it fills white, like every other console action. */
function Pill({ label, onSelect, focusRef, solid, disabled }: PillProps) {
  return (
    <SpatialNavigationFocusableView ref={focusRef} onSelect={() => (disabled ? undefined : onSelect())}>
      {({ isFocused }) => {
        const lit = isFocused || solid;
        return (
          <View style={[styles.pill, lit ? styles.pillFocused : null, disabled ? styles.pillQuiet : null]}>
            <Text style={[styles.pillText, lit ? styles.onLight : null]}>{label}</Text>
          </View>
        );
      }}
    </SpatialNavigationFocusableView>
  );
}

/** The film being rated: its poster and its title, nothing else. */
function Film({ movie }: { movie: Rating['movie'] }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [movie.poster]);
  const genres = Array.isArray(movie.genres) ? movie.genres : [];
  const tintHit = genres.find((g) => consoleGenreTints[g]);
  const tint = tintHit ? consoleGenreTints[tintHit] : consoleColors.fieldTeal;
  const uri = isUrl(movie.poster) ? movie.poster : null;

  return (
    <View style={styles.film}>
      <View style={[styles.poster, { backgroundColor: tint }]}>
        {uri && !failed ? (
          <Image
            source={{ uri }}
            style={styles.posterImage}
            resizeMode="cover"
            onError={() => setFailed(true)}
          />
        ) : null}
      </View>
      <Text style={styles.filmTitle} numberOfLines={1}>
        {movie.title}
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------------------------

export default function RatingScreen({ state, onRate, onSkip, onFinish, onDone }: RatingScreenProps) {
  const rating = state.rating ?? null;
  const people = rating && Array.isArray(rating.people) ? rating.people : [];
  const asking = rating && !rating.done ? rating.asking : null;
  const done = Boolean(rating && rating.done);
  const live = rating && typeof rating.live === 'string' ? rating.live : '';

  const order = householdOrder(state);
  const colorOf = (name: string) => discColorIn(order, name, people);

  const [talking, setTalking] = useState(false);
  const [focusTarget, setFocusTarget] = useState<string | null>(null);

  const nodeRefs = useRef<Record<string, SpatialNavigationNodeRef | null>>({});
  const liveTimer = useRef<Timer | null>(null);

  // The bars move only while `live` changed in the last ~1.2 s.
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

  useEffect(
    () => () => {
      if (liveTimer.current) clearTimeout(liveTimer.current);
    },
    [],
  );

  // The finished view has one action; the D-pad lands on it.
  const prevDone = useRef(done);
  useEffect(() => {
    if (prevDone.current === done) return;
    prevDone.current = done;
    if (done) setFocusTarget(COUCH);
  }, [done]);

  useEffect(() => {
    if (!focusTarget) return;
    try {
      nodeRefs.current[focusTarget]?.focus();
    } catch {
      // not registered; the D-pad still works
    }
    setFocusTarget(null);
  }, [focusTarget]);

  useBackKey(() => {
    if (!rating || done) onDone?.();
    else onFinish?.();
  });

  const refFor = (id: string) => (node: SpatialNavigationNodeRef | null) => {
    nodeRefs.current[id] = node;
  };

  const film = rating ? rating.movie : null;
  const filmTint = film && Array.isArray(film.genres) ? film.genres.find((g) => consoleGenreTints[g]) : undefined;
  const tint = asking ? colorOf(asking) : filmTint ? consoleGenreTints[filmTint] : consoleColors.fieldTeal;

  // ---- Nothing to rate (should not happen on this screen)
  let body: React.ReactNode;
  if (!rating) {
    body = (
      <View style={styles.center}>
        <Text style={styles.status}>Nothing to rate right now</Text>
        <View style={styles.action}>
          <DefaultFocus>
            <Pill label="Back to the couch" solid onSelect={() => onDone?.()} focusRef={refFor(COUCH)} />
          </DefaultFocus>
        </View>
      </View>
    );
  } else if (done) {
    // ---- Saved: one line about what was kept, then the way out.
    const answered = people.filter((p) => {
      const a = rating.answers ? rating.answers[p] : undefined;
      return a && !a.skipped && a.reaction;
    });
    const title =
      answered.length === 0
        ? 'Nothing to save this time'
        : answered.length === people.length
          ? 'Saved to everyone’s taste'
          : `Saved for ${namesLine(answered)}`;
    body = (
      <View style={styles.center}>
        <Text style={styles.status}>{title}</Text>
        <View style={styles.action}>
          <DefaultFocus>
            <Pill label="Back to the couch" solid onSelect={() => onDone?.()} focusRef={refFor(COUCH)} />
          </DefaultFocus>
        </View>
      </View>
    );
  } else {
    // ---- Spotlight: the person answering, their words, the five written answers, Skip, the QR.
    const words = live.trim();
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
    const spoken = spokenSummary(rating);

    body = (
      <>
        <View style={styles.center}>
          {asking ? (
            <View style={styles.personRow}>
              <View style={styles.bigRing}>
                <View style={styles.bigGap}>
                  <View style={[styles.bigDisc, { backgroundColor: colorOf(asking) }]}>
                    <Text style={styles.bigInitials}>{discInitialsForName(asking)}</Text>
                  </View>
                </View>
              </View>
              <View style={styles.questionWrap}>
                <Text style={styles.question} numberOfLines={1}>
                  {`${asking}, what did you think?`}
                </Text>
                {/* Hung off the end of the question: the bars never move the row while they fade in. */}
                <View style={styles.barsHang} pointerEvents="none">
                  <VoiceBars active={talking} />
                </View>
              </View>
            </View>
          ) : null}

          <View style={styles.quoteBox}>
            {headText || tailText ? (
              <Text style={styles.quote} numberOfLines={R.quoteLines}>
                {'“'}
                {headText}
                {tailText ? <Text style={styles.quoteTail}>{tailText}</Text> : null}
                {'”'}
              </Text>
            ) : spoken ? (
              <Text style={styles.quoteSpoken} numberOfLines={R.quoteLines}>
                {`${spoken.name} said “${spoken.quote}”`}
              </Text>
            ) : null}
          </View>

          <SpatialNavigationNode orientation="vertical">
            <View style={styles.actions}>
              <SpatialNavigationNode orientation="horizontal">
                <View style={styles.pills}>
                  {REACTIONS.map((r, i) => (
                    <DefaultFocus key={r.reaction} enable={i === 0}>
                      <View style={i > 0 ? styles.pillGap : null}>
                        <Pill
                          label={r.label}
                          disabled={!asking}
                          focusRef={refFor(pillId(r.reaction))}
                          onSelect={() => {
                            if (asking) onRate?.(asking, r.reaction);
                          }}
                        />
                      </View>
                    </DefaultFocus>
                  ))}
                </View>
              </SpatialNavigationNode>
              <SpatialNavigationNode orientation="horizontal">
                <View style={[styles.skipRow, styles.row]}>
                  <Pill label="Skip" disabled={!asking} onSelect={() => onSkip?.()} focusRef={refFor(SKIP)} />
                  <View style={styles.pillGap}>
                    <Pill label="Back" onSelect={() => onFinish?.()} focusRef={refFor(BACK)} />
                  </View>
                </View>
              </SpatialNavigationNode>
            </View>
          </SpatialNavigationNode>
        </View>

        <View style={styles.qr}>
          <PhoneQr caption="Scan to say what you thought" />
        </View>
      </>
    );
  }

  return (
    <View style={styles.screen}>
      <ConsoleBackdrop tint={tint} layout="spotlight" fieldOpacity={R.fieldOpacity} />
      {film ? <Film movie={film} /> : null}
      {body}
      <View style={styles.hintRow}>
        <Text style={styles.hint}>{rating && !done ? 'Back: finish and save' : 'Back: the couch'}</Text>
      </View>
    </View>
  );
}

const BIG = px(R.disc);
const BIG_BOX = px(R.disc + 2 * (R.discGap + R.discRing));
const PILL_H = px(R.pillHeight);

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: consoleColors.ground,
    overflow: 'hidden',
  },

  // The film
  film: {
    position: 'absolute',
    top: px(R.filmTop),
    left: SAFE_X,
    right: SAFE_X,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  poster: {
    width: px(R.posterWidth),
    height: px(R.posterHeight),
    borderRadius: px(R.posterRadius),
    overflow: 'hidden',
  },
  posterImage: {
    width: px(R.posterWidth),
    height: px(R.posterHeight),
  },
  filmTitle: {
    maxWidth: px(1100),
    marginLeft: px(R.titleGap),
    color: consoleColors.text,
    fontSize: px(T.filmTitle),
    fontWeight: consoleType.weight.semibold,
    letterSpacing: -px(0.8),
  },

  // Spotlight column
  center: {
    position: 'absolute',
    top: px(R.centerTop),
    left: SAFE_X,
    right: SAFE_X,
    alignItems: 'center',
  },
  personRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  bigRing: {
    width: BIG_BOX,
    height: BIG_BOX,
    borderRadius: BIG_BOX / 2,
    backgroundColor: consoleColors.ring,
    padding: px(R.discRing),
    shadowColor: consoleColors.shadow,
    shadowOpacity: 0.5,
    shadowRadius: px(50),
    shadowOffset: { width: 0, height: px(24) },
    elevation: 14,
  },
  bigGap: {
    flex: 1,
    borderRadius: (BIG_BOX - px(R.discRing) * 2) / 2,
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
  questionWrap: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  question: {
    maxWidth: px(1000),
    marginLeft: px(40),
    color: consoleColors.text,
    fontSize: px(T.question),
    fontWeight: consoleType.weight.semibold,
  },

  // Live words and the last spoken summary share one box so nothing jumps.
  quoteBox: {
    marginTop: px(R.quoteGap),
    width: px(R.quoteWidth),
    height: px(T.quoteLine * R.quoteLines),
    justifyContent: 'center',
    alignItems: 'center',
  },
  barsHang: {
    position: 'absolute',
    left: '100%',
    marginLeft: px(20),
    justifyContent: 'center',
  },
  quote: {
    flexShrink: 1,
    textAlign: 'center',
    color: consoleColors.text,
    fontSize: px(T.quote),
    lineHeight: px(T.quoteLine),
    fontWeight: consoleType.weight.semibold,
    letterSpacing: -px(0.5),
  },
  quoteTail: {
    color: consoleColors.secondary,
  },
  quoteSpoken: {
    textAlign: 'center',
    color: consoleColors.secondary,
    fontSize: px(T.quoteSpoken),
    lineHeight: px(T.quoteLine),
    fontWeight: consoleType.weight.medium,
  },
  bars: {
    height: px(R.barsHeight),
    flexDirection: 'row',
    alignItems: 'center',
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

  actions: {
    alignItems: 'center',
  },
  pills: {
    marginTop: px(10),
    flexDirection: 'row',
    alignItems: 'center',
  },
  pillGap: {
    marginLeft: px(R.pillGap),
  },
  skipRow: {
    marginTop: px(R.skipGap),
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  pill: {
    height: PILL_H,
    borderRadius: PILL_H / 2,
    paddingHorizontal: px(R.pillPadding),
    borderWidth: px(2),
    borderColor: consoleRatingColors.pillOutline,
    alignItems: 'center',
    justifyContent: 'center',
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
  pillQuiet: {
    opacity: R.quietOpacity,
  },
  pillText: {
    color: consoleColors.text,
    fontSize: px(T.pill),
    fontWeight: consoleType.weight.semibold,
  },
  onLight: {
    color: consoleColors.onLight,
  },

  // Phone QR: the spoken path, out of the way of the buttons
  qr: {
    position: 'absolute',
    top: px(R.qrTop),
    right: SAFE_X,
  },

  // Finished / empty
  status: {
    color: consoleColors.text,
    fontSize: px(T.status),
    fontWeight: consoleType.weight.semibold,
    letterSpacing: -px(0.4),
  },
  action: {
    marginTop: px(40),
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
});
