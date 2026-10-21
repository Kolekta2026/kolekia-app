import * as Print from 'expo-print';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { Asset } from 'expo-asset';
import { Archivo_400Regular, Archivo_800ExtraBold, Archivo_900Black } from '@expo-google-fonts/archivo';
import { File } from 'expo-file-system';
import type { SQLiteDatabase } from 'expo-sqlite';
import type { Currency, Lang, TFunction } from './i18n';
import { APP_NAME } from '../constants/brand';
import { templateLabel } from '../constants/templates';
import { photoUri } from './photos';
import { newExportFile, shareUri, uniqueStamp } from './share';
import { formatDate, formatMoney } from './money';
import { loadCachedRates, summarize } from './fx';
import { base64ToBytes, embedPayload, type SharedPayload } from './shareData';

type Field = { name: string; type: string; value: string };
type ExportItem = {
  id: number;
  title: string;
  status: string;
  story: string | null;
  purchase_price: number | null;
  estimated_value: number | null;
  purchase_currency: string | null;
  estimated_currency: string | null;
  valued_at: string | null;
  cover: string | null;
  photo_count: number;
  fields: Field[];
};
type ExportCollection = {
  id: number;
  name: string;
  label: string;
  fieldNames: string[];
  items: ExportItem[];
};

type Ctx = { t: TFunction; lang: Lang; currency: Currency };

// Ne paylaşılacak: tüm koleksiyonlar, tek koleksiyon (isteğe bağlı durum filtresiyle) ya da tek parça
export type Scope = { collectionId: number | null; status?: string | null; itemId?: number | null };

// ---------- Veriyi topla ----------

async function loadData(db: SQLiteDatabase, scope: Scope, ctx: Ctx) {
  const { collectionId } = scope;
  const where = collectionId === null ? '' : 'WHERE id = ?';
  const cols = await db.getAllAsync<{ id: number; name: string; template: string; template_label: string | null }>(
    `SELECT id, name, template, template_label FROM collections ${where} ORDER BY sort_order, id DESC`,
    ...(collectionId === null ? [] : [collectionId])
  );

  const result: ExportCollection[] = [];
  for (const c of cols) {
    const defs = await db.getAllAsync<{ id: number; name: string; type: string }>(
      'SELECT id, name, type FROM field_defs WHERE collection_id = ? ORDER BY sort_order', c.id
    );
    const items = await db.getAllAsync<Omit<ExportItem, 'fields'>>(`
      SELECT i.id, i.title, i.status, i.story, i.purchase_price, i.estimated_value, i.valued_at,
        i.purchase_currency, i.estimated_currency,
        (SELECT p.uri FROM item_photos p WHERE p.item_id = i.id ORDER BY p.sort_order LIMIT 1) AS cover,
        (SELECT COUNT(*) FROM item_photos p WHERE p.item_id = i.id) AS photo_count
      FROM items i
      WHERE i.collection_id = ? AND i.deleted_at IS NULL
        AND (? IS NULL OR i.status = ?)
        AND (? IS NULL OR i.id = ?)
      ORDER BY i.sort_order, i.id DESC
    `, c.id, scope.status ?? null, scope.status ?? null, scope.itemId ?? null, scope.itemId ?? null);
    const values = await db.getAllAsync<{ item_id: number; field_id: number; value: string }>(`
      SELECT v.item_id, v.field_id, v.value FROM item_values v
      JOIN items i ON i.id = v.item_id
      WHERE i.collection_id = ? AND i.deleted_at IS NULL
    `, c.id);
    const byItem = new Map<number, Map<number, string>>();
    for (const v of values) {
      if (!byItem.has(v.item_id)) byItem.set(v.item_id, new Map());
      byItem.get(v.item_id)!.set(v.field_id, v.value);
    }

    result.push({
      id: c.id,
      name: c.name,
      label: templateLabel(c.template, c.template_label, ctx.lang, ctx.t('home.custom')),
      fieldNames: defs.map(d => d.name),
      items: items.map(it => ({
        ...it,
        fields: defs.map(d => {
          const raw = byItem.get(it.id)?.get(d.id) ?? '';
          const value = d.type === 'boolean' ? (raw === '1' ? ctx.t('common.yes') : '') : raw;
          return { name: d.name, type: d.type, value };
        }),
      })),
    });
  }
  return result;
}

// Dosya adında sadece İngilizce harf, rakam ve tire kalsın; paylaşım modülü
// Türkçe karakterli ya da özel işaretli dosya yollarında erişim hatası verebiliyor
const TR_MAP: Record<string, string> = {
  ç: 'c', Ç: 'C', ğ: 'g', Ğ: 'G', ı: 'i', İ: 'I', ö: 'o', Ö: 'O', ş: 's', Ş: 'S', ü: 'u', Ü: 'U',
};
const safeName = (s: string) =>
  s
    .normalize('NFC')
    .replace(/[çÇğĞıİöÖşŞüÜ]/g, ch => TR_MAP[ch])
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'export';


// ---------- CSV ----------

export async function exportCsv(db: SQLiteDatabase, collectionId: number | null, scopeName: string, ctx: Ctx) {
  const { t, lang } = ctx;
  const data = await loadData(db, { collectionId }, ctx);
  const count = data.reduce((n, c) => n + c.items.length, 0);
  if (count === 0) return false;

  // Türkçe Excel noktalı virgül bekler (virgül ondalık ayracıdır)
  const sep = lang === 'tr' ? ';' : ',';
  const cell = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /["\n\r;,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const num = (n: number | null) =>
    n === null ? '' : lang === 'tr' ? String(n).replace('.', ',') : String(n);

  // Tüm koleksiyonlardaki alanlar tek başlık satırında birleşir
  const fieldNames: string[] = [];
  for (const c of data) for (const f of c.fieldNames) if (!fieldNames.includes(f)) fieldNames.push(f);

  const header = [
    t('csv.collection'), t('csv.type'), t('csv.item'), t('csv.status'),
    ...fieldNames,
    t('value.purchase'), t('csv.purchaseCurrency'), t('value.estimated'), t('csv.estimatedCurrency'), t('csv.valuedAt'), t('form.story'), t('csv.photos'),
  ];
  const rows = [header.map(cell).join(sep)];
  for (const c of data) {
    for (const it of c.items) {
      const fv = new Map(it.fields.map(f => [f.name, f.value]));
      rows.push([
        c.name, c.label, it.title, t(`status.${it.status}` as 'status.owned'),
        ...fieldNames.map(n => fv.get(n) ?? ''),
        num(it.purchase_price), it.purchase_price === null ? '' : it.purchase_currency ?? ctx.currency,
        num(it.estimated_value), it.estimated_value === null ? '' : it.estimated_currency ?? ctx.currency,
        it.valued_at ? formatDate(it.valued_at, lang) : '',
        it.story ?? '', it.photo_count,
      ].map(cell).join(sep));
    }
  }

  const file = newExportFile(`${APP_NAME}-${safeName(scopeName)}-${uniqueStamp()}.csv`);
  file.create();
  file.write('\uFEFF' + rows.join('\r\n')); // BOM: Excel Türkçe karakterleri doğru okusun
  await shareUri(file.uri, 'text/csv', 'public.comma-separated-values-text');
  return true;
}

// ---------- PDF ----------

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// PDF'i hafif tutmak için fotoğraflar küçültülüp gömülür
async function thumbData(ref: string | null, width = 600): Promise<string | null> {
  const uri = photoUri(ref);
  if (!uri) return null;
  try {
    const ctx = ImageManipulator.manipulate(uri);
    ctx.resize({ width });
    const img = await ctx.renderAsync();
    const res = await img.saveAsync({ format: SaveFormat.JPEG, compress: 0.72, base64: true });
    return res.base64 ? `data:image/jpeg;base64,${res.base64}` : null;
  } catch {
    try {
      return `data:image/jpeg;base64,${await new File(uri).base64()}`;
    } catch {
      return null;
    }
  }
}

// Uygulamanın fontu (Archivo) PDF'e gömülür; bulunamazsa sistem fontu kullanılır
let fontCss: string | null = null;
async function loadFontCss(): Promise<string> {
  if (fontCss !== null) return fontCss;
  const faces: string[] = [];
  const weights: [number, number][] = [
    [400, Archivo_400Regular],
    [800, Archivo_800ExtraBold],
    [900, Archivo_900Black],
  ];
  for (const [w, mod] of weights) {
    try {
      const asset = Asset.fromModule(mod);
      await asset.downloadAsync();
      if (!asset.localUri) continue;
      const b64 = await new File(asset.localUri).base64();
      faces.push(`@font-face { font-family: 'Archivo'; font-weight: ${w}; src: url(data:font/ttf;base64,${b64}) format('truetype'); }`);
    } catch {}
  }
  fontCss = faces.join('\n');
  return fontCss;
}

const CSS = `
  @page { margin: 34px 38px; }
  * { box-sizing: border-box; }
  /* Arka plan renkleri (logo karesi, boş fotoğraf zemini) yazdırmada da korunsun */
  html, body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: 'Archivo', -apple-system, 'Helvetica Neue', Arial, sans-serif; color: #000; margin: 0; font-weight: 400; }
  b, .k { font-weight: 800; }
  .top { display: flex; justify-content: space-between; align-items: center; font-size: 10px; margin-bottom: 18px; }
  .brand { display: flex; align-items: center; gap: 8px; font-weight: 800; font-size: 14px; letter-spacing: -0.2px; }
  .mark { width: 20px; height: 20px; background: #000; color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 900; font-size: 13px; }
  section + section { page-break-before: always; }
  h1 { font-weight: 900; font-size: 46px; letter-spacing: -1.8px; line-height: 1; margin: 0; }
  .sub { font-size: 12px; margin-top: 8px; padding-bottom: 12px; border-bottom: 3px solid #000; }
  .ph { background: #f2f2f2; display: flex; align-items: center; justify-content: center; font-weight: 900; color: #d4d4d4; overflow: hidden; }
  img { display: block; object-fit: cover; }

  /* Tek parça */
  .collage { display: flex; gap: 6px; height: 330px; }
  .collage img { width: 100%; height: 100%; }
  .c-cell { flex: 1; min-width: 0; height: 100%; }
  .c-big { flex: 62; min-width: 0; height: 100%; }
  .c-side { flex: 38; min-width: 0; height: 100%; display: flex; flex-direction: column; gap: 6px; }
  .c-side.grid { flex-direction: row; flex-wrap: wrap; }
  .c-side img { width: 100%; }
  .c-side.grid img { width: calc(50% - 3px); height: calc(50% - 3px); }
  .status { font-weight: 800; font-size: 11px; margin-top: 22px; }
  .title { font-weight: 900; font-size: 38px; letter-spacing: -1.4px; line-height: 1.05; margin-top: 4px; }
  .coll { font-size: 12px; margin-top: 4px; padding-bottom: 12px; border-bottom: 2px solid #000; }
  .props { display: flex; flex-wrap: wrap; column-gap: 24px; }
  .prop { width: calc(50% - 12px); padding: 9px 0 8px; border-bottom: 0.6px solid #cfcfcf; page-break-inside: avoid; }
  .prop .k { display: block; font-size: 10px; }
  .prop .v { display: block; font-size: 13px; margin-top: 2px; }
  .story { font-size: 12px; line-height: 1.55; margin-top: 18px; }
  .story .k { display: block; font-size: 10px; margin-bottom: 4px; }

  /* Katalog */
  .cards { display: flex; flex-wrap: wrap; column-gap: 22px; margin-top: 20px; }
  .card { width: calc(50% - 11px); margin-bottom: 22px; page-break-inside: avoid; }
  .page + .page { page-break-before: always; }
  .card .photo { width: 100%; height: 175px; }
  .mini { display: flex; gap: 4px; margin-top: 4px; }
  .mini img { width: 32px; height: 32px; }
  .card .name { font-weight: 800; font-size: 15px; letter-spacing: -0.3px; margin-top: 10px; }
  .card .line { font-size: 10.5px; margin-top: 4px; }
  .card .st { font-weight: 800; font-size: 10px; margin-top: 8px; }

  /* Liste */
  .row { display: flex; align-items: center; gap: 16px; padding: 12px 0; border-bottom: 0.6px solid #cfcfcf; page-break-inside: avoid; }
  .row .photo { width: 88px; height: 88px; flex-shrink: 0; }
  .row .body { flex: 1; min-width: 0; }
  .row .no { font-weight: 800; font-size: 9px; }
  .row .name { font-weight: 800; font-size: 16px; letter-spacing: -0.3px; margin-top: 2px; }
  .row .line { font-size: 10.5px; margin-top: 6px; }
  .row .line span + span { margin-left: 12px; }
  .box { width: 16px; height: 16px; border: 1.3px solid #000; flex-shrink: 0; }
`;

function collageHtml(cover: string, others: string[]) {
  const img = (src: string, style = '') => `<img src="${src}"${style ? ` style="${style}"` : ''} />`;
  if (others.length === 0) return `<div class="collage"><div class="c-cell">${img(cover)}</div></div>`;
  if (others.length === 1) {
    return `<div class="collage"><div class="c-cell">${img(cover)}</div><div class="c-cell">${img(others[0])}</div></div>`;
  }
  if (others.length <= 3) {
    const h = `height: calc((100% - ${(others.length - 1) * 6}px) / ${others.length});`;
    return `<div class="collage"><div class="c-big">${img(cover)}</div><div class="c-side">${others.map(o => img(o, h)).join('')}</div></div>`;
  }
  return `<div class="collage"><div class="c-big">${img(cover)}</div><div class="c-side grid">${others.slice(0, 4).map(o => img(o)).join('')}</div></div>`;
}

export async function exportPdf(
  db: SQLiteDatabase,
  scope: Scope,
  scopeName: string,
  ctx: Ctx,
  opts: { includeValues: boolean } = { includeValues: true }
) {
  const { t, lang, currency } = ctx;
  const { includeValues } = opts;
  const data = await loadData(db, scope, ctx);
  const count = data.reduce((n, c) => n + c.items.length, 0);
  if (count === 0) return false;

  const money = (v: number, c: string | null) => formatMoney(v, (c ?? currency) as Currency, lang);
  const today = formatDate(new Date().toISOString(), lang);
  const rates = await loadCachedRates(db);
  const initial = (s: string) => esc(s.charAt(0).toLocaleUpperCase('tr'));
  const top = (right: string) =>
    `<div class="top"><div class="brand"><div class="mark">K</div>${APP_NAME}</div><div>${esc(right)}</div></div>`;

  // Bir parçanın gösterilecek özellikleri (değerler isteğe bağlı)
  const propsOf = (it: ExportItem) => {
    const list = it.fields.filter(f => f.value).map(f => ({ k: f.name, v: f.value }));
    if (includeValues && it.estimated_value !== null) list.push({ k: t('value.estimated'), v: money(it.estimated_value, it.estimated_currency) });
    if (includeValues && it.purchase_price !== null) list.push({ k: t('value.purchase'), v: money(it.purchase_price, it.purchase_currency) });
    return list;
  };
  const statusText = (s: string) => esc(t(`status.${s}` as 'status.owned'));

  const payload: SharedPayload = {
    format: 'kolekta-share',
    v: 1,
    title: scopeName,
    createdAt: new Date().toISOString(),
    lang,
    includeValues,
    collections: [],
  };

  const layout: 'item' | 'list' | 'catalog' =
    scope.itemId ? 'item' : scope.status === 'wishlist' || scope.status === 'trade' ? 'list' : 'catalog';

  const sections: string[] = [];
  for (const c of data) {
    if (c.items.length === 0) continue;
    const shared: SharedPayload['collections'][number] = { name: c.name, label: c.label, items: [] };
    payload.collections.push(shared);

    const parts: string[] = [];
    const MAX_PHOTOS = 10; // parça başına içe aktarmaya konan en fazla fotoğraf
    for (const [idx, it] of c.items.entries()) {
      const cover = await thumbData(it.cover, layout === 'item' ? 1200 : 600);
      // Kapak dışındaki fotoğraflar (hem PDF'te küçük kareler hem içe aktarma verisi için)
      const extraRefs = await db.getAllAsync<{ uri: string }>(
        'SELECT uri FROM item_photos WHERE item_id = ? ORDER BY sort_order LIMIT ? OFFSET 1', it.id, MAX_PHOTOS - 1
      );
      const others: string[] = [];
      for (const p of extraRefs) {
        const d = await thumbData(p.uri, 500);
        if (d) others.push(d);
      }
      // İçe aktarma verisine kapak her zaman küçük boyutlu konur
      const small = layout === 'item' ? await thumbData(it.cover, 600) : cover;
      const strip = (d: string) => d.replace(/^data:image\/jpeg;base64,/, '');
      const photos = [...(small ? [strip(small)] : []), ...others.map(strip)];
      shared.items.push({
        title: it.title,
        status: it.status,
        story: it.story,
        fields: it.fields.filter(f => f.value).map(f => ({ name: f.name, value: f.value })),
        purchase: includeValues && it.purchase_price !== null ? { v: it.purchase_price, c: it.purchase_currency ?? currency } : null,
        estimated: includeValues && it.estimated_value !== null ? { v: it.estimated_value, c: it.estimated_currency ?? currency } : null,
        photo: photos[0] ?? null,
        photos,
      });
      const props = propsOf(it);

      if (layout === 'item') {
        // Tüm fotoğraflar tek bir kolajda: 1 tam, 2 yan yana, 3-4 büyük + sağda sütun, 5 büyük + sağda 2x2
        parts.push(`
          ${top(today)}
          ${cover ? collageHtml(cover, others.slice(0, 4)) : `<div class="collage ph" style="font-size:120px">${initial(it.title)}</div>`}
          <div class="status">${statusText(it.status)}</div>
          <div class="title">${esc(it.title)}</div>
          <div class="coll">${esc(c.name)}</div>
          <div class="props">${props.map(p => `<div class="prop"><span class="k">${esc(p.k)}</span><span class="v">${esc(p.v)}</span></div>`).join('')}</div>
          ${it.story ? `<div class="story"><span class="k">${esc(t('form.story'))}</span>${esc(it.story)}</div>` : ''}`);
      } else if (layout === 'list') {
        parts.push(`
          <div class="row">
            ${cover ? `<img class="photo" src="${cover}" />` : `<div class="photo ph" style="font-size:36px">${initial(it.title)}</div>`}
            <div class="body">
              <div class="no">${String(idx + 1).padStart(2, '0')}</div>
              <div class="name">${esc(it.title)}</div>
              <div class="line">${props.slice(0, 4).map(p => `<span><b>${esc(p.k)}</b> ${esc(p.v)}</span>`).join('')}</div>
            </div>
            <div class="box"></div>
          </div>`);
      } else {
        parts.push(`
          <div class="card">
            ${cover ? `<img class="photo" src="${cover}" />` : `<div class="photo ph" style="font-size:64px">${initial(it.title)}</div>`}
            ${others.length ? `<div class="mini">${others.slice(0, 6).map(o => `<img src="${o}" />`).join('')}</div>` : ''}
            ${it.status !== 'owned' ? `<div class="st">${statusText(it.status)}</div>` : ''}
            <div class="name">${esc(it.title)}</div>
            ${props.slice(0, 3).map(p => `<div class="line"><b>${esc(p.k)}</b> ${esc(p.v)}</div>`).join('')}
          </div>`);
      }
    }

    if (layout === 'item') {
      sections.push(`<section>${parts.join('')}</section>`);
    } else {
      const owned = c.items.filter(i => i.status === 'owned' && i.estimated_value !== null)
        .map(i => ({ v: i.estimated_value!, c: (i.estimated_currency ?? currency) as Currency }));
      const total = includeValues ? summarize(owned, currency, rates, lang, t) : null;
      const heading = layout === 'list'
        ? t(scope.status === 'wishlist' ? 'pdf.wishlist' : 'pdf.tradeList')
        : c.name;
      const subParts = layout === 'list'
        ? [c.name, t('export.itemCount', { n: c.items.length })]
        : [c.label, t('export.itemCount', { n: c.items.length }), ...(total ? [total.text] : [])];

      // Sayfalara biz bölüyoruz: iPhone'un PDF motoru kartları ortasından bölebiliyor.
      // Katalogda sayfa başına 2 sıra (4 kart), listede 5 satır.
      const perPage = layout === 'list' ? 5 : 4;
      const pages: string[] = [];
      for (let i = 0; i < parts.length; i += perPage) {
        const chunk = parts.slice(i, i + perPage).join('');
        const head = i === 0
          ? `${top(layout === 'list' ? today : t('export.catalog'))}
             <h1>${esc(heading)}</h1>
             <div class="sub">${subParts.map(esc).join('&nbsp;&nbsp;·&nbsp;&nbsp;')}</div>`
          : top(heading);
        pages.push(`<div class="page">${head}${layout === 'list' ? chunk : `<div class="cards">${chunk}</div>`}</div>`);
      }
      sections.push(`<section>${pages.join('')}</section>`);
    }
  }

  const fonts = await loadFontCss();
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8" /><style>${fonts}\n${CSS}</style></head><body>${sections.join('')}</body></html>`;

  // PDF'i içerik (base64) olarak alıp kendi klasörümüze yazıyoruz; Kolekia kullanan biri
  // içe aktarabilsin diye veriyi PDF'in içine ek olarak gömüyoruz
  // A4 boyutu ve kenar boşlukları (iOS @page kuralını her zaman uygulamıyor)
  const { base64 } = await Print.printToFileAsync({
    html,
    base64: true,
    width: 595,
    height: 842,
    margins: { left: 38, right: 38, top: 34, bottom: 34 },
  });
  if (!base64) throw new Error('PDF could not be created');
  const pdf = await embedPayload(base64ToBytes(base64), payload);
  const file = newExportFile(`${APP_NAME}-${safeName(scopeName)}-${uniqueStamp()}.pdf`);
  file.create();
  file.write(pdf);
  await shareUri(file.uri, 'application/pdf', 'com.adobe.pdf');
  return true;
}
