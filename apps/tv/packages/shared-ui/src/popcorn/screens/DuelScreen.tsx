import React, { useRef } from 'react';
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
  avatarColorForName,
  initialsForName,
} from '../components';

export interface DuelScreenProps {
  state: TVState;
  onPick?: (side: 'left' | 'right') => void;
}

interface DuelPosterOptionProps {
  movie: MovieCard;
  side: 'left' | 'right';
  onPick?: (side: 'left' | 'right') => void;
}

function DuelPosterOption({ movie, side, onPick }: DuelPosterOptionProps) {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const handleFocus = (focused: boolean) => {
    Animated.spring(scaleAnim, {
      toValue: focused ? 1.06 : 1,
      friction: 7,
      tension: 95,
      useNativeDriver: false,
    }).start();
  };

  const handleSelect = () => {
    if (onPick) {
      onPick(side);
    }
  };

  return (
    <SpatialNavigationFocusableView
      onSelect={handleSelect}
      onFocus={() => handleFocus(true)}
      onBlur={() => handleFocus(false)}
    >
      {({ isFocused }) => (
        <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
          <Pressable
            onPress={handleSelect}
            style={[
              styles.duelCard,
              isFocused && styles.duelCardFocused,
            ]}
          >
            <View style={styles.sideLabelRow}>
              <View
                style={[
                  styles.sideBadge,
                  isFocused && styles.sideBadgeFocused,
                ]}
              >
                <Text
                  style={[
                    styles.sideBadgeText,
                    isFocused && styles.sideBadgeTextFocused,
                  ]}
                >
                  {side === 'left' ? 'LEFT OPTION' : 'RIGHT OPTION'}
                </Text>
              </View>
              {movie.rating ? (
                <Text style={styles.ratingText}>
                  TMDB {movie.rating.toFixed(1)}
                </Text>
              ) : null}
            </View>

            <View style={styles.posterCenter}>
              <PosterCard
                poster={movie.poster}
                title={movie.title}
                year={movie.year}
                width={scaledPixels(280)}
                height={scaledPixels(410)}
                borderRadius={radius.lg}
              />
            </View>

            <View style={styles.movieMeta}>
              <Text style={styles.movieTitle} numberOfLines={1}>
                {movie.title}
              </Text>
              <Text style={styles.movieYear}>
                {movie.year || 'Classic'}
              </Text>

              <View style={styles.genresRow}>
                {(movie.genres || []).slice(0, 3).map((g) => (
                  <View key={g} style={styles.genrePill}>
                    <Text style={styles.genrePillText}>{g}</Text>
                  </View>
                ))}
              </View>
            </View>

            <View
              style={[
                styles.pickCallout,
                isFocused && styles.pickCalloutFocused,
              ]}
            >
              <Text
                style={[
                  styles.pickCalloutText,
                  isFocused && styles.pickCalloutTextFocused,
                ]}
              >
                {isFocused
                  ? `Press Select or say "${side}" to pick`
                  : `D-pad ${side} or say "${side}"`}
              </Text>
            </View>
          </Pressable>
        </Animated.View>
      )}
    </SpatialNavigationFocusableView>
  );
}

export default function DuelScreen({ state, onPick }: DuelScreenProps) {
  const members = Array.isArray(state.members) ? state.members : [];
  const duel = state.duel;

  if (!duel || !Array.isArray(duel.pair) || duel.pair.length < 2) {
    return (
      <View style={styles.screen}>
        <CouchBar
          members={members}
          screen={state.screen}
          message={state.message}
        />
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyTitle}>No poster duel active</Text>
          <Text style={styles.emptySub}>
            Say &quot;Start a poster duel&quot; to calibrate someone&apos;s movie taste.
          </Text>
        </View>
      </View>
    );
  }

  const [leftMovie, rightMovie] = duel.pair;
  const currentRound = Math.min(duel.total, (duel.round || 0) + 1);
  const avatarBg = avatarColorForName(duel.name);
  const initials = initialsForName(duel.name);

  return (
    <View style={styles.screen}>
      <CouchBar
        members={members}
        screen={state.screen}
        message={state.message}
      />

      {/* Duel Header */}
      <View style={styles.duelHeader}>
        <View style={styles.duelPersonCluster}>
          <View style={[styles.duelAvatar, { backgroundColor: avatarBg }]}>
            <Text style={styles.duelAvatarText}>{initials}</Text>
          </View>
          <View>
            <Text style={styles.duelHeadline}>
              {duel.name}, pick a poster
            </Text>
            <Text style={styles.duelSub}>
              Which vibe sounds more like you? Use D-pad Left/Right + Select, or say &quot;left&quot; or &quot;right&quot;.
            </Text>
          </View>
        </View>

        <View style={styles.roundCluster}>
          <View style={styles.roundBadge}>
            <Text style={styles.roundBadgeText}>
              Round {currentRound} of {duel.total}
            </Text>
          </View>
          <View style={styles.roundDots}>
            {Array.from({ length: duel.total }).map((_, idx) => (
              <View
                key={idx}
                style={[
                  styles.roundDot,
                  idx < currentRound && styles.roundDotActive,
                ]}
              />
            ))}
          </View>
        </View>
      </View>

      {/* Two Big Posters Side by Side */}
      <SpatialNavigationNode orientation="horizontal">
        <View style={styles.duelArena}>
          <DefaultFocus>
            <DuelPosterOption
              movie={leftMovie}
              side="left"
              onPick={onPick}
            />
          </DefaultFocus>

          <View style={styles.vsColumn}>
            <View style={styles.vsLine} />
            <View style={styles.vsCircle}>
              <Text style={styles.vsText}>OR</Text>
            </View>
            <View style={styles.vsLine} />
          </View>

          <DuelPosterOption
            movie={rightMovie}
            side="right"
            onPick={onPick}
          />
        </View>
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
  duelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: scaledPixels(16),
  },
  duelPersonCluster: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  duelAvatar: {
    width: scaledPixels(64),
    height: scaledPixels(64),
    borderRadius: radius.full,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: scaledPixels(18),
    borderWidth: 2,
    borderColor: 'rgba(255, 241, 208, 0.3)',
  },
  duelAvatarText: {
    color: colors.text.primary,
    fontSize: scaledPixels(24),
    fontWeight: typography.fontWeight.bold,
  },
  duelHeadline: {
    color: colors.text.primary,
    fontSize: scaledPixels(42),
    fontWeight: typography.fontWeight.bold,
    letterSpacing: -0.5,
  },
  duelSub: {
    color: colors.text.secondary,
    fontSize: scaledPixels(21),
    marginTop: scaledPixels(4),
  },
  roundCluster: {
    alignItems: 'flex-end',
  },
  roundBadge: {
    backgroundColor: colors.bg.surface,
    borderWidth: 1.5,
    borderColor: colors.border.accent,
    borderRadius: radius.full,
    paddingHorizontal: scaledPixels(20),
    paddingVertical: scaledPixels(8),
    marginBottom: scaledPixels(10),
  },
  roundBadgeText: {
    color: colors.accent.popcorn,
    fontSize: scaledPixels(22),
    fontWeight: typography.fontWeight.bold,
  },
  roundDots: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  roundDot: {
    width: scaledPixels(14),
    height: scaledPixels(14),
    borderRadius: radius.full,
    backgroundColor: colors.border.default,
    marginLeft: scaledPixels(8),
  },
  roundDotActive: {
    backgroundColor: colors.accent.popcorn,
  },
  duelArena: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  duelCard: {
    width: scaledPixels(620),
    height: scaledPixels(680),
    backgroundColor: colors.bg.surface,
    borderWidth: scaledPixels(3),
    borderColor: colors.border.default,
    borderRadius: radius.xl,
    padding: scaledPixels(24),
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  duelCardFocused: {
    backgroundColor: colors.bg.surfaceHover,
    borderColor: colors.accent.popcorn,
    shadowColor: colors.accent.popcorn,
    shadowOpacity: 0.72,
    shadowRadius: scaledPixels(26),
    elevation: 14,
  },
  sideLabelRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sideBadge: {
    backgroundColor: colors.bg.elevated,
    borderWidth: 1,
    borderColor: colors.border.default,
    borderRadius: radius.full,
    paddingHorizontal: scaledPixels(14),
    paddingVertical: scaledPixels(5),
  },
  sideBadgeFocused: {
    backgroundColor: colors.accent.popcorn,
    borderColor: colors.accent.popcorn,
  },
  sideBadgeText: {
    color: colors.text.secondary,
    fontSize: scaledPixels(16),
    fontWeight: typography.fontWeight.bold,
    letterSpacing: 1,
  },
  sideBadgeTextFocused: {
    color: colors.text.onAccent,
  },
  ratingText: {
    color: colors.text.muted,
    fontSize: scaledPixels(18),
    fontWeight: typography.fontWeight.semibold,
  },
  posterCenter: {
    marginVertical: scaledPixels(8),
    alignItems: 'center',
  },
  movieMeta: {
    width: '100%',
    alignItems: 'center',
  },
  movieTitle: {
    color: colors.text.primary,
    fontSize: scaledPixels(30),
    fontWeight: typography.fontWeight.bold,
    textAlign: 'center',
  },
  movieYear: {
    color: colors.text.muted,
    fontSize: scaledPixels(20),
    marginTop: scaledPixels(2),
  },
  genresRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    marginTop: scaledPixels(8),
  },
  genrePill: {
    backgroundColor: colors.bg.elevated,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    borderRadius: radius.full,
    paddingHorizontal: scaledPixels(12),
    paddingVertical: scaledPixels(4),
    marginHorizontal: scaledPixels(4),
  },
  genrePillText: {
    color: colors.text.secondary,
    fontSize: scaledPixels(17),
    fontWeight: typography.fontWeight.medium,
  },
  pickCallout: {
    width: '100%',
    paddingVertical: scaledPixels(10),
    borderRadius: radius.md,
    backgroundColor: colors.bg.elevated,
    alignItems: 'center',
  },
  pickCalloutFocused: {
    backgroundColor: colors.accent.popcorn,
  },
  pickCalloutText: {
    color: colors.text.muted,
    fontSize: scaledPixels(19),
    fontWeight: typography.fontWeight.semibold,
  },
  pickCalloutTextFocused: {
    color: colors.text.onAccent,
    fontWeight: typography.fontWeight.bold,
  },
  vsColumn: {
    width: scaledPixels(110),
    height: scaledPixels(460),
    alignItems: 'center',
    justifyContent: 'center',
  },
  vsLine: {
    flex: 1,
    width: 2,
    backgroundColor: colors.border.subtle,
  },
  vsCircle: {
    width: scaledPixels(64),
    height: scaledPixels(64),
    borderRadius: radius.full,
    backgroundColor: colors.bg.elevated,
    borderWidth: 2,
    borderColor: colors.border.accent,
    justifyContent: 'center',
    alignItems: 'center',
    marginVertical: scaledPixels(14),
  },
  vsText: {
    color: colors.accent.popcorn,
    fontSize: scaledPixels(20),
    fontWeight: typography.fontWeight.bold,
    letterSpacing: 1,
  },
});
