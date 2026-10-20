import React, { useState } from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import { scaledPixels } from '../../hooks/useScale';
import { consoleColors, consoleQr, consoleQrType, consoleType } from '../../theme/console';
import { phoneQrUrl } from '../api';

const px = scaledPixels;
const Q = consoleQr;

export interface PhoneQrProps {
  /** The one line under the code, e.g. "Scan to say what you thought". */
  caption: string;
}

/**
 * QR code for the phone page (`{API}/phone/`) on the rating screen, drawn by the server as a PNG.
 * The image is dark on white with its own quiet zone; a white frame keeps it scannable on the dark ground.
 */
export default function PhoneQr({ caption }: PhoneQrProps) {
  const [failed, setFailed] = useState(false);
  const side = px(Q.rating);

  return (
    <View style={styles.block}>
      <View style={styles.frame}>
        {failed ? (
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
        )}
      </View>
      <Text style={styles.caption}>{caption}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    alignItems: 'center',
  },
  frame: {
    padding: px(Q.pad),
    borderRadius: px(Q.radius),
    backgroundColor: consoleColors.text,
  },
  caption: {
    marginTop: px(20),
    maxWidth: px(Q.rating + Q.pad * 2 + 120),
    textAlign: 'center',
    color: consoleColors.text,
    fontSize: px(consoleQrType.caption),
    fontWeight: consoleType.weight.medium,
  },
  missing: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  missingText: {
    color: consoleColors.onLight,
    fontSize: px(consoleQrType.caption),
    textAlign: 'center',
  },
});
