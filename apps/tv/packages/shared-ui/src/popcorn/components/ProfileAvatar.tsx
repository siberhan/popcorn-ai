import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated, Easing } from 'react-native';
import {
  DefaultFocus,
  SpatialNavigationFocusableView,
  SpatialNavigationNode,
  SpatialNavigationNodeRef,
} from 'react-tv-space-navigation';
import { scaledPixels } from '../../hooks/useScale';
import { consoleColors, consoleLayout, consoleMotion, consoleType } from '../../theme/console';
import { Member } from '../types';
import { useBackKey } from './useBackKey';
import { consoleDiscColorForName, discInitialsForName as discInitials, isChildMember } from './avatarUtils';

type FocusRef = (node: SpatialNavigationNodeRef | null) => void;

interface DiscSize {
  disc: number;
  gap: number;
}

const SIZES: Record<'regular' | 'compact', DiscSize> = {
  regular: { disc: scaledPixels(consoleLayout.disc), gap: scaledPixels(consoleLayout.discGap) },
  compact: { disc: scaledPixels(consoleLayout.discCompact), gap: scaledPixels(consoleLayout.discGapCompact) },
};

// The ring sits inside the scaled disc, so draw it thinner: 5 x 1.22 is about 6 px on screen.
const RING = scaledPixels(consoleLayout.ring / consoleLayout.focusScale);
const NAME_GAP = scaledPixels(28);

type NameTone = 'muted' | 'strong';

interface RoundTileProps {
  label: string;
  tone: NameTone;
  compact?: boolean;
  onSelect: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
  focusRef?: FocusRef;
  renderFace: (size: DiscSize, isFocused: boolean) => React.ReactNode;
  renderOverlay?: (size: DiscSize) => React.ReactNode;
}

/**
 * One round, focusable tile of the profile row. Focus lifts the disc (scale 1.22), fades in
 * a white ring and drops a soft shadow; the name moves down with it. Transform and opacity
 * only, on the native driver. Nothing waits on an end callback (it may not fire on Vega).
 */
function RoundTile({ label, tone, compact, onSelect, onFocus, onBlur, focusRef, renderFace, renderOverlay }: RoundTileProps) {
  const focusAnim = useRef(new Animated.Value(0)).current;
  const size = compact ? SIZES.compact : SIZES.regular;
  const lift = (size.disc * (consoleLayout.focusScale - 1)) / 2;

  const animateTo = (value: number) => {
    Animated.timing(focusAnim, {
      toValue: value,
      duration: consoleMotion.focusMs,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  };

  const scale = focusAnim.interpolate({ inputRange: [0, 1], outputRange: [1, consoleLayout.focusScale] });
  const nameShift = focusAnim.interpolate({ inputRange: [0, 1], outputRange: [0, lift + scaledPixels(4)] });

  return (
    <SpatialNavigationFocusableView
      ref={focusRef}
      onSelect={onSelect}
      onFocus={() => {
        animateTo(1);
        onFocus?.();
      }}
      onBlur={() => {
        animateTo(0);
        onBlur?.();
      }}
    >
      {({ isFocused }) => (
        <View style={[styles.slot, { width: size.disc, marginRight: size.gap }, isFocused ? styles.slotFocused : null]}>
          <Animated.View style={{ width: size.disc, height: size.disc, transform: [{ scale }] }}>
            <View style={[styles.disc, isFocused ? styles.discLifted : null]}>{renderFace(size, isFocused)}</View>
            <Animated.View
              pointerEvents="none"
              style={[
                styles.ring,
                {
                  top: -RING,
                  left: -RING,
                  width: size.disc + RING * 2,
                  height: size.disc + RING * 2,
                  opacity: focusAnim,
                },
              ]}
            />
            {renderOverlay?.(size)}
          </Animated.View>
          <Animated.Text
            numberOfLines={1}
            style={[
              styles.name,
              { width: size.disc + size.gap, transform: [{ translateY: nameShift }] },
              tone === 'strong' || isFocused ? styles.nameStrong : null,
              isFocused ? styles.nameFocused : null,
            ]}
          >
            {label}
          </Animated.Text>
        </View>
      )}
    </SpatialNavigationFocusableView>
  );
}

function CheckBadge({ disc }: { disc: number }) {
  const badge = Math.round((disc * consoleLayout.checkBadge) / consoleLayout.disc);
  return (
    <View
      pointerEvents="none"
      style={[styles.checkBadge, { width: badge, height: badge, borderRadius: badge / 2 }]}
    >
      <View
        style={[
          styles.checkMark,
          { width: badge * 0.22, height: badge * 0.42, marginTop: -badge * 0.08, borderRightWidth: badge * 0.09, borderBottomWidth: badge * 0.09 },
        ]}
      />
    </View>
  );
}

function KidChip() {
  return (
    <View style={styles.kidWrap} pointerEvents="none">
      <View style={styles.kidChip}>
        <Text style={styles.kidText}>KID</Text>
      </View>
    </View>
  );
}

const BUBBLE_GLASS = 'rgba(255, 255, 255, 0.2)';

type BubbleKind = 'edit' | 'delete';

interface BubbleProps {
  kind: BubbleKind;
  size: number;
  onSelect: () => void;
  onFocus: () => void;
  onBlur: () => void;
}

/** A small round button above the avatar: a pencil (edit) or an X (delete). */
function Bubble({ kind, size, onSelect, onFocus, onBlur }: BubbleProps) {
  return (
    <SpatialNavigationFocusableView onSelect={onSelect} onFocus={onFocus} onBlur={onBlur}>
      {({ isFocused }) => {
        const glyph = isFocused ? consoleColors.onLight : consoleColors.text;
        return (
          <View style={[styles.bubbleRing, isFocused ? styles.bubbleRingFocused : null]}>
            <View
              style={[
                styles.bubble,
                { width: size, height: size, borderRadius: size / 2 },
                isFocused ? styles.bubbleFocused : null,
              ]}
            >
              {kind === 'delete' ? (
                <View style={{ width: size * 0.44, height: size * 0.44 }}>
                  <View style={[styles.xBar, { backgroundColor: glyph, transform: [{ rotate: '45deg' }] }]} />
                  <View style={[styles.xBar, { backgroundColor: glyph, transform: [{ rotate: '-45deg' }] }]} />
                </View>
              ) : (
                <View style={{ alignItems: 'center', transform: [{ rotate: '45deg' }] }}>
                  <View
                    style={{
                      width: size * 0.17,
                      height: size * 0.34,
                      borderTopLeftRadius: size * 0.04,
                      borderTopRightRadius: size * 0.04,
                      backgroundColor: glyph,
                    }}
                  />
                  <View
                    style={{
                      width: 0,
                      height: 0,
                      borderLeftWidth: size * 0.085,
                      borderRightWidth: size * 0.085,
                      borderTopWidth: size * 0.14,
                      borderLeftColor: 'transparent',
                      borderRightColor: 'transparent',
                      borderTopColor: glyph,
                    }}
                  />
                </View>
              )}
            </View>
          </View>
        );
      }}
    </SpatialNavigationFocusableView>
  );
}

/** Back on a bubble returns to the avatar; mounted only while a bubble has focus. */
function BackToAvatar({ onBack }: { onBack: () => void }) {
  useBackKey(onBack);
  return null;
}

export interface ProfileAvatarProps {
  member: Member;
  onCouch: boolean;
  compact?: boolean;
  onToggle: (member: Member) => void;
  /** Pencil and X bubbles above the focused avatar. Both are needed for the bubbles to show. */
  onEdit?: (member: Member) => void;
  onDelete?: (member: Member) => void;
  /** Called with the person's disc colour when the tile takes focus (drives the backdrop tint). */
  onFocusColor?: (color: string) => void;
  focusRef?: FocusRef;
  /** Disc colour; defaults to the name-hash colour. */
  discColor?: string;
}

/**
 * A household member: initials on their disc colour; a white check badge and white name when on the couch.
 * While the avatar (or one of its bubbles) has focus, an edit pencil and a delete X float above the disc.
 * D-pad: Up from the avatar reaches the pencil, Left/Right switch bubble, Down returns. The bubbles
 * are absolutely placed, so the row never shifts.
 */
export default function ProfileAvatar({
  member,
  onCouch,
  compact,
  onToggle,
  onEdit,
  onDelete,
  onFocusColor,
  focusRef,
  discColor: discColorProp,
}: ProfileAvatarProps) {
  const discColor = discColorProp ?? consoleDiscColorForName(member.name);
  const size = compact ? SIZES.compact : SIZES.regular;
  const hasBubbles = Boolean(onEdit && onDelete);
  const avatarNode = useRef<SpatialNavigationNodeRef | null>(null);
  const [avatarFocused, setAvatarFocused] = useState(false);
  const [bubbleFocus, setBubbleFocus] = useState<BubbleKind | null>(null);
  // When focus last sat inside this group (avatar or a bubble). The group's first child is the
  // bubble row, so focus arriving from a neighbour lands on a bubble first; that is sent on to the avatar.
  const lastInside = useRef(0);
  const touch = () => {
    lastInside.current = Date.now();
  };
  const visible = avatarFocused || bubbleFocus !== null;
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fade, {
      toValue: visible ? 1 : 0,
      duration: consoleMotion.focusMs,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [visible, fade]);

  const bubble = Math.round(size.disc * (compact ? 0.4 : 0.32));
  const lift = (size.disc * (consoleLayout.focusScale - 1)) / 2;
  const bubbleTop = -(bubble + lift + scaledPixels(22));

  const tile = (
    <RoundTile
      label={member.name}
      tone={onCouch ? 'strong' : 'muted'}
      compact={compact}
      onSelect={() => onToggle(member)}
      onFocus={() => {
        setAvatarFocused(true);
        onFocusColor?.(discColor);
      }}
      onBlur={() => {
        touch();
        setAvatarFocused(false);
      }}
      focusRef={(node) => {
        avatarNode.current = node;
        focusRef?.(node);
      }}
      renderFace={(sz) => (
        <View style={[styles.face, { backgroundColor: discColor }]}>
          <Text style={[styles.initials, { fontSize: Math.round(sz.disc / 3) }]}>{discInitials(member.name)}</Text>
        </View>
      )}
      renderOverlay={(sz) => (
        <>
          {isChildMember(member) ? <KidChip /> : null}
          {onCouch ? <CheckBadge disc={sz.disc} /> : null}
        </>
      )}
    />
  );

  if (!hasBubbles) return tile;

  const bubbleProps = (kind: BubbleKind, act: () => void) => ({
    kind,
    size: bubble,
    onSelect: act,
    onFocus: () => {
      if (Date.now() - lastInside.current > 150) {
        // Arrived from outside: the avatar comes first. Wait for the focus move to finish.
        setTimeout(() => avatarNode.current?.focus(), 0);
        return;
      }
      setBubbleFocus(kind);
    },
    onBlur: () => {
      touch();
      setBubbleFocus((cur) => (cur === kind ? null : cur));
    },
  });

  return (
    <SpatialNavigationNode orientation="vertical">
      <View style={visible ? styles.groupRaised : null}>
        {/* Focus order: bubbles first (Up from the avatar), then the avatar itself, which takes default focus. */}
        <DefaultFocus enable={false}>
        <SpatialNavigationNode orientation="horizontal">
          <Animated.View
            style={[styles.bubbles, { top: bubbleTop, width: size.disc, opacity: fade }]}
            // Hidden bubbles must not look or act focusable; focus only reaches them from the avatar.
            pointerEvents="box-none"
          >
            <View style={[styles.bubbleRow, bubbleFocus === null ? styles.bubblesDim : null]}>
              <Bubble {...bubbleProps('edit', () => onEdit?.(member))} />
              <View style={{ width: scaledPixels(10) }} />
              <Bubble {...bubbleProps('delete', () => onDelete?.(member))} />
            </View>
          </Animated.View>
        </SpatialNavigationNode>
        </DefaultFocus>
        {tile}
        {bubbleFocus !== null ? <BackToAvatar onBack={() => avatarNode.current?.focus()} /> : null}
      </View>
    </SpatialNavigationNode>
  );
}

export interface AddProfileTileProps {
  compact?: boolean;
  onSelect: () => void;
  onFocus?: () => void;
  focusRef?: FocusRef;
}

/** The "+" tile on the far left of the row: opens the add form. */
export function AddProfileTile({ compact, onSelect, onFocus, focusRef }: AddProfileTileProps) {
  return (
    <RoundTile
      label="Add"
      tone="muted"
      compact={compact}
      onSelect={onSelect}
      onFocus={onFocus}
      focusRef={focusRef}
      renderFace={(size, isFocused) => {
        const plus = Math.round(size.disc * 0.3);
        return (
          <View style={[styles.face, styles.addFace, isFocused ? styles.addFaceFocused : null]}>
            <View style={{ width: plus, height: plus, alignItems: 'center', justifyContent: 'center' }}>
              <View style={[styles.plusBar, { width: plus, height: PLUS_BAR }]} />
              <View style={[styles.plusBar, { width: PLUS_BAR, height: plus }]} />
            </View>
          </View>
        );
      }}
    />
  );
}

const PLUS_BAR = scaledPixels(4);

const styles = StyleSheet.create({
  slot: {
    alignItems: 'center',
  },
  slotFocused: {
    zIndex: 2,
  },
  groupRaised: {
    zIndex: 3,
  },
  bubbles: {
    position: 'absolute',
    left: 0,
    alignItems: 'center',
  },
  bubbleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bubblesDim: {
    opacity: 0.6,
  },
  bubbleRing: {
    borderRadius: 9999,
    borderWidth: scaledPixels(4),
    borderColor: 'transparent',
    padding: scaledPixels(3),
  },
  bubbleRingFocused: {
    borderColor: consoleColors.ring,
  },
  bubble: {
    backgroundColor: BUBBLE_GLASS,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bubbleFocused: {
    backgroundColor: consoleColors.text,
  },
  xBar: {
    position: 'absolute',
    top: '42%',
    left: 0,
    right: 0,
    height: '16%',
    borderRadius: 9999,
  },
  disc: {
    flex: 1,
    borderRadius: 9999,
    backgroundColor: consoleColors.ground, // gives the lifted shadow a body to cast from
  },
  discLifted: {
    shadowColor: consoleColors.shadow,
    shadowOpacity: 0.6,
    shadowRadius: scaledPixels(40),
    shadowOffset: { width: 0, height: scaledPixels(24) },
    elevation: 16,
  },
  face: {
    flex: 1,
    borderRadius: 9999,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  initials: {
    color: consoleColors.text,
    fontWeight: consoleType.weight.semibold,
  },
  ring: {
    position: 'absolute',
    borderRadius: 9999,
    borderWidth: RING,
    borderColor: consoleColors.ring,
  },
  name: {
    marginTop: NAME_GAP,
    color: consoleColors.secondary,
    fontSize: scaledPixels(consoleType.name),
    fontWeight: consoleType.weight.medium,
    textAlign: 'center',
  },
  nameStrong: {
    color: consoleColors.text,
  },
  nameFocused: {
    fontWeight: consoleType.weight.semibold,
  },
  checkBadge: {
    position: 'absolute',
    right: -scaledPixels(2),
    bottom: -scaledPixels(2),
    backgroundColor: consoleColors.text,
    borderWidth: scaledPixels(4),
    borderColor: consoleColors.ground,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkMark: {
    borderColor: consoleColors.onLight,
    transform: [{ rotate: '45deg' }],
  },
  kidWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: -scaledPixels(14),
    alignItems: 'center',
  },
  kidChip: {
    backgroundColor: consoleColors.ground,
    borderWidth: scaledPixels(2),
    borderColor: consoleColors.secondary,
    borderRadius: 9999,
    paddingHorizontal: scaledPixels(12),
    paddingVertical: scaledPixels(2),
  },
  kidText: {
    color: consoleColors.text,
    fontSize: scaledPixels(consoleType.chip),
    fontWeight: consoleType.weight.semibold,
    letterSpacing: 1,
  },
  addFace: {
    backgroundColor: consoleColors.addDisc,
  },
  addFaceFocused: {
    backgroundColor: consoleColors.addDiscFocused,
  },
  plusBar: {
    position: 'absolute',
    backgroundColor: consoleColors.text,
    borderRadius: scaledPixels(2),
  },
});
