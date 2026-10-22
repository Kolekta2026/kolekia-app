import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  Easing, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withTiming,
} from 'react-native-reanimated';
import { F } from '../constants/theme';
import { Palette, useStyles, useTheme } from '../lib/theme';
import { useI18n } from '../lib/i18n';

// Hiç koleksiyon yokken ana ekran: arkada silik örnek ikonlar (uygulama dolunca nasıl
// görüneceğini ima eder), önde tek bir çağrı kartı ve "örnekle dene" seçeneği.
const ICONS = [
  'watch-outline', 'shirt-outline', 'disc-outline', 'ellipse-outline',
  'card-outline', 'camera-outline', 'car-sport-outline', 'book-outline',
  'game-controller-outline', 'glasses-outline', 'musical-notes-outline', 'trophy-outline',
] as const;
const STRIP = ['watch-outline', 'shirt-outline', 'disc-outline', 'ellipse-outline'] as const;

export function EmptyShowcase({ onCreate, onDemo, demoLoading }: {
  onCreate: () => void;
  onDemo: () => void;
  demoLoading?: boolean;
}) {
  const { C } = useTheme();
  const s = useStyles(makeStyles);
  const { t } = useI18n();
  const { width } = useWindowDimensions();
  const cell = (width - 4) / 3;

  // Arka plandaki ikonlar yavaşça "nefes alır"
  const breathe = useSharedValue(0);
  // Düğmenin etrafındaki halkalar nabız gibi atar
  const pulse = useSharedValue(0);
  useEffect(() => {
    breathe.value = withRepeat(withTiming(1, { duration: 2200, easing: Easing.inOut(Easing.quad) }), -1, true);
    pulse.value = withDelay(400, withRepeat(withTiming(1, { duration: 1600, easing: Easing.out(Easing.quad) }), -1, false));
  }, []);
  const ghostStyle = useAnimatedStyle(() => ({ opacity: 0.1 + breathe.value * 0.08 }));
  const ring1 = useAnimatedStyle(() => ({
    opacity: 0.45 * (1 - pulse.value),
    transform: [{ scaleX: 1 + pulse.value * 0.06 }, { scaleY: 1 + pulse.value * 0.35 }],
  }));
  const ring2 = useAnimatedStyle(() => ({
    opacity: 0.25 * (1 - pulse.value),
    transform: [{ scaleX: 1 + pulse.value * 0.1 }, { scaleY: 1 + pulse.value * 0.6 }],
  }));

  return (
    <View>
      {/* Silik koleksiyon şeridi */}
      <Animated.View style={[s.strip, ghostStyle]}>
        {STRIP.map((name, i) => (
          <View key={i} style={s.stripBox}>
            <Ionicons name={name} size={34} color={C.black} />
          </View>
        ))}
      </Animated.View>

      <View>
        {/* Silik parça ızgarası */}
        <Animated.View style={[s.grid, ghostStyle]} pointerEvents="none">
          {ICONS.map((name, i) => (
            <View key={i} style={[s.cell, { width: cell, height: cell }]}>
              <Ionicons name={name} size={cell * 0.38} color={C.black} />
            </View>
          ))}
        </Animated.View>

        {/* Çağrı kartı */}
        <View style={s.card}>
          <Text style={s.title}>{t('empty.title')}</Text>
          <Text style={s.text}>{t('empty.text')}</Text>

          <View style={s.btnWrap}>
            <Animated.View pointerEvents="none" style={[s.ring, ring2]} />
            <Animated.View pointerEvents="none" style={[s.ring, ring1]} />
            <Pressable
              onPress={onCreate}
              style={({ pressed }) => [s.btn, pressed && { opacity: 0.85 }]}
              accessibilityRole="button"
            >
              <Ionicons name="add" size={20} color={C.onBrand} />
              <Text style={s.btnText}>{t('empty.create')}</Text>
            </Pressable>
          </View>

          <Pressable onPress={onCreate} hitSlop={6}>
            <Text style={s.ai}>{t('empty.ai')}</Text>
          </Pressable>
          <Pressable onPress={onDemo} disabled={demoLoading} hitSlop={8} accessibilityRole="button">
            <Text style={s.demo}>{demoLoading ? t('empty.demoLoading') : t('empty.demo')}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const makeStyles = (C: Palette) => StyleSheet.create({
  strip: { flexDirection: 'row', gap: 12, paddingHorizontal: 20, paddingTop: 8, paddingBottom: 14 },
  stripBox: { width: 70, height: 70, backgroundColor: C.paper, alignItems: 'center', justifyContent: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 2, borderTopWidth: 1, borderTopColor: C.line, paddingTop: 2 },
  cell: { backgroundColor: C.paper, alignItems: 'center', justifyContent: 'center' },
  card: {
    position: 'absolute', left: 20, right: 20, top: 26,
    backgroundColor: C.white, borderWidth: 2, borderColor: C.black,
    paddingHorizontal: 20, paddingTop: 24, paddingBottom: 18, alignItems: 'center',
    shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 20, shadowOffset: { width: 0, height: 12 }, elevation: 6,
  },
  title: { fontFamily: F.black, fontSize: 26, letterSpacing: -0.7, color: C.black, textAlign: 'center', lineHeight: 28 },
  text: { fontFamily: F.regular, fontSize: 14, color: C.grey, textAlign: 'center', marginTop: 8, lineHeight: 20 },
  btnWrap: { alignSelf: 'stretch', marginTop: 20, justifyContent: 'center' },
  ring: { ...StyleSheet.absoluteFillObject, borderWidth: 2, borderColor: C.black },
  btn: {
    height: 54, backgroundColor: C.brand, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  btnText: { fontFamily: F.bold, fontSize: 16, color: C.onBrand },
  ai: { fontFamily: F.semi, fontSize: 13, color: C.black, marginTop: 14, textAlign: 'center' },
  demo: { fontFamily: F.bold, fontSize: 14, color: C.black, marginTop: 12, textDecorationLine: 'underline' },
});
