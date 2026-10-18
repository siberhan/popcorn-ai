import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated, Easing } from 'react-native';
import type { Voice } from '../types';
import { scaledPixels } from '../../hooks/useScale';
import {
  consoleColors,
  consoleType,
  consoleVoice,
  consoleVoiceColors,
  consoleVoiceMotion,
  consoleVoiceType,
} from '../../theme/console';

const px = scaledPixels;
const V = consoleVoice;
const MO = consoleVoiceMotion;
const T = consoleVoiceType;

export interface VoiceBarProps {
  voice?: Voice | null;
  /** Text of the speech item playing now. */
  caption: string | null;
  /** The TV itself is waiting on the agent (an event it sent). */
  waiting?: boolean;
  /** The screen shows the live words itself (rating): skip the listening view. */
  hideListening?: boolean;
}

type Mode = 'listening' | 'thinking' | 'speaking' | null;

function ListeningBars() {
  const values = useMemo(() => V.bars.map(() => new Animated.Value(V.barIdle / V.barsHeight)), []);
  useEffect(() => {
    const idle = V.barIdle / V.barsHeight;
    const loops = values.map((v, i) => {
      const peak = V.bars[i] / V.barsHeight;
      const ms = MO.barMs[i % MO.barMs.length];
      return Animated.loop(
        Animated.sequence([
          Animated.timing(v, { toValue: peak, duration: ms, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(v, {
            toValue: Math.max(idle, peak * 0.3),
            duration: ms,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
        ]),
      );
    });
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [values]);
  return (
    <View style={styles.bars}>
      {values.map((v, i) => (
        <Animated.View key={i} style={[styles.bar, i > 0 ? styles.barGap : null, { transform: [{ scaleY: v }] }]} />
      ))}
    </View>
  );
}

function ThinkingDots() {
  const values = useMemo(() => [0, 1, 2].map(() => new Animated.Value(0.3)), []);
  useEffect(() => {
    const loop = Animated.loop(
      Animated.stagger(
        MO.dotMs / 3,
        values.map((v) =>
          Animated.sequence([
            Animated.timing(v, { toValue: 1, duration: MO.dotMs / 2, useNativeDriver: true }),
            Animated.timing(v, { toValue: 0.3, duration: MO.dotMs / 2, useNativeDriver: true }),
          ]),
        ),
      ),
    );
    loop.start();
    return () => loop.stop();
  }, [values]);
  return (
    <View style={styles.dots}>
      {values.map((v, i) => (
        <Animated.View key={i} style={[styles.dot, i > 0 ? styles.dotGap : null, { opacity: v }]} />
      ))}
    </View>
  );
}

/**
 * Bottom strip on every screen: the caption while the TV speaks, "Listening..." with moving bars
 * and the live words while the phone hears someone, "Thinking..." with dots while the agent works.
 * Hidden when the microphone is idle and nothing plays.
 */
export default function VoiceBar({ voice, caption, waiting, hideListening }: VoiceBarProps) {
  // Local staleness: the phone may vanish mid-sentence. Uses the TV clock only (no server time).
  const key = voice ? `${voice.state}|${voice.at}|${voice.text}` : '';
  const [stale, setStale] = useState(false);
  useEffect(() => {
    setStale(false);
    if (!voice || voice.state === 'idle') return;
    const ms = voice.state === 'listening' ? V.listenStaleMs : V.thinkStaleMs;
    const id = setTimeout(() => setStale(true), ms);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the voice value
  }, [key]);

  const state = voice && !stale ? voice.state : 'idle';
  let mode: Mode = null;
  if (state === 'listening' && !hideListening) mode = 'listening';
  else if (state === 'thinking' || waiting) mode = 'thinking';
  else if (caption) mode = 'speaking';

  const fade = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!mode) {
      fade.setValue(0);
      return;
    }
    const anim = Animated.timing(fade, {
      toValue: 1,
      duration: MO.inMs,
      easing: Easing.out(Easing.exp),
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [mode, fade]);

  if (!mode) return null;

  const words = voice && state !== 'idle' ? (voice.text || '').trim() : '';
  const speaker = voice && voice.speaker ? voice.speaker : null;
  const rise = fade.interpolate({ inputRange: [0, 1], outputRange: [px(12), 0] });

  return (
    <View pointerEvents="none" style={styles.wrap}>
      <Animated.View style={[styles.bar_, { opacity: fade, transform: [{ translateY: rise }] }]}>
        {mode === 'speaking' ? (
          <Text style={styles.caption} numberOfLines={V.captionLines}>
            {caption}
          </Text>
        ) : (
          <>
            <View style={styles.lead}>
              {mode === 'listening' ? <ListeningBars /> : <ThinkingDots />}
              <Text style={styles.label}>
                {mode === 'listening' ? (speaker ? `${speaker} · Listening...` : 'Listening...') : 'Thinking...'}
              </Text>
            </View>
            {words ? (
              <Text
                style={[styles.words, mode === 'thinking' ? styles.wordsDone : null]}
                numberOfLines={V.captionLines}
              >
                {mode === 'thinking' ? `“${words}”` : words}
              </Text>
            ) : null}
          </>
        )}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: px(96),
    right: px(96),
    bottom: px(V.bottom),
    alignItems: 'center',
    zIndex: 50,
    elevation: 50,
  },
  bar_: {
    maxWidth: px(V.maxWidth),
    minHeight: px(V.minHeight),
    borderRadius: px(V.radius),
    paddingHorizontal: px(V.padX),
    paddingVertical: px(V.padY),
    backgroundColor: consoleVoiceColors.bar,
    borderWidth: px(1),
    borderColor: consoleVoiceColors.outline,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: consoleColors.shadow,
    shadowOpacity: 0.5,
    shadowRadius: px(28),
    shadowOffset: { width: 0, height: px(12) },
  },
  lead: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  label: {
    marginLeft: px(16),
    color: consoleColors.secondary,
    fontSize: px(T.label),
    fontWeight: consoleType.weight.semibold,
  },
  words: {
    flexShrink: 1,
    marginLeft: px(24),
    color: consoleColors.text,
    fontSize: px(T.text),
    lineHeight: px(T.textLine),
    fontWeight: consoleType.weight.medium,
  },
  wordsDone: {
    color: consoleColors.secondary,
  },
  caption: {
    flexShrink: 1,
    color: consoleColors.text,
    fontSize: px(T.text),
    lineHeight: px(T.textLine),
    fontWeight: consoleType.weight.medium,
    textAlign: 'center',
  },
  bars: {
    height: px(V.barsHeight),
    flexDirection: 'row',
    alignItems: 'center',
  },
  bar: {
    width: px(V.barWidth),
    height: px(V.barsHeight),
    borderRadius: px(V.barWidth / 2),
    backgroundColor: consoleColors.text,
  },
  barGap: {
    marginLeft: px(V.barGap),
  },
  dots: {
    height: px(V.barsHeight),
    flexDirection: 'row',
    alignItems: 'center',
  },
  dot: {
    width: px(V.dot),
    height: px(V.dot),
    borderRadius: px(V.dot / 2),
    backgroundColor: consoleColors.text,
  },
  dotGap: {
    marginLeft: px(V.dotGap),
  },
});
