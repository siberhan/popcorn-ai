import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import {
  SpatialNavigationFocusableView,
  SpatialNavigationNode,
  SpatialNavigationNodeRef,
} from 'react-tv-space-navigation';
import { Genre, TVState } from '../types';
import { getGenres } from '../api';
import { scaledPixels } from '../../hooks/useScale';
import {
  consoleColors,
  consoleGenreTints,
  consoleGenres,
  consoleGenresType,
  consoleLayout,
  consoleReel,
  consoleReelType,
  consoleType,
} from '../../theme/console';
import {
  ConsoleBackdrop,
  ConsoleHeader,
  FormButton,
  discColorIn,
  discInitialsForName,
  householdOrder,
  useBackKey,
  useClock,
} from '../components';

export interface GenresScreenProps {
  state: TVState;
  /** Whose genres are being picked. */
  name: string;
  /** Genres already saved for this person (prefilled). */
  selected?: string[];
  /** Save the chosen genre names (never empty). Resolve false when the save failed. */
  onSave: (genres: string[]) => Promise<boolean>;
  /** Back: the couch (a new person), or the edit view. Shown as a button next to Continue. */
  onBack?: () => void;
}

const px = scaledPixels;
const R = consoleGenres;
const T = consoleGenresType;
const SAFE_X = px(consoleLayout.safeX);
const SAFE_Y = px(consoleLayout.safeY);
const COLUMNS = 5;

// The genre list never changes while the TV runs: one fetch, then the cache.
let genreCache: Genre[] | null = null;

/** Fill the cache at app start, so a new profile's grid shows at once. */
export function preloadGenres(): void {
  if (genreCache) return;
  getGenres().then(
    (list) => {
      genreCache = genreCache || list;
    },
    () => {}, // the screen loads (and shows the error) itself
  );
}

function countLine(n: number): string {
  if (n === 0) return 'Pick at least one genre';
  return n === 1 ? '1 genre picked' : `${n} genres picked`;
}

/** The list in rows of COLUMNS, the last row possibly short. */
function rowsOf(genres: Genre[]): Genre[][] {
  const rows: Genre[][] = [];
  for (let i = 0; i < genres.length; i += COLUMNS) rows.push(genres.slice(i, i + COLUMNS));
  return rows;
}

interface ChipProps {
  genre: Genre;
  selected: boolean;
  lastInRow: boolean;
  onToggle: () => void;
  onFocus: () => void;
  focusRef: (node: SpatialNavigationNodeRef | null) => void;
}

/**
 * One genre pill: the ring and the ground gap sit inside the cell, so a focused chip scales
 * without pushing the grid. Chosen: white fill, dark label and a check.
 */
function GenreChip({ genre, selected, lastInRow, onToggle, onFocus, focusRef }: ChipProps) {
  return (
    <SpatialNavigationFocusableView ref={focusRef} onSelect={onToggle} onFocus={onFocus}>
      {({ isFocused }) => (
        <View style={[styles.cell, lastInRow ? styles.cellLast : null]}>
          <View style={[styles.ring, isFocused ? styles.ringFocused : null]}>
            <View
              style={[
                styles.chip,
                isFocused && !selected ? styles.chipFocused : null,
                selected ? styles.chipSelected : null,
              ]}
            >
              <Text style={[styles.chipText, selected ? styles.chipTextSelected : null]} numberOfLines={1}>
                {genre.name}
              </Text>
              {selected ? <View style={styles.tick} /> : null}
            </View>
          </View>
        </View>
      )}
    </SpatialNavigationFocusableView>
  );
}

// ---------------------------------------------------------------------------------------------

/**
 * Multi-select genre grid for one person. At least one genre is needed before Continue works.
 * Shown by the server right after a new person joins (cannot be skipped) and from the profile
 * edit view (prefilled, saves and goes back there).
 */
export default function GenresScreen({ state, name, selected, onSave, onBack }: GenresScreenProps) {
  const [genres, setGenres] = useState<Genre[] | null>(genreCache);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>(() => (Array.isArray(selected) ? selected : []));
  const [saving, setSaving] = useState(false);
  const [tint, setTint] = useState(consoleColors.fieldTeal);
  const [focusTarget, setFocusTarget] = useState<string | null>(null);
  const nodeRefs = useRef<Record<string, SpatialNavigationNodeRef | null>>({});
  const clock = useClock();

  const load = useCallback(() => {
    setLoadError(null);
    getGenres().then(
      (list) => {
        genreCache = list;
        setGenres(list);
      },
      (err: any) => setLoadError(err?.message || 'Could not load the genres'),
    );
  }, []);

  useEffect(() => {
    if (!genres) load();
  }, [genres, load]);

  // Focus lands on what this person already has, else on the first genre.
  const pickedRef = useRef(picked);
  pickedRef.current = picked;
  useEffect(() => {
    if (!genres || genres.length === 0) return;
    const start = genres.find((g) => pickedRef.current.includes(g.name)) || genres[0];
    setFocusTarget(start.name);
  }, [genres]);

  useEffect(() => {
    if (!focusTarget) return;
    try {
      nodeRefs.current[focusTarget]?.focus();
    } catch {
      // not registered yet; the D-pad still works
    }
    setFocusTarget(null);
  }, [focusTarget]);

  useBackKey(() => onBack?.());

  const toggle = (genre: Genre) => {
    if (saving) return;
    setPicked((prev) => (prev.includes(genre.name) ? prev.filter((n) => n !== genre.name) : [...prev, genre.name]));
  };

  const submit = () => {
    if (saving || picked.length === 0) return;
    setSaving(true);
    onSave(picked).then(
      (ok) => {
        if (!ok) setSaving(false);
      },
      () => setSaving(false),
    );
  };

  const order = householdOrder(state);
  const discColor = discColorIn(order, name, [name]);
  const rows = genres ? rowsOf(genres) : [];
  const empty = genres !== null && genres.length === 0;

  return (
    <View style={styles.screen}>
      <ConsoleBackdrop tint={tint} />

      <ConsoleHeader
        state={state}
        right={
          <View style={styles.who}>
            <View style={[styles.whoDisc, { backgroundColor: discColor }]}>
              <Text style={styles.whoInitials}>{discInitialsForName(name)}</Text>
            </View>
            <Text style={styles.whoName} numberOfLines={1}>
              {name ? `${name}’s genres` : 'Genres'}
            </Text>
            <Text style={styles.whoClock}>{clock}</Text>
          </View>
        }
      />

      <Text style={styles.title} numberOfLines={1}>
        {name ? `What does ${name} love?` : 'What do they love?'}
      </Text>
      <Text style={styles.sub}>Their picks start from these.</Text>

      {/* A stable focus node keeps the grid above the Continue button in D-pad order.
          alignInGrid: Down/Up keep the column instead of jumping to the row's first chip. */}
      <SpatialNavigationNode orientation="vertical" alignInGrid>
        <View style={styles.gridArea}>
          {loadError || empty ? (
            <View style={styles.retry}>
              <Text style={styles.message}>{loadError || 'No genres came back.'}</Text>
              <View style={styles.retryButton}>
                <FormButton label="Try again" onSelect={load} />
              </View>
            </View>
          ) : genres === null ? (
            <Text style={styles.message}>Loading genres...</Text>
          ) : (
            rows.map((row, rowIndex) => (
              <SpatialNavigationNode key={rowIndex} orientation="horizontal">
                <View style={styles.row}>
                  {row.map((genre, i) => (
                    <GenreChip
                      key={genre.id}
                      genre={genre}
                      selected={picked.includes(genre.name)}
                      lastInRow={i === row.length - 1}
                      onToggle={() => toggle(genre)}
                      onFocus={() => setTint(consoleGenreTints[genre.name] || consoleColors.fieldTeal)}
                      focusRef={(node) => {
                        nodeRefs.current[genre.name] = node;
                      }}
                    />
                  ))}
                </View>
              </SpatialNavigationNode>
            ))
          )}
        </View>
      </SpatialNavigationNode>

      <View style={styles.bottomBar}>
        <Text style={styles.count}>{countLine(picked.length)}</Text>
        <SpatialNavigationNode orientation="horizontal">
          <View style={styles.cta}>
            {onBack ? <FormButton label="Back" onSelect={onBack} /> : null}
            <FormButton
              label={saving ? 'Saving...' : 'Continue'}
              primary
              disabled={picked.length === 0 || saving || genres === null}
              onSelect={submit}
            />
          </View>
        </SpatialNavigationNode>
      </View>
    </View>
  );
}

// Five columns fill the safe width exactly, so the grid's right edge lines up with Continue.
const CELL_W = Math.floor((px(1920) - 2 * SAFE_X - (COLUMNS - 1) * px(R.gapX)) / COLUMNS);
const CELL_H = px(R.cellHeight);

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: consoleColors.ground,
  },
  who: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
    marginLeft: px(48),
  },
  whoDisc: {
    width: px(consoleReel.disc),
    height: px(consoleReel.disc),
    borderRadius: px(consoleReel.disc / 2),
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: px(14),
  },
  whoInitials: {
    color: consoleColors.text,
    fontSize: px(consoleReelType.initials),
    fontWeight: consoleType.weight.semibold,
  },
  whoName: {
    flexShrink: 1,
    color: consoleColors.secondary,
    fontSize: px(consoleType.header),
    fontWeight: consoleType.weight.medium,
  },
  whoClock: {
    marginLeft: px(20),
    color: consoleColors.secondary,
    fontSize: px(consoleType.header),
    fontWeight: consoleType.weight.medium,
  },
  title: {
    position: 'absolute',
    top: px(consoleLayout.titleTop),
    left: SAFE_X,
    right: SAFE_X,
    color: consoleColors.text,
    fontSize: px(consoleType.title),
    fontWeight: consoleType.weight.semibold,
    letterSpacing: -px(1.2),
  },
  sub: {
    position: 'absolute',
    top: px(consoleLayout.titleTop + 72),
    left: SAFE_X,
    right: SAFE_X,
    color: consoleColors.secondary,
    fontSize: px(T.sub),
    fontWeight: consoleType.weight.medium,
  },

  gridArea: {
    position: 'absolute',
    top: px(R.gridTop),
    left: SAFE_X,
    right: SAFE_X,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  cell: {
    width: CELL_W,
    height: CELL_H,
    marginRight: px(R.gapX),
    marginBottom: px(R.gapY),
  },
  cellLast: {
    marginRight: 0,
  },
  ring: {
    flex: 1,
    borderRadius: 9999,
    borderWidth: px(R.ring),
    borderColor: 'transparent',
    padding: px(R.ringGap),
  },
  ringFocused: {
    borderColor: consoleColors.ring,
    shadowColor: consoleColors.shadow,
    shadowOpacity: 0.45,
    shadowRadius: px(20),
    shadowOffset: { width: 0, height: px(10) },
  },
  chip: {
    flex: 1,
    borderRadius: 9999,
    backgroundColor: consoleColors.field,
    paddingHorizontal: px(R.chipPadX),
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  chipFocused: {
    backgroundColor: consoleColors.fieldEditing,
  },
  chipSelected: {
    backgroundColor: consoleColors.cta,
  },
  chipText: {
    flexShrink: 1,
    color: consoleColors.text,
    fontSize: px(T.chip),
    fontWeight: consoleType.weight.medium,
  },
  chipTextSelected: {
    color: consoleColors.onLight,
    fontWeight: consoleType.weight.semibold,
  },
  tick: {
    width: px(8),
    height: px(15),
    marginTop: -px(2),
    marginLeft: px(12),
    borderRightWidth: px(R.tick),
    borderBottomWidth: px(R.tick),
    borderColor: consoleColors.onLight,
    transform: [{ rotate: '45deg' }],
  },

  message: {
    color: consoleColors.secondary,
    fontSize: px(T.sub),
    fontWeight: consoleType.weight.medium,
  },
  retry: {
    alignItems: 'flex-start',
  },
  retryButton: {
    marginTop: px(24),
    marginLeft: -px(8),
  },

  bottomBar: {
    position: 'absolute',
    left: SAFE_X,
    right: SAFE_X,
    bottom: SAFE_Y + px(54),
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  count: {
    flexShrink: 1,
    marginRight: px(48),
    color: consoleColors.text,
    fontSize: px(T.count),
    fontWeight: consoleType.weight.semibold,
  },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: -px(R.ctaRing),
    marginBottom: -px(R.ctaRing),
  },
});
