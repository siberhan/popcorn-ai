import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  LayoutAnimation,
  Platform,
  StyleSheet,
  Text,
  UIManager,
  View,
} from 'react-native';
import {
  DefaultFocus,
  SpatialNavigationFocusableView,
  SpatialNavigationNode,
  SpatialNavigationScrollView,
} from 'react-tv-space-navigation';
import { FavCard, TVState } from '../types';
import {
  doneFavorites,
  getFavoritesCatalog,
  FavCatalog,
  searchFavorites,
  toggleFavorite,
} from '../api';
import { scaledPixels } from '../../hooks/useScale';
import {
  consoleColors,
  consoleFavorites,
  consoleFavoritesType,
  consoleType,
} from '../../theme/console';
import {
  ConsoleBackdrop,
  ConsoleHeader,
  FormButton,
  FormTextField,
  PosterCard,
  discColorIn,
  discInitialsForName,
  formIsTyping,
  householdOrder,
  useBackKey,
  useClock,
} from '../components';

export interface FavoritesScreenProps {
  state: TVState;
  /** Back: the couch. The favorites state is kept so Popcorn brings the person back to it. */
  onBack: () => void;
  /** Optional callback to show error toasts. */
  showError?: (msg: string) => void;
  /** Optional callback to refresh state after done. */
  refresh?: () => void;
}

const px = scaledPixels;
const SIDE_X = px(consoleFavorites.sideX); // room for the side buttons, so they never cover a poster
const CARD_W = px(consoleFavorites.posterWidth);
const CARD_H = px(consoleFavorites.posterHeight);
const GAP_X = px(consoleFavorites.gapX);
const GAP_Y = px(consoleFavorites.gapY);
const POSTER_RADIUS = px(consoleFavorites.posterRadius);

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const flyUpAnimation = {
  duration: 300,
  create: {
    type: LayoutAnimation.Types.easeInEaseOut,
    property: LayoutAnimation.Properties.opacity,
  },
  update: {
    type: LayoutAnimation.Types.easeInEaseOut,
  },
  delete: {
    type: LayoutAnimation.Types.easeInEaseOut,
    property: LayoutAnimation.Properties.opacity,
  },
};

function animateLayout() {
  try {
    LayoutAnimation.configureNext(flyUpAnimation);
  } catch {
    // Graceful fallback if unsupported
  }
}

function getCountLine(count: number): string {
  if (count < 5) {
    return `${count} picked, pick at least 5`;
  }
  if (count >= 25) {
    return "25 picked, that's the most";
  }
  return `${count} picked`;
}

function rowsOf<T>(items: T[], cols = 5): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += cols) {
    rows.push(items.slice(i, i + cols));
  }
  return rows;
}

interface FavoriteCardItemProps {
  card: FavCard;
  isPicked: boolean;
  onToggle: () => void;
  isLastInRow: boolean;
}

function FavoriteCardItem({ card, isPicked, onToggle, isLastInRow }: FavoriteCardItemProps) {
  return (
    <SpatialNavigationFocusableView onSelect={onToggle}>
      {({ isFocused }) => (
        <View style={[styles.cardItem, isLastInRow ? styles.cardItemLast : null]}>
          <View style={[styles.posterWrapper, isFocused ? styles.posterFocused : null]}>
            <PosterCard
              poster={card.poster}
              title={card.title}
              year={card.year}
              width={CARD_W}
              height={CARD_H}
              borderRadius={POSTER_RADIUS}
            />
            {isPicked ? (
              <View style={styles.pickedBadge}>
                <Text style={styles.pickedCheck}>✓</Text>
              </View>
            ) : null}
          </View>
          <View style={styles.cardInfo}>
            <Text style={[styles.cardTitle, isFocused ? styles.cardTitleFocused : null]} numberOfLines={1}>
              {card.title}
            </Text>
            <Text style={styles.cardMeta} numberOfLines={1}>
              {card.year || ''}
              {card.rating ? ` · ★ ${card.rating.toFixed(1)}` : ''}
            </Text>
          </View>
        </View>
      )}
    </SpatialNavigationFocusableView>
  );
}

export default function FavoritesScreen({ state, onBack, showError, refresh }: FavoritesScreenProps) {
  const favorites = state.favorites;
  const name = favorites?.name || '';
  const clock = useClock();

  const [catalog, setCatalog] = useState<FavCatalog | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  const [picked, setPicked] = useState<FavCard[]>(() => favorites?.picked || []);
  const [query, setQuery] = useState(favorites?.query || '');
  const [saving, setSaving] = useState(false);

  const inFlightToggles = useRef(new Set<number>());
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSentQuery = useRef<string>(favorites?.query || '');

  useBackKey(() => (formIsTyping() ? undefined : onBack()));

  // Fetch catalog once when page opens
  const loadCatalog = useCallback(() => {
    setCatalogLoading(true);
    setCatalogError(null);
    getFavoritesCatalog().then(
      (data) => {
        setCatalog(data);
        setCatalogLoading(false);
      },
      (err: any) => {
        setCatalogError(err?.message || 'Could not load films');
        setCatalogLoading(false);
      },
    );
  }, []);

  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);

  // Sync picked from server state when no local toggles are in flight
  useEffect(() => {
    if (favorites?.picked && inFlightToggles.current.size === 0) {
      setPicked(favorites.picked);
    }
  }, [favorites?.picked]);

  // Sync search query from server when not actively typing on TV
  useEffect(() => {
    if (!formIsTyping() && favorites) {
      const serverQuery = favorites.query || '';
      if (serverQuery !== lastSentQuery.current) {
        setQuery(serverQuery);
        lastSentQuery.current = serverQuery;
      }
    }
  }, [favorites?.query]);

  // Debounced search typing (400 ms)
  const handleSearchChange = (text: string) => {
    setQuery(text);
    if (searchTimer.current) {
      clearTimeout(searchTimer.current);
    }
    searchTimer.current = setTimeout(() => {
      const trimmed = text.trim();
      lastSentQuery.current = trimmed;
      searchFavorites(trimmed).catch((err: any) => {
        showError?.(err?.message || 'Search failed');
      });
    }, 400);
  };

  const handleSearchSubmit = () => {
    if (searchTimer.current) {
      clearTimeout(searchTimer.current);
    }
    const trimmed = query.trim();
    lastSentQuery.current = trimmed;
    searchFavorites(trimmed).catch((err: any) => {
      showError?.(err?.message || 'Search failed');
    });
  };

  // Pick / un-pick toggle with optimistic UI and LayoutAnimation
  const handleToggle = useCallback(
    async (card: FavCard) => {
      const isPicked = picked.some((c) => c.id === card.id);
      if (!isPicked && picked.length >= 25) {
        showError?.('You can pick up to 25 films');
        return;
      }

      const prevPicked = picked;
      const nextPicked = isPicked
        ? picked.filter((c) => c.id !== card.id)
        : [...picked, card];

      animateLayout();
      setPicked(nextPicked);

      inFlightToggles.current.add(card.id);
      try {
        await toggleFavorite(card.id);
      } catch (err: any) {
        animateLayout();
        setPicked(prevPicked);
        showError?.(err?.message || 'Failed to update favorite');
      } finally {
        inFlightToggles.current.delete(card.id);
      }
    },
    [picked, showError],
  );

  // Done button handler
  const handleDone = useCallback(async () => {
    if (picked.length < 5) {
      showError?.('Pick at least 5 films');
      return;
    }
    setSaving(true);
    try {
      await doneFavorites();
      refresh?.();
    } catch (err: any) {
      setSaving(false);
      showError?.(err?.message || 'Failed to finish favorites');
    }
  }, [picked.length, showError, refresh]);

  const order = householdOrder(state);
  const discColor = discColorIn(order, name, [name]);

  const pickedIds = useMemo(() => new Set(picked.map((c) => c.id)), [picked]);

  // The person's genre lists first, then Popular right now and Best of all time; picked films leave them.
  const sections = useMemo(() => {
    if (!catalog) return [];
    const lists = [
      ...catalog.for_you.map((g) => ({ key: `genre-${g.genre}`, title: g.genre, films: g.films })),
      { key: 'popular', title: 'Popular right now', films: catalog.popular },
      { key: 'best', title: 'Best of all time', films: catalog.best },
    ];
    return lists
      .map((l) => ({ ...l, films: l.films.filter((c) => !pickedIds.has(c.id)) }))
      .filter((l) => l.films.length > 0);
  }, [catalog, pickedIds]);

  const searchResults = useMemo(() => {
    return favorites?.results || [];
  }, [favorites?.results]);

  const isSearching = Boolean(query.trim());

  return (
    <View style={styles.screen}>
      <ConsoleBackdrop tint={consoleColors.fieldTeal} />

      <ConsoleHeader
        state={state}
        right={
          <View style={styles.who}>
            <View style={[styles.whoDisc, { backgroundColor: discColor }]}>
              <Text style={styles.whoInitials}>{discInitialsForName(name)}</Text>
            </View>
            <Text style={styles.whoName} numberOfLines={1}>
              {name ? `${name}’s favorites` : 'Favorites'}
            </Text>
            <Text style={styles.whoClock}>{clock}</Text>
          </View>
        }
      />

      {/* The lists scroll; Back (<) stays fixed at the left middle, Done (✓) at the right middle.
          Left from the first column reaches Back, Right from the last column reaches Done. */}
      <SpatialNavigationNode orientation="horizontal">
      <View style={styles.body}>
      <View style={[styles.sideAction, styles.sideLeft]} pointerEvents="box-none">
        <View style={styles.sidePill}>
          <FormButton label="<" compact disabled={saving} onSelect={onBack} />
        </View>
      </View>
      <SpatialNavigationScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        // Big enough that focusing the search field scrolls back to the very top (title + count line).
        offsetFromStart={px(240)}
      >
        <SpatialNavigationNode orientation="vertical">
          <View style={styles.contentWrap}>
            {/* Header block: title, count line and search */}
            <View style={styles.heroRow}>
            <View style={styles.heroLeft}>
              <Text style={styles.title}>Pick films you like</Text>
              <Text style={[styles.countLine, picked.length >= 5 ? styles.countMet : null]}>
                {name ? `${name} · ` : ''}
                {getCountLine(picked.length)}
              </Text>
              <View style={styles.controlsRow}>
                <View style={styles.searchBox}>
                  <DefaultFocus>
                    <FormTextField
                      label="Search"
                      value={query}
                      placeholder="Search by title"
                      maxLength={100}
                      onChangeText={handleSearchChange}
                      onSubmit={handleSearchSubmit}
                    />
                  </DefaultFocus>
                </View>
              </View>
            </View>
          </View>

          {/* Sections that mount later (picks, lists, results) sit in nodes that are always mounted:
              the spatial navigator orders nodes by mount time, so Down would skip to the bottom buttons. */}
          <SpatialNavigationNode orientation="vertical">
          <View>
          {/* Section: Your picks (shown when 1+ picked) */}
          {picked.length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.sectionHeader}>Your picks ({picked.length})</Text>
              <SpatialNavigationNode orientation="vertical" alignInGrid>
                <View style={styles.gridSection}>
                  {rowsOf(picked, 5).map((row, rowIndex) => (
                    <SpatialNavigationNode key={`picked-row-${rowIndex}`} orientation="horizontal">
                      <View style={styles.posterRow}>
                        {row.map((card, colIndex) => (
                          <FavoriteCardItem
                            key={`picked-${card.id}`}
                            card={card}
                            isPicked={true}
                            onToggle={() => handleToggle(card)}
                            isLastInRow={colIndex === 4}
                          />
                        ))}
                      </View>
                    </SpatialNavigationNode>
                  ))}
                </View>
              </SpatialNavigationNode>
            </View>
          ) : null}
          </View>
          </SpatialNavigationNode>

          {/* Section: Search Results or Catalog Lists */}
          <SpatialNavigationNode orientation="vertical">
          {isSearching ? (
            <View style={styles.section}>
              <Text style={styles.sectionHeader}>Results for “{query.trim()}”</Text>
              {searchResults.length === 0 ? (
                <Text style={styles.emptyText}>No films found for “{query.trim()}”.</Text>
              ) : (
                <SpatialNavigationNode orientation="vertical" alignInGrid>
                  <View style={styles.gridSection}>
                    {rowsOf(searchResults, 5).map((row, rowIndex) => (
                      <SpatialNavigationNode key={`results-row-${rowIndex}`} orientation="horizontal">
                        <View style={styles.posterRow}>
                          {row.map((card, colIndex) => (
                            <FavoriteCardItem
                              key={`result-${card.id}`}
                              card={card}
                              isPicked={pickedIds.has(card.id)}
                              onToggle={() => handleToggle(card)}
                              isLastInRow={colIndex === 4}
                            />
                          ))}
                        </View>
                      </SpatialNavigationNode>
                    ))}
                  </View>
                </SpatialNavigationNode>
              )}
            </View>
          ) : catalogLoading ? (
            <View style={styles.centerStatus}>
              <ActivityIndicator size="large" color={consoleColors.text} />
              <Text style={styles.statusText}>Loading films...</Text>
            </View>
          ) : catalogError ? (
            <View style={styles.centerStatus}>
              <Text style={styles.errorText}>{catalogError}</Text>
              <View style={styles.retryBtn}>
                <FormButton label="Try again" onSelect={loadCatalog} />
              </View>
            </View>
          ) : (
            <>
              {sections.map((section) => (
                <View key={section.key} style={styles.section}>
                  <Text style={styles.sectionHeader}>{section.title}</Text>
                  <SpatialNavigationNode orientation="vertical" alignInGrid>
                    <View style={styles.gridSection}>
                      {rowsOf(section.films, 5).map((row, rowIndex) => (
                        <SpatialNavigationNode key={`${section.key}-row-${rowIndex}`} orientation="horizontal">
                          <View style={styles.posterRow}>
                            {row.map((card, colIndex) => (
                              <FavoriteCardItem
                                key={`${section.key}-${card.id}`}
                                card={card}
                                isPicked={false}
                                onToggle={() => handleToggle(card)}
                                isLastInRow={colIndex === 4}
                              />
                            ))}
                          </View>
                        </SpatialNavigationNode>
                      ))}
                    </View>
                  </SpatialNavigationNode>
                </View>
              ))}
            </>
          )}
          </SpatialNavigationNode>

          </View>
        </SpatialNavigationNode>
      </SpatialNavigationScrollView>
      <View style={[styles.sideAction, styles.sideRight]} pointerEvents="box-none">
        <View style={styles.sidePill}>
          <FormButton
            label="✓"
            primary
            compact
            disabled={picked.length < 5 || saving}
            onSelect={handleDone}
          />
        </View>
      </View>
      </View>
      </SpatialNavigationNode>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: consoleColors.ground,
  },
  body: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
    marginTop: px(130),
  },
  scrollContent: {
    paddingHorizontal: SIDE_X,
    paddingBottom: px(100),
  },
  contentWrap: {
    width: '100%',
  },
  who: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: px(48),
  },
  whoDisc: {
    width: px(36),
    height: px(36),
    borderRadius: px(18),
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: px(10),
  },
  whoInitials: {
    color: consoleColors.text,
    fontSize: px(18),
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
  heroRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: px(20),
  },
  heroLeft: {
    flex: 1,
  },
  title: {
    color: consoleColors.text,
    fontSize: px(consoleFavoritesType.title),
    fontWeight: consoleType.weight.semibold,
    letterSpacing: -px(1),
  },
  countLine: {
    marginTop: px(8),
    color: consoleColors.secondary,
    fontSize: px(consoleFavoritesType.count),
    fontWeight: consoleType.weight.medium,
  },
  countMet: {
    color: consoleColors.text,
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginTop: px(24),
  },
  searchBox: {
    width: px(650),
  },
  section: {
    marginTop: px(28),
  },
  sectionHeader: {
    color: consoleColors.text,
    fontSize: px(consoleFavoritesType.section),
    fontWeight: consoleType.weight.semibold,
    marginBottom: px(20),
    letterSpacing: -px(0.5),
  },
  gridSection: {
    width: '100%',
  },
  posterRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  cardItem: {
    width: CARD_W,
    marginRight: GAP_X,
    marginBottom: GAP_Y,
  },
  cardItemLast: {
    marginRight: 0,
  },
  posterWrapper: {
    width: CARD_W,
    height: CARD_H,
    borderRadius: POSTER_RADIUS,
    overflow: 'hidden',
    borderWidth: px(consoleFavorites.ring),
    borderColor: 'transparent',
    position: 'relative',
  },
  posterFocused: {
    borderColor: consoleColors.ring,
    transform: [{ scale: consoleFavorites.focusScale }],
  },
  pickedBadge: {
    position: 'absolute',
    top: px(12),
    right: px(12),
    width: px(consoleFavorites.badgeSize),
    height: px(consoleFavorites.badgeSize),
    borderRadius: px(consoleFavorites.badgeSize / 2),
    backgroundColor: consoleColors.cta,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: consoleColors.shadow,
    shadowOffset: { width: 0, height: px(2) },
    shadowOpacity: 0.5,
    shadowRadius: px(4),
    elevation: 5,
  },
  pickedCheck: {
    color: consoleColors.ground,
    fontSize: px(22),
    fontWeight: '700',
    lineHeight: px(26),
  },
  cardInfo: {
    marginTop: px(10),
    width: CARD_W,
  },
  cardTitle: {
    color: consoleColors.text,
    fontSize: px(consoleFavoritesType.cardTitle),
    fontWeight: consoleType.weight.semibold,
  },
  cardTitleFocused: {
    color: consoleColors.text,
  },
  cardMeta: {
    marginTop: px(4),
    color: consoleColors.secondary,
    fontSize: px(consoleFavoritesType.cardMeta),
    fontWeight: consoleType.weight.medium,
  },
  emptyText: {
    color: consoleColors.secondary,
    fontSize: px(consoleFavoritesType.sub),
    fontWeight: consoleType.weight.medium,
    marginTop: px(16),
    marginBottom: px(24),
  },
  sideAction: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    zIndex: 2,
    justifyContent: 'center',
  },
  sideLeft: {
    left: px(20),
  },
  sideRight: {
    right: px(20),
  },
  sidePill: {
    padding: px(6),
    borderRadius: px(48),
    backgroundColor: consoleColors.field,
  },
  centerStatus: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: px(60),
  },
  statusText: {
    marginTop: px(16),
    color: consoleColors.secondary,
    fontSize: px(consoleFavoritesType.sub),
    fontWeight: consoleType.weight.medium,
  },
  errorText: {
    color: consoleColors.danger,
    fontSize: px(consoleFavoritesType.sub),
    fontWeight: consoleType.weight.medium,
    marginBottom: px(16),
  },
  retryBtn: {
    marginTop: px(8),
  },
});
