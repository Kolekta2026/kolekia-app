import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import jpeg from 'jpeg-js';
import { base64ToBytes } from './shareData';

// Fotoğraftan paylaşım görseli için üç renk çıkarır:
// zemin (fotoğrafın koyu arka planından, ör. ağaçlar), çerçeve/yazı (açık nötr ton, ör. çelik kasa)
// ve vurgu (parçanın en canlı tonu, ör. gül altını kadran). Telefonda, internete çıkmadan hesaplanır.

export type PhotoPalette = { bg: string; ink: string; accent: string };

type HSL = { h: number; s: number; l: number };

function rgbToHsl(r: number, g: number, b: number): HSL {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  if (mx === mn) return { h: 0, s: 0, l };
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h * 60, s, l };
}

function hslToHex({ h, s, l }: HSL) {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const hex = (x: number) => Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16).padStart(2, '0');
  return `#${hex(f(0))}${hex(f(8))}${hex(f(4))}`.toUpperCase();
}

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const angle = (x: number, y: number) => ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;

// Bilek fotoğraflarında ten rengi geniş yer kaplar; vurgu ve zemin rengi olarak seçilmesin.
// (Gül altını kadran gibi pembe tonlar ten renginden daha kırmızıya, ~5-15° tona düşer.)
const isSkin = (c: HSL) => c.h >= 16 && c.h <= 38 && c.s <= 0.62 && c.l >= 0.28 && c.l <= 0.85;

// Pikseller tek tek değerlendirilir: parça çoğunlukla fotoğrafın ortasındadır, bu yüzden
// vurgu aranırken orta kısım, zemin aranırken kenarlar daha ağır basar.
export function paletteFromPixels(rgba: Uint8Array, w: number, h: number): PhotoPalette | null {
  if (w < 2 || h < 2) return null;
  const BINS = 36;
  const hueW = new Float64Array(BINS);
  const hueS = new Float64Array(BINS);
  const hueX = new Float64Array(BINS);
  const hueY = new Float64Array(BINS);
  let darkW = 0, darkX = 0, darkY = 0, darkS = 0, edgeTotal = 0;
  let lightN = 0, lightX = 0, lightY = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const c = rgbToHsl(rgba[o], rgba[o + 1], rgba[o + 2]);
      const dx = (x / (w - 1) - 0.5) / 0.32;
      const dy = (y / (h - 1) - 0.5) / 0.32;
      const center = Math.exp(-(dx * dx + dy * dy));
      const edge = 1 - center;
      edgeTotal += edge;
      const rad = (c.h * Math.PI) / 180;
      if (c.l > 0.7) {
        lightN++; lightX += c.s * Math.cos(rad); lightY += c.s * Math.sin(rad);
      }
      if (c.s >= 0.12 && c.l >= 0.18 && c.l <= 0.85 && !isSkin(c)) {
        const b = Math.floor(c.h / (360 / BINS)) % BINS;
        const wt = center * c.s;
        hueW[b] += wt; hueS[b] += wt * c.s;
        hueX[b] += wt * Math.cos(rad); hueY[b] += wt * Math.sin(rad);
      }
      if (c.l < 0.32 && !isSkin(c)) {
        darkW += edge; darkS += edge * c.s;
        darkX += edge * c.s * Math.cos(rad); darkY += edge * c.s * Math.sin(rad);
      }
    }
  }

  // Kenarlarda belirgin koyu bir arka plan var mı (ör. ağaçlar)? Varsa zemin onun tonu olur
  // ve vurgu ondan farklı bir tonda aranır; yoksa zemin vurgunun koyu hâli olur
  // (beyaz masadaki mavi kadranlı saatte lacivert, bordo kadranda koyu bordo gibi).
  const hasDarkBack = darkW / edgeTotal > 0.15 && darkS / darkW > 0.1;
  const backHue = hasDarkBack ? angle(darkX, darkY) : -1;
  const nearBack = (b: number) => {
    if (backHue < 0) return false;
    const d = Math.abs((b + 0.5) * (360 / BINS) - backHue);
    return Math.min(d, 360 - d) < 35;
  };

  // Vurgu: ortadaki en güçlü canlı ton (komşu dilimlerle birlikte)
  let peak = 0, peakW = 0;
  for (let b = 0; b < BINS; b++) {
    const v = (hueW[(b + BINS - 1) % BINS] + hueW[b] + hueW[(b + 1) % BINS]) * (nearBack(b) ? 0.25 : 1);
    if (v > peakW) { peakW = v; peak = b; }
  }
  let accent: HSL;
  if (peakW / (w * h) < 0.0015) {
    accent = { h: 0, s: 0, l: 0.72 }; // canlı renk yok: gümüş/gri vurgu
  } else {
    let sx = 0, sy = 0, sw = 0, ss = 0;
    for (const b of [(peak + BINS - 1) % BINS, peak, (peak + 1) % BINS]) {
      sx += hueX[b]; sy += hueY[b]; sw += hueW[b]; ss += hueS[b];
    }
    accent = { h: angle(sx, sy), s: clamp(ss / sw, 0.35, 0.6), l: 0.7 };
  }

  const bg: HSL = hasDarkBack
    ? { h: backHue, s: clamp(darkS / darkW, 0, 0.35), l: 0.11 }
    : { h: accent.h, s: accent.s > 0 ? 0.35 : 0, l: 0.11 };

  // Çerçeve ve yazı: açık tonların renk yönünde, neredeyse nötr (çelik, kâğıt)
  const ink: HSL = { h: lightN ? angle(lightX, lightY) : 0, s: 0.05, l: 0.88 };

  return { bg: hslToHex(bg), ink: hslToHex(ink), accent: hslToHex(accent) };
}

export async function photoPalette(uri: string): Promise<PhotoPalette | null> {
  const img = await ImageManipulator.manipulate(uri).resize({ width: 96 }).renderAsync();
  const res = await img.saveAsync({ format: SaveFormat.JPEG, compress: 0.9, base64: true });
  if (!res.base64) return null;
  const d = jpeg.decode(base64ToBytes(res.base64), { useTArray: true, formatAsRGBA: true });
  return paletteFromPixels(d.data, d.width, d.height);
}
