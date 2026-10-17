import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { colors, typography, radius } from '../../theme';
import { scaledPixels } from '../../hooks/useScale';

export interface MessageLineProps {
  message?: string;
  style?: ViewStyle;
}

export default function MessageLine({ message, style }: MessageLineProps) {
  if (!message || !message.trim()) return null;

  return (
    <View style={[styles.container, style]}>
      <View style={styles.dot} />
      <Text style={styles.text} numberOfLines={1}>
        {message}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bg.surface,
    borderWidth: 1,
    borderColor: colors.border.accent,
    borderRadius: radius.full,
    paddingHorizontal: scaledPixels(16),
    paddingVertical: scaledPixels(7),
    maxWidth: scaledPixels(520),
  },
  dot: {
    width: scaledPixels(9),
    height: scaledPixels(9),
    borderRadius: radius.full,
    backgroundColor: colors.accent.popcorn,
    marginRight: scaledPixels(10),
  },
  text: {
    color: colors.accent.cream,
    fontSize: scaledPixels(20),
    fontWeight: typography.fontWeight.medium,
  },
});
