import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Image, StyleSheet, Animated, Easing } from 'react-native';
import {
  SpatialNavigationFocusableView,
  SpatialNavigationNode,
  SpatialNavigationNodeRef,
  DefaultFocus,
} from 'react-tv-space-navigation';
import { TVState, Details, Provider, Watching } from '../types';
import { scaledPixels } from '../../hooks/useScale';
import {
  consoleColors,
  consoleLayout,
  consoleType,
  consoleGenreTints,
  consoleDetails,
  consoleDetailsType,
  consoleDetailsColors,
  consoleDetailsMotion,
} from '../../theme/console';
import { ConsoleBackdrop, ConsoleHeader, useBackKey } from '../components';

export interface DetailsScreenProps {
  state: TVState;
  /** OK on a provider pill. */
  onWatch?: (provider: string) => void;
  /** "We're back": start the family rating. */
  onWereBack?: () => void;
  /** Back from the pills: tonight's picks. */
  onBack?: () => void;
  /** "Already seen": watched by everyone on the couch, card removed, back to the reel. */
  onSeen?: (movieId: number) => void;
}

const px = scaledPixels;
const D = consoleDetails;
const T = consoleDetailsType;
const M = consoleDetailsMotion;
const W = 1920;
const H = 1080;
const SAFE_X = px(consoleLayout.safeX);
const SAFE_Y = px(consoleLayout.safeY);

const KIND_LABEL: Record<Provider['kind'], string> = { stream: 'Included', rent: 'Rent', buy: 'Buy' };
const WERE_BACK = '__back__';
const SEEN = '__seen__';
const INFO_BLOCKS = 5; // title, meta, chips, overview, credits

const isUrl = (u: unknown): u is string => typeof u === 'string' && u.startsWith('http');

function tintFor(genres: string[] | undefined): string {
  const hit = (Array.isArray(genres) ? genres : []).find((g) => consoleGenreTints[g]);
  return hit ? consoleGenreTints[hit] : consoleColors.fieldTeal;
}

function runtimeText(min: number | null): string {
  if (typeof min !== 'number' || min <= 0) return '';
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

function metaLine(d: Details): string {
  return [d.year, ...(d.genres || []).slice(0, 2), runtimeText(d.runtime_minutes), d.certification_us || '']
    .filter(Boolean)
    .join(' · ');
}

const watchKey = (w: Watching | null) => (w ? `${w.movie_id}:${w.started_at}:${w.provider}` : null);

// Scrims as stacked strips of ground (React Native 0.72 has no gradients).
function lerpStops(stops: [number, number][], x: number): number {
  for (let i = 1; i < stops.length; i += 1) {
    const [x0, a0] = stops[i - 1];
    const [x1, a1] = stops[i];
    if (x <= x1) return x1 === x0 ? a1 : a0 + ((a1 - a0) * (x - x0)) / (x1 - x0);
  }
  return stops[stops.length - 1][1];
}

const sideStrips = (() => {
  const from = D.scrimStops[1][0]; // solid up to here
  const strips = [];
  for (let i = 0; i < D.scrimStrips; i += 1) {
    const a = from + ((1 - from) * i) / D.scrimStrips;
    const b = from + ((1 - from) * (i + 1)) / D.scrimStrips;
    const left = Math.round(px(a * W));
    const right = Math.round(px(b * W));
    strips.push({ left, width: right - left, opacity: lerpStops(D.scrimStops, (a + b) / 2) });
  }
  return { solid: Math.round(px(from * W)), strips };
})();

const bottomStrips = (() => {
  const span = D.bottomScrimShare * H;
  const strips = [];
  for (let i = 0; i < D.bottomScrimStrips; i += 1) {
    const top = Math.round(px(H - span + (span * i) / D.bottomScrimStrips));
    const bottom = Math.round(px(H - span + (span * (i + 1)) / D.bottomScrimStrips));
    const mid = (i + 0.5) / D.bottomScrimStrips; // 0 at the top of the scrim, 1 at the screen edge
    strips.push({ top, height: bottom - top, opacity: D.bottomScrimOpacity * mid });
  }
  return strips;
})();

const topStrips = Array.from({ length: D.topScrimStrips }, (_, i) => {
  const top = Math.round(px((D.topScrimHeight * i) / D.topScrimStrips));
  const bottom = Math.round(px((D.topScrimHeight * (i + 1)) / D.topScrimStrips));
  const mid = (i + 0.5) / D.topScrimStrips;
  return { top, height: bottom - top, opacity: D.topScrimOpacity * (1 - mid) };
});

// ---------------------------------------------------------------------------------------------

function Hero({ details }: { details: Details }) {
  const [failed, setFailed] = useState(false);
  const fade = useRef(new Animated.Value(0)).current;
  const uri = isUrl(details.backdrop) ? details.backdrop : null;

  useEffect(() => {
    setFailed(false);
    fade.setValue(0);
    const anim = Animated.timing(fade, {
      toValue: 1,
      duration: M.backdropMs,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [uri, fade]);

  if (!uri || failed) return <ConsoleBackdrop tint={tintFor(details.genres)} />;

  const scale = fade.interpolate({ inputRange: [0, 1], outputRange: [M.backdropScale, 1] });
  return (
    <View style={styles.heroRoot} pointerEvents="none">
      <Animated.Image
        source={{ uri }}
        resizeMode="cover"
        onError={() => setFailed(true)}
        style={[styles.backdrop, { opacity: fade, transform: [{ scale }] }]}
      />
      <View style={[styles.scrimSolid, { width: sideStrips.solid }]} />
      {sideStrips.strips.map((s, i) => (
        <View key={`s${i}`} style={[styles.scrimV, { left: s.left, width: s.width, opacity: s.opacity }]} />
      ))}
      {topStrips.map((s, i) => (
        <View key={`t${i}`} style={[styles.scrimH, { top: s.top, height: s.height, opacity: s.opacity }]} />
      ))}
      {bottomStrips.map((s, i) => (
        <View key={`b${i}`} style={[styles.scrimH, { top: s.top, height: s.height, opacity: s.opacity }]} />
      ))}
    </View>
  );
}

/** The info column rises into place block by block on entry. */
function useRise(key: string | number) {
  const values = useMemo(() => Array.from({ length: INFO_BLOCKS }, () => new Animated.Value(0)), []);
  useEffect(() => {
    values.forEach((v) => v.setValue(0));
    const anims = values.map((v, i) =>
      Animated.timing(v, {
        toValue: 1,
        duration: M.riseMs,
        delay: i * M.staggerMs,
        easing: Easing.out(Easing.exp),
        useNativeDriver: true,
      }),
    );
    anims.forEach((a) => a.start());
    return () => anims.forEach((a) => a.stop());
  }, [key, values]);
  return (i: number) => ({
    opacity: values[i],
    transform: [{ translateY: values[i].interpolate({ inputRange: [0, 1], outputRange: [px(M.rise), 0] }) }],
  });
}

function ProviderLogo({ provider, focused }: { provider: Provider; focused: boolean }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [provider.logo]);
  if (isUrl(provider.logo) && !failed) {
    return (
      <Image source={{ uri: provider.logo }} style={styles.logo} resizeMode="cover" onError={() => setFailed(true)} />
    );
  }
  return (
    <View style={[styles.logo, styles.logoFallback, focused ? styles.logoFallbackFocused : null]}>
      <Text style={styles.logoLetter}>{(provider.name || '?').charAt(0).toUpperCase()}</Text>
    </View>
  );
}

interface PillProps {
  provider: Provider;
  onSelect: () => void;
  focusRef: (node: SpatialNavigationNodeRef | null) => void;
}

function ProviderPill({ provider, onSelect, focusRef }: PillProps) {
  return (
    <SpatialNavigationFocusableView ref={focusRef} onSelect={onSelect}>
      {({ isFocused }) => (
        <View style={[styles.pill, isFocused ? styles.pillFocused : null]}>
          <ProviderLogo provider={provider} focused={isFocused} />
          <Text style={[styles.pillName, isFocused ? styles.onLight : null]} numberOfLines={1}>
            {provider.name}
          </Text>
          <Text style={[styles.pillKind, isFocused ? styles.kindOnLight : null]}>
            {KIND_LABEL[provider.kind] || ''}
          </Text>
        </View>
      )}
    </SpatialNavigationFocusableView>
  );
}

function WereBackPill({ onSelect, focusRef }: { onSelect: () => void; focusRef: PillProps['focusRef'] }) {
  return (
    <SpatialNavigationFocusableView ref={focusRef} onSelect={onSelect}>
      {({ isFocused }) => (
        <View style={[styles.pill, styles.backPill, isFocused ? styles.pillFocused : null]}>
          <Text style={[styles.pillName, isFocused ? styles.onLight : null]}>We’re back</Text>
        </View>
      )}
    </SpatialNavigationFocusableView>
  );
}

/** Quiet outline pill (white when focused) for "Already seen". */
function SeenPill({ onSelect, focusRef }: { onSelect: () => void; focusRef: PillProps['focusRef'] }) {
  return (
    <SpatialNavigationFocusableView ref={focusRef} onSelect={onSelect}>
      {({ isFocused }) => (
        <View style={[styles.pill, styles.seenPill, isFocused ? styles.pillFocused : null]}>
          <Text style={[styles.pillName, isFocused ? styles.onLight : null]}>Already seen</Text>
        </View>
      )}
    </SpatialNavigationFocusableView>
  );
}

// ---------------------------------------------------------------------------------------------

export default function DetailsScreen({ state, onWatch, onWereBack, onBack, onSeen }: DetailsScreenProps) {
  const details = state.details;
  const watching = state.watching ?? null;
  const [hiddenKey, setHiddenKey] = useState<string | null>(null);
  const [focusTarget, setFocusTarget] = useState<string | null>(null);
  const nodeRefs = useRef<Record<string, SpatialNavigationNodeRef | null>>({});
  const lastProvider = useRef<string | null>(null);

  const providers = details && Array.isArray(details.providers) ? details.providers.slice(0, 4) : [];
  const key = watchKey(watching);
  const handoff = key !== null && key !== hiddenKey;
  const rise = useRise(details ? details.id : 0);

  // The pills and the handoff swap in place; move the D-pad focus with them.
  const prevHandoff = useRef(handoff);
  useEffect(() => {
    if (prevHandoff.current === handoff) return;
    prevHandoff.current = handoff;
    if (handoff || providers.length === 0) setFocusTarget(WERE_BACK);
    else {
      const idx = providers.findIndex((p) => p.name === (watching ? watching.provider : lastProvider.current));
      setFocusTarget(`p${Math.max(idx, 0)}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- react to the swap only
  }, [handoff]);

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
    if (handoff && key)
      setHiddenKey(key); // local only; shows again when `watching` changes
    else onBack?.();
  });

  const refFor = (id: string) => (node: SpatialNavigationNodeRef | null) => {
    nodeRefs.current[id] = node;
  };

  if (!details) {
    return (
      <View style={styles.screen}>
        <ConsoleBackdrop tint={consoleColors.fieldTeal} />
        <ConsoleHeader state={state} />
        <View style={styles.info}>
          <Text style={styles.title}>No film open</Text>
          <Text style={styles.meta}>Pick a film from tonight’s picks.</Text>
        </View>
        <View style={styles.footer}>
          <Text style={styles.footerText}>Back: tonight’s picks</Text>
        </View>
      </View>
    );
  }

  const fromPicks = (Array.isArray(state.recommendations) ? state.recommendations : []).find(
    (m) => m.id === details.id,
  );
  const match = typeof details.match === 'number' ? details.match : fromPicks ? fromPicks.match : undefined;
  const rating = typeof details.rating === 'number' && details.rating > 0 ? details.rating : null;
  const cast = Array.isArray(details.cast) ? details.cast.slice(0, 3) : [];
  const region = details.providers_region || 'US';
  const chosen = watching ? providers.find((p) => p.name === watching.provider) : undefined;
  const seenPill = onSeen ? (
    <View style={styles.pillGap}>
      <SeenPill onSelect={() => onSeen(details.id)} focusRef={refFor(SEEN)} />
    </View>
  ) : null;

  const watch = () => {
    if (handoff && watching) {
      return (
        <View style={styles.handoff}>
          <View style={styles.handoffLine}>
            {chosen ? <ProviderLogo provider={chosen} focused={false} /> : null}
            <Text style={[styles.handoffTitle, chosen ? styles.handoffTitleWithLogo : null]} numberOfLines={1}>
              {`Enjoy it on ${watching.provider}`}
            </Text>
          </View>
          <Text style={styles.handoffSub}>Come back when it’s over</Text>
          <View style={styles.pills}>
            <DefaultFocus>
              <WereBackPill onSelect={() => onWereBack?.()} focusRef={refFor(WERE_BACK)} />
            </DefaultFocus>
          </View>
        </View>
      );
    }
    if (providers.length === 0) {
      return (
        <View>
          <Text style={styles.watchLabel}>Where to watch</Text>
          <Text style={styles.none}>{`Not streaming in the ${region} right now`}</Text>
          <SpatialNavigationNode orientation="horizontal">
            <View style={styles.pills}>
              <DefaultFocus>
                <WereBackPill onSelect={() => onWereBack?.()} focusRef={refFor(WERE_BACK)} />
              </DefaultFocus>
              {seenPill}
            </View>
          </SpatialNavigationNode>
        </View>
      );
    }
    return (
      <View>
        <Text style={styles.watchLabel}>Where to watch</Text>
        <SpatialNavigationNode orientation="horizontal">
          <View style={styles.pills}>
            {providers.map((p, i) => (
              <DefaultFocus key={`${p.id}-${p.name}`} enable={i === 0}>
                <View style={i > 0 ? styles.pillGap : null}>
                  <ProviderPill
                    provider={p}
                    focusRef={refFor(`p${i}`)}
                    onSelect={() => {
                      lastProvider.current = p.name;
                      onWatch?.(p.name);
                    }}
                  />
                </View>
              </DefaultFocus>
            ))}
            {seenPill}
          </View>
        </SpatialNavigationNode>
      </View>
    );
  };

  const longTitle = (details.title || '').length > D.longTitleChars;

  return (
    <View style={styles.screen}>
      <Hero details={details} />
      <ConsoleHeader state={state} />
      {state.message ? (
        <Text style={styles.status} numberOfLines={1}>
          {state.message}
        </Text>
      ) : null}

      <View style={styles.info}>
        <Animated.Text style={[styles.title, rise(0)]} numberOfLines={2}>
          {details.title}
        </Animated.Text>
        <Animated.Text style={[styles.meta, rise(1)]} numberOfLines={1}>
          {metaLine(details)}
        </Animated.Text>
        <Animated.View style={[styles.chips, rise(2)]}>
          {typeof match === 'number' ? (
            <View style={[styles.chip, styles.chipMatch]}>
              <Text style={[styles.chipText, styles.onLight]}>{`${match}% match`}</Text>
            </View>
          ) : null}
          {rating !== null ? (
            <View style={styles.chip}>
              <Text style={styles.chipText}>{`TMDB ${rating.toFixed(1)}`}</Text>
            </View>
          ) : null}
          <View style={styles.chip}>
            <Text style={styles.chipText}>
              {details.ok_for_this_couch === false ? 'Not for this couch' : 'Fine for this couch'}
            </Text>
          </View>
        </Animated.View>
        {details.overview ? (
          <Animated.Text style={[styles.overview, rise(3)]} numberOfLines={longTitle ? 3 : 4}>
            {details.overview}
          </Animated.Text>
        ) : null}
        {details.director || cast.length > 0 ? (
          <Animated.Text style={[styles.credits, rise(4)]} numberOfLines={1}>
            {details.director ? <Text style={styles.creditLabel}>Director </Text> : null}
            {details.director || ''}
            {details.director && cast.length > 0 ? '  ·  ' : ''}
            {cast.length > 0 ? <Text style={styles.creditLabel}>Cast </Text> : null}
            {cast.join(', ')}
          </Animated.Text>
        ) : null}
      </View>

      <View style={styles.watch}>{watch()}</View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          {handoff
            ? 'OK: we’re back · Back: where to watch'
            : 'Left/Right: choose · OK: watch there or mark as seen · Back: tonight’s picks'}
        </Text>
        <Text style={styles.footerText}>Streaming data by JustWatch</Text>
      </View>
    </View>
  );
}

const PILL_H = px(D.pillHeight);
const CHIP_H = px(D.chipHeight);

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: consoleColors.ground,
    overflow: 'hidden',
  },

  // Hero
  heroRoot: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: consoleColors.ground,
    overflow: 'hidden',
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: px(D.backdropLeft),
    width: px(D.backdropWidth),
    height: px(H),
  },
  scrimSolid: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    backgroundColor: consoleColors.ground,
  },
  scrimV: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    backgroundColor: consoleColors.ground,
  },
  scrimH: {
    position: 'absolute',
    left: 0,
    right: 0,
    backgroundColor: consoleColors.ground,
  },

  status: {
    position: 'absolute',
    top: SAFE_Y + px(D.disc + 16),
    right: SAFE_X,
    left: px(800),
    textAlign: 'right',
    color: consoleColors.secondary,
    fontSize: px(T.credits),
    fontWeight: consoleType.weight.medium,
  },

  // Info column
  info: {
    position: 'absolute',
    top: px(D.infoTop),
    left: SAFE_X,
    width: px(D.infoWidth),
  },
  title: {
    color: consoleColors.text,
    fontSize: px(T.title),
    lineHeight: px(74),
    fontWeight: consoleType.weight.semibold,
    letterSpacing: -px(1.28),
  },
  meta: {
    marginTop: px(16),
    color: consoleColors.secondary,
    fontSize: px(T.meta),
    lineHeight: px(34),
    fontWeight: consoleType.weight.medium,
  },
  chips: {
    marginTop: px(22),
    flexDirection: 'row',
    alignItems: 'center',
  },
  chip: {
    height: CHIP_H,
    paddingHorizontal: px(20),
    borderRadius: CHIP_H / 2,
    borderWidth: px(2),
    borderColor: consoleDetailsColors.chipOutline,
    justifyContent: 'center',
    marginRight: px(14),
  },
  chipMatch: {
    backgroundColor: consoleColors.cta,
    borderColor: consoleColors.cta,
  },
  chipText: {
    color: consoleColors.text,
    fontSize: px(T.chip),
    fontWeight: consoleType.weight.semibold,
  },
  overview: {
    marginTop: px(28),
    color: consoleColors.secondary,
    fontSize: px(T.overview),
    lineHeight: px(T.overviewLine),
    fontWeight: consoleType.weight.medium,
  },
  credits: {
    marginTop: px(18),
    color: consoleColors.secondary,
    fontSize: px(T.credits),
    lineHeight: px(34),
    fontWeight: consoleType.weight.medium,
  },
  creditLabel: {
    color: consoleColors.text,
    fontWeight: consoleType.weight.semibold,
  },

  // Where to watch
  watch: {
    position: 'absolute',
    left: SAFE_X,
    right: SAFE_X,
    bottom: px(D.watchBottom),
  },
  watchLabel: {
    color: consoleColors.secondary,
    fontSize: px(T.watchLabel),
    fontWeight: consoleType.weight.semibold,
  },
  none: {
    marginTop: px(10),
    color: consoleColors.secondary,
    fontSize: px(T.watchLabel),
    fontWeight: consoleType.weight.medium,
  },
  pills: {
    marginTop: px(16),
    flexDirection: 'row',
    alignItems: 'center',
  },
  pillGap: {
    marginLeft: px(D.pillGap),
  },
  pill: {
    height: PILL_H,
    borderRadius: PILL_H / 2,
    paddingHorizontal: px(D.pillPadding),
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: consoleDetailsColors.pill,
  },
  pillFocused: {
    backgroundColor: consoleColors.cta,
    borderColor: consoleColors.cta,
    transform: [{ scale: D.focusScale }],
    shadowColor: consoleColors.shadow,
    shadowOpacity: 0.45,
    shadowRadius: px(30),
    shadowOffset: { width: 0, height: px(16) },
    elevation: 10,
  },
  seenPill: {
    paddingHorizontal: px(36),
    backgroundColor: 'transparent',
    borderWidth: px(2),
    borderColor: consoleDetailsColors.chipOutline,
  },
  backPill: {
    paddingHorizontal: px(44),
  },
  logo: {
    width: px(D.logo),
    height: px(D.logo),
    borderRadius: px(D.logoRadius),
    marginRight: px(14),
    overflow: 'hidden',
  },
  logoFallback: {
    backgroundColor: consoleDetailsColors.logoFallback,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoFallbackFocused: {
    backgroundColor: consoleColors.onLight,
  },
  logoLetter: {
    color: consoleColors.text,
    fontSize: px(T.pillKind),
    fontWeight: consoleType.weight.semibold,
  },
  pillName: {
    maxWidth: px(D.pillNameMax),
    color: consoleColors.text,
    fontSize: px(T.pillName),
    fontWeight: consoleType.weight.semibold,
  },
  pillKind: {
    marginLeft: px(14),
    color: consoleColors.secondary,
    fontSize: px(T.pillKind),
    fontWeight: consoleType.weight.medium,
  },
  onLight: {
    color: consoleColors.onLight,
  },
  kindOnLight: {
    color: consoleDetailsColors.kindOnLight,
  },

  // Handoff
  handoff: {},
  handoffLine: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  handoffTitle: {
    color: consoleColors.text,
    fontSize: px(T.handoff),
    fontWeight: consoleType.weight.semibold,
  },
  handoffTitleWithLogo: {
    marginLeft: px(2),
  },
  handoffSub: {
    marginTop: px(8),
    color: consoleColors.secondary,
    fontSize: px(T.watchLabel),
    fontWeight: consoleType.weight.medium,
  },

  footer: {
    position: 'absolute',
    left: SAFE_X,
    right: SAFE_X,
    bottom: px(D.footerBottom),
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  footerText: {
    color: consoleColors.placeholder,
    fontSize: px(T.footer),
    fontWeight: consoleType.weight.medium,
  },
});
