// Siyah-beyaz ağırlıklı, keskin köşeli tasarım dili.
// Tek vurgu rengi (ultramarin) yalnızca durum bilgisinde kullanılır.
// "black" = mürekkep (yazı, çizgi, ana buton), "white" = kâğıt (zemin).
// Gece modunda ikisi yer değiştirir.
export type Palette = {
  black: string;
  white: string;
  paper: string;
  line: string;
  grey: string;
  accent: string;
  brand: string;   // dolu yüzeyler: ana buton, seçili sekme, ikon kutuları
  onBrand: string; // dolu yüzeyin üstündeki yazı ve ikon
};

export const LIGHT: Palette = {
  black: '#000000',
  white: '#FFFFFF',
  paper: '#F2F2F2',   // fotoğraf zemini, basılı durum
  line: '#E0E0E0',    // ince ayırıcılar
  grey: '#8A8A8A',    // ikincil metin
  accent: '#2E3BFF',  // durum etiketi (istek listesi / takaslık)
  brand: '#000000',
  onBrand: '#FFFFFF',
};

export const DARK: Palette = {
  black: '#FFFFFF',
  white: '#000000',
  paper: '#161616',
  line: '#2A2A2A',
  grey: '#8A8A8A',
  accent: '#6B75FF',  // koyu zeminde okunabilir ton
  brand: '#FFFFFF',
  onBrand: '#000000',
};

// Renk temaları: uygulamanın tamamı iki renkten oluşur — biri zemin, diğeri yazı/çizgi/düğme.
// Gündüz: açık zemin + koyu yazı; gece: koyu zemin + açık yazı; canlı: doygun renk zemin.
// Ara tonlar (çizgi, ikincil yazı, fotoğraf zemini) bu iki renkten karıştırılarak üretilir.
// Kulüp adı ya da logosu kullanılmaz (marka hakları); yalnızca renk ikilileri.
type Pair = { bg: string; ink: string };
export type ColorTheme = { key: string; day: Pair; night: Pair; vivid: Pair };
export const COLOR_THEMES: ColorTheme[] = [
  { key: 'mono',
    day: { bg: '#FFFFFF', ink: '#000000' }, night: { bg: '#000000', ink: '#FFFFFF' }, vivid: { bg: '#FFFFFF', ink: '#000000' } },
  { key: 'yellowRed',
    day: { bg: '#FFF3CF', ink: '#A6192E' }, night: { bg: '#2B0710', ink: '#FDB913' }, vivid: { bg: '#A6192E', ink: '#FDB913' } },
  { key: 'yellowNavy',
    day: { bg: '#FFF8CC', ink: '#0B2A5B' }, night: { bg: '#061633', ink: '#FFE600' }, vivid: { bg: '#FFE600', ink: '#0B2A5B' } },
  { key: 'claretBlue',
    day: { bg: '#E4F2FC', ink: '#6E1A37' }, night: { bg: '#260913', ink: '#8FCBF0' }, vivid: { bg: '#6E1A37', ink: '#8FCBF0' } },
  { key: 'redWhite',
    day: { bg: '#FFF4F4', ink: '#C8102E' }, night: { bg: '#2A0508', ink: '#FFFFFF' }, vivid: { bg: '#D7141A', ink: '#FFFFFF' } },
  { key: 'blueWhite',
    day: { bg: '#F1F6FF', ink: '#0050A8' }, night: { bg: '#04152E', ink: '#FFFFFF' }, vivid: { bg: '#0057B8', ink: '#FFFFFF' } },
  { key: 'greenWhite',
    day: { bg: '#F0FAF3', ink: '#00703C' }, night: { bg: '#03200F', ink: '#FFFFFF' }, vivid: { bg: '#00843D', ink: '#FFFFFF' } },
  { key: 'orangeNavy',
    day: { bg: '#FFEBDD', ink: '#0B2A5B' }, night: { bg: '#061633', ink: '#F26522' }, vivid: { bg: '#F26522', ink: '#0B2A5B' } },
];

function hex(c: string) {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
// a ile b arasında karışım; t = b'nin oranı
export function mix(a: string, b: string, t: number) {
  const x = hex(a), y = hex(b);
  return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('');
}
export function isDarkColor(c: string) {
  const [r, g, b] = hex(c);
  return 0.299 * r + 0.587 * g + 0.114 * b < 140;
}
// İki renkten tam palet
export function paletteFrom({ bg, ink }: Pair): Palette {
  return {
    black: ink,
    white: bg,
    paper: mix(bg, ink, 0.08),
    line: mix(bg, ink, 0.18),
    grey: mix(bg, ink, 0.6),
    accent: ink,
    brand: ink,
    onBrand: bg,
  };
}

export const F = {
  regular: 'Archivo_400Regular',
  medium: 'Archivo_500Medium',
  semi: 'Archivo_600SemiBold',
  bold: 'Archivo_700Bold',
  heavy: 'Archivo_800ExtraBold',
  black: 'Archivo_900Black',
};

// Etiketler dil dosyasında: t(`status.${key}`)
export const STATUS_KEYS = ['owned', 'wishlist', 'trade'] as const;


// --- Özel tema: kullanıcının seçtiği iki renkten gündüz/gece/canlı hâlleri üretilir ---
function lum(c: string) {
  const [r, g, b] = hex(c).map(v => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
// WCAG karşıtlık oranı (1..21); 3'ün altı büyük yazıda bile zor okunur
export function contrast(a: string, b: string) {
  const x = lum(a), y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
export const DEFAULT_CUSTOM: [string, string] = ['#A6192E', '#FDB913'];

// main = ana renk (canlı modda zemin), second = ikinci renk
export function customTheme(main: string, second: string): ColorTheme {
  const light = lum(main) >= lum(second) ? main : second;
  let dark = light === main ? second : main;
  // İki renk de açıksa koyu olanı biraz koyulaştır ki gündüz yazılar okunsun
  if (contrast(dark, '#FFFFFF') < 4.5) dark = mix(dark, '#000000', 0.45);
  return {
    key: 'custom',
    day: { bg: mix(light, '#FFFFFF', 0.82), ink: dark },
    night: { bg: mix(dark, '#000000', 0.78), ink: contrast(light, '#000000') < 4.5 ? mix(light, '#FFFFFF', 0.5) : light },
    vivid: { bg: main, ink: second },
  };
}

// Renk paleti: her sütun bir renk ailesi, yukarıdan aşağı açıktan koyuya
export const PICKER_COLORS: string[] = [
  '#FFCDD2', '#FFE0B2', '#FFF59D', '#C8E6C9', '#B2EBF2', '#BBDEFB', '#D1C4E9', '#F8BBD0', '#D7CCC8', '#FFFFFF',
  '#EF5350', '#FFA726', '#FFE600', '#66BB6A', '#26C6DA', '#42A5F5', '#7E57C2', '#EC407A', '#A1887F', '#BDBDBD',
  '#D7141A', '#F26522', '#FDB913', '#00843D', '#00897B', '#0057B8', '#5E35B1', '#C2185B', '#6D4C41', '#757575',
  '#A6192E', '#BF360C', '#C9A227', '#1B5E20', '#00574B', '#0B2A5B', '#311B92', '#6E1A37', '#3E2723', '#000000',
];
