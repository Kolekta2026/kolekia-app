import type { Lang } from '../lib/i18n';

export type FieldType = 'text' | 'number' | 'date' | 'select' | 'boolean';
export type FieldTemplate = { name: string; type: FieldType; options?: string[] };
export type CollectionTemplate = { key: string; label: string; fields: FieldTemplate[] };

type L = { tr: string; en: string };
type RawField = { name: L; type: FieldType; options?: L[] };
type RawTemplate = { key: string; label: L; fields: RawField[] };

const l = (tr: string, en: string): L => ({ tr, en });

const CONDITION = [
  l('Mükemmel', 'Mint'),
  l('Çok iyi', 'Excellent'),
  l('İyi', 'Good'),
  l('Orta', 'Fair'),
  l('Yıpranmış', 'Worn'),
];
const YEAR = { name: l('Yıl', 'Year'), type: 'number' as const };
const COUNTRY = { name: l('Ülke', 'Country'), type: 'text' as const };
const CONDITION_FIELD = { name: l('Kondisyon', 'Condition'), type: 'select' as const, options: CONDITION };

const RAW: RawTemplate[] = [
  {
    key: 'watch', label: l('Saat', 'Watch'),
    fields: [
      { name: l('Marka', 'Brand'), type: 'text' },
      { name: l('Model', 'Model'), type: 'text' },
      { name: l('Referans no', 'Reference no.'), type: 'text' },
      YEAR,
      {
        name: l('Mekanizma', 'Movement'), type: 'select',
        options: [l('Otomatik', 'Automatic'), l('Kurmalı', 'Manual wind'), l('Quartz', 'Quartz'), l('Akıllı saat', 'Smartwatch')],
      },
      { name: l('Kasa çapı (mm)', 'Case diameter (mm)'), type: 'number' },
      CONDITION_FIELD,
      { name: l('Kutu ve belgeler', 'Box & papers'), type: 'boolean' },
    ],
  },
  {
    key: 'coin', label: l('Madeni para', 'Coin'),
    fields: [COUNTRY, YEAR, { name: l('Değer', 'Denomination'), type: 'text' }, CONDITION_FIELD],
  },
  {
    key: 'stamp', label: l('Pul', 'Stamp'),
    fields: [COUNTRY, YEAR, { name: l('Seri', 'Series'), type: 'text' }, { name: l('Damgalı', 'Cancelled'), type: 'boolean' }],
  },
  {
    key: 'card', label: l('Kart', 'Card'),
    fields: [
      { name: l('Seri', 'Set'), type: 'text' },
      { name: l('Kart no', 'Card no.'), type: 'text' },
      { name: l('Oyuncu / karakter', 'Player / character'), type: 'text' },
      {
        name: l('Nadirlik', 'Rarity'), type: 'select',
        options: [l('Sıradan', 'Common'), l('Nadir', 'Rare'), l('Çok nadir', 'Very rare'), l('Özel baskı', 'Special edition')],
      },
    ],
  },
  {
    key: 'jersey', label: l('Forma', 'Jersey'),
    fields: [
      { name: l('Takım', 'Team'), type: 'text' },
      { name: l('Sezon', 'Season'), type: 'text' },
      { name: l('Oyuncu', 'Player'), type: 'text' },
      { name: l('Beden', 'Size'), type: 'select', options: ['XS', 'S', 'M', 'L', 'XL', 'XXL'].map(x => l(x, x)) },
      { name: l('İmzalı', 'Signed'), type: 'boolean' },
    ],
  },
  {
    key: 'vinyl', label: l('Plak', 'Vinyl'),
    fields: [
      { name: l('Sanatçı', 'Artist'), type: 'text' },
      YEAR,
      { name: l('Plak şirketi', 'Label'), type: 'text' },
      { name: l('Format', 'Format'), type: 'select', options: [l('LP', 'LP'), l("45'lik", '7" single'), l('EP', 'EP')] },
    ],
  },
  {
    key: 'book', label: l('Kitap', 'Book'),
    fields: [
      { name: l('Yazar', 'Author'), type: 'text' },
      { name: l('Yayınevi', 'Publisher'), type: 'text' },
      { name: l('Basım yılı', 'Year published'), type: 'number' },
      { name: l('Baskı', 'Edition'), type: 'text' },
    ],
  },
  {
    key: 'pen', label: l('Kalem', 'Pen'),
    fields: [
      { name: l('Marka', 'Brand'), type: 'text' },
      { name: l('Model', 'Model'), type: 'text' },
      {
        name: l('Tür', 'Type'), type: 'select',
        options: [
          l('Dolma kalem', 'Fountain pen'), l('Tükenmez', 'Ballpoint'), l('Roller', 'Rollerball'),
          l('Kurşun kalem', 'Pencil'), l('Versatil', 'Mechanical pencil'),
        ],
      },
      { name: l('Uç', 'Nib'), type: 'select', options: ['EF', 'F', 'M', 'B', 'BB', 'Stub'].map(x => l(x, x)).concat([l('İtalik', 'Italic')]) },
      {
        name: l('Dolum sistemi', 'Filling system'), type: 'select',
        options: [l('Kartuş', 'Cartridge'), l('Konverter', 'Converter'), l('Piston', 'Piston'), l('Vakum', 'Vacuum'), l('Diğer', 'Other')],
      },
      { name: l('Gövde malzemesi', 'Body material'), type: 'text' },
      YEAR,
      CONDITION_FIELD,
    ],
  },
  {
    key: 'decor', label: l('Dekoratif obje', 'Decorative object'),
    fields: [
      { name: l('Tür', 'Type'), type: 'text' },
      { name: l('Sanatçı / üretici', 'Artist / maker'), type: 'text' },
      {
        name: l('Malzeme', 'Material'), type: 'select',
        options: [
          l('Seramik', 'Ceramic'), l('Porselen', 'Porcelain'), l('Cam', 'Glass'), l('Metal', 'Metal'),
          l('Ahşap', 'Wood'), l('Taş', 'Stone'), l('Diğer', 'Other'),
        ],
      },
      { name: l('Dönem / yıl', 'Period / year'), type: 'text' },
      { name: l('Menşei', 'Origin'), type: 'text' },
      { name: l('Boyutlar', 'Dimensions'), type: 'text' },
      { name: l('İmzalı / damgalı', 'Signed / marked'), type: 'boolean' },
      CONDITION_FIELD,
    ],
  },
];

// Hazır şablonlar seçili dilde. Koleksiyon oluşturulunca alan adları
// koleksiyona o dilde kopyalanır (sonrasında kullanıcı verisi sayılır).
export function getTemplates(lang: Lang): CollectionTemplate[] {
  return RAW.map(t => ({
    key: t.key,
    label: t.label[lang],
    fields: t.fields.map(f => ({
      name: f.name[lang],
      type: f.type,
      ...(f.options ? { options: f.options.map(o => o[lang]) } : {}),
    })),
  }));
}

// Listede gösterilecek tür adı: hazır şablonlar dile göre, kullanıcı şablonları kendi adıyla
export function templateLabel(key: string, stored: string | null, lang: Lang, fallback: string) {
  const builtin = RAW.find(t => t.key === key);
  if (builtin) return builtin.label[lang];
  return stored ?? fallback;
}

export const FIELD_TYPES: FieldType[] = ['text', 'number', 'date', 'select', 'boolean'];
