import { useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, Image, Modal, Pressable, StyleSheet, Text, useWindowDimensions, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { Ionicons } from '@expo/vector-icons';
import { F } from '../constants/theme';
import { useI18n } from '../lib/i18n';

// Fotoğraf düzenleme: serbest ya da oranlı kırpma ve 90° döndürme.
// Sonuç yeni bir geçici dosyadır; kalıcı klasöre kayıtta kopyalanır.

const MIN = 64;       // kırpma kutusunun en küçük kenarı (ekran noktası)
const HANDLE = 44;    // köşe tutamaçlarının dokunma alanı
const TOP_BAR = 56;
const BOTTOM_BAR = 150;

type Ratio = { key: string; label: string; r: number | null };

export function PhotoEditor({ uri, visible, onCancel, onDone }: {
  uri: string | null;
  visible: boolean;
  onCancel: () => void;
  onDone: (uri: string) => void;
}) {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const { width: W, height: H } = useWindowDimensions();

  const [src, setSrc] = useState<string | null>(uri);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [ratio, setRatio] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const RATIOS: Ratio[] = [
    { key: 'free', label: t('edit.free'), r: null },
    { key: '1:1', label: '1:1', r: 1 },
    { key: '4:5', label: '4:5', r: 4 / 5 },
    { key: '3:4', label: '3:4', r: 3 / 4 },
    { key: '16:9', label: '16:9', r: 16 / 9 },
  ];

  // Ekranda görüntünün sığdığı alan
  const areaW = W - 32;
  const areaH = H - insets.top - insets.bottom - TOP_BAR - BOTTOM_BAR - 32;
  const scale = size ? Math.min(areaW / size.w, areaH / size.h) : 1;
  const dispW = size ? size.w * scale : 0;
  const dispH = size ? size.h * scale : 0;

  // Kırpma kutusu (görüntü kutusuna göre, ekran noktası)
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const w = useSharedValue(0);
  const h = useSharedValue(0);
  const bw = useSharedValue(0);
  const bh = useSharedValue(0);
  const rr = useSharedValue(0); // 0 = serbest
  const sx = useSharedValue(0);
  const sy = useSharedValue(0);
  const sw = useSharedValue(0);
  const sh = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      setSrc(uri);
      setRatio(null);
    }
  }, [visible, uri]);

  useEffect(() => {
    if (!src) return;
    setSize(null);
    Image.getSize(src, (iw, ih) => setSize({ w: iw, h: ih }), () => setSize(null));
  }, [src]);

  // Görüntü ya da oran değişince kutu, oranı koruyarak ortada en büyük hâline gelir
  useEffect(() => {
    if (!size) return;
    bw.value = dispW;
    bh.value = dispH;
    rr.value = ratio ?? 0;
    let cw = dispW, ch = dispH;
    if (ratio) {
      if (dispW / dispH > ratio) { ch = dispH; cw = ch * ratio; } else { cw = dispW; ch = cw / ratio; }
    }
    w.value = cw; h.value = ch;
    x.value = (dispW - cw) / 2; y.value = (dispH - ch) / 2;
  }, [size, ratio, dispW, dispH]);

  const begin = () => {
    'worklet';
    sx.value = x.value; sy.value = y.value; sw.value = w.value; sh.value = h.value;
  };

  // Köşe sürükleme: karşı köşe sabit kalır. dirX/dirY köşenin yönü (-1 sol/üst, 1 sağ/alt).
  const corner = (dirX: number, dirY: number) =>
    Gesture.Pan()
      .onBegin(begin)
      .onUpdate(e => {
        'worklet';
        const ax = dirX > 0 ? sx.value : sx.value + sw.value;
        const ay = dirY > 0 ? sy.value : sy.value + sh.value;
        const maxW = dirX > 0 ? bw.value - ax : ax;
        const maxH = dirY > 0 ? bh.value - ay : ay;
        let nw = Math.min(Math.max(sw.value + dirX * e.translationX, MIN), maxW);
        let nh = Math.min(Math.max(sh.value + dirY * e.translationY, MIN), maxH);
        if (rr.value > 0) {
          nh = nw / rr.value;
          if (nh > maxH) { nh = maxH; nw = nh * rr.value; }
          if (nh < MIN) { nh = MIN; nw = nh * rr.value; }
          if (nw > maxW) { nw = maxW; nh = nw / rr.value; }
        }
        w.value = nw; h.value = nh;
        x.value = dirX > 0 ? ax : ax - nw;
        y.value = dirY > 0 ? ay : ay - nh;
      });

  // Kutunun içinden sürükleyince kutu taşınır
  const move = Gesture.Pan()
    .onBegin(begin)
    .onUpdate(e => {
      'worklet';
      x.value = Math.min(Math.max(sx.value + e.translationX, 0), bw.value - w.value);
      y.value = Math.min(Math.max(sy.value + e.translationY, 0), bh.value - h.value);
    });

  const tl = corner(-1, -1), tr = corner(1, -1), bl = corner(-1, 1), br = corner(1, 1);

  const boxStyle = useAnimatedStyle(() => ({ left: x.value, top: y.value, width: w.value, height: h.value }));
  const shadeTop = useAnimatedStyle(() => ({ left: 0, top: 0, width: bw.value, height: y.value }));
  const shadeBottom = useAnimatedStyle(() => ({ left: 0, top: y.value + h.value, width: bw.value, height: Math.max(0, bh.value - y.value - h.value) }));
  const shadeLeft = useAnimatedStyle(() => ({ left: 0, top: y.value, width: x.value, height: h.value }));
  const shadeRight = useAnimatedStyle(() => ({ left: x.value + w.value, top: y.value, width: Math.max(0, bw.value - x.value - w.value), height: h.value }));

  async function rotate() {
    if (!src || busy) return;
    setBusy(true);
    try {
      const ctx = ImageManipulator.manipulate(src);
      ctx.rotate(90);
      const img = await ctx.renderAsync();
      const res = await img.saveAsync({ format: SaveFormat.JPEG, compress: 0.92 });
      setSrc(res.uri);
    } catch (e) {
      Alert.alert(t('edit.failed'), String(e));
    } finally {
      setBusy(false);
    }
  }

  async function done() {
    if (!src || !size || busy) return;
    setBusy(true);
    try {
      const ox = Math.max(0, Math.round(x.value / scale));
      const oy = Math.max(0, Math.round(y.value / scale));
      const cw = Math.min(size.w - ox, Math.round(w.value / scale));
      const ch = Math.min(size.h - oy, Math.round(h.value / scale));
      const whole = ox <= 1 && oy <= 1 && cw >= size.w - 2 && ch >= size.h - 2;
      if (whole) {
        onDone(src); // sadece döndürüldüyse (ya da hiç değişmediyse) olduğu gibi
        return;
      }
      const ctx = ImageManipulator.manipulate(src);
      ctx.crop({ originX: ox, originY: oy, width: cw, height: ch });
      const img = await ctx.renderAsync();
      const res = await img.saveAsync({ format: SaveFormat.JPEG, compress: 0.9 });
      onDone(res.uri);
    } catch (e) {
      Alert.alert(t('edit.failed'), String(e));
    } finally {
      setBusy(false);
    }
  }

  // Tutamaçlar kutunun içinde durur (Android, ebeveyn dışındaki dokunuşları almaz)
  const corners = [
    { g: tl, style: { left: 0, top: 0 }, mark: { left: -2, top: -2, borderLeftWidth: 4, borderTopWidth: 4 } },
    { g: tr, style: { right: 0, top: 0 }, mark: { right: -2, top: -2, borderRightWidth: 4, borderTopWidth: 4 } },
    { g: bl, style: { left: 0, bottom: 0 }, mark: { left: -2, bottom: -2, borderLeftWidth: 4, borderBottomWidth: 4 } },
    { g: br, style: { right: 0, bottom: 0 }, mark: { right: -2, bottom: -2, borderRightWidth: 4, borderBottomWidth: 4 } },
  ];
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onCancel}>
      {/* Modal kendi kök görünümünde açıldığı için hareketler burada ayrıca etkinleştirilir */}
      <GestureHandlerRootView style={[s.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={s.top}>
          <Pressable onPress={onCancel} hitSlop={12}>
            <Text style={s.topText}>{t('common.cancel')}</Text>
          </Pressable>
          <Text style={s.topTitle}>{t('edit.title')}</Text>
          <Pressable onPress={done} hitSlop={12} disabled={busy || !size}>
            <Text style={[s.topText, s.topDone]}>{t('edit.done')}</Text>
          </Pressable>
        </View>

        <View style={s.area}>
          {src && size ? (
            <View style={{ width: dispW, height: dispH }}>
              <Image source={{ uri: src }} style={{ width: dispW, height: dispH }} />
              {[shadeTop, shadeBottom, shadeLeft, shadeRight].map((st, i) => (
                <Animated.View key={i} pointerEvents="none" style={[s.shade, st]} />
              ))}
              <Animated.View style={[s.box, boxStyle]}>
                <GestureDetector gesture={move}>
                  <View style={StyleSheet.absoluteFill}>
                    {/* Üçte bir çizgileri */}
                    <View pointerEvents="none" style={[s.gridV, { left: '33.33%' }]} />
                    <View pointerEvents="none" style={[s.gridV, { left: '66.66%' }]} />
                    <View pointerEvents="none" style={[s.gridH, { top: '33.33%' }]} />
                    <View pointerEvents="none" style={[s.gridH, { top: '66.66%' }]} />
                  </View>
                </GestureDetector>
                {corners.map((c, i) => (
                  <GestureDetector key={i} gesture={c.g}>
                    <View style={[s.handle, c.style]}>
                      <View pointerEvents="none" style={[s.mark, c.mark]} />
                    </View>
                  </GestureDetector>
                ))}
              </Animated.View>
            </View>
          ) : (
            <ActivityIndicator color="#FFFFFF" />
          )}
          {busy && (
            <View style={s.busy}>
              <ActivityIndicator color="#FFFFFF" size="large" />
            </View>
          )}
        </View>

        <View style={s.bottom}>
          <View style={s.ratios}>
            {RATIOS.map(o => {
              const on = (o.r ?? null) === ratio;
              return (
                <Pressable key={o.key} onPress={() => setRatio(o.r)} style={[s.ratio, on && s.ratioOn]} hitSlop={4}>
                  <Text style={[s.ratioText, on && s.ratioTextOn]}>{o.label}</Text>
                </Pressable>
              );
            })}
          </View>
          <Pressable onPress={rotate} style={s.rotate} hitSlop={8} accessibilityLabel={t('edit.rotate')}>
            <Ionicons name="refresh" size={22} color="#FFFFFF" style={{ transform: [{ scaleX: -1 }] }} />
            <Text style={s.rotateText}>{t('edit.rotate')}</Text>
          </Pressable>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000000' },
  top: { height: TOP_BAR, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20 },
  topText: { fontFamily: F.semi, fontSize: 16, color: '#FFFFFF' },
  topDone: { fontFamily: F.bold, color: '#FFD84D' },
  topTitle: { fontFamily: F.bold, fontSize: 16, color: '#FFFFFF' },
  area: { flex: 1, alignItems: 'center', justifyContent: 'center', margin: 16 },
  shade: { position: 'absolute', backgroundColor: 'rgba(0,0,0,0.6)' },
  box: { position: 'absolute', borderWidth: 1.5, borderColor: '#FFFFFF' },
  gridV: { position: 'absolute', top: 0, bottom: 0, width: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.5)' },
  gridH: { position: 'absolute', left: 0, right: 0, height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.5)' },
  handle: { position: 'absolute', width: HANDLE, height: HANDLE },
  mark: { position: 'absolute', width: 22, height: 22, borderColor: '#FFFFFF' },
  busy: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.4)' },
  bottom: { height: BOTTOM_BAR, paddingHorizontal: 20, justifyContent: 'center', gap: 18 },
  ratios: { flexDirection: 'row', justifyContent: 'center', gap: 8 },
  ratio: { paddingHorizontal: 12, paddingVertical: 7, borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)' },
  ratioOn: { backgroundColor: '#FFFFFF', borderColor: '#FFFFFF' },
  ratioText: { fontFamily: F.semi, fontSize: 13, color: '#FFFFFF' },
  ratioTextOn: { color: '#000000' },
  rotate: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, alignSelf: 'center', padding: 8 },
  rotateText: { fontFamily: F.semi, fontSize: 14, color: '#FFFFFF' },
});
