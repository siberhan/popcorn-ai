import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { TVState, Member } from '../types';
import { scaledPixels } from '../../hooks/useScale';
import { consoleColors, consoleDiscs, consoleLayout, consoleType, consoleReel, consoleReelType } from '../../theme/console';
import { discInitialsForName } from './avatarUtils';
import { useClock } from './useClock';

const px = scaledPixels;

/** Same rule as the server's `slug()`: collapse spaces, ignore case. */
export const nameSlug = (name: string) => (name || '').split(/\s+/).filter(Boolean).join(' ').toLowerCase();

/**
 * Everyone in couch-screen order (household first, then anyone on the couch it misses), as slugs.
 * A person's disc colour is `consoleDiscs[index]` in this list, so it matches the couch screen.
 */
export function householdOrder(state: TVState): string[] {
  const members = Array.isArray(state.members) ? state.members : [];
  const household = Array.isArray(state.household) ? state.household : members;
  const order: string[] = [];
  [...household, ...members].forEach((m: Member) => {
    if (m && m.name && !order.includes(nameSlug(m.name))) order.push(nameSlug(m.name));
  });
  return order;
}

/** Disc colour for a name in `order`; a name the household does not know gets the next free index. */
export function discColorIn(order: string[], name: string, extra: string[] = []): string {
  let idx = order.indexOf(nameSlug(name));
  if (idx < 0) {
    const unknown = extra.map(nameSlug).filter((s) => !order.includes(s));
    idx = order.length + Math.max(unknown.indexOf(nameSlug(name)), 0);
  }
  return consoleDiscs[idx % consoleDiscs.length];
}

function namesLine(names: string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

export interface ConsoleHeaderProps {
  state: TVState;
  /** Replaces the couch discs, names and clock on the right. */
  right?: React.ReactNode;
}

/**
 * The console header row: "Popcorn AI" left; right the couch discs (household colours),
 * their names and the clock.
 */
export default function ConsoleHeader({ state, right }: ConsoleHeaderProps) {
  const clock = useClock();
  const members = Array.isArray(state.members) ? state.members : [];
  const order = householdOrder(state);
  const seated = members.filter((m) => m && m.name);
  const names = namesLine(seated.map((m) => m.name));

  return (
    <View style={styles.header}>
      <Text style={styles.brand}>Popcorn AI</Text>
      {right !== undefined ? (
        right
      ) : (
        <View style={styles.couch}>
          {seated.map((m) => (
            <View key={nameSlug(m.name)} style={[styles.disc, { backgroundColor: discColorIn(order, m.name) }]}>
              <Text style={styles.discText}>{discInitialsForName(m.name)}</Text>
            </View>
          ))}
          <Text style={styles.couchText} numberOfLines={1}>
            {names ? `${names} · ${clock}` : clock}
          </Text>
        </View>
      )}
    </View>
  );
}

const R = consoleReel;
const T = consoleReelType;

const styles = StyleSheet.create({
  header: {
    position: 'absolute',
    top: px(consoleLayout.safeY),
    left: px(consoleLayout.safeX),
    right: px(consoleLayout.safeX),
    height: px(R.disc),
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  brand: {
    color: consoleColors.text,
    fontSize: px(consoleType.header),
    fontWeight: consoleType.weight.medium,
  },
  couch: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
    marginLeft: px(48),
  },
  disc: {
    width: px(R.disc),
    height: px(R.disc),
    borderRadius: px(R.disc / 2),
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: px(10),
  },
  discText: {
    color: consoleColors.text,
    fontSize: px(T.initials),
    fontWeight: consoleType.weight.semibold,
  },
  couchText: {
    marginLeft: px(6),
    flexShrink: 1,
    color: consoleColors.secondary,
    fontSize: px(T.header),
    fontWeight: consoleType.weight.medium,
  },
});
