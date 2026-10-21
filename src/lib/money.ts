import type { Currency, Lang } from './i18n';

const locale = (lang: Lang) => (lang === 'tr' ? 'tr-TR' : 'en-US');

export function formatMoney(value: number, currency: Currency, lang: Lang) {
  try {
    return new Intl.NumberFormat(locale(lang), {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `${Math.round(value)} ${currency}`;
  }
}

// Kullanıcının yazdığı tutarı sayıya çevir: TR "12.500,50", EN "12,500.50"
export function parseMoney(input: string, lang: Lang): number | null {
  let s = input.replace(/[^\d.,-]/g, '');
  if (!s) return null;
  s = lang === 'tr' ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

// Düzenleme ekranında kutuya yazılacak sade hali
export function moneyToInput(value: number | null, lang: Lang) {
  if (value === null || value === undefined) return '';
  const s = String(Math.round(value * 100) / 100);
  return lang === 'tr' ? s.replace('.', ',') : s;
}

export function formatDate(iso: string, lang: Lang) {
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  return d.toLocaleDateString(locale(lang), { day: 'numeric', month: 'long', year: 'numeric' });
}
