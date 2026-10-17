import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Animated,
} from 'react-native';
import {
  SpatialNavigationFocusableView,
  SpatialNavigationNode,
  DefaultFocus,
} from 'react-tv-space-navigation';
import { TVState, MovieCard } from '../types';
import { colors, typography, radius, safeZones } from '../../theme';
import { scaledPixels } from '../../hooks/useScale';
import {
  CouchBar,
  PosterCard,
  MatchPill,
  KidBadge,
  getKidFilterLabel,
} from '../components';

export interface RecommendationsScreenProps {
  state: TVState;
}

interface DisplayItem {
  movie: MovieCard;
  fadingOut: boolean;
}

interface RecommendationCardProps {
  item: DisplayItem;
  fadeAnim: Animated.Value;
}

function RecommendationCard({ item, fadeAnim }: RecommendationCardProps) {
  const focusScale = useRef(new Animated.Value(1)).current;
  const { movie, fadingOut } = item;

  const handleFocus = (focused: boolean) => {
    Animated.spring(focusScale, {
      toValue: focused ? 1.035 : 1,
      friction: 7,
      tension: 95,
      useNativeDriver: false,
    }).start();
  };

  const fadeScale = fadeAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.88, 1],
  });

  const animatedWrapperStyle = fadingOut
    ? {
        opacity: fadeAnim,
        transform: [{ scale: fadeScale }],
      }
    : {
        opacity: 1,
        transform: [{ scale: focusScale }],
      };

  return (
    <SpatialNavigationFocusableView
      onSelect={() => {
        /* Selecting a card does nothing on Day 3 per tv-contract.md */
      }}
      onFocus={() => handleFocus(true)}
      onBlur={() => handleFocus(false)}
    >
      {({ isFocused }) => (
        <Animated.View style={[styles.cardOuter, animatedWrapperStyle]}>
          <Pressable
            style={[
              styles.card,
              isFocused && !fadingOut && styles.cardFocused,
              fadingOut && styles.cardFadingOut,
            ]}
          >
            {/* Left: Poster */}
            <PosterCard
              poster={movie.poster}
              title={movie.title}
              year={movie.year}
              width={scaledPixels(168)}
              height={scaledPixels(252)}
              borderRadius={radius.md}
            />

            {/* Right: Metadata + Match % + Why Line */}
            <View style={styles.cardInfo}>
              <View style={styles.cardTopRow}>
                {fadingOut ? (
                  <View style={styles.filteredBadge}>
                    <Text style={styles.filteredBadgeText}>
                      REMOVED · KID-SAFE
                    </Text>
                  </View>
                ) : (
                  <MatchPill match={movie.match} />
                )}

                {movie.rating ? (
                  <Text style={styles.ratingText}>
                    TMDB {movie.rating.toFixed(1)}
                  </Text>
                ) : null}
              </View>

              <Text style={styles.movieTitle} numberOfLines={2}>
                {movie.title}
              </Text>

              <Text style={styles.movieSubMeta} numberOfLines={1}>
                {[
                  movie.year,
                  ...(movie.genres || []).slice(0, 3),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>

              <View style={styles.whyBox}>
                <Text style={styles.whyText} numberOfLines={2}>
                  {fadingOut
                    ? 'Filtered out after couch change to keep tonight kid-safe'
                    : movie.why || movie.overview}
                </Text>
              </View>
            </View>
          </Pressable>
        </Animated.View>
      )}
    </SpatialNavigationFocusableView>
  );
}

export default function RecommendationsScreen({
  state,
}: RecommendationsScreenProps) {
  const members = Array.isArray(state.members) ? state.members : [];
  const boost = Array.isArray(state.boost) ? state.boost : [];
  const kidFilter = getKidFilterLabel(members);

  const prevRecsRef = useRef<MovieCard[]>(state.recommendations || []);
  const prevVersionRef = useRef<number>(state.version);
  const fadeAnim = useRef(new Animated.Value(1)).current;

  const [displayItems, setDisplayItems] = useState<DisplayItem[]>(() =>
    (state.recommendations || []).slice(0, 6).map((m) => ({
      movie: m,
      fadingOut: false,
    }))
  );
  const [fadingCount, setFadingCount] = useState<number>(0);

  useEffect(() => {
    const incoming = (state.recommendations || []).slice(0, 6);
    const prev = prevRecsRef.current.slice(0, 6);

    if (state.version !== prevVersionRef.current && prev.length > 0) {
      const nextIds = new Set(incoming.map((m) => m.id));
      const removed = prev.filter((m) => !nextIds.has(m.id));

      if (removed.length > 0) {
        // Keep removed movies in their exact slots so they fade out smoothly without jumping
        const removedIds = new Set(removed.map((m) => m.id));
        const survivingAndNew = incoming.filter((m) => !removedIds.has(m.id));
        let nextCursor = 0;

        const merged: DisplayItem[] = prev.map((prevMovie) => {
          if (removedIds.has(prevMovie.id)) {
            return { movie: prevMovie, fadingOut: true };
          }
          const replacement =
            incoming.find((m) => m.id === prevMovie.id) ||
            survivingAndNew[nextCursor++];
          return { movie: replacement || prevMovie, fadingOut: false };
        });

        setDisplayItems(merged.slice(0, 6));
        setFadingCount(removed.length);
        fadeAnim.setValue(1);

        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 1800,
          useNativeDriver: false,
        }).start(({ finished }) => {
          if (finished) {
            setFadingCount(0);
            setDisplayItems(
              incoming.map((m) => ({ movie: m, fadingOut: false }))
            );
          }
        });

        prevRecsRef.current = incoming;
        prevVersionRef.current = state.version;
        return;
      }
    }

    setFadingCount(0);
    setDisplayItems(incoming.map((m) => ({ movie: m, fadingOut: false })));
    prevRecsRef.current = incoming;
    prevVersionRef.current = state.version;
  }, [state.version, state.recommendations, fadeAnim]);

  return (
    <View style={styles.screen}>
      <CouchBar
        members={members}
        screen={state.screen}
        message={state.message}
      />

      {/* Subheader: Title + Mood Chips + Kid-Safe Badge */}
      <View style={styles.headerRow}>
        <View style={styles.titleCluster}>
          <Text style={styles.headline}>Picked for Tonight&apos;s Couch</Text>
          {boost.length > 0 ? (
            <View style={styles.moodRow}>
              <Text style={styles.moodLabel}>MOOD:</Text>
              {boost.map((genre) => (
                <View key={genre} style={styles.moodChip}>
                  <Text style={styles.moodChipText}>{genre}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>

        <View style={styles.badgesCluster}>
          {fadingCount > 0 ? (
            <View style={styles.fadeNoticePill}>
              <Text style={styles.fadeNoticeText}>
                Fading out {fadingCount} unsafe title{fadingCount > 1 ? 's' : ''}...
              </Text>
            </View>
          ) : null}
          {kidFilter ? (
            <KidBadge label={kidFilter} size="md" />
          ) : null}
        </View>
      </View>

      {/* 3x2 Poster Grid */}
      {displayItems.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyTitle}>No recommendations yet</Text>
          <Text style={styles.emptySub}>
            Ask Popcorn AI to find movies for everyone on the couch.
          </Text>
        </View>
      ) : (
        <SpatialNavigationNode orientation="horizontal">
          <View style={styles.grid}>
            {displayItems.map((item, idx) => {
              const cardNode = (
                <RecommendationCard
                  key={`${item.movie.id}-${item.fadingOut ? 'fade' : 'live'}`}
                  item={item}
                  fadeAnim={fadeAnim}
                />
              );
              if (idx === 0) {
                return (
                  <DefaultFocus key={`default-${item.movie.id}`}>
                    {cardNode}
                  </DefaultFocus>
                );
              }
              return cardNode;
            })}
          </View>
        </SpatialNavigationNode>
      )}
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
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: scaledPixels(14),
  },
  titleCluster: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  headline: {
    color: colors.text.primary,
    fontSize: scaledPixels(38),
    fontWeight: typography.fontWeight.bold,
    letterSpacing: -0.5,
    marginRight: scaledPixels(20),
  },
  moodRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  moodLabel: {
    color: colors.text.muted,
    fontSize: scaledPixels(16),
    fontWeight: typography.fontWeight.bold,
    letterSpacing: 1.1,
    marginRight: scaledPixels(8),
  },
  moodChip: {
    backgroundColor: colors.status.warningBg,
    borderWidth: 1.5,
    borderColor: colors.border.accent,
    borderRadius: radius.full,
    paddingHorizontal: scaledPixels(14),
    paddingVertical: scaledPixels(5),
    marginRight: scaledPixels(8),
  },
  moodChipText: {
    color: colors.accent.popcorn,
    fontSize: scaledPixels(18),
    fontWeight: typography.fontWeight.bold,
    textTransform: 'capitalize',
  },
  badgesCluster: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  fadeNoticePill: {
    backgroundColor: colors.status.errorBg,
    borderWidth: 1.5,
    borderColor: colors.status.error,
    borderRadius: radius.full,
    paddingHorizontal: scaledPixels(16),
    paddingVertical: scaledPixels(6),
    marginRight: scaledPixels(12),
  },
  fadeNoticeText: {
    color: colors.status.error,
    fontSize: scaledPixels(18),
    fontWeight: typography.fontWeight.bold,
  },
  emptyWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyTitle: {
    color: colors.text.primary,
    fontSize: scaledPixels(34),
    fontWeight: typography.fontWeight.bold,
  },
  emptySub: {
    color: colors.text.secondary,
    fontSize: scaledPixels(22),
    marginTop: scaledPixels(8),
  },
  grid: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignContent: 'space-between',
  },
  cardOuter: {
    width: scaledPixels(556),
    height: scaledPixels(356),
    marginBottom: scaledPixels(18),
  },
  card: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: colors.bg.surface,
    borderWidth: scaledPixels(3),
    borderColor: colors.border.default,
    borderRadius: radius.xl,
    padding: scaledPixels(20),
    alignItems: 'center',
  },
  cardFocused: {
    backgroundColor: colors.bg.surfaceHover,
    borderColor: colors.accent.popcorn,
    shadowColor: colors.accent.popcorn,
    shadowOpacity: 0.65,
    shadowRadius: scaledPixels(20),
    elevation: 12,
  },
  cardFadingOut: {
    borderColor: colors.status.error,
    backgroundColor: '#261411',
  },
  cardInfo: {
    flex: 1,
    height: '100%',
    marginLeft: scaledPixels(20),
    justifyContent: 'space-between',
  },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  filteredBadge: {
    backgroundColor: colors.status.errorBg,
    borderWidth: 1.5,
    borderColor: colors.status.error,
    borderRadius: radius.full,
    paddingHorizontal: scaledPixels(12),
    paddingVertical: scaledPixels(4),
  },
  filteredBadgeText: {
    color: colors.status.error,
    fontSize: scaledPixels(15),
    fontWeight: typography.fontWeight.bold,
    letterSpacing: 0.6,
  },
  ratingText: {
    color: colors.text.muted,
    fontSize: scaledPixels(17),
    fontWeight: typography.fontWeight.semibold,
  },
  movieTitle: {
    color: colors.text.primary,
    fontSize: scaledPixels(28),
    fontWeight: typography.fontWeight.bold,
    lineHeight: scaledPixels(34),
    marginTop: scaledPixels(6),
  },
  movieSubMeta: {
    color: colors.text.secondary,
    fontSize: scaledPixels(19),
    fontWeight: typography.fontWeight.medium,
  },
  whyBox: {
    backgroundColor: colors.bg.elevated,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    borderRadius: radius.md,
    paddingHorizontal: scaledPixels(12),
    paddingVertical: scaledPixels(10),
    marginTop: scaledPixels(6),
  },
  whyText: {
    color: colors.accent.cream,
    fontSize: scaledPixels(18),
    lineHeight: scaledPixels(24),
    fontWeight: typography.fontWeight.medium,
  },
});
