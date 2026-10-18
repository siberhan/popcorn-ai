import { useEffect, useRef } from 'react';
import { BackHandler } from 'react-native';
import RemoteControlManager from '../../app/remote-control/RemoteControlManager';
import { SupportedKeys } from '../../app/remote-control/SupportedKeys';

// One press can arrive twice on Vega (the key listener and hardwareBackPress); keep the first.
const DEDUPE_MS = 400;

/**
 * Run `onBack` on the remote's Back key while the calling screen is mounted.
 * Key events come from the same RemoteControlManager the spatial navigation uses (Backspace on
 * web, `back` on Vega). The hardwareBackPress listener returns true so Vega does not exit the app.
 */
export function useBackKey(onBack: () => void): void {
  const handler = useRef(onBack);
  handler.current = onBack;

  useEffect(() => {
    let last = 0;
    const fire = () => {
      const now = Date.now();
      if (now - last < DEDUPE_MS) return;
      last = now;
      handler.current();
    };
    const keyListener = RemoteControlManager.addKeydownListener((key: SupportedKeys) => {
      if (key === SupportedKeys.Back) fire();
    });
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      fire();
      return true;
    });
    return () => {
      RemoteControlManager.removeKeydownListener(keyListener);
      sub.remove();
    };
  }, []);
}
