import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { colors, typography, radius } from '../../theme';
import { scaledPixels } from '../../hooks/useScale';

export interface KidBadgeProps {
  label?: string;
  size?: 'sm' | 'md';
  style?: ViewStyle;
}

export default function KidBadge({
  label = 'KID',
  size = 'sm',
  style,
}: KidBadgeProps) {
  const isMedium = size === 'md';
  return (
    <View
      style={[
        styles.badge,
        isMedium ? styles.badgeMd : styles.badgeSm,
        style,
      ]}
    >
      <Text style={[styles.text, isMedium ? styles.textMd : styles.textSm]}>
        {label.toUpperCase()}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    backgroundColor: colors.status.kidBadgeBg,
    borderWidth: 1.5,
    borderColor: colors.status.kidBadge,
    borderRadius: radius.full,
    alignSelf: 'flex-start',
    justifyContent: 'center',
    alignItems: 'center',
  },
  badgeSm: {
    paddingHorizontal: scaledPixels(10),
    paddingVertical: scaledPixels(3),
  },
  badgeMd: {
    paddingHorizontal: scaledPixels(14),
    paddingVertical: scaledPixels(6),
  },
  text: {
    color: colors.status.kidBadge,
    fontWeight: typography.fontWeight.bold,
    letterSpacing: 0.8,
  },
  textSm: {
    fontSize: scaledPixels(15),
  },
  textMd: {
    fontSize: scaledPixels(18),
  },
});
