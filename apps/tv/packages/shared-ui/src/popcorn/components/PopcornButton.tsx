import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SpatialNavigationFocusableView } from 'react-tv-space-navigation';
import { scaledPixels } from '../../hooks/useScale';
import { consoleColors, consoleLayout, consoleType } from '../../theme/console';

export interface PopcornMarkProps {
  /** Ink colour of the mark. */
  color?: string;
  /** Colour of the surface behind it; used for the cut lines between kernels and stripes. */
  cutout?: string;
}

/**
 * A small popcorn box drawn with plain Views (no image assets), in one ink colour:
 * a cloud of kernels over a tapered, striped box.
 */
export function PopcornMark({ color = consoleColors.onLight, cutout = consoleColors.cta }: PopcornMarkProps) {
  const kernel = [mark.kernel, { backgroundColor: color, borderColor: cutout }];
  return (
    <View style={mark.wrap}>
      <View style={[mark.box, { borderTopColor: color }]} />
      <View style={[mark.stripe, mark.s1, { backgroundColor: cutout }]} />
      <View style={[mark.stripe, mark.s2, { backgroundColor: cutout }]} />
      <View style={[kernel, mark.k1]} />
      <View style={[kernel, mark.k4]} />
      <View style={[kernel, mark.k2]} />
      <View style={[kernel, mark.k3]} />
    </View>
  );
}

export interface PopcornButtonProps {
  disabled: boolean;
  onPress: () => void;
}

/**
 * The white "Popcorn" pill. Disabled = 40% opacity, still focusable, does nothing.
 * Focus draws a white ring with a gap and lifts the pill slightly.
 */
export default function PopcornButton({ disabled, onPress }: PopcornButtonProps) {
  const handleSelect = () => {
    if (!disabled) onPress();
  };

  return (
    <SpatialNavigationFocusableView onSelect={handleSelect}>
      {({ isFocused }) => (
        <View style={[styles.ring, isFocused ? styles.ringFocused : null]}>
          <View style={[styles.pill, disabled ? styles.pillDisabled : null]}>
            <PopcornMark />
            <Text style={styles.label}>Popcorn</Text>
          </View>
        </View>
      )}
    </SpatialNavigationFocusableView>
  );
}

const MARK_W = scaledPixels(40);
const MARK_H = scaledPixels(46);
const KERNEL = scaledPixels(18);
const BOX_TOP = scaledPixels(18);
const BOX_TAPER = scaledPixels(6);
const RING_W = scaledPixels(4);
const RING_GAP = scaledPixels(5);
const H = scaledPixels(consoleLayout.ctaHeight);

const mark = StyleSheet.create({
  wrap: {
    width: MARK_W,
    height: MARK_H,
    marginRight: scaledPixels(16),
  },
  kernel: {
    position: 'absolute',
    width: KERNEL,
    height: KERNEL,
    borderRadius: KERNEL / 2,
    borderWidth: scaledPixels(2),
  },
  k1: { left: 0, top: scaledPixels(8) },
  k2: { left: scaledPixels(7), top: scaledPixels(1) },
  k3: { left: scaledPixels(15), top: scaledPixels(1) },
  k4: { left: scaledPixels(22), top: scaledPixels(8) },
  // Trapezoid from borders: full width at the top, narrower at the bottom.
  box: {
    position: 'absolute',
    left: 0,
    top: BOX_TOP,
    width: MARK_W - BOX_TAPER * 2,
    height: 0,
    borderTopWidth: MARK_H - BOX_TOP,
    borderLeftWidth: BOX_TAPER,
    borderRightWidth: BOX_TAPER,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  stripe: {
    position: 'absolute',
    top: BOX_TOP + scaledPixels(6),
    bottom: 0,
    width: scaledPixels(3),
  },
  s1: { left: scaledPixels(14) },
  s2: { left: scaledPixels(23) },
});

const styles = StyleSheet.create({
  ring: {
    borderRadius: 9999,
    borderWidth: RING_W,
    borderColor: 'transparent',
    padding: RING_GAP,
  },
  ringFocused: {
    borderColor: consoleColors.ring,
    transform: [{ scale: 1.06 }],
  },
  pill: {
    height: H,
    borderRadius: H / 2,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: consoleColors.cta,
    paddingLeft: scaledPixels(44),
    paddingRight: scaledPixels(52),
    shadowColor: consoleColors.shadow,
    shadowOpacity: 0.45,
    shadowRadius: scaledPixels(30),
    shadowOffset: { width: 0, height: scaledPixels(16) },
    elevation: 10,
  },
  pillDisabled: {
    opacity: 0.4,
  },
  label: {
    color: consoleColors.onLight,
    fontSize: scaledPixels(consoleType.name),
    fontWeight: consoleType.weight.semibold,
  },
});
