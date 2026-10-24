// "Örnek koleksiyonla dene": yeni kullanıcı uygulamayı dolu hâliyle gezebilsin diye
// birkaç örnek parça yüklenir. Örnek koleksiyonun kimliği ayarlarda tutulur;
// tek dokunuşla (fotoğraflarıyla birlikte) silinir.
import { Directory, File, Paths } from 'expo-file-system';
import type { SQLiteDatabase } from 'expo-sqlite';
import type { Lang } from './i18n';
import { DEMO_PHOTOS } from './demoPhotos';
import { base64ToBytes } from './shareData';
import { deleteItemsForever } from './trash';

const KEY = 'demo_collection';

type L = { tr: string; en: string };
type DemoItem = {
  title: L;
  status: 'owned' | 'wishlist' | 'trade';
  photo?: string; // DEMO_PHOTOS anahtarı
  story?: L;
  value?: number; // tahmini değer (TRY)
  fields: Record<'brand' | 'model' | 'year' | 'condition', L | undefined>;
};

const l = (tr: string, en: string): L => ({ tr, en });

const FIELDS = [
  { key: 'brand', name: l('Marka / üretici', 'Brand / maker'), type: 'text' },
  { key: 'model', name: l('Model', 'Model'), type: 'text' },
  { key: 'year', name: l('Yıl', 'Year'), type: 'text' },
  { key: 'condition', name: l('Kondisyon', 'Condition'), type: 'text' },
] as const;

const ITEMS: DemoItem[] = [
  {
    title: l('Gümüş cep saati', 'Silver pocket watch'),
    status: 'owned',
    photo: 'cep-saati',
    story: l(
      'Dedemden kaldı. Kapağının içinde baş harfleri kazılı; hâlâ her sabah kuruluyor.',
      "Inherited from my grandfather. His initials are engraved inside the lid; it still gets wound every morning."
    ),
    value: 18000,
    fields: { brand: undefined, model: undefined, year: l("1890'lar", '1890s'), condition: l('İyi', 'Good') },
  },
  {
    title: l('Bronz kadranlı dalgıç saat', 'Bronze-dial dive watch'),
    status: 'owned',
    photo: 'dalgic-saat',
    story: l(
      'İlk maaşımla aldığım saat. Yaz tatillerinin vazgeçilmezi.',
      'Bought with my first salary. A summer holiday essential.'
    ),
    value: 42000,
    fields: { brand: undefined, model: l('Dalgıç', 'Diver'), year: l('2022', '2022'), condition: l('Çok iyi', 'Excellent') },
  },
  {
    title: l('10 euro cent', '10 euro cent'),
    status: 'owned',
    photo: 'euro-cent',
    story: l('Bir Roma gezisinde cebimde kalan ilk euro.', 'The first euro left in my pocket after a trip to Rome.'),
    value: 150,
    fields: { brand: l('İtalya', 'Italy'), model: undefined, year: l('2002', '2002'), condition: l('Orta', 'Fair') },
  },
  {
    title: l('1 cent (ABD)', '1 cent (USA)'),
    status: 'trade',
    photo: 'abd-cent',
    value: 120,
    fields: { brand: l('ABD', 'USA'), model: undefined, year: l('1977', '1977'), condition: l('İyi', 'Good') },
  },
  {
    title: l('Sovyet film fotoğraf makinesi', 'Soviet film camera'),
    status: 'owned',
    photo: 'film-makinesi',
    story: l(
      'Babamın gençliğinden kalma. Helios lensiyle hâlâ fotoğraf çekiyor, ışık ölçeri biraz yorgun.',
      "From my father's youth. Still shoots with its Helios lens; the light meter is a little tired."
    ),
    value: 3500,
    fields: { brand: l('Zenit', 'Zenit'), model: l('E', 'E'), year: l('1970', '1970'), condition: l('İyi', 'Good') },
  },
  {
    title: l('İsveç taş plağı (78 devir)', 'Swedish 78 rpm shellac record'),
    status: 'owned',
    photo: 'tas-plak',
    story: l(
      'Bir sahafta orijinal kâğıt kılıfıyla buldum. Gramofonda hâlâ çalıyor.',
      'Found it at a second-hand shop in its original paper sleeve. Still plays on the gramophone.'
    ),
    value: 900,
    fields: { brand: l('Sonora', 'Sonora'), model: l('78 devir', '78 rpm'), year: l("1930'lar", '1930s'), condition: l('Orta', 'Fair') },
  },
  {
    title: l('Makaralı teyp', 'Reel-to-reel tape recorder'),
    status: 'owned',
    photo: 'makarali-teyp',
    story: l(
      'Rahmetli amcamın salonunun baş köşesindeydi. Makaraları da orijinal, ikisi hâlâ dönüyor.',
      "It had pride of place in my late uncle's living room. The reels are original and both still turn."
    ),
    value: 12000,
    fields: { brand: l('Grundig', 'Grundig'), model: l('TK 147 Hi-Fi Stereo', 'TK 147 Hi-Fi Stereo'), year: l("1960'lar", '1960s'), condition: l('Çok iyi', 'Excellent') },
  },
  {
    title: l('Karışık kasetler', 'Mixtapes'),
    status: 'owned',
    photo: 'kasetler',
    story: l(
      "Lise yıllarında radyodan kaydettiğim kasetler. Etiketlerin yarısı silinmiş ama hangisinde ne olduğunu hâlâ biliyorum.",
      "Tapes I recorded off the radio in high school. Half the labels have faded, but I still know what's on each one."
    ),
    value: 1500,
    fields: { brand: undefined, model: l('C60 / C90', 'C60 / C90'), year: l("1990'lar", '1990s'), condition: l('Orta', 'Fair') },
  },
  {
    title: l('Teneke yarış arabası', 'Tin racing car'),
    status: 'wishlist',
    photo: 'teneke-araba',
    story: l(
      'Bir antikacının vitrininde gördüm; 54 numaralı pembe yarışçı. Fiyatı düşerse alacağım.',
      "Spotted it in an antique shop window: the pink number 54 racer. If the price drops, it's mine."
    ),
    value: 2800,
    fields: { brand: undefined, model: l('No. 54', 'No. 54'), year: undefined, condition: l('İyi', 'Good') },
  },
];

export async function getDemoCollectionId(db: SQLiteDatabase): Promise<number | null> {
  const r = await db.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key = ?', KEY);
  const id = Number(r?.value);
  if (!id) return null;
  const exists = await db.getFirstAsync<{ id: number }>('SELECT id FROM collections WHERE id = ?', id);
  return exists ? id : null;
}

// Koda gömülü örnek fotoğrafı uygulamanın fotoğraf klasörüne yazar.
// (Paketlenmiş görsel dosyaları Android yayın sürümünde dosya yolu olarak okunamıyordu.)
async function bundlePhoto(key: string): Promise<string | null> {
  try {
    const data = DEMO_PHOTOS[key];
    if (!data) return null;
    const dir = new Directory(Paths.document, 'photos');
    if (!dir.exists) dir.create();
    const name = `demo-${key}-${Date.now()}.jpg`;
    const file = new File(dir, name);
    file.create();
    file.write(base64ToBytes(data));
    return `photos/${name}`;
  } catch {
    return null;
  }
}

export async function loadDemo(db: SQLiteDatabase, lang: Lang): Promise<number> {
  const existing = await getDemoCollectionId(db);
  if (existing) return existing;

  // Fotoğraflar işlemden önce kopyalanır (işlem içinde dosya işi yapılmaz)
  const refs = await Promise.all(ITEMS.map(it => (it.photo ? bundlePhoto(it.photo) : Promise.resolve(null))));

  let colId = 0;
  await db.withTransactionAsync(async () => {
    const col = await db.runAsync(
      `INSERT INTO collections (name, template, template_label, sort_order)
       VALUES (?, 'general', NULL, (SELECT COALESCE(MIN(sort_order), 0) - 1 FROM collections))`,
      lang === 'tr' ? 'Örnek koleksiyon' : 'Sample collection'
    );
    colId = col.lastInsertRowId;

    const fieldIds: Record<string, number> = {};
    for (const [i, f] of FIELDS.entries()) {
      const r = await db.runAsync(
        'INSERT INTO field_defs (collection_id, name, name_tr, name_en, type, options, sort_order) VALUES (?, ?, ?, ?, ?, NULL, ?)',
        colId, f.name[lang], f.name.tr, f.name.en, f.type, i
      );
      fieldIds[f.key] = r.lastInsertRowId;
    }

    for (const [i, it] of ITEMS.entries()) {
      const r = await db.runAsync(
        `INSERT INTO items (collection_id, title, status, story, estimated_value, estimated_currency, valued_at, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        colId, it.title[lang], it.status, it.story?.[lang] ?? null,
        it.value ?? null, it.value ? 'TRY' : null, it.value ? new Date().toISOString() : null, i
      );
      const itemId = r.lastInsertRowId;
      for (const f of FIELDS) {
        const v = it.fields[f.key];
        if (v) {
          await db.runAsync(
            'INSERT INTO item_values (item_id, field_id, value) VALUES (?, ?, ?)', itemId, fieldIds[f.key], v[lang]
          );
        }
      }
      if (refs[i]) {
        await db.runAsync('INSERT INTO item_photos (item_id, uri, sort_order) VALUES (?, ?, 0)', itemId, refs[i]!);
      }
    }
    await db.runAsync('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', KEY, String(colId));
  });
  return colId;
}

// 1.7 öncesi Android'de örnek fotoğraflar kopyalanamamıştı (kayıtta geçersiz yol kaldı).
// Örnek koleksiyon duruyorsa bu parçaların fotoğrafları yeniden yazılır.
export async function repairDemoPhotos(db: SQLiteDatabase) {
  const id = await getDemoCollectionId(db);
  if (!id) return false;
  const broken = await db.getAllAsync<{ photo_id: number; sort_order: number }>(`
    SELECT p.id AS photo_id, i.sort_order FROM item_photos p JOIN items i ON i.id = p.item_id
     WHERE i.collection_id = ? AND p.uri NOT LIKE 'photos/%' AND p.uri NOT LIKE 'file:%'`, id);
  let fixed = false;
  for (const b of broken) {
    const key = ITEMS[b.sort_order]?.photo;
    const ref = key ? await bundlePhoto(key) : null;
    if (ref) {
      await db.runAsync('UPDATE item_photos SET uri = ? WHERE id = ?', ref, b.photo_id);
      fixed = true;
    }
  }
  return fixed;
}

// Örnek koleksiyonu fotoğraflarıyla birlikte tamamen siler
export async function removeDemo(db: SQLiteDatabase) {
  const id = await getDemoCollectionId(db);
  if (id) {
    const rows = await db.getAllAsync<{ id: number }>('SELECT id FROM items WHERE collection_id = ?', id);
    await deleteItemsForever(db, rows.map(r => r.id));
    await db.runAsync('DELETE FROM collections WHERE id = ?', id);
  }
  await db.runAsync('DELETE FROM settings WHERE key = ?', KEY);
}
