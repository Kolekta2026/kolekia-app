import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSQLiteContext } from 'expo-sqlite';
import { contrast, F, PICKER_COLORS } from '../constants/theme';
import { APP_NAME } from '../constants/brand';
import { useI18n } from '../lib/i18n';
import { useTheme } from '../lib/theme';

// Paylaşım görsellerinin (tek parça hikâyesi, kolaj) ortak parçaları:
// renk seçenekleri, kendi renklerin, Hikâye / X seçimi ve logo.

// Görselin renkleri: zemin + yazı. Fotoğraf çerçevesi yazı renginde olur.
// İlk seçenek uygulamada seçili renk teması (tek renkli temada eklenmez).
export type Swatch = { bg: string; ink: string };
export const STYLES: Swatch[] = [
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

export type Format = 'story' | 'x';
// Çıktı boyutları: Instagram hikâyesi 1080×1920, X gönderisi 1600×900 (16:9)
export const OUT: Record<Format, { w: number; h: number }> = { story: { w: 1080, h: 1920 }, x: { w: 1600, h: 900 } };

// Instagram hikâyede üstte ilerleme çubuğu, profil adı ve müzik satırı; altta mesaj kutusu durur.
// Logo ve alt yazı bu şeritlerin dışında kalsın diye üstten ve alttan fazladan boşluk bırakılır.
export const STORY_SIDE = 28; // 360 birimlik genişlikte yan boşluk
export const STORY_PAD = (u: number) => ({ paddingHorizontal: STORY_SIDE * u, paddingTop: 56 * u, paddingBottom: 40 * u });

// Önizleme ölçüleri: ekrana sığan en büyük boyut. u = tasarım birimi (hikâye 360×640, X 640×360)
export function previewSize(format: Format, screenW: number, avail: number) {
  const isX = format === 'x';
  const w = isX ? Math.min(screenW - 40, avail * (16 / 9)) : Math.min(screenW - 64, avail * (9 / 16));
  const h = isX ? w * (9 / 16) : w * (16 / 9);
  return { w, h, u: w / (isX ? 640 : 360) };
}

// Kullanıcının kendi seçtiği zemin/yazı rengi; ayarlarda saklanır, bir sonraki paylaşımda hatırlanır
const CUSTOM_KEY = 'story_custom';
const DEFAULT_CUSTOM: [string, string] = ['#0B2A5B', '#FDB913'];
const isHex = (x: string) => /^#[0-9A-F]{6}$/i.test(x);

export function useShareStyle(visible: boolean) {
  const db = useSQLiteContext();
  const { C, colorTheme } = useTheme();
  const swatches = colorTheme !== 'mono' ? [{ bg: C.white, ink: C.black }, ...STYLES] : STYLES;
  const [styleIdx, setStyleIdx] = useState(0);
  const [custom, setCustom] = useState<[string, string]>(DEFAULT_CUSTOM);
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

  const sw = customOn ? { bg: custom[0], ink: custom[1] } : swatches[Math.min(styleIdx, swatches.length - 1)];
  return {
    swatches, styleIdx, setStyleIdx, custom, customOn, customIdx, slotPick, setSlotPick, saveCustom,
    pickColor: (c: string) => saveCustom(slotPick === 0 ? [c, custom[1]] : [custom[0], c]),
    st: { bg: sw.bg, ink: sw.ink },
  };
}
export type ShareStyleState = ReturnType<typeof useShareStyle>;

// Kendi renklerin paneli açıkken önizlemenin küçülmesi gereken yükseklik
export const CUSTOM_PANEL_H = 104;

export function FormatToggle({ format, onChange }: { format: Format; onChange: (f: Format) => void }) {
  const { t } = useI18n();
  return (
    <View style={s.formats}>
      {(['story', 'x'] as Format[]).map(f => (
        <Pressable
          key={f}
          onPress={() => f !== format && onChange(f)}
          style={[s.format, f === format && s.formatOn]}
          accessibilityRole="button"
          accessibilityState={{ selected: f === format }}
        >
          <Ionicons name={f === 'x' ? 'logo-x' : 'logo-instagram'} size={16} color={f === format ? '#000000' : '#FFFFFF'} />
          <Text style={[s.formatText, f === format && { color: '#000000' }]}>{t(f === 'x' ? 'story.fmtX' : 'story.fmtStory')}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export function StylePicker({ style }: { style: ShareStyleState }) {
  const { t } = useI18n();
  const { swatches, styleIdx, setStyleIdx, custom, customOn, customIdx, slotPick, setSlotPick, saveCustom, pickColor } = style;
  return (
    <>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.stylesWrap} contentContainerStyle={s.styles}>
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
            <Pressable onPress={() => saveCustom([custom[1], custom[0]])} hitSlop={8} style={s.swapBtn} accessibilityLabel={t('custom.swap')}>
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
    </>
  );
}

// Görselin içindeki logo: yazı renginde kare K + uygulama adı
export function ShareBrand({ u, st }: { u: number; st: Swatch }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 * u }}>
      <View style={{ width: 26 * u, height: 26 * u, backgroundColor: st.ink, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontFamily: F.black, fontSize: 19 * u, lineHeight: 23 * u, color: st.bg }}>K</Text>
      </View>
      <Text style={{ fontFamily: F.black, fontSize: 21 * u, letterSpacing: -0.6 * u, color: st.ink }}>{APP_NAME}</Text>
    </View>
  );
}

// Başlık yazı boyutu uzunluğa göre küçülür; satır aralığı da yazıyla birlikte küçülür
export function fitTitle(text: string, base: number, fitChars: number) {
  const n = text.length;
  return n <= fitChars ? base : Math.max(base * 0.62, (base * fitChars) / n);
}

// Paylaşım ekranlarının (koyu zeminli tam ekran) ortak stilleri
export const shareScreen = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#1A1A1A', paddingHorizontal: 20 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heading: { fontFamily: F.bold, fontSize: 16, color: '#FFFFFF' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  button: {
    height: 54, backgroundColor: '#FFFFFF', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
  },
  buttonText: { fontFamily: F.bold, fontSize: 16, color: '#000000' },
  hint: { fontFamily: F.regular, fontSize: 12, color: '#AAAAAA', textAlign: 'center', marginTop: 10 },
});

const s = StyleSheet.create({
  formats: { flexDirection: 'row', gap: 8, marginTop: 14, alignSelf: 'center' },
  format: {
    flexDirection: 'row', alignItems: 'center', gap: 6, height: 34, paddingHorizontal: 14,
    borderWidth: 1, borderColor: '#555555',
  },
  formatOn: { backgroundColor: '#FFFFFF', borderColor: '#FFFFFF' },
  formatText: { fontFamily: F.bold, fontSize: 13, color: '#FFFFFF' },
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
});
