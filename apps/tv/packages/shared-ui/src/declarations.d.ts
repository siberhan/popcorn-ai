declare module 'react-native-pixel-perfect';

// Vega-only package (installed in apps/vega). Only the part clipPlayer.vega.ts uses, so the
// shared-ui typecheck (which resolves modules from the Expo app) passes.
declare module '@amazon-devices/react-native-w3cmedia' {
  export enum AudioContentType {
    CONTENT_TYPE_NONE = 0,
    CONTENT_TYPE_SPEECH = 1,
    CONTENT_TYPE_MUSIC = 2,
    CONTENT_TYPE_MOVIE = 3,
    CONTENT_TYPE_SONIFICATION = 4,
  }
  export enum AudioUsageType {
    USAGE_NONE = 0,
    USAGE_MEDIA = 1,
    USAGE_VOICE_ASSISTANT = 9,
  }
  export class AudioPlayer {
    constructor(audioType?: AudioContentType, audioUsage?: AudioUsageType);
    src: string;
    autoplay: boolean;
    initialize(): Promise<void>;
    deinitialize(): Promise<void>;
    play(): void;
    pause(): void;
    addEventListener(type: string, listener: (event?: unknown) => void): void;
    removeEventListener(type: string, listener: (event?: unknown) => void): void;
  }
}
