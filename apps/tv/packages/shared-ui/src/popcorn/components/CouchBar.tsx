import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, typography, radius } from '../../theme';
import { scaledPixels } from '../../hooks/useScale';
import { Member, Screen } from '../types';
import {
  avatarColorForName,
  initialsForName,
  isChildMember,
  getKidFilterLabel,
} from './avatarUtils';
import KidBadge from './KidBadge';
import MessageLine from './MessageLine';

export interface CouchBarProps {
  members: Member[];
  screen: Screen;
  message?: string;
}

const SCREEN_LABELS: Record<Screen, string> = {
  couch: 'TONIGHT ON THE COUCH',
  duel: 'POSTER DUEL',
  recommendations: "TONIGHT'S PICKS",
  details: 'MOVIE DETAILS',
  rating: 'HOW WAS IT',
};

/**
 * Top living-room status bar shown across all 4 TV screens:
 * brand identity, current screen pill, couch member chips, kid-safe certification badge, and state.message.
 */
export default function CouchBar({ members, screen, message }: CouchBarProps) {
  const kidFilterLabel = getKidFilterLabel(members);

  return (
    <View style={styles.bar}>
      {/* Left: Brand + Screen Pill */}
      <View style={styles.leftCluster}>
        <View style={styles.brandEmblem}>
          <View style={styles.brandDot} />
        </View>
        <Text style={styles.brandName}>Popcorn AI</Text>
        <View style={styles.screenPill}>
          <Text style={styles.screenPillText}>
            {SCREEN_LABELS[screen] || 'MOVIE NIGHT'}
          </Text>
        </View>
      </View>

      {/* Center: Couch Member Avatars + Kid-Safe Filter Pill */}
      <View style={styles.centerCluster}>
        {members.length === 0 ? (
          <Text style={styles.emptyCouchText}>
            Couch is empty — say who is watching tonight
          </Text>
        ) : (
          <View style={styles.membersList}>
            {members.map((member) => {
              const bgColor = avatarColorForName(member.name);
              const initials = initialsForName(member.name);
              const isKid = isChildMember(member);
              return (
                <View key={member.name} style={styles.memberChip}>
                  <View style={[styles.avatarCircle, { backgroundColor: bgColor }]}>
                    <Text style={styles.avatarInitials}>{initials}</Text>
                  </View>
                  <Text style={styles.memberName}>{member.name}</Text>
                  {isKid ? <KidBadge label="KID" size="sm" style={styles.kidBadge} /> : null}
                </View>
              );
            })}
          </View>
        )}

        {kidFilterLabel ? (
          <KidBadge label={kidFilterLabel} size="md" style={styles.filterBadge} />
        ) : null}
      </View>

      {/* Right: Status Message Toast */}
      <View style={styles.rightCluster}>
        <MessageLine message={message} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.bg.elevated,
    borderWidth: 1.5,
    borderColor: colors.border.subtle,
    borderRadius: radius.lg,
    paddingHorizontal: scaledPixels(24),
    paddingVertical: scaledPixels(14),
    marginBottom: scaledPixels(22),
  },
  leftCluster: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  brandEmblem: {
    width: scaledPixels(36),
    height: scaledPixels(36),
    borderRadius: radius.sm,
    backgroundColor: colors.bg.surfaceActive,
    borderWidth: 1.5,
    borderColor: colors.border.accent,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: scaledPixels(12),
  },
  brandDot: {
    width: scaledPixels(16),
    height: scaledPixels(16),
    borderRadius: radius.full,
    backgroundColor: colors.accent.popcorn,
  },
  brandName: {
    color: colors.text.primary,
    fontSize: scaledPixels(28),
    fontWeight: typography.fontWeight.bold,
    letterSpacing: -0.4,
    marginRight: scaledPixels(14),
  },
  screenPill: {
    backgroundColor: colors.bg.surface,
    borderWidth: 1,
    borderColor: colors.border.default,
    borderRadius: radius.xs,
    paddingHorizontal: scaledPixels(12),
    paddingVertical: scaledPixels(5),
  },
  screenPillText: {
    color: colors.text.secondary,
    fontSize: scaledPixels(16),
    fontWeight: typography.fontWeight.bold,
    letterSpacing: 1.1,
  },
  centerCluster: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    flex: 1,
    justifyContent: 'center',
    marginHorizontal: scaledPixels(20),
  },
  emptyCouchText: {
    color: colors.text.muted,
    fontSize: scaledPixels(20),
    fontWeight: typography.fontWeight.medium,
  },
  membersList: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  memberChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bg.surface,
    borderWidth: 1,
    borderColor: colors.border.default,
    borderRadius: radius.full,
    paddingLeft: scaledPixels(6),
    paddingRight: scaledPixels(14),
    paddingVertical: scaledPixels(5),
    marginRight: scaledPixels(10),
  },
  avatarCircle: {
    width: scaledPixels(34),
    height: scaledPixels(34),
    borderRadius: radius.full,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: scaledPixels(9),
  },
  avatarInitials: {
    color: colors.text.primary,
    fontSize: scaledPixels(16),
    fontWeight: typography.fontWeight.bold,
  },
  memberName: {
    color: colors.text.primary,
    fontSize: scaledPixels(20),
    fontWeight: typography.fontWeight.semibold,
  },
  kidBadge: {
    marginLeft: scaledPixels(8),
  },
  filterBadge: {
    marginLeft: scaledPixels(8),
  },
  rightCluster: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
});
