import type { TFunction, Lang } from './i18n';

export type MarketSite = { label: string; url: string };

// Aranacak metin: ilk iki metin alanı (ör. marka, model) + parçanın adı, tekrar eden kelimeler atılır
export function buildQuery(title: string, textValues: string[]) {
  const seen = new Set<string>();
  const words: string[] = [];
  for (const part of [...textValues.slice(0, 2), title]) {
    for (const w of part.split(/\s+/)) {
      const k = w.toLocaleLowerCase('tr');
      if (w && !seen.has(k)) {
        seen.add(k);
        words.push(w);
      }
    }
  }
  return words.join(' ');
}

export function marketSites(query: string, template: string, lang: Lang, t: TFunction): MarketSite[] {
  const q = encodeURIComponent(query);
  const sites: MarketSite[] = [
    { label: 'sahibinden.com', url: `https://www.google.com/search?q=${encodeURIComponent('site:sahibinden.com ' + query)}` },
    { label: t('value.ebaySold'), url: `https://www.ebay.com/sch/i.html?_nkw=${q}&LH_Sold=1&LH_Complete=1` },
  ];
  if (template === 'watch') {
    sites.push({ label: 'Chrono24', url: `https://www.chrono24.com/search/index.htm?query=${q}` });
  }
  if (template === 'vinyl') {
    sites.push({ label: 'Discogs', url: `https://www.discogs.com/search/?q=${q}&type=all` });
  }
  sites.push({ label: 'Google', url: `https://www.google.com/search?q=${encodeURIComponent(query + ' ' + t('value.priceWord'))}` });
  return sites;
}
