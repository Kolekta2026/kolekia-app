import type { Currency } from './i18n';
import { convert, type Rates } from './fx';

export type SortMode = 'manual' | 'name' | 'value' | 'newest' | 'oldest';
export const SORT_MODES: SortMode[] = ['manual', 'name', 'value', 'newest', 'oldest'];

type Sortable = {
  id: number;
  title: string;
  sort_order: number;
  created_at: string;
  estimated_value: number | null;
  estimated_currency: string | null;
};

export function parseSortMode(v: string | undefined | null): SortMode {
  return SORT_MODES.includes(v as SortMode) ? (v as SortMode) : 'manual';
}

// Parçaları seçilen sıralamaya göre dizer. Değere göre sıralamada farklı para birimleri
// günlük kurla aynı birime çevrilerek karşılaştırılır; değeri olmayanlar sona kalır.
export function sortItems<T extends Sortable>(
  list: T[],
  mode: SortMode,
  opts: { currency: Currency; rates: Rates | null }
): T[] {
  const out = [...list];
  switch (mode) {
    case 'name':
      return out.sort((a, b) =>
        a.title.localeCompare(b.title, 'tr', { sensitivity: 'base', numeric: true })
      );
    case 'value': {
      const val = (i: T) => {
        if (i.estimated_value === null) return null;
        const c = (i.estimated_currency ?? opts.currency) as Currency;
        return convert(i.estimated_value, c, opts.currency, opts.rates) ?? i.estimated_value;
      };
      return out.sort((a, b) => {
        const va = val(a), vb = val(b);
        if (va === null && vb === null) return a.sort_order - b.sort_order;
        if (va === null) return 1;
        if (vb === null) return -1;
        return vb - va;
      });
    }
    case 'newest':
      return out.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : b.id - a.id));
    case 'oldest':
      return out.sort((a, b) => (a.created_at > b.created_at ? 1 : a.created_at < b.created_at ? -1 : a.id - b.id));
    default:
      return out.sort((a, b) => a.sort_order - b.sort_order || b.id - a.id);
  }
}
