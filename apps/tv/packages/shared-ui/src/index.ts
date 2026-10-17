// Main Popcorn TV Root
export { default as PopcornRoot } from './popcorn/PopcornRoot';

// State hook & API actions
export { useTVState } from './popcorn/useTVState';
export type { UseTVStateResult } from './popcorn/useTVState';
export { pickDuel, addToCouch, removeFromCouch, refreshPicks } from './popcorn/api';
export { API_BASE_URL } from './popcorn/config';

// Contract Types
export * from './popcorn/types';

// Theme
export * from './theme';

// Components
export { default as OfflineBanner } from './components/OfflineBanner';
export { default as Toast } from './components/Toast';
export { default as FocusablePressable } from './components/FocusablePressable';
export { default as LoadingIndicator } from './components/LoadingIndicator';
export { default as PlatformLinearGradient } from './components/PlatformLinearGradient';

// Hooks
export { scaledPixels } from './hooks/useScale';
