// Alan adlarını iki dilde tutar. field_defs.name her zaman ekranda görünen dildeki addır;
// name_tr / name_en karşılıkları hazır şablonlardan, yapay zekânın verdiği çiftlerden
// ya da alanın oluşturulduğu dilden gelir. Dil değişince ad ve seçim seçenekleri çevrilir.
import type { SQLiteDatabase } from 'expo-sqlite';
import type { Lang } from './i18n';
import { FIELD_PAIRS, OPTION_PAIRS } from '../constants/templates';

export type Pair = { tr: string; en: string };

const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLocaleLowerCase('tr');
const KEY = 'field_pairs';

function index(pairs: Pair[]) {
  const m = new Map<string, Pair>();
  for (const p of pairs) {
    if (!m.has(norm(p.tr))) m.set(norm(p.tr), p);
    if (!m.has(norm(p.en))) m.set(norm(p.en), p);
  }
  return m;
}
const OPTIONS = index(OPTION_PAIRS);

async function learned(db: SQLiteDatabase): Promise<Pair[]> {
  const r = await db.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key = ?', KEY);
  try {
    const v = r ? JSON.parse(r.value) : [];
    return Array.isArray(v) ? v.filter(p => p && typeof p.tr === 'string' && typeof p.en === 'string') : [];
  } catch {
    return [];
  }
}

// Yapay zekânın verdiği yeni alan çiftlerini hatırlar (aynı alan başka koleksiyonlarda da çevrilsin)
export async function learnPairs(db: SQLiteDatabase, pairs: Pair[]) {
  const fresh = pairs.filter(p => p.tr.trim() && p.en.trim() && norm(p.tr) !== norm(p.en));
  if (!fresh.length) return;
  const all = await learned(db);
  const known = index(all);
  const add = fresh.filter(p => !known.has(norm(p.tr)) && !known.has(norm(p.en)));
  if (!add.length) return;
  await db.runAsync(
    'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', KEY, JSON.stringify([...all, ...add].slice(-500))
  );
}

// "Türkçe ad | English name" biçimindeki anahtarı ayırır; tek dil geldiyse ikisi aynı olur
export function splitPair(key: string): Pair {
  const [a, b] = key.split('|').map(x => x.trim()).filter(Boolean);
  return { tr: a ?? key.trim(), en: b ?? a ?? key.trim() };
}

// Tüm alanları verilen dile getirir.
// stamp: karşılığı bilinmeyen alanların şu anki adı bu dilin karşılığı olarak kaydedilir
// (ad o an bu dilde göründüğü için doğrudur). Dil değiştirirken önce eski dille stamp=true,
// sonra yeni dille stamp=false çağrılır.
export async function localizeFields(db: SQLiteDatabase, lang: Lang, stamp: boolean) {
  const dict = index([...FIELD_PAIRS, ...(await learned(db))]);
  const rows = await db.getAllAsync<{
    id: number; name: string; name_tr: string | null; name_en: string | null; type: string; options: string | null;
  }>('SELECT id, name, name_tr, name_en, type, options FROM field_defs');

  await db.withTransactionAsync(async () => {
    for (const r of rows) {
      const p = dict.get(norm(r.name)) ?? (r.name_tr ? dict.get(norm(r.name_tr)) : undefined)
        ?? (r.name_en ? dict.get(norm(r.name_en)) : undefined);
      let tr = r.name_tr ?? p?.tr ?? null;
      let en = r.name_en ?? p?.en ?? null;
      if (stamp) {
        if (lang === 'tr' && !tr) tr = r.name;
        if (lang === 'en' && !en) en = r.name;
      }
      const name = (lang === 'tr' ? tr : en) ?? r.name;

      // Hazır şablon seçenekleri (Mükemmel ↔ Mint) ve o alana girilmiş değerler de çevrilir
      let options = r.options;
      if (r.type === 'select' && r.options) {
        try {
          const list: string[] = JSON.parse(r.options);
          const mapped = list.map(o => OPTIONS.get(norm(o))?.[lang] ?? o);
          if (mapped.some((o, i) => o !== list[i])) {
            options = JSON.stringify(mapped);
            for (const [i, o] of list.entries()) {
              if (mapped[i] !== o) {
                await db.runAsync('UPDATE item_values SET value = ? WHERE field_id = ? AND value = ?', mapped[i], r.id, o);
              }
            }
          }
        } catch {}
      }

      if (name !== r.name || tr !== r.name_tr || en !== r.name_en || options !== r.options) {
        await db.runAsync(
          'UPDATE field_defs SET name = ?, name_tr = ?, name_en = ?, options = ? WHERE id = ?',
          name, tr, en, options, r.id
        );
      }
    }
  });
}
