import { useEffect, useState, type ReactNode } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSQLiteContext } from 'expo-sqlite';
import { contrast, F, PICKER_COLORS } from '../constants/theme';
import { APP_NAME } from '../constants/brand';
import { useI18n } from '../lib/i18n';
import { useTheme } from '../lib/theme';
import { photoPalette, type PhotoPalette } from '../lib/photoPalette';

// Paylaşım görsellerinin (tek parça hikâyesi, kolaj) ortak parçaları:
// renk seçenekleri, kendi renklerin, Hikâye / X seçimi ve logo.

// Görselin renkleri: zemin + yazı (+ isteğe bağlı vurgu). Fotoğraf çerçevesi yazı renginde olur,
// vurgu varsa çerçevenin içinde ince bir hat ve alt yazı onun renginde olur.
// Sıra: fotoğraftan çıkarılan renkler (fotoğraf varsa), uygulamanın renk teması, hazır seçenekler.
export type Swatch = { bg: string; ink: string; accent?: string };
// Her seçeneğin vurgusu: çerçevenin içindeki ince hat ve alt yazı. Zeminde okunur, kenardan ayrışır.
export const STYLES: Swatch[] = [
  { bg: '#0D0D0D', ink: '#FFFFFF', accent: '#C9A86A' }, // siyah · beyaz · altın
  { bg: '#FFFFFF', ink: '#0D0D0D', accent: '#D7141A' }, // beyaz · siyah · kırmızı
  { bg: '#F4EEE3', ink: '#111111', accent: '#A8574A' }, // krem · siyah · kiremit
  { bg: '#FFE600', ink: '#0B2A5B', accent: '#1F5FBF' }, // sarı · lacivert · mavi
  { bg: '#A6192E', ink: '#FDB913', accent: '#FFFFFF' }, // kırmızı · sarı · beyaz
  { bg: '#6E1A37', ink: '#8FCBF0', accent: '#FFFFFF' }, // bordo · mavi · beyaz
  { bg: '#C8102E', ink: '#FFFFFF', accent: '#1A1A1A' }, // kırmızı · beyaz · siyah
  { bg: '#0050A8', ink: '#FFFFFF', accent: '#FFE600' }, // mavi · beyaz · sarı
  { bg: '#00703C', ink: '#FFFFFF', accent: '#F2C230' }, // yeşil · beyaz · altın
  { bg: '#0B2A5B', ink: '#FF7A1A', accent: '#FFFFFF' }, // lacivert · turuncu · beyaz
  { bg: '#5E35B1', ink: '#FFE600', accent: '#FFFFFF' }, // mor · sarı · beyaz
  { bg: '#FF4F9A', ink: '#FFFFFF', accent: '#3A0F25' }, // pembe · beyaz · mürdüm
  { bg: '#8EE3C8', ink: '#111111', accent: '#0B5D4B' }, // mint · siyah · koyu yeşil
  { bg: '#E4F2FC', ink: '#6E1A37', accent: '#2F7DC1' }, // açık mavi · bordo · mavi
  { bg: '#2B2B2B', ink: '#C9A86A', accent: '#F2EEE6' }, // füme · altın · krem
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
// Zemin, kenar/yazı, vurgu (ince hat ve alt yazı)
type Custom = [string, string, string];
const DEFAULT_CUSTOM: Custom = ['#0B2A5B', '#FDB913', '#FFFFFF'];
const isHex = (x: string) => /^#[0-9A-F]{6}$/i.test(x);

// Fotoğraf hazırlanırken gösterilen geçici renkler
const PALETTE_WAIT: Swatch = { bg: '#2B2B2B', ink: '#DDDDDD' };

export function useShareStyle(visible: boolean, photo?: string | null) {
  const db = useSQLiteContext();
  const { C, colorTheme } = useTheme();
  const [palette, setPalette] = useState<PhotoPalette | null>(null);
  // Fotoğraf varsa ilk kutu ondan çıkarılan renklere ayrılır (hesaplanana kadar geçici renkte)
  const hasPhoto = !!photo;
  const base = colorTheme !== 'mono' ? [{ bg: C.white, ink: C.black, accent: C.accent }, ...STYLES] : STYLES;
  const swatches: Swatch[] = hasPhoto ? [palette ?? PALETTE_WAIT, ...base] : base;

  useEffect(() => {
    if (!visible || !photo) return;
    let alive = true;
    setPalette(null); // başka fotoğraf seçildi: renkler yeniden hesaplanır
    photoPalette(photo)
      .then(p => { if (alive) setPalette(p); })
      .catch(() => {});
    return () => { alive = false; };
  }, [visible, photo]);
  const [styleIdx, setStyleIdx] = useState(0);
  const [custom, setCustom] = useState<Custom>(DEFAULT_CUSTOM);
  const [slotPick, setSlotPick] = useState<0 | 1 | 2>(0);
  const customIdx = swatches.length; // listenin sonundaki "kendi renklerin" kutusu
  const customOn = styleIdx === customIdx;

  useEffect(() => {
    if (!visible) return;
    db.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key = ?', CUSTOM_KEY)
      .then(r => {
        // Eski kayıtlarda iki renk var: vurgu kenar rengiyle aynı başlar
        const [bg, ink, accent] = (r?.value ?? '').split(',');
        if (bg && ink && isHex(bg) && isHex(ink)) setCustom([bg, ink, accent && isHex(accent) ? accent : ink]);
      })
      .catch(() => {});
  }, [visible, db]);

  function saveCustom(next: Custom) {
    setCustom(next);
    db.runAsync('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', CUSTOM_KEY, next.join(',')).catch(() => {});
  }

  const sw = customOn ? { bg: custom[0], ink: custom[1], accent: custom[2] } : swatches[Math.min(styleIdx, swatches.length - 1)];
  return {
    swatches, styleIdx, setStyleIdx, custom, customOn, customIdx, slotPick, setSlotPick, saveCustom,
    pickColor: (c: string) => saveCustom(custom.map((x, i) => (i === slotPick ? c : x)) as Custom),
    // accent: çerçevedeki ince hat (kenar ile fotoğraf arasında; zeminle yan yana gelmez, her zaman kullanılır)
    // accentText: alt yazı; vurgu zeminde okunmuyorsa yazıda kenar rengi kullanılır
    st: {
      bg: sw.bg,
      ink: sw.ink,
      accent: sw.accent ?? sw.ink,
      accentText: sw.accent && contrast(sw.accent, sw.bg) >= 2.5 ? sw.accent : sw.ink,
    },
    hasPhoto,
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
  const { swatches, styleIdx, setStyleIdx, custom, customOn, customIdx, slotPick, setSlotPick, saveCustom, pickColor, hasPhoto } = style;
  return (
    <>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.stylesWrap} contentContainerStyle={s.styles}>
        {swatches.map((x, i) => (
          <Pressable
            key={`${x.bg}-${x.ink}-${i}`}
            onPress={() => setStyleIdx(i)}
            style={[s.swatch, { backgroundColor: x.bg }, i === styleIdx && s.swatchOn]}
            accessibilityLabel={hasPhoto && i === 0 ? t('story.fromPhoto') : `${t('story.style')} ${i + 1}`}
          >
            <View style={{ width: 16, height: 16, backgroundColor: x.ink, borderWidth: x.accent ? 3 : 0, borderColor: x.accent }} />
            {hasPhoto && i === 0 && (
              <View style={s.editBadge}>
                <Ionicons name="image" size={11} color="#000000" />
              </View>
            )}
          </Pressable>
        ))}
        <Pressable
          onPress={() => setStyleIdx(customIdx)}
          style={[s.swatch, { backgroundColor: custom[0] }, customOn && s.swatchOn]}
          accessibilityLabel={t('story.custom')}
        >
          <View style={{ width: 16, height: 16, backgroundColor: custom[1], borderWidth: 3, borderColor: custom[2] }} />
          <View style={s.editBadge}>
            <Ionicons name="color-palette" size={11} color="#000000" />
          </View>
        </Pressable>
      </ScrollView>

      {customOn && (
        <View style={s.customPanel}>
          <View style={s.slotRow}>
            {([0, 1, 2] as const).map(i => (
              <Pressable
                key={i}
                onPress={() => setSlotPick(i)}
                style={[s.slot, slotPick === i && s.slotOn]}
                accessibilityState={{ selected: slotPick === i }}
              >
                <View style={[s.slotChip, { backgroundColor: custom[i] }]} />
                <Text style={[s.slotText, slotPick === i && { color: '#FFFFFF' }]}>{t(i === 0 ? 'story.bg' : i === 1 ? 'story.ink' : 'story.accent')}</Text>
              </Pressable>
            ))}
            <Pressable onPress={() => saveCustom([custom[1], custom[0], custom[2]])} hitSlop={8} style={s.swapBtn} accessibilityLabel={t('custom.swap')}>
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
          {(contrast(custom[0], custom[1]) < 2 || contrast(custom[0], custom[2]) < 2) && <Text style={s.weak}>{t('custom.weak')}</Text>}
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

// Başlık yazı boyutu uzunluğa göre küçülür; satır aralığı da yazıyla birlikte küçülür.
// width verilirse en uzun kelime tek satıra sığacak kadar küçülür ("Formalarım" ikiye bölünmesin).
// Kalın yazı tipinde bir harf ortalama ~0.72 yazı boyutu genişliğinde.
export function fitTitle(text: string, base: number, fitChars: number, width?: number) {
  const n = text.length;
  let size = n <= fitChars ? base : Math.max(base * 0.62, (base * fitChars) / n);
  if (width) {
    const longest = Math.max(1, ...text.split(/\s+/).map(w => w.length));
    size = Math.min(size, width / (0.72 * longest));
  }
  return size;
}

// Paylaşım ekranlarının (koyu zeminli tam ekran) ortak stilleri
// Fotoğraf penceresinin şekilleri
export type Shape = 'square' | 'rounded' | 'circle' | 'arch' | 'octagon';
export const SHAPES: Shape[] = ['square', 'rounded', 'circle', 'arch', 'octagon'];
const OCT_CUT = 0.2; // sekizgenin köşe kesiği, kenar uzunluğuna oranla (saat kasası gibi)

// Sekizgen: kare ile 45° dönmüş karenin kesişimi. Kare ile dönmüş kutu taşanı keser,
// içerik ters yönde döndürülerek düz durur. (SVG gerektirmez, görüntü yakalamada da çalışır.)
function Octagon({ size, cut, color, children }: { size: number; cut: number; color?: string; children?: ReactNode }) {
  const d = (size - cut) * Math.SQRT2;
  return (
    <View style={{ width: size, height: size, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ width: d, height: d, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '45deg' }] }}>
        <View style={{ width: size, height: size, backgroundColor: color, alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '-45deg' }] }}>
          {children}
        </View>
      </View>
    </View>
  );
}

// Şekle göre köşe yuvarlakları (dışta r, her içe katmanda kalınlık kadar azalır)
function radii(shape: Shape, size: number) {
  if (shape === 'circle') return { all: size / 2 };
  if (shape === 'rounded') return { all: size * 0.14 };
  if (shape === 'arch') return { top: size / 2 };
  return { all: 0 };
}

// Çerçeveli fotoğraf: dışta yazı renginde kalın kenar, içte (vurgu farklıysa) ince vurgu hattı
export function FramedPhoto({ uri, letter, size, u, st, shape }: {
  uri: string | null; letter: string; size: number; u: number; st: Swatch & { accent: string }; shape: Shape;
}) {
  const t1 = 6 * u;
  const t2 = st.accent.toUpperCase() !== st.ink.toUpperCase() ? 2.5 * u : 0;
  const inner = size - 2 * (t1 + t2);
  const content = (sz: number, br: ReturnType<typeof radii>) => (
    <View style={{
      width: sz, height: sz, overflow: 'hidden', backgroundColor: st.ink, alignItems: 'center', justifyContent: 'center',
      ...(br.all !== undefined ? { borderRadius: br.all } : { borderTopLeftRadius: br.top, borderTopRightRadius: br.top }),
    }}>
      {uri ? (
        <Image source={{ uri }} style={{ width: sz, height: sz }} />
      ) : (
        <Text style={{ fontFamily: F.black, fontSize: sz * 0.38, color: st.bg, opacity: 0.25 }}>{letter}</Text>
      )}
    </View>
  );
  if (shape === 'octagon') {
    const c0 = size * OCT_CUT;
    const c1 = c0 - t1 * (2 - Math.SQRT2);
    const c2 = c1 - t2 * (2 - Math.SQRT2);
    return (
      <Octagon size={size} cut={c0} color={st.ink}>
        <Octagon size={size - 2 * t1} cut={c1} color={st.accent}>
          <Octagon size={inner} cut={c2} color={st.ink}>
            {content(inner, { all: 0 })}
          </Octagon>
        </Octagon>
      </Octagon>
    );
  }
  const ring = (sz: number, off: number, color: string, child: ReactNode) => {
    const r = radii(shape, size);
    const br = r.all !== undefined ? { borderRadius: Math.max(0, r.all - off) } : { borderTopLeftRadius: Math.max(0, r.top! - off), borderTopRightRadius: Math.max(0, r.top! - off) };
    return (
      <View style={{ width: sz, height: sz, backgroundColor: color, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', ...br }}>
        {child}
      </View>
    );
  };
  const r = radii(shape, size);
  const off = t1 + t2;
  const innerR = r.all !== undefined ? { all: Math.max(0, r.all - off) } : { top: Math.max(0, r.top! - off) };
  return ring(size, 0, st.ink, ring(size - 2 * t1, t1, st.accent, content(inner, innerR)));
}

// Şekil seçici: her seçenek kendi küçük şeklini gösterir
export function ShapePicker({ value, onChange }: { value: Shape; onChange: (s: Shape) => void }) {
  const { t } = useI18n();
  const mini = { bg: '#1A1A1A', ink: '#FFFFFF', accent: '#FFFFFF' };
  return (
    <View style={s.shapes}>
      {SHAPES.map(sh => (
        <Pressable
          key={sh}
          onPress={() => onChange(sh)}
          style={[s.shapeBtn, sh === value && s.shapeOn]}
          accessibilityLabel={t(`shape.${sh}` as 'shape.square')}
          accessibilityState={{ selected: sh === value }}
        >
          <FramedPhoto uri={null} letter="" size={22} u={0.4} st={mini} shape={sh} />
        </Pressable>
      ))}
    </View>
  );
}

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
  shapes: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  shapeBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#444444' },
  shapeOn: { borderColor: '#FFFFFF', backgroundColor: '#2E2E2E' },
  slotRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  slot: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, height: 38, paddingHorizontal: 8,
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
