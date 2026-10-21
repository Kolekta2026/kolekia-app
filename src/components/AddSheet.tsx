import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated as RNAnimated, Image, Modal, PanResponder, Platform, Pressable, ScrollView, StyleSheet, Text,
  useWindowDimensions, View,
} from 'react-native';
import Animated, { SlideInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { F } from '../constants/theme';
import { Palette, useStyles, useTheme } from '../lib/theme';
import { useI18n } from '../lib/i18n';

export type AddChoice = { key: string; label: string; image?: string | null; onPress: () => void };

export type AddOption = {
  key: string;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  sub: string;
  onPress?: () => void;
  // Önce koleksiyon seçilmesi gerekiyorsa seçenekler aynı menüde ikinci adım olarak gösterilir
  choices?: AddChoice[];
};

// Ana ekrandaki "Ekle" düğmesinin açtığı alt sayfa: büyük ikonlu seçenekler
export function AddSheet({ visible, options, onClose }: {
  visible: boolean;
  options: AddOption[];
  onClose: () => void;
}) {
  const { C } = useTheme();
  const s = useStyles(makeStyles);
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const { height: screenH } = useWindowDimensions();
  const [step, setStep] = useState<AddOption | null>(null);

  useEffect(() => {
    if (visible) setStep(null);
  }, [visible]);

  // Seçilen işlem, menü tamamen kapandıktan sonra çalışır. iOS'ta kapanmakta olan
  // bir pencerenin üstüne yeni ekran ya da menü açılamıyor; bu yüzden onDismiss beklenir.
  const pending = useRef<(() => void) | null>(null);
  function run(fn: () => void) {
    pending.current = fn;
    onClose();
    // iOS'ta onDismiss beklenir; gelmezse diye biraz daha geç bir yedek
    setTimeout(onDismiss, Platform.OS === 'ios' ? 600 : 200);
  }
  function onDismiss() {
    const f = pending.current;
    pending.current = null;
    f?.();
  }

  // Menünün herhangi bir yerinden aşağı sürükleyince parmağı takip eder;
  // yeterince aşağı çekilince kapanır, az çekilince yerine döner.
  // Her açılışta yeni bir değer: önceki kapanıştan kalan konum yeniden açılışı bozmasın
  const dragY = useMemo(() => new RNAnimated.Value(0), [visible]);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const swipe = useMemo(
    () =>
      PanResponder.create({
        // "Capture": satırlara dokunmayla başlasa da aşağı sürükleme menüye geçer
        onMoveShouldSetPanResponderCapture: (_, g) => g.dy > 6 && Math.abs(g.dy) > Math.abs(g.dx),
        onPanResponderTerminationRequest: () => false,
        onPanResponderMove: (_, g) => dragY.setValue(Math.max(0, g.dy)),
        onPanResponderRelease: (_, g) => {
          if (g.dy > 80 || g.vy > 0.8) {
            // Kapatma animasyonun bitmesine bağlı değil; menü her durumda kapanır
            RNAnimated.timing(dragY, { toValue: 700, duration: 160, useNativeDriver: true }).start();
            closeRef.current();
          } else {
            RNAnimated.spring(dragY, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start();
          }
        },
        onPanResponderTerminate: () => {
          RNAnimated.spring(dragY, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start();
        },
      }),
    [dragY]
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={() => (step ? setStep(null) : onClose())}
      onDismiss={onDismiss}
      statusBarTranslucent
    >
      <View style={s.root}>
      {/* Boş alana dokununca kapanır */}
      <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel={t('common.cancel')} />
      <Animated.View entering={SlideInDown.duration(220)}>
      <RNAnimated.View
        {...swipe.panHandlers}
        style={[s.sheet, { marginBottom: insets.bottom + 10, transform: [{ translateY: dragY }] }]}
      >
        <View style={s.header}>
          <View style={s.grabber} />
          <View style={s.titleRow}>
            {step && (
              <Pressable onPress={() => setStep(null)} hitSlop={12} accessibilityLabel={t('common.back')} style={s.back}>
                <Ionicons name="chevron-back" size={24} color={C.black} />
              </Pressable>
            )}
            <Text style={s.title} numberOfLines={1}>{step ? t('home.pickCollection') : t('add.title')}</Text>
            <Pressable onPress={onClose} hitSlop={12} accessibilityLabel={t('common.cancel')} style={s.close}>
              <Ionicons name="close" size={22} color={C.black} />
            </Pressable>
          </View>
        </View>

        {step ? (
          <ScrollView style={{ maxHeight: screenH * 0.5 }} bounces={false}>
            {step.choices!.map((c, i) => (
              <Pressable
                key={c.key}
                onPress={() => run(c.onPress)}
                style={({ pressed }) => [s.row, i > 0 && s.rowDivider, pressed && { backgroundColor: C.paper }]}
              >
                <View style={s.thumb}>
                  {c.image ? (
                    <Image source={{ uri: c.image }} style={StyleSheet.absoluteFill} />
                  ) : (
                    <Text style={s.thumbText}>{c.label.charAt(0).toLocaleUpperCase('tr')}</Text>
                  )}
                </View>
                <Text style={[s.rowTitle, { flex: 1 }]} numberOfLines={1}>{c.label}</Text>
                <Ionicons name="chevron-forward" size={18} color={C.grey} />
              </Pressable>
            ))}
          </ScrollView>
        ) : (
          options.map((o, i) => (
            <Pressable
              key={o.key}
              onPress={() => {
                if (o.choices?.length) setStep(o);
                else if (o.onPress) run(o.onPress);
              }}
              style={({ pressed }) => [s.row, i > 0 && s.rowDivider, pressed && { backgroundColor: C.paper }]}
            >
              <View style={s.icon}>
                <Ionicons name={o.icon} size={24} color={C.onBrand} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.rowTitle}>{o.title}</Text>
                <Text style={s.rowSub}>{o.sub}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={C.grey} />
            </Pressable>
          ))
        )}
      </RNAnimated.View>
      </Animated.View>
      </View>
    </Modal>
  );
}

const makeStyles = (C: Palette) => StyleSheet.create({
  root: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  // Ekranın kenarlarına yapışmayan, gölgeli, havada duran bir kart
  sheet: {
    backgroundColor: C.white,
    marginHorizontal: 12,
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 6,
    borderWidth: 1.5,
    borderColor: C.black,
    shadowColor: '#000',
    shadowOpacity: 0.28,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 16,
  },
  grabber: { alignSelf: 'center', width: 40, height: 4, backgroundColor: C.line, marginBottom: 14 },
  header: { paddingBottom: 8 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  back: { marginLeft: -6 },
  title: { fontFamily: F.black, fontSize: 22, color: C.black, letterSpacing: -0.5, flex: 1 },
  close: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: C.paper },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14 },
  rowDivider: { borderTopWidth: 1, borderTopColor: C.line },
  icon: { width: 48, height: 48, backgroundColor: C.brand, alignItems: 'center', justifyContent: 'center' },
  thumb: {
    width: 48, height: 48, backgroundColor: C.paper, alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  thumbText: { fontFamily: F.black, fontSize: 20, color: C.black },
  rowTitle: { fontFamily: F.bold, fontSize: 16, color: C.black },
  rowSub: { fontFamily: F.regular, fontSize: 13, color: C.grey, marginTop: 2, lineHeight: 18 },
});
