import type { Box } from './detect';

// Otomatik ızgara: saat kutusu bölmeleri, albüm cepleri, kutu içindeki kartlar gibi
// düzenli dizilmiş parçalar için bölme çizgilerini bulur.
//
// Fikir: bölme çizgileri (kutu duvarı, kılıf arası) boyunca renk pek değişmez;
// parçaların (saat, kart) üzerinden geçen çizgilerde ise çok değişir. Her satır ve
// sütun için bu "pürüzlülük" ölçülür, sonra en iyi oturan düzenli tarak aranır.
// Satırlar boyunca sütun çizgileri perspektif yüzünden hafifçe kayabilir; bu yüzden
// sütunlar her satır bandında ayrı bulunur ve ortak bir doğruya oturtulur.

export type GridResult = {
  rows: number;
  cols: number;
  boxes: Box[]; // okuma sırasıyla, 0..1 fotoğraf oranları
  score: number; // güven; ~0.6 altı zayıf
};

const WORK = 300; // çerçeve bu boyuta küçültülerek incelenir
const MAX_N = 10;
const COVERAGE = 0.6; // çerçeveyi daha çok kaplayan ızgaralar biraz öne çıkar

type Fit = { n: number; b: number[]; score: number };

function quantile(arr: ArrayLike<number>, q: number) {
  const a = Array.from(arr).sort((x, y) => x - y);
  return a.length ? a[Math.min(a.length - 1, Math.floor(q * a.length))] : 0;
}

function spreadOf(P: Float32Array) {
  return Math.max(1, quantile(P, 0.9) - quantile(P, 0.1));
}

function smooth(p: Float32Array, r: number) {
  const n = p.length;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    let c = 0;
    for (let k = -r; k <= r; k++) {
      const j = i + k;
      if (j >= 0 && j < n) {
        s += p[j];
        c++;
      }
    }
    out[i] = s / c;
  }
  return out;
}

// Çizgi boyunca pürüzlülük: çizgi parçalara bölünür, her parçadaki renk değişimi ölçülür,
// düşük bir yüzdelik alınır. Böylece çizgiyi yer yer kesen kayış, kılıf kenarı gibi
// şeyler sonucu bozmaz.
function roughness(
  img: Float32Array, w: number,
  x0: number, x1: number, y0: number, y1: number,
  vertical: boolean
) {
  const len = vertical ? x1 - x0 : y1 - y0;
  const out = new Float32Array(len);
  const a0 = vertical ? y0 : x0;
  const a1 = vertical ? y1 : x1;
  const span = a1 - a0;
  const segs = Math.max(4, Math.min(16, Math.round(span / 10)));
  const v = new Float32Array(segs);
  for (let i = 0; i < len; i++) {
    for (let s = 0; s < segs; s++) {
      const s0 = a0 + Math.floor((s * span) / segs);
      const s1 = a0 + Math.floor(((s + 1) * span) / segs);
      let tv = 0;
      for (let j = s0 + 1; j < s1; j++) {
        const o = vertical ? (j * w + x0 + i) * 3 : ((y0 + i) * w + j) * 3;
        const p = vertical ? o - w * 3 : o - 3;
        tv += Math.abs(img[o] - img[p]) + Math.abs(img[o + 1] - img[p + 1]) + Math.abs(img[o + 2] - img[p + 2]);
      }
      v[s] = tv / Math.max(1, s1 - s0);
    }
    out[i] = quantile(v, 0.3);
  }
  return out;
}

// a..b aralığında n hücre için bölme yerleri: eşit aralıklı tahminin çevresindeki en düşük nokta
function fitN(P: Float32Array, n: number, a = 0, b = P.length) {
  const p = (b - a) / n;
  const out = [a];
  for (let k = 1; k < n; k++) {
    const lo = Math.max(a + 1, Math.round(a + k * p - 0.3 * p));
    const hi = Math.min(b - 1, Math.round(a + k * p + 0.3 * p));
    let best = lo;
    for (let i = lo; i <= hi; i++) if (P[i] < P[best]) best = i;
    out.push(best);
  }
  out.push(b);
  return out;
}

// Puan: bölmeler düşük, hücre içleri yüksek olmalı; hücreler benzer genişlikte olmalı.
// Hücre içine düşen gizli bir bölme (yarım/katlı sayı) içi düşürdüğü için kendiliğinden elenir.
function scoreFit(P: Float32Array, b: number[], spread: number) {
  const n = b.length - 1;
  const L = P.length;
  if (n < 2) return -9;
  let bv = 0;
  let bc = 0;
  for (let k = 0; k <= n; k++) {
    if ((k === 0 && b[k] <= 0) || (k === n && b[k] >= L)) continue; // çerçeve kenarı: bilgi yok
    const wgt = k === 0 || k === n ? 0.5 : 1;
    bv += P[Math.min(L - 1, b[k])] * wgt;
    bc += wgt;
  }
  bv /= bc;
  let iv = 0;
  const ws: number[] = [];
  for (let k = 0; k < n; k++) {
    const w = b[k + 1] - b[k];
    if (w < 4) return -9;
    ws.push(w);
    const s0 = Math.round(b[k] + 0.3 * w);
    const s1 = Math.max(s0 + 1, Math.round(b[k + 1] - 0.3 * w));
    iv += quantile(P.subarray(s0, s1), 0.2);
  }
  iv /= n;
  const mw = ws.reduce((x, c) => x + c, 0) / n;
  const dev = Math.max(...ws.map(x => Math.abs(x - mw) / mw));
  return (iv - bv) / spread - Math.max(0, dev - 0.2) * 3 + COVERAGE * ((b[n] - b[0]) / L);
}

function localMins(P: Float32Array, lo: number, hi: number) {
  const out: number[] = [];
  for (let i = Math.max(1, lo); i < Math.min(P.length - 1, hi); i++) {
    if (P[i] <= P[i - 1] && P[i] < P[i + 1]) out.push(i);
  }
  return out;
}

// Dış kenarlar da serbest: ızgara çerçevenin tamamını kaplamayabilir
function bestFit(P: Float32Array, minN: number, maxN: number): Fit {
  const L = P.length;
  const spread = spreadOf(P);
  const As = [0, ...localMins(P, 0, Math.round(0.25 * L))];
  const Bs = [L, ...localMins(P, Math.round(0.75 * L), L).map(i => i + 1)];
  let res: Fit = { n: 1, b: [0, L], score: -9 };
  for (let n = Math.max(2, minN); n <= maxN; n++) {
    for (const a of As) {
      for (const e of Bs) {
        if ((e - a) / n < 6) continue;
        const b = fitN(P, n, a, e);
        const s = scoreFit(P, b, spread);
        if (s > res.score) res = { n, b, score: s };
      }
    }
  }
  return res;
}

// Sütun çizgileri satırdan satıra düz bir doğru boyunca kayar (perspektif).
// Her çizgi için satırlardaki konumlara ağırlıklı doğru uydurulur; zayıf satırlar
// güçlü satırların doğrusuna çekilir, sonra yakın çevrede ince ayar yapılır.
function consensus(profiles: Float32Array[], ys: number[], n: number, L: number) {
  const fits = profiles.map(P => bestFit(P, n, n));
  if (fits.some(f => f.score <= -9)) return { score: -9, lines: [] as number[][], scores: [] as number[] };
  const wts = fits.map(f => Math.pow(Math.max(0.05, f.score), 2));
  const lines: number[][] = profiles.map(() => []);
  for (let k = 0; k <= n; k++) {
    let sw = 0, sy = 0, sx = 0, syy = 0, sxy = 0;
    fits.forEach((f, i) => {
      const w = wts[i], y = ys[i], x = f.b[k];
      sw += w; sy += w * y; sx += w * x; syy += w * y * y; sxy += w * x * y;
    });
    const den = sw * syy - sy * sy;
    const slope = profiles.length > 1 && Math.abs(den) > 1e-6 ? (sw * sxy - sy * sx) / den : 0;
    const icpt = (sx - slope * sy) / sw;
    profiles.forEach((P, i) => {
      let x = Math.round(icpt + slope * ys[i]);
      const r = Math.max(1, Math.round((0.12 * L) / n));
      if (x <= 1) x = 0;
      else if (x >= L - 2) x = L;
      else {
        const sp = spreadOf(P);
        const cost = (j: number) => P[j] + (0.3 * sp * Math.abs(j - x)) / r;
        let bi = x;
        for (let j = Math.max(1, x - r); j <= Math.min(L - 2, x + r); j++) if (cost(j) < cost(bi)) bi = j;
        x = bi;
      }
      lines[i].push(x);
    });
  }
  for (const b of lines) for (let k = 1; k < b.length; k++) if (b[k] <= b[k - 1]) b[k] = Math.min(L, b[k - 1] + 1);
  const scores = profiles.map((P, i) => scoreFit(P, lines[i], spreadOf(P)));
  return { score: scores.reduce((a, c) => a + c, 0) / scores.length, lines, scores };
}

function columnsFor(img: Float32Array, w: number, bands: [number, number][]) {
  const rs = Math.max(1, Math.round(Math.min(w, WORK) / 120));
  const profiles = bands.map(([y0, y1]) => {
    const h = y1 - y0;
    const a = Math.round(y0 + 0.15 * h);
    const b = Math.max(a + 2, Math.round(y1 - 0.15 * h));
    return smooth(roughness(img, w, 0, w, a, b, true), rs);
  });
  const ys = bands.map(([y0, y1]) => (y0 + y1) / 2);
  // Bant başına ortalama doku: boş bantlar (cam kapak, masa) düşük çıkar
  const levels = profiles.map(P => P.reduce((a, c) => a + c, 0) / P.length);
  let best = { n: 0, score: -9, lines: [] as number[][], scores: [] as number[], levels };
  for (let n = 2; n <= MAX_N; n++) {
    if (w / n < 8) break;
    const r = consensus(profiles, ys, n, w);
    if (r.score > best.score) best = { n, ...r, levels };
  }
  return best;
}

export function detectGrid(
  rgba: Uint8Array, W: number, H: number,
  frame = { l: 0, t: 0, r: 1, b: 1 }
): GridResult | null {
  const fl = frame.l * W, ft = frame.t * H;
  const fw = (frame.r - frame.l) * W, fh = (frame.b - frame.t) * H;
  if (fw < 16 || fh < 16) return null;
  const sc = Math.min(1, WORK / Math.max(fw, fh));
  const w = Math.max(16, Math.round(fw * sc));
  const h = Math.max(16, Math.round(fh * sc));

  // Kutu ortalamasıyla küçült (gürültüyü de azaltır)
  const img = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    const sy0 = Math.floor(ft + y / sc);
    const sy1 = Math.min(H, Math.max(sy0 + 1, Math.floor(ft + (y + 1) / sc)));
    for (let x = 0; x < w; x++) {
      const sx0 = Math.floor(fl + x / sc);
      const sx1 = Math.min(W, Math.max(sx0 + 1, Math.floor(fl + (x + 1) / sc)));
      let r = 0, g = 0, bl = 0, c = 0;
      for (let yy = sy0; yy < sy1; yy++) {
        for (let xx = sx0; xx < sx1; xx++) {
          const o = (yy * W + xx) * 4;
          r += rgba[o]; g += rgba[o + 1]; bl += rgba[o + 2]; c++;
        }
      }
      const o = (y * w + x) * 3;
      img[o] = r / (c || 1); img[o + 1] = g / (c || 1); img[o + 2] = bl / (c || 1);
    }
  }

  const rs = Math.max(1, Math.round(Math.min(w, h) / 120));
  const rowFit = bestFit(smooth(roughness(img, w, 0, w, 0, h, false), rs), 2, MAX_N);

  // Satır bantları; tek sıra dizilmiş parçalar için tüm yükseklik de denenir
  const candidates: [number, number][][] = [];
  if (rowFit.score > -9) {
    const bands: [number, number][] = [];
    for (let k = 0; k < rowFit.n; k++) bands.push([rowFit.b[k], rowFit.b[k + 1]]);
    candidates.push(bands);
  }
  candidates.push([[0, h]]);

  let best: { bands: [number, number][]; cols: ReturnType<typeof columnsFor>; total: number } | null = null;
  for (let bands of candidates) {
    let cols = columnsFor(img, w, bands);
    // Uçtaki bir satır ızgaraya uymuyorsa (ör. açık cam kapak, masa) atılır:
    // ya puanı çok düşüktür ya da hem puanı zayıf hem de neredeyse boştur
    for (;;) {
      if (bands.length < 2 || cols.n === 0) break;
      const med = quantile(cols.scores, 0.5);
      const medLevel = quantile(cols.levels, 0.5);
      const isWeak = (i: number) =>
        cols.scores[i] < 0.45 * med || (cols.scores[i] < 0.75 * med && cols.levels[i] < 0.6 * medLevel);
      const last = bands.length - 1;
      const dropFirst = isWeak(0) && (!isWeak(last) || cols.scores[0] <= cols.scores[last]);
      const dropLast = !dropFirst && isWeak(last);
      if (!dropFirst && !dropLast) break;
      bands = dropFirst ? bands.slice(1) : bands.slice(0, -1);
      cols = columnsFor(img, w, bands);
    }
    if (cols.n === 0) continue;
    const rowScore = bands.length > 1 ? rowFit.score : 0.5;
    const total = (cols.score + rowScore) / 2;
    if (!best || total > best.total) best = { bands, cols, total };
  }
  if (!best) return null;

  const boxes: Box[] = [];
  best.bands.forEach(([y0, y1], i) => {
    const xs = best!.cols.lines[i];
    for (let k = 0; k < xs.length - 1; k++) {
      boxes.push({
        x: (fl + xs[k] / sc) / W,
        y: (ft + y0 / sc) / H,
        w: (xs[k + 1] - xs[k]) / sc / W,
        h: (y1 - y0) / sc / H,
      });
    }
  });
  return { rows: best.bands.length, cols: best.cols.n, boxes, score: best.total };
}
