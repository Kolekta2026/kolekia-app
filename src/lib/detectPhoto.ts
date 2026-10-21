import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import jpeg from 'jpeg-js';
import { base64ToBytes } from './shareData';
import { detectBoxes, type Box } from './detect';
import { detectGrid } from './detectGrid';

// Algılama küçültülmüş bir kopya üzerinde yapılır: hızlı ve yeterince hassas
const DETECT_SIZE = 600;
const OBJECT_SIZE = 400; // düz zemindeki parçaları arayan yöntem bu boyuta göre ayarlı
const GRID_MIN_SCORE = 0.5;

type Frame = { l: number; t: number; r: number; b: number };

export type Detection =
  | { kind: 'objects'; boxes: Box[] }
  | { kind: 'grid'; boxes: Box[]; rows: number; cols: number; frame: Frame; xs: number[]; ys: number[] }
  | { kind: 'none'; boxes: Box[] };

function downsample(src: Uint8Array, w: number, h: number, max: number) {
  const sc = Math.min(1, max / Math.max(w, h));
  const tw = Math.max(1, Math.round(w * sc));
  const th = Math.max(1, Math.round(h * sc));
  const out = new Uint8Array(tw * th * 4);
  for (let y = 0; y < th; y++) {
    const sy = Math.min(h - 1, Math.floor(y / sc));
    for (let x = 0; x < tw; x++) {
      const si = (sy * w + Math.min(w - 1, Math.floor(x / sc))) * 4;
      const di = (y * tw + x) * 4;
      out[di] = src[si]; out[di + 1] = src[si + 1]; out[di + 2] = src[si + 2]; out[di + 3] = 255;
    }
  }
  return { data: out, w: tw, h: th };
}

// Düz zeminde aralıklı dizilmiş parçalar bulunduysa sonuç "temiz" olur:
// en az iki kutu, kutular aşağı yukarı aynı büyüklükte, birbirinin üstüne binmiyor
// ve fotoğrafın anlamlı bir kısmını kaplıyor (birkaç küçük parlama/kadran sayılmaz)
const MIN_TOTAL_AREA = 0.12;
function looksClean(boxes: Box[]) {
  if (boxes.length < 2) return false;
  const areas = boxes.map(b => b.w * b.h);
  const total = areas.reduce((a, c) => a + c, 0);
  if (total < MIN_TOTAL_AREA) return false;
  const mean = total / areas.length;
  const sd = Math.sqrt(areas.reduce((a, c) => a + (c - mean) ** 2, 0) / areas.length);
  if (sd / mean >= 0.35) return false;
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const p = boxes[i], q = boxes[j];
      const ix = Math.max(0, Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x));
      const iy = Math.max(0, Math.min(p.y + p.h, q.y + q.h) - Math.max(p.y, q.y));
      if (ix * iy > 0.3 * Math.min(areas[i], areas[j])) return false;
    }
  }
  return true;
}

// İki yöntem denenir:
// 1) Düz bir zemine aralıklı dizilmiş parçalar (masadaki kartlar)
// 2) Bölmeli düzen: saat kutusu, albüm sayfası, kutu içindeki kartlar
export async function detectInPhoto(uri: string, width: number, height: number, frame?: Frame): Promise<Detection> {
  const ctx = ImageManipulator.manipulate(uri);
  if (width >= height) ctx.resize({ width: Math.min(width, DETECT_SIZE) });
  else ctx.resize({ height: Math.min(height, DETECT_SIZE) });
  const img = await ctx.renderAsync();
  const res = await img.saveAsync({ format: SaveFormat.JPEG, compress: 0.9, base64: true });
  if (!res.base64) return { kind: 'none', boxes: [] };
  const decoded = jpeg.decode(base64ToBytes(res.base64), { useTArray: true, formatAsRGBA: true });
  const { data, width: w, height: h } = decoded;

  const small = downsample(data, w, h, OBJECT_SIZE);
  const objects = detectBoxes(small.data, small.w, small.h);
  if (looksClean(objects)) return { kind: 'objects', boxes: objects };

  const grid = detectGrid(data, w, h, frame);
  if (grid && grid.score >= GRID_MIN_SCORE && grid.boxes.length >= 2) {
    // Izgara sekmesi de bulunan düzene oturtulur: çerçeve = tüm hücrelerin sınırı,
    // ara çizgiler = satırlardaki konumların ortalaması
    const l = Math.min(...grid.boxes.map(b => b.x));
    const t = Math.min(...grid.boxes.map(b => b.y));
    const r = Math.max(...grid.boxes.map(b => b.x + b.w));
    const btm = Math.max(...grid.boxes.map(b => b.y + b.h));
    const fw = r - l || 1;
    const fh = btm - t || 1;
    const xs: number[] = [];
    for (let c = 1; c < grid.cols; c++) {
      let sum = 0;
      for (let rr = 0; rr < grid.rows; rr++) sum += grid.boxes[rr * grid.cols + c].x;
      xs.push((sum / grid.rows - l) / fw);
    }
    const ys: number[] = [];
    for (let rr = 1; rr < grid.rows; rr++) ys.push((grid.boxes[rr * grid.cols].y - t) / fh);
    return {
      kind: 'grid',
      boxes: grid.boxes,
      rows: grid.rows,
      cols: grid.cols,
      frame: { l, t, r, b: btm },
      xs,
      ys,
    };
  }
  return { kind: 'none', boxes: [] };
}
