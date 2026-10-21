import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { F } from '../constants/theme';
import { Palette, useStyles, useTheme } from '../lib/theme';

type ToastAction = { label: string; onPress: () => void };
export type ToastHandle = { show: (message: string, action?: ToastAction) => void };

const DURATION = 3500;

// Altta belirip kaybolan bilgi mesajı (isteğe bağlı "Geri al" gibi bir eylemle)
export const Toast = forwardRef<ToastHandle, { bottom: number }>(function Toast({ bottom }, ref) {
  const { C } = useTheme();
  const s = useStyles(makeStyles);
  const [state, setState] = useState<{ message: string; action?: ToastAction } | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const hide = () =>
    Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true })
      .start(() => setState(null));

  useImperativeHandle(ref, () => ({
    show(message, action) {
      clearTimeout(timer.current);
      setState({ message, action });
      Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }).start();
      timer.current = setTimeout(hide, DURATION);
    },
  }));

  useEffect(() => () => clearTimeout(timer.current), []);

  if (!state) return null;
  return (
    <Animated.View pointerEvents="box-none" style={[s.wrap, { bottom, opacity }]}>
      <View style={s.bar}>
        <Text style={s.text}>{state.message}</Text>
        {state.action && (
          <Pressable
            hitSlop={12}
            onPress={() => {
              clearTimeout(timer.current);
              state.action!.onPress();
              hide();
            }}
          >
            <Text style={s.action}>{state.action.label}</Text>
          </Pressable>
        )}
      </View>
    </Animated.View>
  );
});

const makeStyles = (C: Palette) => StyleSheet.create({
  wrap: { position: 'absolute', left: 20, right: 20 },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    backgroundColor: C.black,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  text: { flex: 1, fontFamily: F.medium, fontSize: 14, color: C.white, lineHeight: 19 },
  action: { fontFamily: F.bold, fontSize: 14, color: C.white, textDecorationLine: 'underline' },
});
