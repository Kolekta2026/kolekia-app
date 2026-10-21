// Gemini ile fotoğraftan parça bilgisi çıkarma.
// İstek ya Kolekia'nın küçük ara sunucusuna (EXPO_PUBLIC_AI_PROXY, anahtar sunucuda saklanır)
// ya da doğrudan Gemini API'sine (EXPO_PUBLIC_GEMINI_KEY) gider. İkisi de yoksa özellik gizlenir.
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import type { SQLiteDatabase } from 'expo-sqlite';
import type { Lang } from './i18n';
import { parseLooseJson } from './aiFill';

const PROXY = process.env.EXPO_PUBLIC_AI_PROXY;
const KEY = process.env.EXPO_PUBLIC_GEMINI_KEY;
const MODEL = process.env.EXPO_PUBLIC_GEMINI_MODEL || 'gemini-3.1-flash-lite';

export const aiAvailable = !!(PROXY || KEY);

function instruction(fieldNames: string[], collection: string, lang: Lang) {
  const tr = lang === 'tr';
  const keys = [tr ? 'Parça adı' : 'Item name', ...fieldNames, tr ? 'Tahmini değer' : 'Estimated value', tr ? 'Para birimi' : 'Currency', tr ? 'Açıklama' : 'Description'];
  return tr
    ? `Fotoğraftaki koleksiyon parçasını tanımla (koleksiyon: ${collection}). Yanıtı tek bir JSON nesnesi olarak ver. Şu anahtarları kullan: ${keys.join(', ')}. Emin olmadığın anahtarı boş bırak, uydurma. Parçayı tanımlayan önemli başka özellikler varsa (en fazla 5) Türkçe yeni anahtarlar olarak ekle. Tüm değerler kısa metin olsun; Açıklama en fazla 2 cümle.`
    : `Identify the collectible in the photo (collection: ${collection}). Reply with a single JSON object. Use these keys: ${keys.join(', ')}. Leave a key empty if unsure, do not guess. If other important identifying details exist (at most 5), add them as new keys in English. Keep every value a short string; Description at most 2 sentences.`;
}

export async function identifyItem(
  uri: string, fieldNames: string[], collection: string, lang: Lang
): Promise<Record<string, string> | null> {
  // Fotoğraf küçültülür: daha hızlı ve daha az veri
  const ctx = ImageManipulator.manipulate(uri);
  ctx.resize({ width: 1024 });
  const img = await ctx.renderAsync();
  const res = await img.saveAsync({ format: SaveFormat.JPEG, compress: 0.75, base64: true });
  if (!res.base64) throw new Error('image');

  const body = {
    contents: [{
      parts: [
        { inline_data: { mime_type: 'image/jpeg', data: res.base64 } },
        { text: instruction(fieldNames, collection, lang) },
      ],
    }],
  };

  const url = PROXY
    ? PROXY
    : `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (!PROXY && KEY) headers['x-goog-api-key'] = KEY;
  if (PROXY) headers['x-kolekia'] = '1';

  // Google yoğunken (503/429) kısa aralıklarla iki kez daha denenir
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await new Promise(r => setTimeout(r, attempt * 2500));
    try {
      return await callOnce(url, headers, body);
    } catch (e: any) {
      lastErr = e;
      if (!e?.busy) throw e;
    }
  }
  const busy = new Error(lang === 'tr'
    ? 'Google\'ın yapay zekâ servisi şu an çok yoğun. Birkaç dakika sonra tekrar dene.'
    : "Google's AI service is very busy right now. Try again in a few minutes.");
  (busy as any).cause = lastErr;
  (busy as any).friendly = true;
  throw busy;
}

async function callOnce(url: string, headers: Record<string, string>, body: unknown) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PROXY ? 90000 : 30000);
  try {
    const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: ctrl.signal });
    const raw = await r.text();
    let json: any = null;
    try { json = JSON.parse(raw); } catch {}
    // Hata ayrıntısı kullanıcıya gösterilir (anahtar eksik, model adı yanlış, kota doldu vb.)
    if (!r.ok) {
      const err: any = new Error(`HTTP ${r.status}: ${json?.error?.message ?? raw.slice(0, 200)}`);
      err.busy = r.status === 503 || r.status === 429 || r.status === 504 || r.status === 500;
      throw err;
    }
    if (!json) throw new Error(raw.slice(0, 200));
    const text: string = (json?.candidates?.[0]?.content?.parts ?? [])
      .map((p: { text?: string }) => p.text ?? '').join('');
    return parseLooseJson(text);
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new Error('Zaman aşımı');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// Fotoğrafın Google'a gönderileceği bir kez sorulur (App Store 5.1.2: üçüncü taraf yapay zekâ ile paylaşım onayı)
export async function hasAiConsent(db: SQLiteDatabase) {
  const r = await db.getFirstAsync<{ value: string }>("SELECT value FROM settings WHERE key = 'ai_consent'");
  return r?.value === '1';
}

export async function setAiConsent(db: SQLiteDatabase) {
  await db.runAsync("INSERT OR REPLACE INTO settings (key, value) VALUES ('ai_consent', '1')");
}

// Ücretsiz günlük hak: cihaz başına günde AI_DAILY_LIMIT başarılı doldurma (yerel saatle gün)
export const AI_DAILY_LIMIT = 10;
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};

export async function aiRemaining(db: SQLiteDatabase) {
  const r = await db.getFirstAsync<{ value: string }>("SELECT value FROM settings WHERE key = 'ai_usage'");
  try {
    const u = r ? JSON.parse(r.value) : null;
    if (u?.date === today()) return Math.max(0, AI_DAILY_LIMIT - Number(u.n || 0));
  } catch {}
  return AI_DAILY_LIMIT;
}

export async function countAiUse(db: SQLiteDatabase) {
  const left = await aiRemaining(db);
  const n = AI_DAILY_LIMIT - left + 1;
  await db.runAsync(
    "INSERT OR REPLACE INTO settings (key, value) VALUES ('ai_usage', ?)",
    JSON.stringify({ date: today(), n })
  );
  return Math.max(0, AI_DAILY_LIMIT - n);
}
