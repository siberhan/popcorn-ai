import React, { useState, useCallback, useEffect, useRef } from 'react';
import { View, StyleSheet, Text, ActivityIndicator } from 'react-native';
import { SpatialNavigationRoot } from 'react-tv-space-navigation';
import { useTVState } from './useTVState';
import {
  pickDuel,
  addToCouch,
  removeFromCouch,
  openDetails,
  goTo,
  settleFocus,
  startWatching,
  startRating,
  rateByHand,
  skipTurn,
  finishRating,
  markSeen,
  newSession,
  sendEvent,
  AgentEvent,
} from './api';
import { useSpeech } from './speech/useSpeech';
import { VoiceBar } from './components';
import { Reaction } from './types';
import CouchScreen from './screens/CouchScreen';
import DuelScreen from './screens/DuelScreen';
import RecommendationsScreen from './screens/RecommendationsScreen';
import DetailsScreen from './screens/DetailsScreen';
import RatingScreen from './screens/RatingScreen';
import OfflineBanner from '../components/OfflineBanner';
import Toast from '../components/Toast';
import { colors, typography, spacing } from '../theme';
import '../app/configureRemoteControl';

const SpatialNavRoot = SpatialNavigationRoot as React.ComponentType<{
  isActive?: boolean;
  children?: React.ReactNode;
  onDirectionHandledWithoutMovement?: any;
}>;

// One fresh agent conversation per app start (module level, so a remount does not start another).
let sessionStarted = false;

export function PopcornRoot() {
  const { state, online } = useTVState();
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(0); // agent events in flight: the voice bar shows "Thinking..."
  const speech = useSpeech(state ? state.speech : undefined);

  const stateRef = useRef(state);
  stateRef.current = state;

  const showError = useCallback((msg: string) => {
    setToastMessage(msg);
  }, []);

  useEffect(() => {
    if (sessionStarted) return;
    sessionStarted = true;
    newSession().catch((err: any) => {
      if (__DEV__) console.log(`[agent] session/new failed: ${err?.message || err}`);
    });
  }, []);

  /** Tell the agent about a TV event. The agent's reply arrives as `speech` in the state. */
  const runEvent = useCallback(
    async (event: AgentEvent, name?: string, skipped?: boolean, failText?: string) => {
      setWaiting((n) => n + 1);
      try {
        await sendEvent(event, name, skipped);
      } catch (err: any) {
        if (failText) showError(err?.message ? `${failText}: ${err.message}` : failText);
      } finally {
        setWaiting((n) => Math.max(0, n - 1));
      }
    },
    [showError]
  );

  const handlePickDuel = useCallback(
    async (side: 'left' | 'right' | 'skip') => {
      const name = stateRef.current?.duel?.name;
      let res: any;
      try {
        res = await pickDuel(side);
      } catch (err: any) {
        showError(err?.message || (side === 'skip' ? 'Failed to skip the duel' : 'Failed to record duel choice'));
        return;
      }
      if (res && res.done && name) {
        // Fire and forget: the agent writes taste notes and speaks next.
        runEvent('duel_done', name, side === 'skip');
      }
    },
    [showError, runEvent]
  );

  const handleRemoveMember = useCallback(
    async (name: string) => {
      try {
        await removeFromCouch(name);
        return true;
      } catch (err: any) {
        showError(err?.message || 'Failed to remove member from couch');
        return false;
      }
    },
    [showError]
  );

  const handleAddMember = useCallback(
    async (name: string, age?: number) => {
      try {
        await addToCouch(name, age);
        return true;
      } catch (err: any) {
        showError(err?.message || 'Failed to add member to couch');
        return false;
      }
    },
    [showError]
  );

  const handleShowPicks = useCallback(() => {
    runEvent('show_picks', undefined, undefined, 'Popcorn could not get picks');
  }, [runEvent]);

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

  // Fire and forget: the voice page reads `focus`; errors are ignored.
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
  const handleSeen = useCallback(
    (movieId: number) => run(() => markSeen(movieId), 'Failed to mark the film as seen'),
    [run]
  );

  if (!state) {
    return (
      <View style={styles.container}>
        {!online && <OfflineBanner />}
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={colors.accent.popcorn} />
          <Text style={styles.connectingText}>Connecting to Popcorn AI...</Text>
        </View>
        {toastMessage && (
          <Toast message={toastMessage} onDismiss={() => setToastMessage(null)} />
        )}
      </View>
    );
  }

  let screenNode: React.ReactNode = null;
  switch (state.screen) {
    case 'couch':
      screenNode = (
        <CouchScreen
          state={state}
          onAddMember={handleAddMember}
          onRemoveMember={handleRemoveMember}
          onShowPicks={handleShowPicks}
        />
      );
      break;
    case 'duel':
      screenNode = (
        <DuelScreen
          state={state}
          onPick={handlePickDuel}
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
          onNewPicks={handleShowPicks}
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
          onSeen={handleSeen}
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
          onShowPicks={handleShowPicks}
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
          waiting={waiting > 0}
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
    backgroundColor: colors.bg.canvas,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  connectingText: {
    color: colors.text.secondary,
    fontSize: typography.fontSize.lg,
    marginTop: spacing[4],
  },
});
