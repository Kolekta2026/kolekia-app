// Google Lens / Gemini'den gelen JSON ile parça formunu doldurma yardımcıları
import type { Lang } from './i18n';

export const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLocaleLowerCase('tr');

// Şablon dışı, forma özel anahtarlar (her iki dilde de tanınır)
export const KEY_TITLE = ['parça adı', 'parça', 'ad', 'adı', 'isim', 'ürün', 'ürün adı', 'başlık', 'item name', 'item', 'name', 'title', 'product', 'product name'];
export const KEY_VALUE = ['tahmini değer', 'değer', 'fiyat', 'tahmini fiyat', 'piyasa değeri', 'estimated value', 'value', 'price', 'market value'];
export const KEY_CURRENCY = ['para birimi', 'currency'];
export const KEY_STORY = ['açıklama', 'hikâye', 'hikaye', 'not', 'notlar', 'description', 'story', 'notes', 'summary', 'özet'];
const META = new Set([...KEY_TITLE, ...KEY_VALUE, ...KEY_CURRENCY, ...KEY_STORY].map(norm));
export const isMetaKey = (k: string) => META.has(norm(k));

// Lens'teki Gemini kutusuna yapıştırılacak komut
export function buildPrompt(fieldNames: string[], lang: Lang) {
  const tr = lang === 'tr';
  const keys = [
    tr ? 'Parça adı' : 'Item name',
    ...fieldNames,
    tr ? 'Tahmini değer' : 'Estimated value',
    tr ? 'Para birimi' : 'Currency',
    tr ? 'Açıklama' : 'Description',
  ];
  const seen = new Set<string>();
  const obj: Record<string, string> = {};
  for (const k of keys) {
    if (seen.has(norm(k))) continue;
    seen.add(norm(k));
    obj[k] = '';
  }
  const json = JSON.stringify(obj);
  return tr
    ? `Bu görseldeki koleksiyon parçasını tanımla. Yanıtı yalnızca tek bir JSON nesnesi olarak ver, başka metin yazma. Şu anahtarları doldur, emin olmadıklarını boş bırak: ${json} Parçayı tanımlayan önemli başka özellikler varsa (en fazla 5) bunları da yeni anahtar olarak ekle; yeni anahtarları "Türkçe ad | English name" biçiminde yaz. Tüm değerler kısa metin olsun.`
    : `Identify the collectible in this image. Reply with a single JSON object only, no other text. Fill these keys and leave any you are unsure of empty: ${json} If other important identifying details exist (at most 5), add them as new keys written as "Turkish name | English name". Keep every value a short string.`;
}

// Arama çubuğu için en kısa istek; alan eşleştirme ve yeni alan ekleme uygulamada yapılır
export function buildSearchPrompt(_fieldNames: string[], lang: Lang) {
  return lang === 'tr' ? 'sonucu json olarak ver' : 'give the result as json';
}

// Panodaki metinden JSON nesnesini toleranslı biçimde çıkarır (```json çitleri, öncesi/sonrası metin vb.)
export function parseLooseJson(text: string): Record<string, string> | null {
  let src = text.replace(/```(?:json)?/gi, '').trim();
  const a = src.indexOf('{');
  const b = src.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  src = src.slice(a, b + 1);
  let obj: unknown;
  try {
    obj = JSON.parse(src);
  } catch {
    // Akıllı tırnaklar ve sondaki virgüller düzeltilip tekrar denenir
    try {
      obj = JSON.parse(src.replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/,\s*([}\]])/g, '$1'));
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const out: Record<string, string> = {};
  const put = (k: string, v: unknown) => {
    const key = k.trim();
    if (!key) return;
    let s = '';
    if (v === null || v === undefined) s = '';
    else if (typeof v === 'boolean') s = v ? '1' : '';
    else if (Array.isArray(v)) s = v.filter(x => x !== null && typeof x !== 'object').join(', ');
    else if (typeof v === 'object') {
      // İç içe nesneler düzleştirilir
      for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) put(k2, v2);
      return;
    } else s = String(v);
    s = s.trim();
    if (!s || /^(-|—|n\/a|null|unknown|bilinmiyor|yok)$/i.test(s)) return;
    out[key] = s;
  };
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) put(k, v);
  return Object.keys(out).length ? out : null;
}

export function findKey(obj: Record<string, string>, candidates: string[]) {
  const set = new Set(candidates.map(norm));
  return Object.keys(obj).find(k => set.has(norm(k)));
}

// Parça adı anahtarı yoksa ilk anlamlı değer: sayı/tarih olmayan, makul uzunlukta bir metin
export function meaningfulTitle(entries: [string, string][]) {
  for (const [, v] of entries) {
    const s = v.trim();
    if (s.length < 2 || s.length > 60) continue;
    if (/^[\d\s.,/:%+-]+$/.test(s)) continue; // yıl, tutar, tarih
    if (/^(evet|hayır|yes|no|true|false|1|0)$/i.test(s)) continue;
    return s;
  }
  return null;
}

// Alan türüne göre değeri uyarlar; uymuyorsa null
export function coerce(type: string, options: string | null, v: string): string | null {
  if (type === 'boolean') {
    if (/^(1|evet|var|true|yes|✓)$/i.test(v.trim())) return '1';
    return null;
  }
  if (type === 'number') {
    const m = v.replace(/\s/g, '').match(/-?\d+(?:[.,]\d+)?/);
    return m ? m[0] : null;
  }
  if (type === 'select') {
    const opts: string[] = options ? JSON.parse(options) : [];
    const hit = opts.find(o => norm(o) === norm(v)) ?? opts.find(o => norm(v).includes(norm(o)));
    return hit ?? null;
  }
  return v;
}
