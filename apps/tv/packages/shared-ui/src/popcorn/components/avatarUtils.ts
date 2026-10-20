import { colors } from '../../theme';
import { consoleDiscs } from '../../theme/console';
import { Member } from '../types';

/** Stable hash of a person's name (case and outer spaces ignored). */
function nameHash(name: string): number {
  const clean = (name || 'Guest').trim().toLowerCase();
  let hash = 0;
  for (let i = 0; i < clean.length; i += 1) {
    hash = (hash * 31 + clean.charCodeAt(i)) >>> 0;
  }
  return hash;
}

/**
 * Deterministic warm cinema avatar color derived from a person's name.
 * Matches the v1 design tokens.
 */
export function avatarColorForName(name: string): string {
  return colors.avatar[nameHash(name) % colors.avatar.length];
}

/** Same name-to-color mapping as `avatarColorForName`, on the console disc palette (couch screen). */
export function consoleDiscColorForName(name: string): string {
  return consoleDiscs[nameHash(name) % consoleDiscs.length];
}

/**
 * Extract 1-2 uppercase initials from a person's name.
 */
export function initialsForName(name: string): string {
  const parts = (name || '?')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Console discs: one letter for a one-word name, first and last initial for longer names. */
export function discInitialsForName(name: string): string {
  const parts = (name || '?').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

/**
 * Determine whether a member is considered a child (<13 or kid: true).
 */
export function isChildMember(member: Member): boolean {
  return Boolean(member.kid || (typeof member.age === 'number' && member.age < 13));
}

/**
 * Compute the household kid-safe certification badge text per tv-contract.md:
 * - Any member with kid: true or age < 13 -> "PG kid-safe"
 * - Any member with age < 17 -> "PG-13 kid-safe"
 * - Otherwise -> null
 */
export function getKidFilterLabel(members: Member[]): string | null {
  if (!Array.isArray(members) || members.length === 0) return null;
  const hasUnder13 = members.some(
    (m) => m && (m.kid || (typeof m.age === 'number' && m.age < 13))
  );
  if (hasUnder13) return 'PG kid-safe';

  const hasUnder17 = members.some(
    (m) => m && typeof m.age === 'number' && m.age < 17
  );
  if (hasUnder17) return 'PG-13 kid-safe';

  return null;
}
