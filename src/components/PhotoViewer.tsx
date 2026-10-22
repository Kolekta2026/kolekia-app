import { useRef, useState } from 'react';
import {
  FlatList, Image, Modal, Platform, Pressable, ScrollView, StatusBar, StyleSheet, Text,
  useWindowDimensions, View,
} from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { F } from '../constants/theme';
import { Palette, useStyles, useTheme } from '../lib/theme';
import { useI18n } from '../lib/i18n';

const MAX_ZOOM = 5;
const DOUBLE_TAP_ZOOM = 2.5;
const DOUBLE_TAP_MS = 260;
const DISMISS_DISTANCE = 120;
const DISMISS_VELOCITY = 900;

// Tam ekran fotoğraf görüntüleyici: iki parmakla yakınlaştırma,
// çift dokunuşla yakınlaştır/uzaklaştır, yatay kaydırarak fotoğraflar arası geçiş,
// aşağı kaydırarak kapatma (yakınlaştırılmışken kapanmaz).
export function PhotoViewer({ photos, index, visible, onClose }: {
  photos: string[];
  index: number;
  visible: boolean;
  onClose: () => void;
}) {
  const { C } = useTheme();
  const s = useStyles(makeStyles);
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const [page, setPage] = useState(index);
  const [zoomed, setZoomed] = useState(false);

  // Aşağı kaydırarak kapatma: fotoğraf parmağı izler, zemin giderek şeffaflaşır
  const dragY = useSharedValue(0);
  // iPhone'da fotoğraflar yerel ScrollView içinde (yakınlaştırma için); dikey hareketi o yakalar.
  // Orada kapatma ScrollView'un aşağı esnemesiyle yapılır (pull), Android'de bu el hareketiyle.
  const pull = useSharedValue(0);
  const dismiss = Gesture.Pan()
    .enabled(!zoomed && Platform.OS === 'android')
    .activeOffsetY(18)
    .failOffsetY(-18)
    .failOffsetX([-18, 18])
    .onUpdate(e => {
      dragY.value = Math.max(0, e.translationY);
    })
    .onEnd(e => {
      if (dragY.value > DISMISS_DISTANCE || e.velocityY > DISMISS_VELOCITY) {
        dragY.value = withTiming(height, { duration: 180 }, done => {
          if (done) runOnJS(onClose)();
        });
      } else {
        dragY.value = withSpring(0, { damping: 18, stiffness: 220 });
      }
    });
  const contentStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: dragY.value },
      { scale: 1 - Math.min(dragY.value / height, 1) * 0.15 },
    ],
  }));
  const fadeStyle = useAnimatedStyle(() => ({
    opacity: 1 - Math.min((dragY.value + pull.value) / (height * 0.6), 1),
  }));
  const onPull = (dy: number) => { pull.value = Math.max(0, dy); };
  const onPullEnd = (dy: number, vy: number) => {
    if (dy > DISMISS_DISTANCE * 0.8 || (dy > 20 && vy > 1.2)) onClose();
    else pull.value = withTiming(0, { duration: 150 });
  };

  return (
    <Modal
      visible={visible}
      animationType="fade"
      presentationStyle="overFullScreen"
      transparent
      onRequestClose={onClose}
      onShow={() => {
        setPage(index);
        setZoomed(false);
        dragY.value = 0;
        pull.value = 0;
      }}
    >
      <StatusBar hidden />
      {/* Android'de hareketlerin Modal içinde çalışması için kök görünüm gerekiyor */}
      <GestureHandlerRootView style={s.root}>
        <Animated.View style={[StyleSheet.absoluteFill, s.backdrop, fadeStyle]} pointerEvents="none" />
        <GestureDetector gesture={dismiss}>
        <Animated.View style={[{ flex: 1 }, contentStyle]}>
        <FlatList
          data={photos}
          keyExtractor={(u, i) => `${i}-${u}`}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          initialScrollIndex={index}
          getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
          onMomentumScrollEnd={e => setPage(Math.round(e.nativeEvent.contentOffset.x / width))}
          scrollEnabled={!zoomed}
          renderItem={({ item }) =>
            Platform.OS === 'android' ? (
              <ZoomableAndroid uri={item} width={width} height={height} onZoomChange={setZoomed} />
            ) : (
              <ZoomablePhoto
                uri={item} width={width} height={height}
                onZoomChange={setZoomed} onPull={onPull} onPullEnd={onPullEnd}
              />
            )
          }
        />
        </Animated.View>
        </GestureDetector>

        <Animated.View style={[s.topBar, { paddingTop: insets.top + 8 }, fadeStyle]} pointerEvents="box-none">
          <Text style={s.counter}>
            {photos.length > 1 ? `${page + 1} / ${photos.length}` : ''}
          </Text>
          <Pressable onPress={onClose} hitSlop={14} style={s.closeButton}>
            <Text style={s.closeText}>{t('common.close')}</Text>
          </Pressable>
        </Animated.View>
      </GestureHandlerRootView>
    </Modal>
  );
}

// Android: iki parmakla yakınlaştırma, yakınken kaydırma ve çift dokunuş hareketlerle kuruluyor
// (iPhone'daki ScrollView yakınlaştırması Android'de yok)
function ZoomableAndroid({ uri, width, height, onZoomChange }: {
  uri: string;
  width: number;
  height: number;
  onZoomChange: (z: boolean) => void;
}) {
  const scale = useSharedValue(1);
  const saved = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const sx = useSharedValue(0);
  const sy = useSharedValue(0);
  const [zoomed, setZoomed] = useState(false);

  const report = (z: boolean) => {
    setZoomed(z);
    onZoomChange(z);
  };
  const clamp = (v: number, sc: number, size: number) => {
    'worklet';
    const max = (size * (sc - 1)) / 2;
    return Math.min(max, Math.max(-max, v));
  };
  const reset = () => {
    'worklet';
    scale.value = withTiming(1);
    saved.value = 1;
    tx.value = withTiming(0);
    ty.value = withTiming(0);
    sx.value = 0;
    sy.value = 0;
    runOnJS(report)(false);
  };

  const pinch = Gesture.Pinch()
    .onUpdate(e => {
      scale.value = Math.min(MAX_ZOOM, Math.max(1, saved.value * e.scale));
    })
    .onEnd(() => {
      saved.value = scale.value;
      if (scale.value <= 1.02) reset();
      else runOnJS(report)(true);
    });

  const pan = Gesture.Pan()
    .enabled(zoomed)
    .averageTouches(true)
    .onUpdate(e => {
      tx.value = clamp(sx.value + e.translationX, scale.value, width);
      ty.value = clamp(sy.value + e.translationY, scale.value, height);
    })
    .onEnd(() => {
      sx.value = tx.value;
      sy.value = ty.value;
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(e => {
      if (saved.value > 1) {
        reset();
        return;
      }
      const z = DOUBLE_TAP_ZOOM;
      const nx = clamp((width / 2 - e.x) * (z - 1), z, width);
      const ny = clamp((height / 2 - e.y) * (z - 1), z, height);
      scale.value = withTiming(z);
      saved.value = z;
      tx.value = withTiming(nx);
      ty.value = withTiming(ny);
      sx.value = nx;
      sy.value = ny;
      runOnJS(report)(true);
    });

  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));

  return (
    <GestureDetector gesture={Gesture.Simultaneous(pinch, pan, doubleTap)}>
      <Animated.View style={{ width, height, overflow: 'hidden' }}>
        <Animated.Image source={{ uri }} style={[{ width, height }, style]} resizeMode="contain" />
      </Animated.View>
    </GestureDetector>
  );
}

function ZoomablePhoto({ uri, width, height, onZoomChange, onPull, onPullEnd }: {
  uri: string; width: number; height: number; onZoomChange: (z: boolean) => void;
  onPull: (dy: number) => void; onPullEnd: (dy: number, vy: number) => void;
}) {
  const { C } = useTheme();
  const s = useStyles(makeStyles);
  const scrollRef = useRef<ScrollView>(null);
  const zoom = useRef(1);
  const lastTap = useRef(0);

  function handlePress(e: { nativeEvent: { locationX: number; locationY: number } }) {
    const now = Date.now();
    if (now - lastTap.current < DOUBLE_TAP_MS) {
      lastTap.current = 0;
      const sv = scrollRef.current as any;
      if (zoom.current > 1.05) {
        sv?.scrollResponderZoomTo?.({ x: 0, y: 0, width, height, animated: true });
      } else {
        const w = width / DOUBLE_TAP_ZOOM;
        const h = height / DOUBLE_TAP_ZOOM;
        const { locationX, locationY } = e.nativeEvent;
        sv?.scrollResponderZoomTo?.({
          x: locationX - w / 2,
          y: locationY - h / 2,
          width: w,
          height: h,
          animated: true,
        });
      }
    } else {
      lastTap.current = now;
    }
  }

  return (
    <ScrollView
      ref={scrollRef}
      style={{ width, height }}
      contentContainerStyle={{ width, height }}
      maximumZoomScale={MAX_ZOOM}
      minimumZoomScale={1}
      bouncesZoom
      centerContent
      showsHorizontalScrollIndicator={false}
      showsVerticalScrollIndicator={false}
      alwaysBounceVertical
      scrollEventThrottle={16}
      onScrollEndDrag={e => {
        // Yakınlaştırılmamışken aşağı çekilip bırakılırsa kapanır
        if (zoom.current > 1.05) return;
        const dy = -e.nativeEvent.contentOffset.y;
        const vy = -(e.nativeEvent.velocity?.y ?? 0);
        onPullEnd(dy, vy);
      }}
      onScroll={e => {
        if (zoom.current <= 1.05) onPull(-e.nativeEvent.contentOffset.y);
        const z = e.nativeEvent.zoomScale ?? 1;
        // Yakınlaştırma durumu değişince üst bileşene bildirilir (yakınken aşağı kaydırma kapatmaz)
        if ((z > 1.05) !== (zoom.current > 1.05)) onZoomChange(z > 1.05);
        zoom.current = z;
      }}
    >
      <Pressable onPress={handlePress}>
        <Image source={{ uri }} style={{ width, height }} resizeMode="contain" />
      </Pressable>
    </ScrollView>
  );
}

const makeStyles = (C: Palette) => StyleSheet.create({
  root: { flex: 1, backgroundColor: 'transparent' },
  backdrop: { backgroundColor: '#000000' }, // görüntüleyici her zaman karanlık
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  counter: { fontFamily: F.bold, fontSize: 15, color: '#FFFFFF' },
  closeButton: { paddingVertical: 6 },
  closeText: { fontFamily: F.bold, fontSize: 16, color: '#FFFFFF' },
});
