import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { DefaultFocus, SpatialNavigationNode } from 'react-tv-space-navigation';
import { TVState } from '../types';
import { scaledPixels } from '../../hooks/useScale';
import { consoleColors, consoleGenresType, consoleLayout, consoleType } from '../../theme/console';
import {
  ConsoleBackdrop,
  ConsoleHeader,
  FormButton,
  FormTextField,
  PhoneQr,
  formIsTyping,
  useBackKey,
  useClock,
} from '../components';

export interface AskScreenProps {
  state: TVState;
  /** Send the typed wish; the server checks it and either shows the picks or a "sorry" line here. */
  onAsk: (text: string) => void;
  /** Picks without a wish. */
  onSkip: () => void;
  /** Back: the couch. */
  onBack: () => void;
  /** A wish or the picks are on their way. */
  busy: boolean;
}

const px = scaledPixels;
const T = consoleGenresType;
const SAFE_X = px(consoleLayout.safeX);
const SAFE_Y = px(consoleLayout.safeY);

/**
 * "What do you feel like watching tonight?" after the Popcorn button. Typed with the remote or said on
 * the phone (QR). A wish the picks cannot use comes back as a fixed "sorry" line and the question stays.
 */
export default function AskScreen({ state, onAsk, onSkip, onBack, busy }: AskScreenProps) {
  const [text, setText] = useState('');
  const clock = useClock();

  useBackKey(() => (formIsTyping() ? undefined : onBack()));

  const submit = () => {
    const wish = text.split(/\s+/).filter(Boolean).join(' ');
    if (busy || !wish) return;
    onAsk(wish);
  };

  const voice = state.voice;
  const live = voice && voice.state !== 'idle' && voice.text ? voice.text : '';
  const reply = state.ask_reply || '';
  const status = busy || state.picks_loading ? 'Finding films...' : live ? `“${live}”` : '';

  return (
    <View style={styles.screen}>
      <ConsoleBackdrop tint={consoleColors.fieldTeal} />
      <ConsoleHeader state={state} right={<Text style={styles.clock}>{clock}</Text>} />

      <Text style={styles.title}>What do you feel like watching tonight?</Text>
      <Text style={styles.sub}>For example: something light and funny, a 90s thriller, a film like Up.</Text>

      <View style={styles.form}>
        <SpatialNavigationNode orientation="vertical">
          <View>
            <DefaultFocus>
              <FormTextField
                label="Tonight"
                value={text}
                placeholder="Type what you feel like"
                maxLength={200}
                onChangeText={setText}
                onSubmit={submit}
              />
            </DefaultFocus>
            <Text style={[styles.reply, reply ? null : styles.hidden]} numberOfLines={2}>
              {reply || ' '}
            </Text>
            <Text style={[styles.status, status ? null : styles.hidden]} numberOfLines={2}>
              {status || ' '}
            </Text>
            <SpatialNavigationNode orientation="horizontal">
              <View style={styles.buttons}>
                <FormButton label="Find films" primary disabled={busy || !text.trim()} onSelect={submit} />
                <FormButton label="Skip" disabled={busy} onSelect={onSkip} />
                <FormButton label="Back" onSelect={onBack} />
              </View>
            </SpatialNavigationNode>
          </View>
        </SpatialNavigationNode>
        {reply ? null : (
          <Text style={styles.note}>I don’t know films from the last two years or what’s in cinemas now.</Text>
        )}
      </View>

      <View style={styles.qr}>
        <PhoneQr caption="Scan to say it" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: consoleColors.ground,
  },
  clock: {
    marginLeft: px(48),
    color: consoleColors.secondary,
    fontSize: px(consoleType.header),
    fontWeight: consoleType.weight.medium,
  },
  title: {
    position: 'absolute',
    top: px(consoleLayout.titleTop),
    left: SAFE_X,
    right: SAFE_X + px(420),
    color: consoleColors.text,
    fontSize: px(consoleType.title),
    fontWeight: consoleType.weight.semibold,
    letterSpacing: -px(1.2),
  },
  sub: {
    position: 'absolute',
    top: px(consoleLayout.titleTop + 96),
    left: SAFE_X,
    right: SAFE_X + px(420),
    color: consoleColors.secondary,
    fontSize: px(T.sub),
    fontWeight: consoleType.weight.medium,
  },
  form: {
    position: 'absolute',
    top: px(370),
    left: SAFE_X,
    width: px(1000),
  },
  reply: {
    color: consoleColors.danger,
    fontSize: px(consoleType.secondary),
    fontWeight: consoleType.weight.semibold,
    minHeight: px(34),
  },
  status: {
    color: consoleColors.secondary,
    fontSize: px(consoleType.secondary),
    fontWeight: consoleType.weight.medium,
    minHeight: px(34),
    marginTop: px(6),
    marginBottom: px(18),
  },
  hidden: {
    opacity: 0,
  },
  buttons: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: -px(8),
  },
  note: {
    marginTop: px(36),
    color: consoleColors.secondary,
    fontSize: px(consoleType.credit),
    fontWeight: consoleType.weight.medium,
  },
  qr: {
    position: 'absolute',
    top: px(360),
    right: SAFE_X,
    bottom: SAFE_Y,
  },
});
