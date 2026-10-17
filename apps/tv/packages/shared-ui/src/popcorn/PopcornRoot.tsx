import React, { useState, useCallback } from 'react';
import { View, StyleSheet, Text, ActivityIndicator } from 'react-native';
import { SpatialNavigationRoot } from 'react-tv-space-navigation';
import { useTVState } from './useTVState';
import { pickDuel, removeFromCouch, refreshPicks } from './api';
import CouchScreen from './screens/CouchScreen';
import DuelScreen from './screens/DuelScreen';
import RecommendationsScreen from './screens/RecommendationsScreen';
import DetailsScreen from './screens/DetailsScreen';
import OfflineBanner from '../components/OfflineBanner';
import Toast from '../components/Toast';
import { colors, typography, spacing } from '../theme';
import '../app/configureRemoteControl';

const SpatialNavRoot = SpatialNavigationRoot as React.ComponentType<{
  isActive?: boolean;
  children?: React.ReactNode;
  onDirectionHandledWithoutMovement?: any;
}>;

export function PopcornRoot() {
  const { state, online } = useTVState();
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showError = useCallback((msg: string) => {
    setToastMessage(msg);
  }, []);

  const handlePickDuel = useCallback(
    async (side: 'left' | 'right') => {
      try {
        await pickDuel(side);
      } catch (err: any) {
        showError(err?.message || 'Failed to record duel choice');
      }
    },
    [showError]
  );

  const handleRemoveMember = useCallback(
    async (name: string) => {
      try {
        await removeFromCouch(name);
      } catch (err: any) {
        showError(err?.message || 'Failed to remove member from couch');
      }
    },
    [showError]
  );

  const handleShowPicks = useCallback(async () => {
    try {
      await refreshPicks();
    } catch (err: any) {
      showError(err?.message || 'Failed to refresh recommendations');
    }
  }, [showError]);

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
        />
      );
      break;
    case 'details':
      screenNode = (
        <DetailsScreen
          state={state}
        />
      );
      break;
    default:
      screenNode = (
        <CouchScreen
          state={state}
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
