// Fotoğraftaki ayrı parçaları (masadaki kartlar, pullar, saatler) bulur.
// Tamamen telefonda çalışır: zemin rengi fotoğrafın kenarlarından öğrenilir,
// zeminden belirgin şekilde ayrılan bölgeler gruplanır ve her grubun kutusu çıkarılır.
// En iyi sonuç: düz, tek renkli bir zemin üzerinde aralıklı dizilmiş parçalar.

export type Box = { x: number; y: number; w: number; h: number }; // 0..1 oranları

type Opts = {
  minArea?: number; // görüntü alanına oranla en küçük parça
  maxArea?: number; // bundan büyük bölgeler zemin hatası sayılır
  pad?: number; // kutulara eklenen kenar payı (oran)
};

const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)] ?? 0;
};
const percentile = (a: number[], p: number) => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))] ?? 0;
};

// rgba: w*h*4 piksel dizisi
export function detectBoxes(rgba: Uint8Array, w: number, h: number, opts: Opts = {}): Box[] {
  const minArea = opts.minArea ?? 0.002;
  const maxArea = opts.maxArea ?? 0.6;
  const pad = opts.pad ?? 0.01;
  const N = w * h;

  // 1) Zemin rengi: kenardaki şeridin medyanı
  const ring = Math.max(2, Math.round(Math.min(w, h) * 0.03));
  const R: number[] = [], G: number[] = [], B: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x >= ring && x < w - ring && y >= ring && y < h - ring) continue;
      const i = (y * w + x) * 4;
      R.push(rgba[i]); G.push(rgba[i + 1]); B.push(rgba[i + 2]);
    }
  }
  const bg = [median(R), median(G), median(B)];

  // 2) Her pikselin zemine uzaklığı; eşik, kenar şeridindeki dağılıma göre uyarlanır
  const dist = new Float32Array(N);
  for (let p = 0; p < N; p++) {
    const i = p * 4;
    const dr = rgba[i] - bg[0], dg = rgba[i + 1] - bg[1], db = rgba[i + 2] - bg[2];
    dist[p] = Math.sqrt(dr * dr + dg * dg + db * db);
  }
  const ringDists: number[] = [];
  for (let k = 0; k < R.length; k++) {
    const dr = R[k] - bg[0], dg = G[k] - bg[1], db = B[k] - bg[2];
    ringDists.push(Math.sqrt(dr * dr + dg * dg + db * db));
  }
  const thr = Math.max(28, percentile(ringDists, 0.9) * 1.6);

  // 3) Parça maskesi + kenar (doku) desteği: zeminle aynı renkte ama desenli alanlar da yakalansın
  let mask = new Uint8Array(N);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      if (dist[p] > thr) { mask[p] = 1; continue; }
      const i = p * 4;
      const lum = (j: number) => rgba[j] * 0.3 + rgba[j + 1] * 0.59 + rgba[j + 2] * 0.11;
      const gx = lum(i + 4) - lum(i - 4);
      const gy = lum(i + w * 4) - lum(i - w * 4);
      if (Math.abs(gx) + Math.abs(gy) > thr * 1.2) mask[p] = 1;
    }
  }

  const raw = mask; // bölme adımı için kapatılmamış maske
  // 4) Morfoloji: önce kapat (boşlukları doldur), sonra hafif aşındır (birbirine değen parçaları ayır)
  const r = Math.max(1, Math.round(Math.min(w, h) / 160));
  mask = dilate(mask, w, h, r);
  mask = erode(mask, w, h, r);
  mask = fillHoles(mask, w, h);
  const er = Math.max(1, Math.round(r * 1.5));
  const core = erode(mask, w, h, er);

  // 5) Bağlı bölgeler
  const label = new Int32Array(N);
  const boxes: (Box & { area: number })[] = [];
  const stack: number[] = [];
  let next = 1;
  for (let p = 0; p < N; p++) {
    if (!core[p] || label[p]) continue;
    let minX = w, minY = h, maxX = 0, maxY = 0, area = 0;
    label[p] = next;
    stack.push(p);
    while (stack.length) {
      const q = stack.pop()!;
      const qx = q % w, qy = (q - qx) / w;
      area++;
      if (qx < minX) minX = qx; if (qx > maxX) maxX = qx;
      if (qy < minY) minY = qy; if (qy > maxY) maxY = qy;
      const nb = [q - 1, q + 1, q - w, q + w];
      for (let k = 0; k < 4; k++) {
        const n = nb[k];
        if (n < 0 || n >= N) continue;
        if ((k === 0 && qx === 0) || (k === 1 && qx === w - 1)) continue;
        if (core[n] && !label[n]) { label[n] = next; stack.push(n); }
      }
    }
    next++;
    // Aşındırmayla küçülen kutu geri büyütülür
    minX = Math.max(0, minX - er); minY = Math.max(0, minY - er);
    maxX = Math.min(w - 1, maxX + er); maxY = Math.min(h - 1, maxY + er);
    const bw = maxX - minX + 1, bh = maxY - minY + 1;
    const frac = (bw * bh) / N;
    if (area / N < minArea || frac > maxArea) continue;
    // Çok ince şeritler (gölge, çizgi) elenir
    if (bw / bh > 8 || bh / bw > 8) continue;
    // Birbirine çok yakın parçalar tek bölge olabilir: boşluk vadilerinden böl
    for (const sb of splitBox(raw, w, h, minX, minY, maxX, maxY, 0)) {
      const sw = sb[2] - sb[0] + 1, sh = sb[3] - sb[1] + 1;
      if ((sw * sh) / N < minArea) continue;
      if (sw / sh > 8 || sh / sw > 8) continue;
      boxes.push({ x: sb[0] / w, y: sb[1] / h, w: sw / w, h: sh / h, area: sw * sh });
    }
  }

  // 6) Çok küçük kalıntıları ele: en büyük parçaların medyanının %15'inden küçükler
  if (boxes.length > 2) {
    const med = median(boxes.map(b => b.w * b.h));
    for (let i = boxes.length - 1; i >= 0; i--) {
      if (boxes[i].w * boxes[i].h < med * 0.15) boxes.splice(i, 1);
    }
  }

  // 6b) Boyu/eni tipik parçanın katı olan kutular (birleşik kalmış sıralar) eşit parçalara bölünür
  if (boxes.length >= 3) {
    // Tipik boyut için alt çeyrek kullanılır; birleşik büyük kutular ortalamayı bozmasın
    const mw = percentile(boxes.map(b => b.w), 0.1), mh = percentile(boxes.map(b => b.h), 0.1);
    for (let i = boxes.length - 1; i >= 0; i--) {
      const b = boxes[i];
      const ny = Math.round(b.h / mh), nx = Math.round(b.w / mw);
      const okY = ny >= 2 && Math.abs(b.h / ny - mh) < mh * 0.25 && Math.abs(b.w - mw) < mw * 0.35;
      const okX = nx >= 2 && Math.abs(b.w / nx - mw) < mw * 0.25 && Math.abs(b.h - mh) < mh * 0.35;
      if (!okX && !okY) continue;
      const parts: (Box & { area: number })[] = [];
      const n = okY ? ny : nx;
      for (let k = 0; k < n; k++) {
        parts.push(okY
          ? { x: b.x, y: b.y + (b.h / n) * k, w: b.w, h: b.h / n, area: b.area / n }
          : { x: b.x + (b.w / n) * k, y: b.y, w: b.w / n, h: b.h, area: b.area / n });
      }
      boxes.splice(i, 1, ...parts);
    }
  }

  // 7) Kenar payı ve okuma sırası (satır satır, soldan sağa)
  return sortReading(
    boxes.map(b => {
      const x = Math.max(0, b.x - pad), y = Math.max(0, b.y - pad);
      return { x, y, w: Math.min(1 - x, b.w + pad * 2), h: Math.min(1 - y, b.h + pad * 2) };
    })
  );
}

export function sortReading(boxes: Box[]): Box[] {
  if (boxes.length === 0) return boxes;
  const medH = median(boxes.map(b => b.h));
  const sorted = [...boxes].sort((a, b) => a.y + a.h / 2 - (b.y + b.h / 2));
  const rows: Box[][] = [];
  for (const b of sorted) {
    const cy = b.y + b.h / 2;
    const row = rows[rows.length - 1];
    if (row && Math.abs(cy - (row[0].y + row[0].h / 2)) < medH * 0.5) row.push(b);
    else rows.push([b]);
  }
  return rows.flatMap(row => row.sort((a, b) => a.x - b.x));
}

// Kutu içindeki satır/sütun doluluk profilinde belirgin bir "vadi" varsa kutuyu oradan ikiye böler
function splitBox(
  m: Uint8Array, w: number, h: number, x0: number, y0: number, x1: number, y1: number, depth: number
): [number, number, number, number][] {
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  if (depth > 6 || bw < 8 || bh < 8) return [[x0, y0, x1, y1]];
  const cut = (vertical: boolean): number | null => {
    const len = vertical ? bw : bh;
    const span = vertical ? bh : bw;
    const prof: number[] = [];
    for (let i = 0; i < len; i++) {
      let c = 0;
      for (let j = 0; j < span; j++) {
        const x = vertical ? x0 + i : x0 + j, y = vertical ? y0 + j : y0 + i;
        c += m[y * w + x];
      }
      prof.push(c / span);
    }
    const edge = Math.floor(len * 0.12);
    let best = -1, bestV = 1;
    for (let i = edge; i < len - edge; i++) if (prof[i] < bestV) { bestV = prof[i]; best = i; }
    const peak = Math.max(...prof);
    // İki yanında yeterince dolu bölge olan derin bir vadi
    if (best < 0 || bestV > 0.45 * peak) return null;
    const left = Math.max(...prof.slice(0, best)), right = Math.max(...prof.slice(best + 1));
    if (left < 0.6 * peak || right < 0.6 * peak) return null;
    return best;
  };
  // Önce uzun kenar boyunca dene
  const order = bh >= bw ? [false, true] : [true, false];
  for (const vertical of order) {
    const c = cut(vertical);
    if (c === null) continue;
    const a = vertical ? tight(m, w, x0, y0, x0 + c - 1, y1) : tight(m, w, x0, y0, x1, y0 + c - 1);
    const b = vertical ? tight(m, w, x0 + c + 1, y0, x1, y1) : tight(m, w, x0, y0 + c + 1, x1, y1);
    return [
      ...(a ? splitBox(m, w, h, ...a, depth + 1) : []),
      ...(b ? splitBox(m, w, h, ...b, depth + 1) : []),
    ];
  }
  return [[x0, y0, x1, y1]];
}

// Bölgedeki maske piksellerini saran en dar kutu
function tight(m: Uint8Array, w: number, x0: number, y0: number, x1: number, y1: number) {
  let a = x1, b = y1, c = x0, d = y0, any = false;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    if (!m[y * w + x]) continue;
    any = true;
    if (x < a) a = x; if (x > c) c = x; if (y < b) b = y; if (y > d) d = y;
  }
  return any ? ([a, b, c, d] as [number, number, number, number]) : null;
}

function dilate(m: Uint8Array, w: number, h: number, r: number) {
  return morph(m, w, h, r, true);
}
function erode(m: Uint8Array, w: number, h: number, r: number) {
  return morph(m, w, h, r, false);
}
// Kare yapı elemanıyla ayrılabilir (önce yatay, sonra dikey) morfoloji
function morph(m: Uint8Array, w: number, h: number, r: number, grow: boolean) {
  const tmp = new Uint8Array(w * h);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = grow ? 0 : 1;
      for (let k = -r; k <= r; k++) {
        const xx = x + k;
        const s = xx < 0 || xx >= w ? (grow ? 0 : 0) : m[y * w + xx];
        if (grow ? s : !s) { v = grow ? 1 : 0; break; }
      }
      tmp[y * w + x] = v;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = grow ? 0 : 1;
      for (let k = -r; k <= r; k++) {
        const yy = y + k;
        const s = yy < 0 || yy >= h ? 0 : tmp[yy * w + x];
        if (grow ? s : !s) { v = grow ? 1 : 0; break; }
      }
      out[y * w + x] = v;
    }
  }
  return out;
}
// Kenara ulaşmayan iç boşlukları (kartın ortasındaki zemin rengine yakın alanlar) doldurur
function fillHoles(m: Uint8Array, w: number, h: number) {
  const outside = new Uint8Array(w * h);
  const stack: number[] = [];
  const push = (p: number) => { if (!m[p] && !outside[p]) { outside[p] = 1; stack.push(p); } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (stack.length) {
    const q = stack.pop()!;
    const qx = q % w, qy = (q - qx) / w;
    if (qx > 0) push(q - 1);
    if (qx < w - 1) push(q + 1);
    if (qy > 0) push(q - w);
    if (qy < h - 1) push(q + w);
  }
  const out = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) out[p] = outside[p] ? 0 : 1;
  return out;
}
