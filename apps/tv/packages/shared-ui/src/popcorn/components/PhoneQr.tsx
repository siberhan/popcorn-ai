import React, { useState } from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import { scaledPixels } from '../../hooks/useScale';
import { consoleColors, consoleQr, consoleQrType, consoleType } from '../../theme/console';
import { phoneQrUrl } from '../api';

const px = scaledPixels;
const Q = consoleQr;

export interface PhoneQrProps {
  /** large: first run (nobody known yet); small: a corner hint once people exist. */
  size: 'large' | 'small';
}

/**
 * QR code for the phone microphone page (`{API}/phone/?agent=...`), drawn by the server as a PNG.
 * The image is dark on white with its own quiet zone; a white frame keeps it scannable on the dark ground.
 */
export default function PhoneQr({ size }: PhoneQrProps) {
  const [failed, setFailed] = useState(false);
  const large = size === 'large';
  const side = px(large ? Q.large : Q.small);
  const code = failed ? (
    <View style={[styles.missing, { width: side, height: side }]}>
      <Text style={styles.missingText}>QR code unavailable</Text>
    </View>
  ) : (
    <Image
      source={{ uri: phoneQrUrl() }}
      style={{ width: side, height: side }}
      resizeMode="contain"
      onError={() => setFailed(true)}
    />
  );

  if (large) {
    return (
      <View style={styles.large}>
        <View style={styles.frame}>{code}</View>
        <Text style={styles.largeTitle}>Scan to talk to Popcorn</Text>
        <Text style={styles.largeSub}>Open the camera on your phone, then say who is watching.</Text>
      </View>
    );
  }
  return (
    <View style={styles.small}>
      <Text style={styles.smallText}>Talk to Popcorn</Text>
      <View style={[styles.frame, styles.frameSmall]}>{code}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    padding: px(Q.pad),
    borderRadius: px(Q.radius),
    backgroundColor: consoleColors.text,
  },
  frameSmall: {
    padding: px(Q.pad / 2),
    borderRadius: px(Q.radius / 2),
  },
  large: {
    alignItems: 'center',
  },
  largeTitle: {
    marginTop: px(28),
    color: consoleColors.text,
    fontSize: px(consoleQrType.large),
    fontWeight: consoleType.weight.semibold,
  },
  largeSub: {
    marginTop: px(10),
    maxWidth: px(Q.large + Q.pad * 2 + 80),
    textAlign: 'center',
    color: consoleColors.secondary,
    fontSize: px(consoleQrType.largeSub),
    fontWeight: consoleType.weight.medium,
  },
  small: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  smallText: {
    marginRight: px(20),
    color: consoleColors.secondary,
    fontSize: px(consoleQrType.small),
    fontWeight: consoleType.weight.medium,
  },
  missing: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  missingText: {
    color: consoleColors.onLight,
    fontSize: px(consoleQrType.small),
    textAlign: 'center',
  },
});
