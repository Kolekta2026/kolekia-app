import { useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Image, Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { captureRef } from 'react-native-view-shot';
import { Ionicons } from '@expo/vector-icons';
import { F } from '../constants/theme';
import { APP_NAME } from '../constants/brand';
import { useI18n } from '../lib/i18n';
import { useTheme } from '../lib/theme';
import { shareUri } from '../lib/share';

export type StoryItem = {
  title: string;
  collection: string;
  photo: string | null;
  lines: { k: string; v: string }[]; // en fazla 3 özellik; değerler (fiyat) hiç konmaz
};

// Hikâye görselinin renkleri: zemin + yazı. Fotoğraf çerçevesi yazı renginde olur.
// İlk seçenek uygulamada seçili renk teması (tek renkli temada eklenmez).
type Swatch = { bg: string; ink: string };
const STYLES: Swatch[] = [
  { bg: '#0D0D0D', ink: '#FFFFFF' },
  { bg: '#FFFFFF', ink: '#0D0D0D' },
  { bg: '#F4EEE3', ink: '#111111' },
  { bg: '#FFE600', ink: '#0B2A5B' },
  { bg: '#A6192E', ink: '#FDB913' },
  { bg: '#6E1A37', ink: '#8FCBF0' },
  { bg: '#C8102E', ink: '#FFFFFF' },
  { bg: '#0050A8', ink: '#FFFFFF' },
  { bg: '#00703C', ink: '#FFFFFF' },
  { bg: '#0B2A5B', ink: '#FF7A1A' },
  { bg: '#5E35B1', ink: '#FFE600' },
  { bg: '#FF4F9A', ink: '#FFFFFF' },
  { bg: '#8EE3C8', ink: '#111111' },
  { bg: '#E4F2FC', ink: '#6E1A37' },
  { bg: '#2B2B2B', ink: '#C9A86A' },
];

// Parçadan 1080×1920 hikâye görseli: önce önizleme, sonra sistem paylaşım menüsü
// (Instagram'da "Hikâye" seçilince doğrudan hikâye ekranı açılır)
export function StoryShare({ item, visible, onClose }: { item: StoryItem; visible: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const ref = useRef<View>(null);
  const { C, colorTheme } = useTheme();
  const swatches = colorTheme !== 'mono' ? [{ bg: C.white, ink: C.black }, ...STYLES] : STYLES;
  const [styleIdx, setStyleIdx] = useState(0);
  const [busy, setBusy] = useState(false);

  // Önizleme ekrana sığacak boyutta; çıktı her zaman 1080×1920
  const w = Math.min(width - 64, (height - insets.top - insets.bottom - 200) * (9 / 16));
  const u = w / 360;
  const sw = swatches[Math.min(styleIdx, swatches.length - 1)];
  const st = { bg: sw.bg, ink: sw.ink, card: sw.ink, cardInk: sw.bg };

  async function share() {
    if (!ref.current) return;
    setBusy(true);
    try {
      const uri = await captureRef(ref, { format: 'png', width: 1080, height: 1920, result: 'tmpfile' });
      await shareUri(uri, 'image/png', 'public.png');
    } catch (e) {
      Alert.alert(t('story.failed'), String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <View style={[s.screen, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 16 }]}>
        <View style={s.top}>
          <Pressable onPress={onClose} hitSlop={12} accessibilityLabel={t('common.close')}>
            <Ionicons name="close" size={28} color="#FFFFFF" />
          </Pressable>
          <Text style={s.heading}>{t('story.title')}</Text>
          <View style={{ width: 28 }} />
        </View>

        <View style={s.center}>
          <View
            ref={ref}
            collapsable={false}
            style={{ width: w, height: w * (16 / 9), backgroundColor: st.bg, padding: 24 * u }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 * u }}>
              <View style={{ width: 26 * u, height: 26 * u, backgroundColor: st.ink, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontFamily: F.black, fontSize: 19 * u, lineHeight: 23 * u, color: st.bg }}>K</Text>
              </View>
              <Text style={{ fontFamily: F.black, fontSize: 21 * u, letterSpacing: -0.6 * u, color: st.ink }}>{APP_NAME}</Text>
            </View>

            <Text style={{ fontFamily: F.bold, fontSize: 13 * u, color: st.ink, opacity: 0.7, marginTop: 34 * u }}>
              {t('story.kicker')}
            </Text>

            <View style={{ marginTop: 12 * u, borderWidth: 6 * u, borderColor: st.card, backgroundColor: st.card }}>
              {item.photo ? (
                <Image source={{ uri: item.photo }} style={{ width: '100%', aspectRatio: 1 }} />
              ) : (
                <View style={{ width: '100%', aspectRatio: 1, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ fontFamily: F.black, fontSize: 120 * u, color: st.cardInk, opacity: 0.25 }}>
                    {item.title.charAt(0).toLocaleUpperCase('tr')}
                  </Text>
                </View>
              )}
            </View>

            <Text
              numberOfLines={3}
              style={{ fontFamily: F.black, fontSize: 30 * u, lineHeight: 32 * u, letterSpacing: -1 * u, color: st.ink, marginTop: 18 * u }}
            >
              {item.title}
            </Text>
            <Text numberOfLines={1} style={{ fontFamily: F.semi, fontSize: 14 * u, color: st.ink, opacity: 0.7, marginTop: 6 * u }}>
              {item.collection}
            </Text>

            <View style={{ marginTop: 14 * u, gap: 6 * u }}>
              {item.lines.slice(0, 3).map(l => (
                <View key={l.k} style={{ flexDirection: 'row', gap: 8 * u }}>
                  <Text numberOfLines={1} style={{ fontFamily: F.regular, fontSize: 13 * u, color: st.ink, opacity: 0.65, flexShrink: 0, maxWidth: '45%' }}>{l.k}</Text>
                  <Text numberOfLines={1} style={{ fontFamily: F.bold, fontSize: 13 * u, color: st.ink, flexShrink: 1 }}>{l.v}</Text>
                </View>
              ))}
            </View>

            <Text style={{ position: 'absolute', left: 24 * u, bottom: 24 * u, fontFamily: F.bold, fontSize: 13 * u, color: st.ink, opacity: 0.8 }}>
              kolekia.app
            </Text>
          </View>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={s.stylesWrap}
          contentContainerStyle={s.styles}
        >
          {swatches.map((x, i) => (
            <Pressable
              key={`${x.bg}-${x.ink}-${i}`}
              onPress={() => setStyleIdx(i)}
              style={[s.swatch, { backgroundColor: x.bg }, i === styleIdx && s.swatchOn]}
              accessibilityLabel={`${t('story.style')} ${i + 1}`}
            >
              <View style={{ width: 16, height: 16, backgroundColor: x.ink }} />
            </Pressable>
          ))}
        </ScrollView>

        <Pressable onPress={share} disabled={busy} style={({ pressed }) => [s.button, pressed && { opacity: 0.85 }]}>
          {busy ? <ActivityIndicator color="#000000" /> : (
            <>
              <Ionicons name="logo-instagram" size={20} color="#000000" />
              <Text style={s.buttonText}>{t('story.share')}</Text>
            </>
          )}
        </Pressable>
        <Text style={s.hint}>{t('story.hint')}</Text>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#1A1A1A', paddingHorizontal: 20 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heading: { fontFamily: F.bold, fontSize: 16, color: '#FFFFFF' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  stylesWrap: { flexGrow: 0, marginHorizontal: -20, marginBottom: 14 },
  styles: { flexDirection: 'row', gap: 10, paddingHorizontal: 20 },
  swatch: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'transparent' },
  swatchOn: { borderColor: '#FFFFFF' },
  button: {
    height: 54, backgroundColor: '#FFFFFF', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
  },
  buttonText: { fontFamily: F.bold, fontSize: 16, color: '#000000' },
  hint: { fontFamily: F.regular, fontSize: 12, color: '#AAAAAA', textAlign: 'center', marginTop: 10 },
});
