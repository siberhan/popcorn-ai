import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, StyleSheet, Platform, Keyboard, KeyboardTypeOptions, TextStyle } from 'react-native';
import {
  SpatialNavigationFocusableView,
  SpatialNavigationNode,
  SpatialNavigationNodeRef,
  useLockSpatialNavigation,
} from 'react-tv-space-navigation';
import { scaledPixels } from '../../hooks/useScale';
import { consoleColors, consoleLayout, consoleType } from '../../theme/console';

type FocusRef = (node: SpatialNavigationNodeRef | null) => void;

// Web: hide the browser focus outline (the field draws its own). Vega: hide the native underline.
const webInputReset = Platform.OS === 'web' ? ({ outlineStyle: 'none' } as unknown as TextStyle) : null;
const keplerInputProps = Platform.OS === 'web' ? {} : { underlineColorKepler: 'transparent' };

interface FormTextFieldProps {
  label: string;
  value: string;
  placeholder: string;
  onChangeText: (text: string) => void;
  keyboardType?: KeyboardTypeOptions;
  maxLength?: number;
  focusRef?: FocusRef;
  onSubmit?: () => void;
}

/**
 * A text field the remote can reach. D-pad focus lands on the box; OK focuses the real
 * TextInput (opens the on-screen keyboard on Vega) and locks spatial navigation while typing,
 * so arrows and Enter go to the input. Submit, blur, or the keyboard closing unlocks again.
 */
function FormTextField({
  label,
  value,
  placeholder,
  onChangeText,
  keyboardType,
  maxLength,
  focusRef,
  onSubmit,
}: FormTextFieldProps) {
  const inputRef = useRef<TextInput>(null);
  const { lock, unlock } = useLockSpatialNavigation();
  const lockedRef = useRef(false);
  const [editing, setEditing] = useState(false);

  const startEditing = () => {
    if (!lockedRef.current) {
      lockedRef.current = true;
      lock();
    }
    setEditing(true);
  };

  const stopEditing = () => {
    setEditing(false);
    if (lockedRef.current) {
      lockedRef.current = false;
      // Unlock after the current key event is done, so the Enter that submitted the
      // field does not also reach the spatial navigator and reopen it.
      setTimeout(unlock, 0);
    }
  };

  const stopEditingRef = useRef(stopEditing);
  stopEditingRef.current = stopEditing;

  useEffect(() => {
    // Vega: Back on the on-screen keyboard hides it without a submit.
    const sub = Keyboard.addListener('keyboardDidHide', () => {
      if (lockedRef.current) {
        inputRef.current?.blur();
        stopEditingRef.current();
      }
    });
    return () => {
      sub.remove();
      if (lockedRef.current) {
        lockedRef.current = false;
        unlock();
      }
    };
  }, [unlock]);

  const handleSelect = () => {
    startEditing();
    inputRef.current?.focus();
  };

  return (
    <View style={styles.fieldBlock}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <SpatialNavigationFocusableView ref={focusRef} onSelect={handleSelect}>
        {({ isFocused }) => (
          <View style={[styles.field, isFocused ? styles.fieldFocused : null, editing ? styles.fieldEditing : null]}>
            <TextInput
              ref={inputRef}
              value={value}
              onChangeText={onChangeText}
              placeholder={placeholder}
              placeholderTextColor={consoleColors.placeholder}
              selectionColor={consoleColors.text}
              keyboardType={keyboardType}
              maxLength={maxLength}
              autoCorrect={false}
              returnKeyType="done"
              onFocus={startEditing}
              onBlur={stopEditing}
              onSubmitEditing={() => {
                stopEditing();
                onSubmit?.();
              }}
              style={[styles.input, webInputReset]}
              {...keplerInputProps}
            />
            {isFocused && !editing ? <Text style={styles.fieldHint}>OK to type</Text> : null}
          </View>
        )}
      </SpatialNavigationFocusableView>
    </View>
  );
}

interface FormButtonProps {
  label: string;
  primary?: boolean;
  onSelect: () => void;
  focusRef?: FocusRef;
}

function FormButton({ label, primary, onSelect, focusRef }: FormButtonProps) {
  return (
    <SpatialNavigationFocusableView ref={focusRef} onSelect={onSelect}>
      {({ isFocused }) => (
        <View style={[styles.buttonRing, isFocused ? styles.buttonRingFocused : null]}>
          <View style={[styles.button, primary ? styles.buttonPrimary : styles.buttonOutline]}>
            <Text style={[styles.buttonText, primary ? styles.buttonTextPrimary : null]}>{label}</Text>
          </View>
        </View>
      )}
    </SpatialNavigationFocusableView>
  );
}

export interface AddMemberFormProps {
  onSubmit: (name: string, age?: number) => void;
  onCancel: () => void;
  /** Ref of the name field's focus node, so the screen can focus it when the form opens. */
  nameFocusRef?: FocusRef;
}

/**
 * Add a new family member: name (required) + age (optional), all reachable with the D-pad.
 * The screen shows the heading; this draws the fields and buttons only.
 */
export default function AddMemberForm({ onSubmit, onCancel, nameFocusRef }: AddMemberFormProps) {
  const [name, setName] = useState('');
  const [age, setAge] = useState('');
  const [error, setError] = useState<string | null>(null);
  const nameNode = useRef<SpatialNavigationNodeRef | null>(null);
  const ageNode = useRef<SpatialNavigationNodeRef | null>(null);
  const addNode = useRef<SpatialNavigationNodeRef | null>(null);

  const focusNode = (node: SpatialNavigationNodeRef | null) => {
    try {
      node?.focus();
    } catch {
      // node not registered yet; the user can still move with the D-pad
    }
  };

  const handleAdd = () => {
    const cleanName = name.split(/\s+/).filter(Boolean).join(' ');
    if (!cleanName) {
      setError('Type a name first.');
      focusNode(nameNode.current);
      return;
    }
    const ageNumber = age ? parseInt(age, 10) : undefined;
    if (ageNumber !== undefined && (isNaN(ageNumber) || ageNumber > 120)) {
      setError('Age must be a number from 0 to 120.');
      focusNode(ageNode.current);
      return;
    }
    setError(null);
    onSubmit(cleanName, ageNumber);
  };

  return (
    <View style={styles.form}>
      <SpatialNavigationNode orientation="vertical">
        <View>
          <FormTextField
            label="Name"
            value={name}
            placeholder="Their name"
            maxLength={40}
            onChangeText={(text) => {
              setName(text);
              if (error) setError(null);
            }}
            focusRef={(node) => {
              nameNode.current = node;
              nameFocusRef?.(node);
            }}
            onSubmit={() => focusNode(ageNode.current)}
          />
          <FormTextField
            label="Age (optional)"
            value={age}
            placeholder="For example 9"
            keyboardType="number-pad"
            maxLength={3}
            onChangeText={(text) => {
              setAge(text.replace(/[^0-9]/g, ''));
              if (error) setError(null);
            }}
            focusRef={(node) => {
              ageNode.current = node;
            }}
            onSubmit={() => focusNode(addNode.current)}
          />
          <Text style={[styles.error, error ? null : styles.errorHidden]}>{error || ' '}</Text>
          <SpatialNavigationNode orientation="horizontal">
            <View style={styles.buttonRow}>
              <FormButton
                label="Add"
                primary
                onSelect={handleAdd}
                focusRef={(node) => {
                  addNode.current = node;
                }}
              />
              <FormButton label="Cancel" onSelect={onCancel} />
            </View>
          </SpatialNavigationNode>
        </View>
      </SpatialNavigationNode>
    </View>
  );
}

const FIELD_H = scaledPixels(consoleLayout.fieldHeight);
const BUTTON_H = scaledPixels(72);
const RING_W = scaledPixels(4);
const RING_GAP = scaledPixels(4);

const styles = StyleSheet.create({
  form: {
    width: scaledPixels(720),
  },
  fieldBlock: {
    marginBottom: scaledPixels(22),
  },
  fieldLabel: {
    color: consoleColors.secondary,
    fontSize: scaledPixels(consoleType.secondary),
    fontWeight: consoleType.weight.medium,
    marginBottom: scaledPixels(10),
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    height: FIELD_H,
    backgroundColor: consoleColors.field,
    borderWidth: scaledPixels(2),
    borderColor: 'transparent',
    borderRadius: scaledPixels(16),
    paddingHorizontal: scaledPixels(24),
  },
  fieldFocused: {
    borderColor: consoleColors.ring,
  },
  fieldEditing: {
    borderColor: consoleColors.ring,
    backgroundColor: consoleColors.fieldEditing,
  },
  input: {
    flex: 1,
    color: consoleColors.text,
    fontSize: scaledPixels(consoleType.name),
    fontWeight: consoleType.weight.medium,
    paddingVertical: 0,
  },
  fieldHint: {
    color: consoleColors.secondary,
    fontSize: scaledPixels(consoleType.credit),
    fontWeight: consoleType.weight.medium,
    marginLeft: scaledPixels(12),
  },
  error: {
    color: consoleColors.danger,
    fontSize: scaledPixels(consoleType.secondary),
    fontWeight: consoleType.weight.medium,
    minHeight: scaledPixels(34),
    marginBottom: scaledPixels(10),
  },
  errorHidden: {
    opacity: 0,
  },
  buttonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: -(RING_W + RING_GAP),
  },
  buttonRing: {
    borderRadius: 9999,
    borderWidth: RING_W,
    borderColor: 'transparent',
    padding: RING_GAP,
    marginRight: scaledPixels(12),
  },
  buttonRingFocused: {
    borderColor: consoleColors.ring,
    transform: [{ scale: 1.06 }],
  },
  button: {
    height: BUTTON_H,
    minWidth: scaledPixels(180),
    borderRadius: BUTTON_H / 2,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: scaledPixels(40),
  },
  buttonPrimary: {
    backgroundColor: consoleColors.cta,
  },
  buttonOutline: {
    borderWidth: scaledPixels(2),
    borderColor: consoleColors.outline,
  },
  buttonText: {
    color: consoleColors.text,
    fontSize: scaledPixels(consoleType.secondary),
    fontWeight: consoleType.weight.semibold,
  },
  buttonTextPrimary: {
    color: consoleColors.onLight,
  },
});
