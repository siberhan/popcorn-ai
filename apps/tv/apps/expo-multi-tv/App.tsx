import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { PopcornRoot } from '@multi-tv/shared-ui';
import { LogBox } from 'react-native';

// Suppress specific deprecation warnings that don't affect functionality
if (__DEV__) {
  LogBox.ignoreLogs([
    /findNodeHandle is deprecated/,
    /findHostInstance_DEPRECATED is deprecated/,
  ]);

  const originalWarn = console.warn;
  console.warn = (...args) => {
    const message = args[0]?.toString() || '';
    if (
      message.includes('findNodeHandle is deprecated') ||
      message.includes('findHostInstance_DEPRECATED is deprecated')
    ) {
      return;
    }
    originalWarn(...args);
  };
}

// Prevent splash screen from auto-hiding before asset loading
SplashScreen.preventAutoHideAsync();

export default function App() {
  const [loaded, error] = useFonts({
    SpaceMono: require('./assets/fonts/SpaceMono-Regular.ttf'),
  });

  useEffect(() => {
    if (loaded || error) {
      SplashScreen.hideAsync();
      if (error) {
        console.warn(`Error in loading fonts: ${error}`);
      }
    }
  }, [loaded, error]);

  if (!loaded && !error) {
    return null;
  }

  return <PopcornRoot />;
}
