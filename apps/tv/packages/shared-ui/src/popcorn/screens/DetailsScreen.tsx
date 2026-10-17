import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import {
  SpatialNavigationFocusableView,
  SpatialNavigationNode,
  DefaultFocus,
} from 'react-tv-space-navigation';
import { TVState } from '../types';
import { colors, typography, radius, safeZones } from '../../theme';
import { scaledPixels } from '../../hooks/useScale';
import {
  CouchBar,
  PosterCard,
  MatchPill,
  getKidFilterLabel,
} from '../components';

export interface DetailsScreenProps {
  state: TVState;
}

export default function DetailsScreen({ state }: DetailsScreenProps) {
  const members = Array.isArray(state.members) ? state.members : [];
  const details = state.details;
  const kidFilter = getKidFilterLabel(members);

  if (!details) {
    return (
      <View style={styles.screen}>
        <CouchBar
          members={members}
          screen={state.screen}
          message={state.message}
        />
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyTitle}>No movie selected</Text>
          <Text style={styles.emptySub}>
            Ask Popcorn AI &quot;Tell me more about...&quot; to inspect a movie on the TV.
          </Text>
        </View>
      </View>
    );
  }

  const isCouchSafe = details.ok_for_this_couch !== false;
  const certLabel = details.certification_us || 'NR';
  const runtimeLabel =
    typeof details.runtime_minutes === 'number' && details.runtime_minutes > 0
      ? `${details.runtime_minutes} min`
      : null;

  return (
    <View style={styles.screen}>
      <CouchBar
        members={members}
        screen={state.screen}
        message={state.message}
      />

      {/* Main 2-Column Hero Stage */}
      <SpatialNavigationNode>
        <DefaultFocus>
          <SpatialNavigationFocusableView onSelect={() => {}}>
            {({ isFocused }) => (
              <Pressable
                style={[
                  styles.heroCard,
                  isFocused && styles.heroCardFocused,
                  !isCouchSafe && styles.heroCardUnsafe,
                ]}
              >
                {/* Left: Big Poster */}
                <View style={styles.posterCol}>
                  <PosterCard
                    poster={details.poster}
                    title={details.title}
                    year={details.year}
                    width={scaledPixels(410)}
                    height={scaledPixels(615)}
                    borderRadius={radius.xl}
                  />
                </View>

                {/* Right: Movie Details & Couch Safety Status */}
                <View style={styles.detailsCol}>
                  {/* Safety Banner */}
                  {!isCouchSafe ? (
                    <View style={styles.unsafeBanner}>
                      <View style={styles.unsafePill}>
                        <Text style={styles.unsafePillText}>WARNING</Text>
                      </View>
                      <Text style={styles.unsafeBannerText}>
                        Not OK for this couch — rated {certLabel}
                        {kidFilter ? ` (${kidFilter} required)` : ''}
                      </Text>
                    </View>
                  ) : (
                    <View style={styles.safeBanner}>
                      <View style={styles.safeDot} />
                      <Text style={styles.safeBannerText}>
                        OK for everyone on the couch tonight
                        {kidFilter ? ` · ${kidFilter}` : ''}
                      </Text>
                      {typeof details.match === 'number' ? (
                        <MatchPill
                          match={details.match}
                          style={styles.matchPillOffset}
                        />
                      ) : null}
                    </View>
                  )}

                  {/* Title & Tagline */}
                  <View style={styles.titleBlock}>
                    <Text style={styles.movieTitle} numberOfLines={2}>
                      {details.title}
                    </Text>
                    {details.tagline ? (
                      <Text style={styles.tagline} numberOfLines={1}>
                        &ldquo;{details.tagline}&rdquo;
                      </Text>
                    ) : null}
                  </View>

                  {/* Metadata Badges Row */}
                  <View style={styles.metaRow}>
                    {details.year ? (
                      <View style={styles.metaBadge}>
                        <Text style={styles.metaBadgeText}>{details.year}</Text>
                      </View>
                    ) : null}

                    <View
                      style={[
                        styles.certBadge,
                        !isCouchSafe && styles.certBadgeUnsafe,
                      ]}
                    >
                      <Text
                        style={[
                          styles.certBadgeText,
                          !isCouchSafe && styles.certBadgeTextUnsafe,
                        ]}
                      >
                        {certLabel}
                      </Text>
                    </View>

                    {runtimeLabel ? (
                      <View style={styles.metaBadge}>
                        <Text style={styles.metaBadgeText}>{runtimeLabel}</Text>
                      </View>
                    ) : null}

                    {details.rating ? (
                      <View style={styles.ratingBadge}>
                        <Text style={styles.ratingBadgeText}>
                          TMDB {details.rating.toFixed(1)} / 10
                        </Text>
                      </View>
                    ) : null}

                    {(details.genres || []).map((g) => (
                      <View key={g} style={styles.genreChip}>
                        <Text style={styles.genreChipText}>{g}</Text>
                      </View>
                    ))}
                  </View>

                  {/* Plot Overview */}
                  <View style={styles.overviewBox}>
                    <Text style={styles.sectionLabel}>SYNOPSIS</Text>
                    <Text style={styles.overviewText} numberOfLines={4}>
                      {details.overview || 'No synopsis available.'}
                    </Text>
                  </View>

                  {/* Director & Cast */}
                  <View style={styles.creditsGrid}>
                    <View style={styles.creditBlock}>
                      <Text style={styles.sectionLabel}>DIRECTOR</Text>
                      <Text style={styles.creditValue}>
                        {details.director || 'Not listed'}
                      </Text>
                    </View>

                    <View style={[styles.creditBlock, styles.castBlock]}>
                      <Text style={styles.sectionLabel}>STARRING CAST</Text>
                      <View style={styles.castChipsRow}>
                        {Array.isArray(details.cast) &&
                        details.cast.length > 0 ? (
                          details.cast.slice(0, 5).map((actor) => (
                            <View key={actor} style={styles.castChip}>
                              <Text style={styles.castChipText}>{actor}</Text>
                            </View>
                          ))
                        ) : (
                          <Text style={styles.creditValue}>Cast not listed</Text>
                        )}
                      </View>
                    </View>
                  </View>
                </View>
              </Pressable>
            )}
          </SpatialNavigationFocusableView>
        </DefaultFocus>
      </SpatialNavigationNode>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg.canvas,
    paddingHorizontal: scaledPixels(safeZones.titleSafe.horizontal),
    paddingVertical: scaledPixels(safeZones.titleSafe.vertical),
    justifyContent: 'space-between',
  },
  emptyWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyTitle: {
    color: colors.text.primary,
    fontSize: scaledPixels(36),
    fontWeight: typography.fontWeight.bold,
  },
  emptySub: {
    color: colors.text.secondary,
    fontSize: scaledPixels(22),
    marginTop: scaledPixels(10),
  },
  heroCard: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: colors.bg.surface,
    borderWidth: scaledPixels(3),
    borderColor: colors.border.default,
    borderRadius: radius.xl,
    padding: scaledPixels(32),
    alignItems: 'center',
  },
  heroCardFocused: {
    borderColor: colors.accent.popcorn,
    shadowColor: colors.accent.popcorn,
    shadowOpacity: 0.45,
    shadowRadius: scaledPixels(22),
    elevation: 10,
  },
  heroCardUnsafe: {
    borderColor: colors.status.error,
  },
  posterCol: {
    marginRight: scaledPixels(38),
  },
  detailsCol: {
    flex: 1,
    height: '100%',
    justifyContent: 'space-between',
  },
  unsafeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.status.errorBg,
    borderWidth: 2,
    borderColor: colors.status.error,
    borderRadius: radius.lg,
    paddingHorizontal: scaledPixels(20),
    paddingVertical: scaledPixels(12),
  },
  unsafePill: {
    backgroundColor: colors.status.error,
    paddingHorizontal: scaledPixels(12),
    paddingVertical: scaledPixels(4),
    borderRadius: radius.full,
    marginRight: scaledPixels(14),
  },
  unsafePillText: {
    color: colors.text.primary,
    fontSize: scaledPixels(16),
    fontWeight: typography.fontWeight.bold,
    letterSpacing: 1,
  },
  unsafeBannerText: {
    color: colors.text.primary,
    fontSize: scaledPixels(24),
    fontWeight: typography.fontWeight.bold,
  },
  safeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.status.successBg,
    borderWidth: 1.5,
    borderColor: colors.status.success,
    borderRadius: radius.lg,
    paddingHorizontal: scaledPixels(20),
    paddingVertical: scaledPixels(10),
  },
  safeDot: {
    width: scaledPixels(12),
    height: scaledPixels(12),
    borderRadius: radius.full,
    backgroundColor: colors.status.success,
    marginRight: scaledPixels(12),
  },
  safeBannerText: {
    color: colors.status.success,
    fontSize: scaledPixels(22),
    fontWeight: typography.fontWeight.bold,
  },
  matchPillOffset: {
    marginLeft: 'auto',
  },
  titleBlock: {
    marginTop: scaledPixels(8),
  },
  movieTitle: {
    color: colors.text.primary,
    fontSize: scaledPixels(50),
    fontWeight: typography.fontWeight.bold,
    letterSpacing: -0.8,
    lineHeight: scaledPixels(56),
  },
  tagline: {
    color: colors.accent.popcorn,
    fontSize: scaledPixels(23),
    fontWeight: typography.fontWeight.medium,
    marginTop: scaledPixels(6),
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginTop: scaledPixels(8),
  },
  metaBadge: {
    backgroundColor: colors.bg.elevated,
    borderWidth: 1,
    borderColor: colors.border.default,
    borderRadius: radius.sm,
    paddingHorizontal: scaledPixels(14),
    paddingVertical: scaledPixels(6),
    marginRight: scaledPixels(10),
    marginBottom: scaledPixels(6),
  },
  metaBadgeText: {
    color: colors.text.primary,
    fontSize: scaledPixels(20),
    fontWeight: typography.fontWeight.semibold,
  },
  certBadge: {
    backgroundColor: colors.bg.surfaceActive,
    borderWidth: 1.5,
    borderColor: colors.accent.popcorn,
    borderRadius: radius.sm,
    paddingHorizontal: scaledPixels(14),
    paddingVertical: scaledPixels(6),
    marginRight: scaledPixels(10),
    marginBottom: scaledPixels(6),
  },
  certBadgeUnsafe: {
    backgroundColor: colors.status.errorBg,
    borderColor: colors.status.error,
  },
  certBadgeText: {
    color: colors.accent.popcorn,
    fontSize: scaledPixels(20),
    fontWeight: typography.fontWeight.bold,
  },
  certBadgeTextUnsafe: {
    color: colors.status.error,
  },
  ratingBadge: {
    backgroundColor: colors.status.warningBg,
    borderWidth: 1,
    borderColor: colors.border.accent,
    borderRadius: radius.sm,
    paddingHorizontal: scaledPixels(14),
    paddingVertical: scaledPixels(6),
    marginRight: scaledPixels(10),
    marginBottom: scaledPixels(6),
  },
  ratingBadgeText: {
    color: colors.accent.popcorn,
    fontSize: scaledPixels(20),
    fontWeight: typography.fontWeight.bold,
  },
  genreChip: {
    backgroundColor: colors.bg.elevated,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    borderRadius: radius.full,
    paddingHorizontal: scaledPixels(14),
    paddingVertical: scaledPixels(6),
    marginRight: scaledPixels(8),
    marginBottom: scaledPixels(6),
  },
  genreChipText: {
    color: colors.text.secondary,
    fontSize: scaledPixels(19),
    fontWeight: typography.fontWeight.medium,
  },
  overviewBox: {
    backgroundColor: colors.bg.elevated,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    borderRadius: radius.lg,
    padding: scaledPixels(20),
    marginTop: scaledPixels(6),
  },
  sectionLabel: {
    color: colors.text.muted,
    fontSize: scaledPixels(16),
    fontWeight: typography.fontWeight.bold,
    letterSpacing: 1.3,
    marginBottom: scaledPixels(6),
  },
  overviewText: {
    color: colors.text.primary,
    fontSize: scaledPixels(24),
    lineHeight: scaledPixels(34),
  },
  creditsGrid: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginTop: scaledPixels(6),
  },
  creditBlock: {
    marginRight: scaledPixels(32),
  },
  castBlock: {
    flex: 1,
    marginRight: 0,
  },
  creditValue: {
    color: colors.text.primary,
    fontSize: scaledPixels(22),
    fontWeight: typography.fontWeight.semibold,
  },
  castChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  castChip: {
    backgroundColor: colors.bg.elevated,
    borderWidth: 1,
    borderColor: colors.border.default,
    borderRadius: radius.full,
    paddingHorizontal: scaledPixels(14),
    paddingVertical: scaledPixels(5),
    marginRight: scaledPixels(8),
    marginBottom: scaledPixels(6),
  },
  castChipText: {
    color: colors.text.secondary,
    fontSize: scaledPixels(19),
    fontWeight: typography.fontWeight.medium,
  },
});
