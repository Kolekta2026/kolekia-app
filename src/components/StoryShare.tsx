import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Image, Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { captureRef } from 'react-native-view-shot';
import { Ionicons } from '@expo/vector-icons';
import { useSQLiteContext } from 'expo-sqlite';
import { contrast, F, PICKER_COLORS } from '../constants/theme';
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

type Format = 'story' | 'x';
// Çıktı boyutları: Instagram hikâyesi 1080×1920, X gönderisi 1600×900 (16:9)
const OUT: Record<Format, { w: number; h: number }> = { story: { w: 1080, h: 1920 }, x: { w: 1600, h: 900 } };

// Kullanıcının kendi seçtiği zemin/yazı rengi; ayarlarda saklanır, bir sonraki paylaşımda hatırlanır
const CUSTOM_KEY = 'story_custom';
const DEFAULT_STORY_CUSTOM: [string, string] = ['#0B2A5B', '#FDB913'];
const isHex = (x: string) => /^#[0-9A-F]{6}$/i.test(x);

// Parçadan paylaşım görseli: önce önizleme, sonra sistem paylaşım menüsü
// (Instagram'da "Hikâye" seçilince doğrudan hikâye ekranı açılır; X'te görsel gönderiye eklenir)
export function StoryShare({ item, visible, onClose }: { item: StoryItem; visible: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const ref = useRef<View>(null);
  const { C, colorTheme } = useTheme();
  const swatches = colorTheme !== 'mono' ? [{ bg: C.white, ink: C.black }, ...STYLES] : STYLES;
  const db = useSQLiteContext();
  const [styleIdx, setStyleIdx] = useState(0);
  const [custom, setCustom] = useState<[string, string]>(DEFAULT_STORY_CUSTOM);
  const [slotPick, setSlotPick] = useState<0 | 1>(0);
  const customIdx = swatches.length; // listenin sonundaki "kendi renklerin" kutusu
  const customOn = styleIdx === customIdx;

  useEffect(() => {
    if (!visible) return;
    db.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key = ?', CUSTOM_KEY)
      .then(r => {
        const [bg, ink] = (r?.value ?? '').split(',');
        if (bg && ink && isHex(bg) && isHex(ink)) setCustom([bg, ink]);
      })
      .catch(() => {});
  }, [visible, db]);

  function saveCustom(next: [string, string]) {
    setCustom(next);
    db.runAsync('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', CUSTOM_KEY, next.join(',')).catch(() => {});
  }

  function pickColor(c: string) {
    saveCustom(slotPick === 0 ? [c, custom[1]] : [custom[0], c]);
  }
  const [format, setFormat] = useState<Format>('story');
  const [busy, setBusy] = useState(false);
  // Fotoğraf kalan alana sığan en büyük kare olur; böylece uzun başlıkta alttaki yazılar üst üste binmez
  const [slot, setSlot] = useState<{ w: number; h: number } | null>(null);

  // Önizleme ekrana sığacak boyutta; çıktı her zaman OUT boyutunda.
  // u: tasarım birimi (hikâye 360×640, X 640×360 üzerinden)
  const avail = height - insets.top - insets.bottom - 270 - (customOn ? 104 : 0);
  const isX = format === 'x';
  const w = isX ? Math.min(width - 40, avail * (16 / 9)) : Math.min(width - 64, avail * (9 / 16));
  const h = isX ? w * (9 / 16) : w * (16 / 9);
  const u = w / (isX ? 640 : 360);
  const sw = customOn ? { bg: custom[0], ink: custom[1] } : swatches[Math.min(styleIdx, swatches.length - 1)];
  const st = { bg: sw.bg, ink: sw.ink, card: sw.ink, cardInk: sw.bg };
  const side = slot ? Math.max(0, Math.min(slot.w, slot.h)) : 0;

  function pickFormat(f: Format) {
    if (f === format) return;
    setSlot(null);
    setFormat(f);
  }

  async function share() {
    if (!ref.current) return;
    setBusy(true);
    try {
      const uri = await captureRef(ref, { format: 'png', width: OUT[format].w, height: OUT[format].h, result: 'tmpfile' });
      await shareUri(uri, 'image/png', 'public.png');
    } catch (e) {
      Alert.alert(t('story.failed'), String(e));
    } finally {
      setBusy(false);
    }
  }

  const brand = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 * u }}>
      <View style={{ width: 26 * u, height: 26 * u, backgroundColor: st.ink, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontFamily: F.black, fontSize: 19 * u, lineHeight: 23 * u, color: st.bg }}>K</Text>
      </View>
      <Text style={{ fontFamily: F.black, fontSize: 21 * u, letterSpacing: -0.6 * u, color: st.ink }}>{APP_NAME}</Text>
    </View>
  );

  const kicker = (top: number) => (
    <Text style={{ fontFamily: F.bold, fontSize: 13 * u, color: st.ink, opacity: 0.7, marginTop: top * u }}>
      {t('story.kicker')}
    </Text>
  );

  const photo = (size: number) => (
    <View style={{ width: size, height: size, borderWidth: 6 * u, borderColor: st.card, backgroundColor: st.card }}>
      {item.photo ? (
        <Image source={{ uri: item.photo }} style={{ flex: 1 }} />
      ) : (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontFamily: F.black, fontSize: size * 0.38, color: st.cardInk, opacity: 0.25 }}>
            {item.title.charAt(0).toLocaleUpperCase('tr')}
          </Text>
        </View>
      )}
    </View>
  );

  const details = (titleSize: number) => (
    <>
      <Text
        numberOfLines={3}
        style={{ fontFamily: F.black, fontSize: titleSize * u, lineHeight: (titleSize + 2) * u, letterSpacing: -1 * u, color: st.ink, marginTop: 18 * u }}
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
    </>
  );

  // Alt bilgi akışın içinde, en altta: içerik uzasa da alanların üstüne binmez
  const footer = (
    <Text style={{ fontFamily: F.bold, fontSize: 13 * u, color: st.ink, opacity: 0.8, marginTop: 14 * u }}>
      kolekia.app
    </Text>
  );

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <View style={[s.screen, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 16 }]}>
        <View style={s.top}>
          <Pressable onPress={onClose} hitSlop={12} accessibilityLabel={t('common.close')}>
            <Ionicons name="close" size={28} color="#FFFFFF" />
          </Pressable>
          <Text style={s.heading}>{t(isX ? 'story.titleX' : 'story.title')}</Text>
          <View style={{ width: 28 }} />
        </View>

        <View style={s.formats}>
          {(['story', 'x'] as Format[]).map(f => (
            <Pressable
              key={f}
              onPress={() => pickFormat(f)}
              style={[s.format, f === format && s.formatOn]}
              accessibilityRole="button"
              accessibilityState={{ selected: f === format }}
            >
              <Ionicons name={f === 'x' ? 'logo-x' : 'logo-instagram'} size={16} color={f === format ? '#000000' : '#FFFFFF'} />
              <Text style={[s.formatText, f === format && { color: '#000000' }]}>{t(f === 'x' ? 'story.fmtX' : 'story.fmtStory')}</Text>
            </Pressable>
          ))}
        </View>

        <View style={s.center}>
          <View
            ref={ref}
            collapsable={false}
            style={{ width: w, height: h, backgroundColor: st.bg, padding: 24 * u, flexDirection: isX ? 'row' : 'column' }}
          >
            {isX ? (
              <>
                {photo(h - 48 * u)}
                <View style={{ flex: 1, marginLeft: 24 * u }}>
                  {brand}
                  {kicker(26)}
                  {details(26)}
                  <View style={{ flex: 1 }} />
                  {footer}
                </View>
              </>
            ) : (
              <>
                {brand}
                {kicker(34)}
                <View
                  style={{ flex: 1, marginTop: 12 * u, minHeight: 0 }}
                  onLayout={e => {
                    const { width: lw, height: lh } = e.nativeEvent.layout;
                    if (!slot || Math.abs(slot.w - lw) > 0.5 || Math.abs(slot.h - lh) > 0.5) setSlot({ w: lw, h: lh });
                  }}
                >
                  {side > 0 && photo(side)}
                </View>
                {details(30)}
                {footer}
              </>
            )}
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
          <Pressable
            onPress={() => setStyleIdx(customIdx)}
            style={[s.swatch, { backgroundColor: custom[0] }, customOn && s.swatchOn]}
            accessibilityLabel={t('story.custom')}
          >
            <View style={{ width: 16, height: 16, backgroundColor: custom[1] }} />
            <View style={s.editBadge}>
              <Ionicons name="color-palette" size={11} color="#000000" />
            </View>
          </Pressable>
        </ScrollView>

        {customOn && (
          <View style={s.customPanel}>
            <View style={s.slotRow}>
              {([0, 1] as const).map(i => (
                <Pressable
                  key={i}
                  onPress={() => setSlotPick(i)}
                  style={[s.slot, slotPick === i && s.slotOn]}
                  accessibilityState={{ selected: slotPick === i }}
                >
                  <View style={[s.slotChip, { backgroundColor: custom[i] }]} />
                  <Text style={[s.slotText, slotPick === i && { color: '#FFFFFF' }]}>{t(i === 0 ? 'story.bg' : 'story.ink')}</Text>
                </Pressable>
              ))}
              <Pressable
                onPress={() => saveCustom([custom[1], custom[0]])}
                hitSlop={8}
                style={s.swapBtn}
                accessibilityLabel={t('custom.swap')}
              >
                <Ionicons name="swap-horizontal" size={22} color="#FFFFFF" />
              </Pressable>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.palette}>
              {PICKER_COLORS.map(c => {
                const on = custom[slotPick].toUpperCase() === c.toUpperCase();
                return (
                  <Pressable key={c} onPress={() => pickColor(c)} accessibilityLabel={c} style={[s.cell, { backgroundColor: c }, on && s.cellOn]}>
                    {on && <Ionicons name="checkmark" size={14} color={contrast(c, '#000000') > 7 ? '#000000' : '#FFFFFF'} />}
                  </Pressable>
                );
              })}
            </ScrollView>
            {contrast(custom[0], custom[1]) < 2 && <Text style={s.weak}>{t('custom.weak')}</Text>}
          </View>
        )}

        <Pressable onPress={share} disabled={busy} style={({ pressed }) => [s.button, pressed && { opacity: 0.85 }]}>
          {busy ? <ActivityIndicator color="#000000" /> : (
            <>
              <Ionicons name={isX ? 'logo-x' : 'logo-instagram'} size={20} color="#000000" />
              <Text style={s.buttonText}>{t('story.share')}</Text>
            </>
          )}
        </Pressable>
        <Text style={s.hint}>{t(isX ? 'story.hintX' : 'story.hint')}</Text>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#1A1A1A', paddingHorizontal: 20 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heading: { fontFamily: F.bold, fontSize: 16, color: '#FFFFFF' },
  formats: { flexDirection: 'row', gap: 8, marginTop: 14, alignSelf: 'center' },
  format: {
    flexDirection: 'row', alignItems: 'center', gap: 6, height: 34, paddingHorizontal: 14,
    borderWidth: 1, borderColor: '#555555',
  },
  formatOn: { backgroundColor: '#FFFFFF', borderColor: '#FFFFFF' },
  formatText: { fontFamily: F.bold, fontSize: 13, color: '#FFFFFF' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  stylesWrap: { flexGrow: 0, marginHorizontal: -20, marginBottom: 14 },
  styles: { flexDirection: 'row', gap: 10, paddingHorizontal: 20 },
  swatch: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'transparent' },
  swatchOn: { borderColor: '#FFFFFF' },
  editBadge: {
    position: 'absolute', right: -1, bottom: -1, width: 16, height: 16, backgroundColor: '#FFFFFF',
    alignItems: 'center', justifyContent: 'center',
  },
  customPanel: { marginTop: -4, marginBottom: 14 },
  slotRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  slot: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, height: 38, paddingHorizontal: 10,
    borderWidth: 1, borderColor: '#444444',
  },
  slotOn: { borderColor: '#FFFFFF' },
  slotChip: { width: 20, height: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)' },
  slotText: { fontFamily: F.semi, fontSize: 13, color: '#AAAAAA' },
  swapBtn: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  palette: { flexDirection: 'row', gap: 6, paddingTop: 10, paddingRight: 20 },
  cell: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)' },
  cellOn: { borderWidth: 2.5, borderColor: '#FFFFFF' },
  weak: { fontFamily: F.regular, fontSize: 11, color: '#E0A0A0', marginTop: 8, lineHeight: 15 },
  button: {
    height: 54, backgroundColor: '#FFFFFF', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
  },
  buttonText: { fontFamily: F.bold, fontSize: 16, color: '#000000' },
  hint: { fontFamily: F.regular, fontSize: 12, color: '#AAAAAA', textAlign: 'center', marginTop: 10 },
});
