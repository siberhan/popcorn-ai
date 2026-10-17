import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, typography, spacing, radius } from '../theme';

export interface OfflineBannerProps {
  message?: string;
}

export default function OfflineBanner({
  message = 'Offline — reconnecting to Popcorn AI server...',
}: OfflineBannerProps) {
  return (
    <View style={styles.banner}>
      <View style={styles.dot} />
      <Text style={styles.text}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    top: 20,
    left: '50%',
    transform: [{ translateX: -250 }],
    width: 500,
    backgroundColor: colors.status.errorBg,
    borderColor: colors.status.error,
    borderWidth: 1.5,
    borderRadius: radius.md,
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[5],
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.status.error,
    marginRight: spacing[3],
  },
  text: {
    color: colors.text.primary,
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
  },
});
