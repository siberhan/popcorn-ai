import React, { useState, useEffect } from 'react';
import { View, Text, Image, StyleSheet, ViewStyle } from 'react-native';
import { colors, typography, radius } from '../../theme';
import { scaledPixels } from '../../hooks/useScale';
import { initialsForName } from './avatarUtils';

export interface PosterCardProps {
  poster: string | null | undefined;
  title: string;
  year?: string;
  width: number;
  height: number;
  borderRadius?: number;
  style?: ViewStyle;
}

/**
 * Renders a TMDB movie poster at runtime with a rich warm cinema typographic fallback
 * when poster is null, offline, or fails to load.
 */
export default function PosterCard({
  poster,
  title,
  year,
  width,
  height,
  borderRadius = radius.md,
  style,
}: PosterCardProps) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [poster]);

  const showImage = Boolean(poster && typeof poster === 'string' && poster.startsWith('http') && !failed);
  const monogram = initialsForName(title || 'Film');

  return (
    <View
      style={[
        styles.frame,
        {
          width,
          height,
          borderRadius,
        },
        style,
      ]}
    >
      {/* Always-present warm cinema typographic fallback */}
      <View style={styles.fallbackContainer}>
        <View style={styles.monogramCircle}>
          <Text style={styles.monogramText}>{monogram}</Text>
        </View>
        <Text style={styles.fallbackTitle} numberOfLines={3}>
          {title || 'Untitled Film'}
        </Text>
        {year ? <Text style={styles.fallbackYear}>{year}</Text> : null}
      </View>

      {showImage ? (
        <Image
          source={{ uri: poster as string }}
          style={[styles.image, { width, height, borderRadius }]}
          resizeMode="cover"
          onError={() => setFailed(true)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    backgroundColor: colors.bg.elevated,
    borderWidth: 1.5,
    borderColor: colors.border.default,
    overflow: 'hidden',
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
  },
  fallbackContainer: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    padding: scaledPixels(14),
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1B1410',
  },
  monogramCircle: {
    width: scaledPixels(48),
    height: scaledPixels(48),
    borderRadius: radius.full,
    backgroundColor: colors.bg.surfaceActive,
    borderWidth: 1.5,
    borderColor: colors.border.accent,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: scaledPixels(10),
  },
  monogramText: {
    color: colors.accent.popcorn,
    fontSize: scaledPixels(18),
    fontWeight: typography.fontWeight.bold,
    letterSpacing: 1,
  },
  fallbackTitle: {
    color: colors.text.primary,
    fontSize: scaledPixels(18),
    fontWeight: typography.fontWeight.semibold,
    textAlign: 'center',
    lineHeight: scaledPixels(23),
  },
  fallbackYear: {
    color: colors.text.muted,
    fontSize: scaledPixels(15),
    marginTop: scaledPixels(4),
  },
  image: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
});
