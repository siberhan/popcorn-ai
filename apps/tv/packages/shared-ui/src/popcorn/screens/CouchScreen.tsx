import React, { useState, useRef, useEffect } from 'react';
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
import { TVState, Member } from '../types';
import { colors, typography, radius, safeZones } from '../../theme';
import { scaledPixels } from '../../hooks/useScale';
import {
  CouchBar,
  KidBadge,
  avatarColorForName,
  initialsForName,
  isChildMember,
  getKidFilterLabel,
} from '../components';

export interface CouchScreenProps {
  state: TVState;
  onRemoveMember?: (name: string) => void;
  onShowPicks?: () => void;
}

interface MemberCardProps {
  member: Member;
  isConfirmingRemove: boolean;
  onSelectCard: (name: string) => void;
  onCancelRemove: () => void;
}

function MemberCard({
  member,
  isConfirmingRemove,
  onSelectCard,
  onCancelRemove,
}: MemberCardProps) {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const avatarBg = avatarColorForName(member.name);
  const initials = initialsForName(member.name);
  const isKid = isChildMember(member);
  const topGenres =
    member.loves && member.loves.length > 0
      ? member.loves
      : member.likes && member.likes.length > 0
      ? member.likes
      : [];
  const avoided =
    member.never && member.never.length > 0
      ? member.never
      : member.dislikes || [];

  const handleFocusChange = (focused: boolean) => {
    Animated.spring(scaleAnim, {
      toValue: focused ? 1.04 : 1,
      friction: 7,
      tension: 90,
      useNativeDriver: false,
    }).start();
  };

  return (
    <SpatialNavigationFocusableView
      onSelect={() => onSelectCard(member.name)}
      onFocus={() => handleFocusChange(true)}
      onBlur={() => {
        handleFocusChange(false);
        if (isConfirmingRemove) {
          onCancelRemove();
        }
      }}
    >
      {({ isFocused }) => (
        <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
          <Pressable
            onPress={() => onSelectCard(member.name)}
            style={[
              styles.memberCard,
              isFocused && styles.memberCardFocused,
              isConfirmingRemove && styles.memberCardConfirming,
            ]}
          >
            {/* Avatar + Kid Badge */}
            <View style={styles.avatarHeader}>
              <View style={[styles.avatarLarge, { backgroundColor: avatarBg }]}>
                <Text style={styles.avatarLargeText}>{initials}</Text>
              </View>
              {isKid ? (
                <KidBadge
                  label={member.age ? `KID · ${member.age}` : 'KID'}
                  size="md"
                  style={styles.cardKidBadge}
                />
              ) : null}
            </View>

            {/* Name */}
            <Text style={styles.memberTitle} numberOfLines={1}>
              {member.name}
            </Text>

            {/* Taste Memory Section */}
            <View style={styles.tasteSection}>
              {member.new ? (
                <View style={styles.newMemberBox}>
                  <View style={styles.newPill}>
                    <Text style={styles.newPillText}>No taste memory yet</Text>
                  </View>
                  <Text style={styles.newHintText}>
                    Start a poster duel or tell Popcorn AI what genres they love.
                  </Text>
                </View>
              ) : (
                <View style={styles.tasteDetails}>
                  <Text style={styles.tasteSectionLabel}>TOP LOVES</Text>
                  <View style={styles.genreChipsWrap}>
                    {topGenres.length > 0 ? (
                      topGenres.slice(0, 3).map((genre) => (
                        <View key={genre} style={styles.genreChip}>
                          <Text style={styles.genreChipText}>{genre}</Text>
                        </View>
                      ))
                    ) : (
                      <Text style={styles.mutedMetaText}>Learning preferences</Text>
                    )}
                  </View>

                  {avoided.length > 0 ? (
                    <Text style={styles.avoidText} numberOfLines={1}>
                      Skips: {avoided.slice(0, 2).join(', ')}
                    </Text>
                  ) : null}

                  {member.watched && member.watched.length > 0 ? (
                    <Text style={styles.watchedText} numberOfLines={1}>
                      Watched: {member.watched.slice(-2).join(', ')}
                    </Text>
                  ) : null}
                </View>
              )}
            </View>

            {/* Footer Action Prompt / Remove Confirmation */}
            <View
              style={[
                styles.cardFooterPrompt,
                isConfirmingRemove && styles.cardFooterConfirm,
                isFocused && !isConfirmingRemove && styles.cardFooterFocused,
              ]}
            >
              <Text
                style={[
                  styles.cardFooterText,
                  isConfirmingRemove && styles.cardFooterConfirmText,
                  isFocused && !isConfirmingRemove && styles.cardFooterFocusedText,
                ]}
                numberOfLines={1}
              >
                {isConfirmingRemove
                  ? `Remove ${member.name}? Press Select to confirm`
                  : isFocused
                  ? `Press Select to remove ${member.name}`
                  : 'On the couch tonight'}
              </Text>
            </View>
          </Pressable>
        </Animated.View>
      )}
    </SpatialNavigationFocusableView>
  );
}

export default function CouchScreen({
  state,
  onRemoveMember,
  onShowPicks,
}: CouchScreenProps) {
  const [confirmRemoveName, setConfirmRemoveName] = useState<string | null>(null);
  const members = Array.isArray(state.members) ? state.members : [];
  const kidFilter = getKidFilterLabel(members);

  useEffect(() => {
    setConfirmRemoveName(null);
  }, [state.version]);

  const handleSelectMember = (name: string) => {
    if (confirmRemoveName === name) {
      setConfirmRemoveName(null);
      if (onRemoveMember) {
        onRemoveMember(name);
      }
    } else {
      setConfirmRemoveName(name);
    }
  };

  const handleShowPicksPress = () => {
    if (onShowPicks) {
      onShowPicks();
    }
  };

  return (
    <View style={styles.screen}>
      <CouchBar
        members={members}
        screen={state.screen}
        message={state.message}
      />

      {/* Stage Header */}
      <View style={styles.headerBlock}>
        <View style={styles.headerTitleRow}>
          <Text style={styles.headline}>Who is on the couch tonight?</Text>
          {kidFilter ? (
            <KidBadge label={`${kidFilter} active`} size="md" />
          ) : null}
        </View>
        <Text style={styles.subheadline}>
          Every person&apos;s taste memory blends together automatically. When a child joins, unsafe movies are filtered out right away.
        </Text>
      </View>

      {/* Members Stage */}
      <View style={styles.stageCenter}>
        {members.length === 0 ? (
          <View style={styles.emptyStageCard}>
            <Text style={styles.emptyStageTitle}>
              The couch is empty right now
            </Text>
            <Text style={styles.emptyStageSub}>
              Say &quot;Hey Popcorn, it&apos;s me and Ayse tonight&quot; on the voice companion to begin.
            </Text>
          </View>
        ) : (
          <SpatialNavigationNode orientation="horizontal">
            <View style={styles.membersGrid}>
              {members.map((member) => (
                <MemberCard
                  key={member.name}
                  member={member}
                  isConfirmingRemove={confirmRemoveName === member.name}
                  onSelectCard={handleSelectMember}
                  onCancelRemove={() => setConfirmRemoveName(null)}
                />
              ))}
            </View>
          </SpatialNavigationNode>
        )}
      </View>

      {/* Bottom Action Bar */}
      <View style={styles.bottomBar}>
        {confirmRemoveName ? (
          <View style={styles.confirmBanner}>
            <Text style={styles.confirmBannerText}>
              Remove {confirmRemoveName} from tonight&apos;s couch?
            </Text>
            <View style={styles.confirmBannerButtons}>
              <Pressable
                onPress={() => {
                  const target = confirmRemoveName;
                  setConfirmRemoveName(null);
                  if (onRemoveMember) onRemoveMember(target);
                }}
                style={styles.confirmDeleteBtn}
              >
                <Text style={styles.confirmDeleteBtnText}>
                  Confirm Remove
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setConfirmRemoveName(null)}
                style={styles.confirmCancelBtn}
              >
                <Text style={styles.confirmCancelBtnText}>Keep on couch</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        <SpatialNavigationNode>
          <DefaultFocus>
            <SpatialNavigationFocusableView onSelect={handleShowPicksPress}>
              {({ isFocused }) => (
                <Pressable
                  onPress={handleShowPicksPress}
                  style={[
                    styles.showPicksButton,
                    isFocused && styles.showPicksButtonFocused,
                    members.length === 0 && styles.showPicksButtonDisabled,
                  ]}
                >
                  <Text style={styles.showPicksButtonText}>
                    Show picks
                  </Text>
                  <Text style={styles.showPicksSubText}>
                    {members.length > 0
                      ? `for ${members.map((m) => m.name).join(' & ')}`
                      : '(add someone first)'}
                  </Text>
                </Pressable>
              )}
            </SpatialNavigationFocusableView>
          </DefaultFocus>
        </SpatialNavigationNode>
      </View>
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
  headerBlock: {
    marginBottom: scaledPixels(14),
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headline: {
    color: colors.text.primary,
    fontSize: scaledPixels(42),
    fontWeight: typography.fontWeight.bold,
    letterSpacing: -0.6,
  },
  subheadline: {
    color: colors.text.secondary,
    fontSize: scaledPixels(22),
    marginTop: scaledPixels(6),
  },
  stageCenter: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    marginVertical: scaledPixels(10),
  },
  emptyStageCard: {
    backgroundColor: colors.bg.surface,
    borderWidth: 2,
    borderColor: colors.border.default,
    borderRadius: radius.xl,
    paddingHorizontal: scaledPixels(56),
    paddingVertical: scaledPixels(48),
    alignItems: 'center',
    maxWidth: scaledPixels(920),
  },
  emptyStageTitle: {
    color: colors.text.primary,
    fontSize: scaledPixels(34),
    fontWeight: typography.fontWeight.bold,
    marginBottom: scaledPixels(12),
  },
  emptyStageSub: {
    color: colors.text.secondary,
    fontSize: scaledPixels(24),
    textAlign: 'center',
  },
  membersGrid: {
    flexDirection: 'row',
    alignItems: 'stretch',
    justifyContent: 'center',
    flexWrap: 'wrap',
  },
  memberCard: {
    width: scaledPixels(380),
    minHeight: scaledPixels(430),
    backgroundColor: colors.bg.surface,
    borderWidth: scaledPixels(3),
    borderColor: colors.border.default,
    borderRadius: radius.xl,
    padding: scaledPixels(26),
    marginHorizontal: scaledPixels(14),
    justifyContent: 'space-between',
  },
  memberCardFocused: {
    backgroundColor: colors.bg.surfaceHover,
    borderColor: colors.accent.popcorn,
    shadowColor: colors.accent.popcorn,
    shadowOpacity: 0.55,
    shadowRadius: scaledPixels(20),
    elevation: 10,
  },
  memberCardConfirming: {
    borderColor: colors.status.error,
    backgroundColor: '#291714',
  },
  avatarHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: scaledPixels(14),
  },
  avatarLarge: {
    width: scaledPixels(88),
    height: scaledPixels(88),
    borderRadius: radius.full,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255, 241, 208, 0.25)',
  },
  avatarLargeText: {
    color: colors.text.primary,
    fontSize: scaledPixels(34),
    fontWeight: typography.fontWeight.bold,
    letterSpacing: 1,
  },
  cardKidBadge: {
    alignSelf: 'flex-start',
  },
  memberTitle: {
    color: colors.text.primary,
    fontSize: scaledPixels(34),
    fontWeight: typography.fontWeight.bold,
    marginBottom: scaledPixels(12),
  },
  tasteSection: {
    flex: 1,
    justifyContent: 'flex-start',
  },
  newMemberBox: {
    backgroundColor: colors.status.warningBg,
    borderWidth: 1.5,
    borderColor: colors.border.accent,
    borderRadius: radius.md,
    padding: scaledPixels(16),
  },
  newPill: {
    backgroundColor: colors.accent.popcorn,
    alignSelf: 'flex-start',
    paddingHorizontal: scaledPixels(12),
    paddingVertical: scaledPixels(4),
    borderRadius: radius.full,
    marginBottom: scaledPixels(8),
  },
  newPillText: {
    color: colors.text.onAccent,
    fontSize: scaledPixels(17),
    fontWeight: typography.fontWeight.bold,
  },
  newHintText: {
    color: colors.text.secondary,
    fontSize: scaledPixels(19),
    lineHeight: scaledPixels(26),
  },
  tasteDetails: {
    flex: 1,
  },
  tasteSectionLabel: {
    color: colors.text.muted,
    fontSize: scaledPixels(16),
    fontWeight: typography.fontWeight.bold,
    letterSpacing: 1.2,
    marginBottom: scaledPixels(8),
  },
  genreChipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: scaledPixels(10),
  },
  genreChip: {
    backgroundColor: colors.bg.elevated,
    borderWidth: 1,
    borderColor: colors.border.accent,
    borderRadius: radius.full,
    paddingHorizontal: scaledPixels(14),
    paddingVertical: scaledPixels(6),
    marginRight: scaledPixels(8),
    marginBottom: scaledPixels(8),
  },
  genreChipText: {
    color: colors.accent.popcorn,
    fontSize: scaledPixels(19),
    fontWeight: typography.fontWeight.semibold,
  },
  mutedMetaText: {
    color: colors.text.muted,
    fontSize: scaledPixels(19),
  },
  avoidText: {
    color: colors.text.secondary,
    fontSize: scaledPixels(18),
    marginTop: scaledPixels(4),
  },
  watchedText: {
    color: colors.text.muted,
    fontSize: scaledPixels(17),
    marginTop: scaledPixels(4),
  },
  cardFooterPrompt: {
    marginTop: scaledPixels(14),
    paddingVertical: scaledPixels(9),
    paddingHorizontal: scaledPixels(12),
    borderRadius: radius.sm,
    backgroundColor: colors.bg.elevated,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    alignItems: 'center',
  },
  cardFooterFocused: {
    borderColor: colors.border.accent,
    backgroundColor: 'rgba(245, 185, 66, 0.12)',
  },
  cardFooterConfirm: {
    borderColor: colors.status.error,
    backgroundColor: colors.status.errorBg,
  },
  cardFooterText: {
    color: colors.text.muted,
    fontSize: scaledPixels(17),
    fontWeight: typography.fontWeight.medium,
  },
  cardFooterFocusedText: {
    color: colors.accent.popcorn,
    fontWeight: typography.fontWeight.semibold,
  },
  cardFooterConfirmText: {
    color: colors.status.error,
    fontWeight: typography.fontWeight.bold,
  },
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: scaledPixels(8),
  },
  confirmBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.status.errorBg,
    borderWidth: 1.5,
    borderColor: colors.status.error,
    borderRadius: radius.md,
    paddingHorizontal: scaledPixels(20),
    paddingVertical: scaledPixels(12),
    marginRight: scaledPixels(20),
  },
  confirmBannerText: {
    color: colors.text.primary,
    fontSize: scaledPixels(20),
    fontWeight: typography.fontWeight.semibold,
    marginRight: scaledPixels(16),
  },
  confirmBannerButtons: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  confirmDeleteBtn: {
    backgroundColor: colors.status.error,
    paddingHorizontal: scaledPixels(16),
    paddingVertical: scaledPixels(8),
    borderRadius: radius.sm,
    marginRight: scaledPixels(10),
  },
  confirmDeleteBtnText: {
    color: colors.text.primary,
    fontSize: scaledPixels(18),
    fontWeight: typography.fontWeight.bold,
  },
  confirmCancelBtn: {
    backgroundColor: colors.bg.surface,
    borderWidth: 1,
    borderColor: colors.border.default,
    paddingHorizontal: scaledPixels(14),
    paddingVertical: scaledPixels(8),
    borderRadius: radius.sm,
  },
  confirmCancelBtnText: {
    color: colors.text.secondary,
    fontSize: scaledPixels(18),
    fontWeight: typography.fontWeight.medium,
  },
  showPicksButton: {
    flexDirection: 'row',
    alignItems: 'baseline',
    backgroundColor: colors.bg.surfaceActive,
    borderWidth: scaledPixels(3),
    borderColor: colors.border.accent,
    borderRadius: radius.full,
    paddingHorizontal: scaledPixels(36),
    paddingVertical: scaledPixels(16),
    marginLeft: 'auto',
  },
  showPicksButtonFocused: {
    backgroundColor: colors.accent.popcorn,
    borderColor: colors.accent.cream,
    shadowColor: colors.accent.popcorn,
    shadowOpacity: 0.7,
    shadowRadius: scaledPixels(18),
    elevation: 10,
  },
  showPicksButtonDisabled: {
    opacity: 0.55,
  },
  showPicksButtonText: {
    color: colors.text.onAccent,
    backgroundColor: colors.accent.popcorn,
    paddingHorizontal: scaledPixels(14),
    paddingVertical: scaledPixels(4),
    borderRadius: radius.full,
    fontSize: scaledPixels(24),
    fontWeight: typography.fontWeight.bold,
    marginRight: scaledPixels(12),
  },
  showPicksSubText: {
    color: colors.text.primary,
    fontSize: scaledPixels(21),
    fontWeight: typography.fontWeight.semibold,
  },
});
