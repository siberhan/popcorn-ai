import React, { useState, useCallback, useEffect, useRef } from 'react';
import { View, StyleSheet, Text, ActivityIndicator } from 'react-native';
import { SpatialNavigationRoot } from 'react-tv-space-navigation';
import { useTVState } from './useTVState';
import {
  addToCouch,
  removeFromCouch,
  recommend,
  openAsk,
  askTonight,
  saveGenres,
  openDetails,
  goTo,
  settleFocus,
  startWatching,
  startRating,
  rateByHand,
  skipTurn,
  finishRating,
  editPerson,
  deletePerson,
} from './api';
import { useSpeech } from './speech/useSpeech';
import { ConsoleBackdrop, VoiceBar } from './components';
import { Reaction } from './types';
import CouchScreen from './screens/CouchScreen';
import GenresScreen, { preloadGenres } from './screens/GenresScreen';
import AskScreen from './screens/AskScreen';
import FavoritesScreen from './screens/FavoritesScreen';
import RecommendationsScreen from './screens/RecommendationsScreen';
import DetailsScreen from './screens/DetailsScreen';
import RatingScreen from './screens/RatingScreen';
import OfflineBanner from '../components/OfflineBanner';
import Toast from '../components/Toast';
import { scaledPixels } from '../hooks/useScale';
import { consoleColors, consoleType } from '../theme/console';
import '../app/configureRemoteControl';

const SpatialNavRoot = SpatialNavigationRoot as React.ComponentType<{
  isActive?: boolean;
  children?: React.ReactNode;
  onDirectionHandledWithoutMovement?: any;
}>;

/** Same rule as the server's `slug()`: collapse spaces, ignore case. */
const slug = (name: string) => (name || '').split(/\s+/).filter(Boolean).join(' ').toLowerCase();

export function PopcornRoot() {
  const { state, online, refresh } = useTVState();
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [picking, setPicking] = useState(false); // a recommend call is in flight
  const speech = useSpeech(state ? state.speech : undefined);
  // A new profile shows its genres screen before the server answers (see handleAddMember).
  const [pendingGenresFor, setPendingGenresFor] = useState<string | null>(null);
  const addingRef = useRef<Promise<unknown> | null>(null);

  useEffect(() => {
    preloadGenres();
  }, []);

  // The server's own genres screen (or any other screen change) takes over from the local one.
  const serverScreen = state ? state.screen : null;
  const serverVersion = state ? state.version : null;
  const pendingVersion = useRef<number | null>(null);
  useEffect(() => {
    if (!pendingGenresFor) {
      pendingVersion.current = null;
      return;
    }
    if (pendingVersion.current === null) {
      pendingVersion.current = serverVersion;
    } else if (serverVersion !== pendingVersion.current) {
      setPendingGenresFor(null);
    }
  }, [pendingGenresFor, serverScreen, serverVersion]);

  const showError = useCallback((msg: string) => {
    setToastMessage(msg);
  }, []);

  const handleRemoveMember = useCallback(
    async (name: string) => {
      try {
        await removeFromCouch(name);
        refresh();
        return true;
      } catch (err: any) {
        showError(err?.message || 'Failed to remove member from couch');
        return false;
      }
    },
    [refresh, showError]
  );

  const handleAddMember = useCallback(
    async (name: string, age?: number) => {
      // A new name goes to the genres screen at once; the server confirms it with the next poll.
      const roster = state && Array.isArray(state.household) ? state.household : [];
      const isNew = !roster.some((m) => slug(m.name) === slug(name));
      const adding = addToCouch(name, age);
      if (isNew) {
        addingRef.current = adding;
        setPendingGenresFor(name.split(/\s+/).filter(Boolean).join(' '));
      }
      try {
        await adding;
      } catch (err: any) {
        if (isNew) setPendingGenresFor(null);
        showError(err?.message || 'Failed to add member to couch');
        return false;
      }
      refresh();
      return true;
    },
    [state, refresh, showError]
  );

  const handleEditMember = useCallback(
    async (name: string, newName: string, age: number | null) => {
      try {
        await editPerson(name, { name: newName, age });
        refresh();
        return true;
      } catch (err: any) {
        showError(err?.message || 'Failed to save the changes');
        return false;
      }
    },
    [refresh, showError]
  );

  const handleSaveGenres = useCallback(
    async (name: string, genres: string[]) => {
      try {
        await addingRef.current?.catch(() => {}); // the profile must exist before its genres are saved
        await saveGenres(name, genres);
        refresh();
        return true;
      } catch (err: any) {
        showError(err?.message || 'Failed to save the genres');
        return false;
      }
    },
    [refresh, showError]
  );

  const handleDeleteMember = useCallback(
    async (name: string) => {
      try {
        await deletePerson(name);
        refresh();
        return true;
      } catch (err: any) {
        showError(err?.message || 'Failed to delete the profile');
        return false;
      }
    },
    [refresh, showError]
  );

  /** Skip on the ask screen (request = "") and "New picks" on the reel (more = true, tonight's wish kept). */
  const handleShowPicks = useCallback(
    async (more: boolean, request?: string) => {
      if (picking) return;
      setPicking(true);
      try {
        await recommend(more, request);
        refresh(); // the server moved to the new list; show it now, not on the next poll
      } catch (err: any) {
        showError(err?.message || (more ? 'Popcorn could not find new picks' : 'Popcorn could not get picks'));
      } finally {
        setPicking(false);
      }
    },
    [picking, refresh, showError]
  );

  /** Popcorn on the couch: "what do you feel like tonight?" (or an unfinished genres/favorites first). */
  const handleOpenAsk = useCallback(async () => {
    try {
      await openAsk();
      refresh();
    } catch (err: any) {
      showError(err?.message || 'Popcorn could not start');
    }
  }, [refresh, showError]);

  /** A typed wish: the server checks it, then shows the picks or a "sorry" line on the ask screen. */
  const handleAsk = useCallback(
    async (text: string) => {
      if (picking) return;
      setPicking(true);
      try {
        await askTonight(text);
        refresh();
      } catch (err: any) {
        showError(err?.message || 'Popcorn could not get picks');
      } finally {
        setPicking(false);
      }
    },
    [picking, refresh, showError]
  );

  /** Run a request; toast its error text (or `fallback`). */
  const run = useCallback(
    async (call: () => Promise<unknown>, fallback: string) => {
      try {
        await call();
      } catch (err: any) {
        showError(err?.message || fallback);
      }
    },
    [showError]
  );

  const handleOpen = useCallback(
    (movieId: number) => run(() => openDetails(movieId), 'Failed to open the film'),
    [run]
  );

  // Fire and forget: `focus` records the film the reel settled on.
  const handleFilmSettled = useCallback((movieId: number) => {
    settleFocus(movieId).catch(() => {});
  }, []);

  const detailsId = state?.details?.id;
  const handleWatch = useCallback(
    (provider: string) => {
      if (typeof detailsId !== 'number') return;
      run(() => startWatching(detailsId, provider), 'Failed to start watching');
    },
    [run, detailsId]
  );

  const handleWereBack = useCallback(() => run(() => startRating(), 'Failed to start the rating'), [run]);
  const handleBackToPicks = useCallback(
    () => run(() => goTo('recommendations'), 'Failed to go back to the picks'),
    [run]
  );
  const handleRate = useCallback(
    (name: string, reaction: Reaction) => run(() => rateByHand(name, reaction), 'Failed to save the rating'),
    [run]
  );
  const handleSkip = useCallback(() => run(() => skipTurn(), 'Failed to skip'), [run]);
  const handleFinish = useCallback(() => run(() => finishRating(), 'Failed to save the ratings'), [run]);
  const handleDone = useCallback(() => run(() => goTo('couch'), 'Failed to go back to the couch'), [run]);
  const handleBackToAsk = useCallback(() => run(() => goTo('ask'), 'Failed to go back'), [run]);

  if (!state) {
    return (
      <View style={styles.container}>
        <ConsoleBackdrop tint={consoleColors.fieldTeal} />
        {!online && <OfflineBanner />}
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={consoleColors.text} />
          <Text style={styles.connectingText}>Connecting to Popcorn AI...</Text>
        </View>
        {toastMessage && (
          <Toast message={toastMessage} onDismiss={() => setToastMessage(null)} />
        )}
      </View>
    );
  }

  const picksLoading = picking || Boolean(state.picks_loading);

  let screenNode: React.ReactNode = null;
  switch (pendingGenresFor ? 'genres' : state.screen) {
    case 'couch':
      screenNode = (
        <CouchScreen
          state={state}
          onAddMember={handleAddMember}
          onRemoveMember={handleRemoveMember}
          onEditMember={handleEditMember}
          onDeleteMember={handleDeleteMember}
          onSaveGenres={handleSaveGenres}
          onShowPicks={handleOpenAsk}
          picksLoading={picksLoading}
        />
      );
      break;
    case 'genres': {
      // A new person picks their genres here; 1+ is required. Back goes to the couch and Popcorn
      // brings them back here before any picks.
      const who = pendingGenresFor || state.genres_for || '';
      const roster = Array.isArray(state.household) ? state.household : state.members || [];
      const member = roster.find((m) => slug(m.name) === slug(who));
      screenNode = (
        <GenresScreen
          state={state}
          name={who}
          selected={member && Array.isArray(member.genres) ? member.genres : []}
          onSave={(genres) => handleSaveGenres(who, genres)}
          onBack={handleDone}
        />
      );
      break;
    }
    case 'favorites':
      screenNode = (
        <FavoritesScreen
          state={state}
          onBack={handleDone}
          showError={showError}
          refresh={refresh}
        />
      );
      break;
    case 'ask':
      screenNode = (
        <AskScreen
          state={state}
          onAsk={handleAsk}
          onSkip={() => handleShowPicks(false, '')}
          onBack={handleDone}
          busy={picksLoading}
        />
      );
      break;
    case 'recommendations':
      screenNode = (
        <RecommendationsScreen
          state={state}
          onOpen={handleOpen}
          onFilmSettled={handleFilmSettled}
          onOpenCouch={handleDone}
          onBack={handleBackToAsk}
          onNewPicks={() => handleShowPicks(true)}
          picksLoading={picksLoading}
          speaking={speech.speaking}
          narrating={speech.narrating}
          onNarrate={speech.narrate}
          onStopNarration={speech.stopNarration}
        />
      );
      break;
    case 'details':
      screenNode = (
        <DetailsScreen
          state={state}
          onWatch={handleWatch}
          onWereBack={handleWereBack}
          onBack={handleBackToPicks}
        />
      );
      break;
    case 'rating':
      screenNode = (
        <RatingScreen
          state={state}
          onRate={handleRate}
          onSkip={handleSkip}
          onFinish={handleFinish}
          onDone={handleDone}
        />
      );
      break;
    default:
      screenNode = (
        <CouchScreen
          state={state}
          onAddMember={handleAddMember}
          onRemoveMember={handleRemoveMember}
          onEditMember={handleEditMember}
          onDeleteMember={handleDeleteMember}
          onSaveGenres={handleSaveGenres}
          onShowPicks={handleOpenAsk}
          picksLoading={picksLoading}
        />
      );
  }

  return (
    <SpatialNavRoot isActive={true}>
      <View style={styles.container}>
        {!online && <OfflineBanner />}
        {screenNode}
        <VoiceBar
          voice={state.voice}
          caption={speech.caption}
          hideListening={state.screen === 'rating' && Boolean(state.rating && state.rating.asking)}
        />
        {toastMessage && (
          <Toast message={toastMessage} onDismiss={() => setToastMessage(null)} />
        )}
      </View>
    </SpatialNavRoot>
  );
}

export default PopcornRoot;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: consoleColors.ground,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  connectingText: {
    color: consoleColors.secondary,
    fontSize: scaledPixels(consoleType.secondary),
    fontWeight: consoleType.weight.medium,
    marginTop: scaledPixels(24),
  },
});
