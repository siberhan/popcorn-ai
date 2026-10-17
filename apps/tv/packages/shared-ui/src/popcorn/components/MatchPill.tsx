import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { colors, typography, radius } from '../../theme';
import { scaledPixels } from '../../hooks/useScale';

export interface MatchPillProps {
  match?: number;
  style?: ViewStyle;
}

export default function MatchPill({ match, style }: MatchPillProps) {
  if (typeof match !== 'number') return null;

  return (
    <View style={[styles.pill, style]}>
      <Text style={styles.text}>{match}% match</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    backgroundColor: colors.accent.popcorn,
    paddingHorizontal: scaledPixels(12),
    paddingVertical: scaledPixels(4),
    borderRadius: radius.full,
    alignSelf: 'flex-start',
  },
  text: {
    color: colors.text.onAccent,
    fontSize: scaledPixels(18),
    fontWeight: typography.fontWeight.bold,
    letterSpacing: 0.3,
  },
});
