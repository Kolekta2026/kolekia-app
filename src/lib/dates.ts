import type { Lang } from './i18n';

// Gün bazlı tarihler (satış, ödünç, dönüş) veritabanında "YYYY-MM-DD" olarak tutulur.
// Saat dilimi kayması olmasın diye hep yerel gün öğlesine göre hesaplanır.

const pad = (n: number) => String(n).padStart(2, '0');

export function toDay(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const today = () => toDay(new Date());

function fromDay(day: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12);
  return isNaN(d.getTime()) ? null : d;
}

export function addDays(day: string, n: number): string {
  const d = fromDay(day) ?? new Date();
  d.setDate(d.getDate() + n);
  return toDay(d);
}

export function addMonths(day: string, n: number): string {
  const d = fromDay(day) ?? new Date();
  d.setMonth(d.getMonth() + n);
  return toDay(d);
}

// Bugünden o güne kaç gün var (geçmişse negatif)
export function daysUntil(day: string): number | null {
  const d = fromDay(day);
  if (!d) return null;
  const now = fromDay(today())!;
  return Math.round((d.getTime() - now.getTime()) / 86400000);
}

// Ekranda: "22 Ekim 2026" / "October 22, 2026"
export function formatDay(day: string, lang: Lang): string {
  const d = fromDay(day);
  if (!d) return day;
  return d.toLocaleDateString(lang === 'tr' ? 'tr-TR' : 'en-US', { day: 'numeric', month: 'long', year: 'numeric' });
}

// Kutuya yazılan hâli: TR "22.10.2026", EN "10/22/2026"
export function dayToInput(day: string | null, lang: Lang): string {
  const d = day ? fromDay(day) : null;
  if (!d) return '';
  return lang === 'tr'
    ? `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`
    : `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${d.getFullYear()}`;
}

export const dayInputPlaceholder = (lang: Lang) => (lang === 'tr' ? 'GG.AA.YYYY' : 'MM/DD/YYYY');

// Kullanıcının yazdığını "YYYY-MM-DD"ye çevirir; anlaşılamazsa null
export function inputToDay(input: string, lang: Lang): string | null {
  const s = input.trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return fromDay(s) ? s : null;
  const parts = s.split(/[./\-\s]+/).map(Number);
  if (parts.length !== 3 || parts.some(n => !Number.isFinite(n))) return null;
  let [a, b, y] = parts;
  if (y < 100) y += 2000;
  const [day, month] = lang === 'tr' ? [a, b] : [b, a];
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(y, month - 1, day, 12);
  if (d.getMonth() !== month - 1) return null; // 31 Şubat gibi
  return toDay(d);
}

// SQLite'ın "YYYY-MM-DD HH:MM:SS" (UTC) zaman damgası için kısa tarih: "22 Eki 2026" / "Oct 22, 2026"
export function formatAdded(stamp: string, lang: Lang): string {
  const d = new Date(stamp.includes('T') ? stamp : stamp.replace(' ', 'T') + 'Z');
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString(lang === 'tr' ? 'tr-TR' : 'en-US', { day: 'numeric', month: 'short', year: 'numeric' });
}
