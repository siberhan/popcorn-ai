import React, { useEffect, useRef, useState } from 'react';
import { View, StyleSheet, Animated, Easing } from 'react-native';
import { scaledPixels } from '../../hooks/useScale';
import { consoleColors, consoleBackdrop, consoleMotion } from '../../theme/console';

import { BLOB } from './backdropBlob';

const W = 1920;
const H = 1080;

// One drift cycle sampled as a sine, so the loop end matches its start exactly.
const STEPS = 12;
const PHASES = Array.from({ length: STEPS + 1 }, (_, i) => i / STEPS);
const wave = (amp: number, shift = 0) => PHASES.map((p) => scaledPixels(amp) * Math.sin(2 * Math.PI * p + shift));
const breathe = (amount: number) => PHASES.map((p) => 1 + amount * (0.5 - 0.5 * Math.cos(2 * Math.PI * p)));

// Left-to-right scrim: near-solid ground on the left third, clear by about x 1400.
const SCRIM_SOLID_TO = 560;
const SCRIM_CLEAR_AT = 1400;
const SCRIM_STRIPS = 28;
// Bottom shade behind the info block and the Popcorn button.
const SHADE_FROM = 640;
const SHADE_STRIPS = 20;

const smooth = (x: number) => x * x * (3 - 2 * x);

const scrimStrips = Array.from({ length: SCRIM_STRIPS }, (_, i) => {
  const w = (SCRIM_CLEAR_AT - SCRIM_SOLID_TO) / SCRIM_STRIPS;
  const mid = (i + 0.5) / SCRIM_STRIPS;
  const left = Math.round(scaledPixels(SCRIM_SOLID_TO + i * w));
  const right = Math.round(scaledPixels(SCRIM_SOLID_TO + (i + 1) * w));
  return { left, width: right - left, opacity: 0.94 * (1 - smooth(mid)) };
});

const shadeStrips = Array.from({ length: SHADE_STRIPS }, (_, i) => {
  const h = (H - SHADE_FROM) / SHADE_STRIPS;
  const mid = (i + 0.5) / SHADE_STRIPS;
  const top = Math.round(scaledPixels(SHADE_FROM + i * h));
  const bottom = Math.round(scaledPixels(SHADE_FROM + (i + 1) * h));
  return { top, height: bottom - top, opacity: 0.85 * smooth(mid) };
});

export type ConsoleBackdropLayout = 'couch' | 'reel' | 'spotlight';

export interface ConsoleBackdropProps {
  /** Colour of the main soft field; changes crossfade. */
  tint: string;
  /**
   * 'couch' (default): fields upper right, scrim keeps the left third near-solid ground.
   * 'reel': fields low and centred behind the recommendations band, no scrim.
   * 'spotlight': the field centred behind the rating spotlight, rust lower right, no scrim.
   */
  layout?: ConsoleBackdropLayout;
  /** Opacity of the main field (default `consoleBackdrop.fieldOpacity`). */
  fieldOpacity?: number;
}

/**
 * The console backdrop (couch and recommendations screens): tinted copies of one soft blob image drifting slowly behind
 * the content. In the couch layout a scrim keeps the left third near-solid ground.
 * Two field layers crossfade when `tint` changes. Nothing waits on an Animated end callback.
 */
export default function ConsoleBackdrop({ tint, layout = 'couch', fieldOpacity = consoleBackdrop.fieldOpacity }: ConsoleBackdropProps) {
  const reel = layout !== 'couch'; // no scrim
  const spot = layout === 'spotlight';
  const fieldStyle = spot ? styles.fieldSpot : reel ? styles.fieldReel : styles.field;
  const rustStyle = spot ? styles.rustSpot : reel ? styles.rustReel : styles.rust;
  const drift = useRef(new Animated.Value(0)).current;
  const fadeA = useRef(new Animated.Value(1)).current;
  const fadeB = useRef(new Animated.Value(0)).current;
  const [slots, setSlots] = useState<[string, string]>([tint, tint]);
  const active = useRef(0);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(drift, {
        toValue: 1,
        duration: consoleMotion.driftMs,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [drift]);

  useEffect(() => {
    const current = active.current;
    if (slots[current] === tint) return;
    const next = current === 0 ? 1 : 0;
    active.current = next;
    setSlots((prev) => (next === 0 ? [tint, prev[1]] : [prev[0], tint]));
    const fadeIn = next === 0 ? fadeA : fadeB;
    const fadeOut = next === 0 ? fadeB : fadeA;
    const ease = Easing.out(Easing.cubic);
    Animated.timing(fadeIn, { toValue: 1, duration: consoleMotion.tintMs, easing: ease, useNativeDriver: true }).start();
    Animated.timing(fadeOut, { toValue: 0, duration: consoleMotion.tintMs, easing: ease, useNativeDriver: true }).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- react to tint changes only
  }, [tint]);

  const fieldMotion = {
    transform: [
      { translateX: drift.interpolate({ inputRange: PHASES, outputRange: wave(70) }) },
      { translateY: drift.interpolate({ inputRange: PHASES, outputRange: wave(40, Math.PI / 2) }) },
      { scale: drift.interpolate({ inputRange: PHASES, outputRange: breathe(0.08) }) },
    ],
  };
  const rustMotion = {
    transform: [
      { translateX: drift.interpolate({ inputRange: PHASES, outputRange: wave(-60, Math.PI / 3) }) },
      { translateY: drift.interpolate({ inputRange: PHASES, outputRange: wave(-36) }) },
      { scale: drift.interpolate({ inputRange: PHASES, outputRange: breathe(0.06) }) },
    ],
  };

  return (
    <View style={styles.root} pointerEvents="none">
      <Animated.Image
        source={BLOB}
        resizeMode="stretch"
        tintColor={consoleColors.fieldRust}
        style={[rustStyle, { opacity: consoleBackdrop.rustOpacity }, rustMotion]}
      />
      <Animated.Image
        source={BLOB}
        resizeMode="stretch"
        tintColor={slots[0]}
        style={[fieldStyle, { opacity: Animated.multiply(fadeA, fieldOpacity) }, fieldMotion]}
      />
      <Animated.Image
        source={BLOB}
        resizeMode="stretch"
        tintColor={slots[1]}
        style={[fieldStyle, { opacity: Animated.multiply(fadeB, fieldOpacity) }, fieldMotion]}
      />
      {reel ? null : <View style={styles.scrimSolid} />}
      {reel
        ? null
        : scrimStrips.map((s, i) => (
            <View
              key={`scrim-${i}`}
              style={[styles.scrimStrip, { left: s.left, width: s.width, opacity: s.opacity }]}
            />
          ))}
      {reel
        ? null
        : shadeStrips.map((s, i) => (
            <View
              key={`shade-${i}`}
              style={[styles.shadeStrip, { top: s.top, height: s.height, opacity: s.opacity }]}
            />
          ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: consoleColors.ground,
    overflow: 'hidden',
  },
  field: {
    position: 'absolute',
    left: scaledPixels(W * 0.37),
    top: scaledPixels(-330),
    width: scaledPixels(1640),
    height: scaledPixels(1360),
  },
  rust: {
    position: 'absolute',
    left: scaledPixels(W * 0.66),
    top: scaledPixels(H * 0.3),
    width: scaledPixels(1100),
    height: scaledPixels(1000),
  },
  // Reel: the main field sits low and centred behind the band, the rust pools lower right.
  fieldReel: {
    position: 'absolute',
    left: scaledPixels(180),
    top: scaledPixels(220),
    width: scaledPixels(1680),
    height: scaledPixels(1060),
  },
  rustReel: {
    position: 'absolute',
    left: scaledPixels(1180),
    top: scaledPixels(560),
    width: scaledPixels(1000),
    height: scaledPixels(820),
  },
  // Spotlight: the field pools behind the centred disc and words, the rust lower right.
  fieldSpot: {
    position: 'absolute',
    left: scaledPixels(300),
    top: scaledPixels(40),
    width: scaledPixels(1320),
    height: scaledPixels(1040),
  },
  rustSpot: {
    position: 'absolute',
    left: scaledPixels(1160),
    top: scaledPixels(520),
    width: scaledPixels(940),
    height: scaledPixels(780),
  },
  scrimSolid: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: Math.round(scaledPixels(SCRIM_SOLID_TO)),
    backgroundColor: consoleColors.ground,
    opacity: 0.94,
  },
  scrimStrip: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    backgroundColor: consoleColors.ground,
  },
  shadeStrip: {
    position: 'absolute',
    left: 0,
    right: 0,
    backgroundColor: consoleColors.ground,
  },
});
