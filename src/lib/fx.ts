import { useEffect, useState } from 'react';
import { useSQLiteContext, type SQLiteDatabase } from 'expo-sqlite';
import { CURRENCIES, type Currency, type Lang, type TFunction } from './i18n';
import { formatDate, formatMoney } from './money';

// Avrupa Merkez Bankası'nın günlük referans kurları (1 EUR karşılığı).
// Ücretsiz, anahtarsız; isteğe kullanıcıya ait hiçbir bilgi eklenmez.
const ECB_URL = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

export type Rates = { date: string; fetchedAt: number; perEur: Record<string, number> };

export async function loadCachedRates(db: SQLiteDatabase): Promise<Rates | null> {
  const row = await db.getFirstAsync<{ value: string }>("SELECT value FROM settings WHERE key = 'fx'");
  if (!row) return null;
  try {
    return JSON.parse(row.value) as Rates;
  } catch {
    return null;
  }
}

async function fetchRates(): Promise<Rates | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(ECB_URL, { signal: ctrl.signal });
    if (!res.ok) return null;
    const xml = await res.text();
    const date = /time=['"](\d{4}-\d{2}-\d{2})['"]/.exec(xml)?.[1];
    const perEur: Record<string, number> = { EUR: 1 };
    for (const m of xml.matchAll(/currency=['"]([A-Z]{3})['"]\s+rate=['"]([\d.]+)['"]/g)) {
      perEur[m[1]] = parseFloat(m[2]);
    }
    if (!date || CURRENCIES.some(c => !perEur[c])) return null;
    return { date, fetchedAt: Date.now(), perEur };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Önbellekteki kurlar yeterince yeniyse onları, değilse yenilerini döndürür
let inflight: Promise<Rates | null> | null = null;
export async function refreshRates(db: SQLiteDatabase): Promise<Rates | null> {
  const cached = await loadCachedRates(db);
  if (cached && Date.now() - cached.fetchedAt < MAX_AGE_MS) return cached;
  if (!inflight) {
    inflight = fetchRates().finally(() => { inflight = null; });
  }
  const fresh = await inflight;
  if (fresh) {
    await db.runAsync("INSERT OR REPLACE INTO settings (key, value) VALUES ('fx', ?)", JSON.stringify(fresh));
    return fresh;
  }
  return cached; // internet yoksa son bilinen kurlar
}

export function useFxRates() {
  const db = useSQLiteContext();
  const [rates, setRates] = useState<Rates | null>(null);
  useEffect(() => {
    let alive = true;
    loadCachedRates(db).then(r => { if (alive && r) setRates(r); });
    refreshRates(db).then(r => { if (alive && r) setRates(r); });
    return () => { alive = false; };
  }, [db]);
  return rates;
}

export function convert(amount: number, from: Currency, to: Currency, rates: Rates | null): number | null {
  if (from === to) return amount;
  if (!rates) return null;
  const a = rates.perEur[from], b = rates.perEur[to];
  if (!a || !b) return null;
  return (amount / a) * b;
}

export type Amount = { v: number; c: Currency };

// Toplam: hepsi aynı birimdeyse kesin; farklı birimler varsa kurla çevrilip "≈" ile;
// kur yoksa birim birim ("₺26.000 + $1.200")
export function summarize(amounts: Amount[], display: Currency, rates: Rates | null, lang: Lang, t: TFunction) {
  if (amounts.length === 0) return null;
  const byCur = new Map<Currency, number>();
  for (const a of amounts) byCur.set(a.c, (byCur.get(a.c) ?? 0) + a.v);
  const currencies = [...byCur.keys()];

  if (currencies.length === 1) {
    const [c] = currencies;
    const exact = formatMoney(byCur.get(c)!, c, lang);
    if (c === display) return { text: t('value.total', { v: exact }), note: null };
    const conv = convert(byCur.get(c)!, c, display, rates);
    if (conv === null) return { text: t('value.total', { v: exact }), note: null };
    return {
      text: t('value.total', { v: exact }),
      note: `≈ ${formatMoney(conv, display, lang)} · ${t('fx.note', { date: formatDate(`${rates!.date}T12:00:00Z`, lang) })}`,
    };
  }

  let sum = 0;
  for (const [c, v] of byCur) {
    const conv = convert(v, c, display, rates);
    if (conv === null) {
      const parts = currencies.map(cc => formatMoney(byCur.get(cc)!, cc, lang)).join(' + ');
      return { text: t('value.total', { v: parts }), note: null };
    }
    sum += conv;
  }
  return {
    text: t('value.total', { v: `≈ ${formatMoney(sum, display, lang)}` }),
    note: t('fx.note', { date: formatDate(`${rates!.date}T12:00:00Z`, lang) }),
  };
}
