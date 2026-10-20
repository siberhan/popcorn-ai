// Mapped from the v1 design tokens (font sizes x1.5 for 10-foot)

export const typography = {
  fontFamily: {
    display: 'Fraunces',
    sans: 'Plus Jakarta Sans',
    regular: 'System',
    mono: 'SpaceMono',
  },
  // Base font sizes multiplied by 1.5 for TV viewing
  fontSize: {
    xs: 18, // 12 * 1.5
    sm: 21, // 14 * 1.5
    md: 24, // 16 * 1.5
    lg: 27, // 18 * 1.5
    xl: 33, // 22 * 1.5
    '2xl': 42, // 28 * 1.5
    '3xl': 54, // 36 * 1.5
    '4xl': 72, // 48 * 1.5
    // Aliases
    xxl: 42,
    xxxl: 54,
  },
  lineHeight: {
    tight: 1.15,
    snug: 1.3,
    normal: 1.5,
    relaxed: 1.65,
  },
  fontWeight: {
    regular: '400' as const,
    medium: '500' as const,
    semibold: '600' as const,
    bold: '700' as const,
  },
};
