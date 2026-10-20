import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SpatialNavigationNode, DefaultFocus, SpatialNavigationNodeRef } from 'react-tv-space-navigation';
import { scaledPixels } from '../../hooks/useScale';
import { consoleColors, consoleType } from '../../theme/console';
import { FormButton } from './AddMemberForm';

export interface ConfirmDeleteProps {
  onDelete: () => void;
  onCancel: () => void;
  /** Ref of the Cancel button's focus node, so the screen can focus it when the confirm opens. */
  cancelFocusRef?: (node: SpatialNavigationNodeRef | null) => void;
}

/** The screen title asks "Delete Can?"; this adds the memory note with Delete and Cancel. Cancel takes focus first, so a stray OK keeps the profile. */
export default function ConfirmDelete({ onDelete, onCancel, cancelFocusRef }: ConfirmDeleteProps) {
  return (
    <View style={styles.box}>
      <Text style={styles.question}>Their taste memory goes too.</Text>
      <SpatialNavigationNode orientation="horizontal">
        <View style={styles.buttonRow}>
          <FormButton label="Delete" primary onSelect={onDelete} />
          <DefaultFocus>
            <FormButton label="Cancel" onSelect={onCancel} focusRef={cancelFocusRef} />
          </DefaultFocus>
        </View>
      </SpatialNavigationNode>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    width: scaledPixels(900),
  },
  question: {
    color: consoleColors.secondary,
    fontSize: scaledPixels(consoleType.info - 6),
    fontWeight: consoleType.weight.medium,
    marginBottom: scaledPixels(36),
  },
  buttonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: -scaledPixels(8),
  },
});
