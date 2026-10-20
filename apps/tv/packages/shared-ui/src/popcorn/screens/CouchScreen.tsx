import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SpatialNavigationNode, SpatialNavigationNodeRef, DefaultFocus } from 'react-tv-space-navigation';
import { TVState, Member } from '../types';
import { scaledPixels } from '../../hooks/useScale';
import { consoleColors, consoleDiscs, consoleLayout, consoleType } from '../../theme/console';
import {
  ProfileAvatar,
  AddProfileTile,
  AddMemberForm,
  PopcornButton,
  ConfirmDelete,
  ConsoleBackdrop,
  formIsTyping,
  isChildMember,
  useBackKey,
  useClock,
} from '../components';
import GenresScreen from './GenresScreen';

export interface CouchScreenProps {
  state: TVState;
  /** Resolve true on success. The caller shows the error toast. */
  onAddMember?: (name: string, age?: number) => Promise<boolean>;
  onRemoveMember?: (name: string) => Promise<boolean>;
  /** Edit a profile. `age` null clears it. Resolve true on success. */
  onEditMember?: (name: string, newName: string, age: number | null) => Promise<boolean>;
  /** Delete a profile for good. Resolve true on success. */
  onDeleteMember?: (name: string) => Promise<boolean>;
  /** Save the genres picked on the edit view's genre grid. Resolve true on success. */
  onSaveGenres?: (name: string, genres: string[]) => Promise<boolean>;
  /** "Popcorn": ask for tonight's picks. */
  onShowPicks?: () => void;
  /** A picks call is in flight (this TV or another): the button waits and the line says so. */
  picksLoading?: boolean;
}

/** Same rule as the server's `slug()`: collapse spaces, ignore case. */
const slug = (name: string) => name.split(/\s+/).filter(Boolean).join(' ').toLowerCase();

const ADD_TILE = '__add__';
const COMPACT_FROM = 7; // people in the row (plus "+") before the avatars shrink

/** The Back key while the add/edit form or the delete confirm is open. */
function BackKey({ onBack }: { onBack: () => void }) {
  useBackKey(onBack);
  return null;
}

interface Patch {
  name: string;
  age: number | null;
  req: number;
  settledAt: number | null;
}

interface Removal {
  req: number;
  settledAt: number | null;
}

type Mode =
  | { kind: 'add' }
  | { kind: 'edit'; member: Member }
  | { kind: 'genres'; member: Member }
  | { kind: 'delete'; member: Member };

interface Override {
  join: boolean; // optimistic: on the couch or not
  req: number; // which request owns it
  settledAt: number | null; // state.version when the request succeeded
}

const TMDB_CREDIT = 'This product uses the TMDB API but is not endorsed or certified by TMDB.';

function countLine(n: number): string {
  if (n === 0) return 'Nobody on the couch yet';
  return n === 1 ? '1 person on the couch' : `${n} people on the couch`;
}

/**
 * The kid rule for tonight, from the youngest kid's rule (under 13 -> PG, under 17 -> PG-13).
 * "Can is 9, so picks stay PG"; null when nobody on the couch is under 17.
 */
function kidLine(couch: Member[]): string | null {
  let pick: { member: Member; rule: 'PG' | 'PG-13'; age: number } | null = null;
  couch.forEach((m) => {
    const age = typeof m.age === 'number' ? m.age : null;
    let rule: 'PG' | 'PG-13' | null = null;
    if (isChildMember(m)) rule = 'PG';
    else if (age !== null && age < 17) rule = 'PG-13';
    if (!rule) return;
    const rank = age === null ? -1 : age; // a kid with no age counts as the youngest
    const stricter = pick === null || (rule === 'PG' && pick.rule === 'PG-13');
    const sameButYounger = pick !== null && rule === pick.rule && rank < pick.age;
    if (stricter || sameButYounger) pick = { member: m, rule, age: rank };
  });
  if (!pick) return null;
  const { member, rule } = pick as { member: Member; rule: 'PG' | 'PG-13'; age: number };
  const who = typeof member.age === 'number' ? `${member.name} is ${member.age}` : `${member.name} is a kid`;
  return `${who}, so picks stay ${rule}`;
}

function newMember(name: string, age?: number): Member {
  return {
    name,
    age: age === undefined ? null : age,
    kid: age !== undefined && age < 13,
    genres: [],
    favorites: [],
    favorites_done: false,
    reviews: [],
    new: true,
  };
}

export default function CouchScreen({
  state,
  onAddMember,
  onRemoveMember,
  onEditMember,
  onDeleteMember,
  onSaveGenres,
  onShowPicks,
  picksLoading,
}: CouchScreenProps) {
  const [overrides, setOverrides] = useState<Record<string, Override>>({});
  const [pendingNew, setPendingNew] = useState<Member[]>([]);
  const [mode, setMode] = useState<Mode | null>(null);
  const [patches, setPatches] = useState<Record<string, Patch>>({});
  const [removed, setRemoved] = useState<Record<string, Removal>>({});
  const formOpen = mode !== null;
  const [focusTarget, setFocusTarget] = useState<string | null>(null);
  const [tint, setTint] = useState(consoleColors.fieldTeal);
  const clock = useClock();

  const versionRef = useRef(state.version);
  versionRef.current = state.version;
  const reqCounter = useRef(0);
  const inFlight = useRef(new Set<Promise<boolean>>());
  const nodeRefs = useRef<Record<string, SpatialNavigationNodeRef | null>>({});

  const serverMembers = Array.isArray(state.members) ? state.members : [];
  const household = Array.isArray(state.household) ? state.household : serverMembers;

  // Everyone in the row: the household (or the couch, until the server sends `household`),
  // anyone on the couch the household list misses, then people just added on this screen.
  const people: Member[] = [];
  const seen = new Set<string>();
  [...household, ...serverMembers, ...pendingNew].forEach((raw) => {
    if (!raw || !raw.name) return;
    const patch = patches[slug(raw.name)];
    const m: Member = patch
      ? { ...raw, name: patch.name, age: patch.age, kid: patch.age !== null ? patch.age < 13 : raw.kid }
      : raw;
    const id = slug(m.name);
    if (removed[slug(raw.name)] || seen.has(id)) return;
    seen.add(id);
    people.push(m);
  });

  const serverOnCouch = new Set(serverMembers.map((m) => slug(m.name)));
  const isOnCouch = (name: string) => {
    const o = overrides[slug(name)];
    return o ? o.join : serverOnCouch.has(slug(name));
  };
  const couch = people.filter((m) => isOnCouch(m.name));

  // A new version from the server: drop overrides whose request already finished
  // (follow state.members from now on) and optimistic people the household now has.
  useEffect(() => {
    setOverrides((prev) => {
      const next: Record<string, Override> = {};
      let changed = false;
      Object.keys(prev).forEach((id) => {
        const o = prev[id];
        if (o.settledAt !== null && state.version > o.settledAt) {
          changed = true;
        } else {
          next[id] = o;
        }
      });
      return changed ? next : prev;
    });
    const dropSettled = <T extends { settledAt: number | null }>(prev: Record<string, T>) => {
      const next: Record<string, T> = {};
      let changed = false;
      Object.keys(prev).forEach((id) => {
        if (prev[id].settledAt !== null && state.version > (prev[id].settledAt as number)) changed = true;
        else next[id] = prev[id];
      });
      return changed ? next : prev;
    };
    setPatches(dropSettled);
    setRemoved(dropSettled);
    const known = new Set([...household, ...serverMembers].map((m) => slug(m.name)));
    setPendingNew((prev) => {
      const next = prev.filter((m) => !known.has(slug(m.name)));
      return next.length === prev.length ? prev : next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once per server version
  }, [state.version]);

  // Imperative focus after the row or the form (re)mounts. This effect runs after all
  // children registered their focus nodes.
  useEffect(() => {
    if (!focusTarget) return;
    try {
      nodeRefs.current[focusTarget]?.focus();
    } catch {
      // not registered; the D-pad still works
    }
    setFocusTarget(null);
  }, [focusTarget, formOpen]);

  const track = (p: Promise<boolean>) => {
    inFlight.current.add(p);
    p.then(
      () => inFlight.current.delete(p),
      () => inFlight.current.delete(p),
    );
    return p;
  };

  const settle = (id: string, req: number, ok: boolean) => {
    setOverrides((prev) => {
      const o = prev[id];
      if (!o || o.req !== req) return prev;
      const next = { ...prev };
      if (ok) {
        next[id] = { ...o, settledAt: versionRef.current };
      } else {
        delete next[id]; // undo the optimistic change
      }
      return next;
    });
  };

  const setJoin = (name: string, join: boolean, call: () => Promise<boolean>) => {
    const id = slug(name);
    reqCounter.current += 1;
    const req = reqCounter.current;
    setOverrides((prev) => ({ ...prev, [id]: { join, req, settledAt: null } }));
    track(
      call().then(
        (ok) => ok,
        () => false,
      ),
    ).then((ok) => settle(id, req, ok));
  };

  const handleToggle = (member: Member) => {
    const join = !isOnCouch(member.name);
    if (join) {
      if (!onAddMember) return;
      setJoin(member.name, true, () => onAddMember(member.name));
    } else {
      if (!onRemoveMember) return;
      setJoin(member.name, false, () => onRemoveMember(member.name));
    }
  };

  const handleOpenForm = () => {
    setMode({ kind: 'add' });
    setFocusTarget('form-name');
  };

  const handleCancelForm = () => {
    const target = mode && mode.kind !== 'add' ? slug(mode.member.name) : ADD_TILE;
    setMode(null);
    setFocusTarget(target);
  };

  const handleOpenEdit = (member: Member) => {
    setMode({ kind: 'edit', member });
    setFocusTarget('form-name');
  };

  const handleOpenGenres = (member: Member) => {
    setMode({ kind: 'genres', member });
  };

  const handleOpenDelete = (member: Member) => {
    setMode({ kind: 'delete', member });
    setFocusTarget('confirm-cancel');
  };

  const handleSubmitEdit = (member: Member, name: string, age?: number) => {
    const oldId = slug(member.name);
    const newId = slug(name);
    const newAge = age === undefined ? null : age;
    setMode(null);
    setFocusTarget(newId);
    if (!onEditMember) return;
    reqCounter.current += 1;
    const req = reqCounter.current;
    const wasOnCouch = isOnCouch(member.name);
    setPatches((prev) => ({ ...prev, [oldId]: { name, age: newAge, req, settledAt: null } }));
    if (newId !== oldId) {
      // Keep the couch seat across the rename until the server catches up.
      setOverrides((prev) => ({ ...prev, [newId]: { join: wasOnCouch, req, settledAt: null } }));
    }
    track(
      onEditMember(member.name, name, newAge).then(
        (ok) => ok,
        () => false,
      ),
    ).then((ok) => {
      setPatches((prev) => {
        const p = prev[oldId];
        if (!p || p.req !== req) return prev;
        const next = { ...prev };
        if (ok) next[oldId] = { ...p, settledAt: versionRef.current };
        else delete next[oldId];
        return next;
      });
      if (newId !== oldId) settle(newId, req, ok);
    });
  };

  const handleConfirmDelete = (member: Member) => {
    const id = slug(member.name);
    const index = people.findIndex((m) => slug(m.name) === id);
    const neighbour = index > 0 ? slug(people[index - 1].name) : people.length > 1 ? slug(people[1].name) : ADD_TILE;
    setMode(null);
    setFocusTarget(neighbour);
    if (!onDeleteMember) return;
    reqCounter.current += 1;
    const req = reqCounter.current;
    setRemoved((prev) => ({ ...prev, [id]: { req, settledAt: null } }));
    track(
      onDeleteMember(member.name).then(
        (ok) => ok,
        () => false,
      ),
    ).then((ok) => {
      setRemoved((prev) => {
        const r = prev[id];
        if (!r || r.req !== req) return prev;
        const next = { ...prev };
        if (ok) next[id] = { ...r, settledAt: versionRef.current };
        else delete next[id];
        return next;
      });
    });
  };

  const handleSubmitForm = (name: string, age?: number) => {
    const id = slug(name);
    setMode(null);
    setFocusTarget(id);
    if (!onAddMember) return;
    const isNew = !people.some((m) => slug(m.name) === id);
    if (isNew) {
      setPendingNew((prev) => [...prev, newMember(name, age)]);
    }
    reqCounter.current += 1;
    const req = reqCounter.current;
    setOverrides((prev) => ({ ...prev, [id]: { join: true, req, settledAt: null } }));
    track(
      onAddMember(name, age).then(
        (ok) => ok,
        () => false,
      ),
    ).then((ok) => {
      settle(id, req, ok);
      if (!ok && isNew) {
        setPendingNew((prev) => prev.filter((m) => slug(m.name) !== id));
      }
    });
  };

  const handlePopcorn = () => {
    if (!onShowPicks || couch.length === 0 || picksLoading) return;
    // Let pending couch changes reach the server first.
    Promise.all(Array.from(inFlight.current)).then(
      () => onShowPicks(),
      () => onShowPicks(),
    );
  };

  // Default focus: first person on the couch, else the first avatar, else "+".
  const firstOnCouch = people.find((m) => serverOnCouch.has(slug(m.name)));
  const defaultId = firstOnCouch ? slug(firstOnCouch.name) : people.length > 0 ? slug(people[0].name) : ADD_TILE;
  const compact = people.length >= COMPACT_FROM;

  const refFor = (id: string) => (node: SpatialNavigationNodeRef | null) => {
    nodeRefs.current[id] = node;
  };

  const infoDetail = picksLoading
    ? 'Popcorn is picking tonight’s films...'
    : couch.length > 0
      ? kidLine(couch)
      : people.length === 0
        ? 'Press + to add someone.'
        : 'Press OK on a name to join the couch.';

  // The genre grid takes the whole screen; saving goes back to the edit form.
  if (mode !== null && mode.kind === 'genres') {
    const member = mode.member;
    return (
      <GenresScreen
        state={state}
        name={member.name}
        selected={Array.isArray(member.genres) ? member.genres : []}
        onBack={() => {
          setMode({ kind: 'edit', member });
          setFocusTarget('form-name');
        }}
        onSave={(genres) => {
          if (!onSaveGenres) return Promise.resolve(false);
          return onSaveGenres(member.name, genres).then((ok) => {
            if (ok) {
              setMode({ kind: 'edit', member: { ...member, genres } });
              setFocusTarget('form-name');
            }
            return ok;
          });
        }}
      />
    );
  }

  return (
    <View style={styles.screen}>
      <ConsoleBackdrop tint={tint} />

      <View style={styles.header}>
        <Text style={styles.brand}>Popcorn AI</Text>
        <Text style={styles.clock}>{clock}</Text>
      </View>

      <Text style={styles.title} numberOfLines={1}>
        {mode === null
          ? 'Who\u2019s watching?'
          : mode.kind === 'add'
            ? 'Add someone new'
            : mode.kind === 'edit'
              ? `Edit ${mode.member.name}`
              : `Delete ${mode.member.name}?`}
      </Text>

      {mode !== null ? <BackKey onBack={() => (formIsTyping() ? undefined : handleCancelForm())} /> : null}

      {/* A stable focus node keeps the row/form above the Popcorn button in D-pad order,
          even though the row and the form swap (and re-register) inside it. */}
      <SpatialNavigationNode orientation="vertical">
        <View style={styles.rowArea}>
          {mode && mode.kind === 'add' ? (
            <AddMemberForm onSubmit={handleSubmitForm} onCancel={handleCancelForm} nameFocusRef={refFor('form-name')} />
          ) : mode && mode.kind === 'edit' ? (
            <AddMemberForm
              key={`edit-${mode.member.name}`}
              initialName={mode.member.name}
              initialAge={typeof mode.member.age === 'number' ? mode.member.age : null}
              submitLabel="Save"
              onSubmit={(name, age) => handleSubmitEdit(mode.member, name, age)}
              onCancel={handleCancelForm}
              secondaryAction={{ label: 'Edit genres', onSelect: () => handleOpenGenres(mode.member) }}
              nameFocusRef={refFor('form-name')}
            />
          ) : mode && mode.kind === 'delete' ? (
            <ConfirmDelete
              onDelete={() => handleConfirmDelete(mode.member)}
              onCancel={handleCancelForm}
              cancelFocusRef={refFor('confirm-cancel')}
            />
          ) : (
            <SpatialNavigationNode orientation="horizontal">
              <View style={styles.row}>
                <DefaultFocus enable={defaultId === ADD_TILE}>
                  <AddProfileTile
                    compact={compact}
                    onSelect={handleOpenForm}
                    onFocus={() => setTint(consoleColors.fieldTeal)}
                    focusRef={refFor(ADD_TILE)}
                  />
                </DefaultFocus>
                {people.map((member, index) => {
                  const id = slug(member.name);
                  return (
                    <DefaultFocus key={id} enable={defaultId === id}>
                      <ProfileAvatar
                        member={member}
                        // Household order, not a name hash: the first 8 people never share a colour.
                        discColor={consoleDiscs[index % consoleDiscs.length]}
                        onCouch={isOnCouch(member.name)}
                        compact={compact}
                        onToggle={handleToggle}
                        onEdit={handleOpenEdit}
                        onDelete={handleOpenDelete}
                        onFocusColor={setTint}
                        focusRef={refFor(id)}
                      />
                    </DefaultFocus>
                  );
                })}
              </View>
            </SpatialNavigationNode>
          )}
        </View>
      </SpatialNavigationNode>

      <View style={styles.bottomBar}>
        <View style={styles.info}>
          <Text style={styles.count}>{countLine(couch.length)}</Text>
          {infoDetail ? <Text style={styles.detail}>{infoDetail}</Text> : null}
        </View>
        <View style={styles.cta}>
          <PopcornButton disabled={couch.length === 0 || Boolean(picksLoading)} onPress={handlePopcorn} />
        </View>
      </View>
      <Text style={styles.credit}>{TMDB_CREDIT}</Text>
    </View>
  );
}

// The Popcorn button draws its focus ring outside the pill; pull it back so the pill sits on the safe line.
const CTA_RING = scaledPixels(9);
const SAFE_X = scaledPixels(consoleLayout.safeX);
const SAFE_Y = scaledPixels(consoleLayout.safeY);

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: consoleColors.ground,
  },
  header: {
    position: 'absolute',
    top: SAFE_Y,
    left: SAFE_X,
    right: SAFE_X,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  brand: {
    color: consoleColors.text,
    fontSize: scaledPixels(consoleType.header),
    fontWeight: consoleType.weight.medium,
  },
  clock: {
    color: consoleColors.secondary,
    fontSize: scaledPixels(consoleType.header),
    fontWeight: consoleType.weight.medium,
  },
  title: {
    position: 'absolute',
    top: scaledPixels(consoleLayout.titleTop),
    left: SAFE_X,
    right: SAFE_X,
    color: consoleColors.text,
    fontSize: scaledPixels(consoleType.title),
    fontWeight: consoleType.weight.semibold,
    letterSpacing: -scaledPixels(1.2),
  },
  rowArea: {
    position: 'absolute',
    top: scaledPixels(consoleLayout.rowTop),
    left: SAFE_X,
    right: SAFE_X,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  bottomBar: {
    position: 'absolute',
    left: SAFE_X,
    right: SAFE_X,
    bottom: SAFE_Y + scaledPixels(54),
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  info: {
    flexShrink: 1,
    marginRight: scaledPixels(48),
  },
  count: {
    color: consoleColors.text,
    fontSize: scaledPixels(consoleType.info),
    fontWeight: consoleType.weight.semibold,
  },
  detail: {
    marginTop: scaledPixels(12),
    color: consoleColors.secondary,
    fontSize: scaledPixels(consoleType.secondary),
    fontWeight: consoleType.weight.medium,
  },
  cta: {
    marginRight: -CTA_RING,
    marginBottom: -CTA_RING,
  },
  credit: {
    position: 'absolute',
    left: SAFE_X,
    right: SAFE_X,
    bottom: SAFE_Y,
    color: consoleColors.secondary,
    fontSize: scaledPixels(consoleType.credit),
    fontWeight: consoleType.weight.medium,
  },
});
