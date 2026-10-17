import React, { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, typography, spacing, radius } from '../theme';

export interface ToastProps {
  message: string;
  durationMs?: number;
  onDismiss?: () => void;
}

export default function Toast({ message, durationMs = 4000, onDismiss }: ToastProps) {
  useEffect(() => {
    if (!durationMs || !onDismiss) return;
    const timer = setTimeout(() => {
      onDismiss();
    }, durationMs);
    return () => clearTimeout(timer);
  }, [durationMs, onDismiss]);

  return (
    <View style={styles.toast}>
      <Text style={styles.icon}>⚠️</Text>
      <Text style={styles.text}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: 'absolute',
    bottom: 40,
    left: '50%',
    transform: [{ translateX: -200 }],
    width: 400,
    backgroundColor: colors.bg.surface,
    borderColor: colors.border.accent,
    borderWidth: 1.5,
    borderRadius: radius.md,
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[4],
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
    elevation: 10,
    zIndex: 9999,
  },
  icon: {
    fontSize: 20,
    marginRight: spacing[3],
  },
  text: {
    color: colors.text.primary,
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium,
    flex: 1,
  },
});
