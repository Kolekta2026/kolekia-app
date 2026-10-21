import { Pressable, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { F } from '../constants/theme';
import { Palette, useStyles, useTheme } from '../lib/theme';

type Option = { key: string; label: string };

export function PrimaryButton({ label, onPress, disabled, style, icon }: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  icon?: keyof typeof Ionicons.glyphMap;
}) {
  const { C } = useTheme();
  const s = useStyles(makeStyles);
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [s.button, (pressed || disabled) && { opacity: 0.7 }, style]}
    >
      <View style={s.buttonRow}>
        {icon ? <Ionicons name={icon} size={20} color={C.onBrand} /> : null}
        <Text style={s.buttonText}>{label}</Text>
      </View>
    </Pressable>
  );
}

export function SecondaryButton({ label, onPress, style }: {
  label: string;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const { C } = useTheme();
  const s = useStyles(makeStyles);
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [s.secondary, pressed && { backgroundColor: C.paper }, style]}
    >
      <Text style={s.secondaryText}>{label}</Text>
    </Pressable>
  );
}

// Sabit genişlikte bölümlü seçici (durum, filtre)
export function Segmented({ options, value, onChange }: {
  options: Option[];
  value: string;
  onChange: (key: string) => void;
}) {
  const { C } = useTheme();
  const s = useStyles(makeStyles);
  return (
    <View style={s.segment}>
      {options.map((o, i) => {
        const on = o.key === value;
        return (
          <Pressable
            key={o.key}
            onPress={() => onChange(o.key)}
            style={[s.segItem, i > 0 && s.segDivider, on && s.segOn]}
          >
            <Text style={[s.segText, on && s.segTextOn]} numberOfLines={1}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// Serbest sayıda seçenek (şablon, select alanları)
export function Chips({ options, value, onChange }: {
  options: Option[];
  value: string;
  onChange: (key: string) => void;
}) {
  const { C } = useTheme();
  const s = useStyles(makeStyles);
  return (
    <View style={s.chips}>
      {options.map(o => {
        const on = o.key === value;
        return (
          <Pressable key={o.key} onPress={() => onChange(o.key)} style={[s.chip, on && s.chipOn]}>
            <Text style={[s.chipText, on && s.chipTextOn]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function FieldLabel({ children }: { children: string }) {
  const { C } = useTheme();
  const s = useStyles(makeStyles);
  return <Text style={s.label}>{children}</Text>;
}

const makeStyles = (C: Palette) => StyleSheet.create({
  button: {
    backgroundColor: C.brand,
    paddingVertical: 18,
    alignItems: 'center',
  },
  buttonRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  buttonText: { color: C.onBrand, fontFamily: F.bold, fontSize: 16, letterSpacing: 0.2 },
  secondary: {
    borderWidth: 1.5,
    borderColor: C.black,
    paddingVertical: 13,
    alignItems: 'center',
    backgroundColor: C.white,
  },
  secondaryText: { color: C.black, fontFamily: F.bold, fontSize: 15 },

  segment: { flexDirection: 'row', borderWidth: 1.5, borderColor: C.black },
  segItem: { flex: 1, paddingVertical: 10, alignItems: 'center', backgroundColor: C.white },
  segDivider: { borderLeftWidth: 1.5, borderLeftColor: C.black },
  segOn: { backgroundColor: C.brand },
  segText: { fontFamily: F.semi, fontSize: 13, color: C.black },
  segTextOn: { color: C.onBrand },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1.5, borderColor: C.black, paddingVertical: 9, paddingHorizontal: 14 },
  chipOn: { backgroundColor: C.brand },
  chipText: { fontFamily: F.medium, fontSize: 14, color: C.black },
  chipTextOn: { color: C.onBrand },

  label: { fontFamily: F.bold, fontSize: 14, color: C.black, marginTop: 24, marginBottom: 10 },
});
