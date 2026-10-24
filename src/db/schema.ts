import type { SQLiteDatabase } from 'expo-sqlite';

export const DB_VERSION = 10;

export async function migrateDb(db: SQLiteDatabase) {
  // Yabancı anahtarlar her bağlantıda ayrıca açılmalı
  await db.execAsync('PRAGMA foreign_keys = ON;');

  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  let version = row?.user_version ?? 0;
  if (version >= DB_VERSION) return;

  if (version === 0) {
    await db.execAsync(`
      PRAGMA journal_mode = WAL;

      CREATE TABLE IF NOT EXISTS collections (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT NOT NULL,
        template    TEXT NOT NULL,
        icon        TEXT,
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS field_defs (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        collection_id  INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
        name           TEXT NOT NULL,
        type           TEXT NOT NULL,          -- text | number | date | select | boolean
        options        TEXT,                   -- select için JSON dizi
        sort_order     INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS items (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        collection_id  INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
        title          TEXT NOT NULL,
        status         TEXT NOT NULL DEFAULT 'owned',   -- owned | wishlist | trade | loaned | sold
        photo_uri      TEXT,
        story          TEXT,
        created_at     TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS item_values (
        item_id   INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
        field_id  INTEGER NOT NULL REFERENCES field_defs(id) ON DELETE CASCADE,
        value     TEXT,
        PRIMARY KEY (item_id, field_id)
      );
    `);
    version = 1;
  }

  // v2: parça başına birden fazla fotoğraf
  if (version < 2) {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS item_photos (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        item_id     INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
        uri         TEXT NOT NULL,
        sort_order  INTEGER NOT NULL DEFAULT 0   -- 0 = kapak fotoğrafı
      );
      CREATE INDEX IF NOT EXISTS idx_item_photos_item ON item_photos(item_id, sort_order);

      -- Eski tek fotoğraf alanını yeni tabloya taşı
      INSERT INTO item_photos (item_id, uri, sort_order)
        SELECT id, photo_uri, 0 FROM items WHERE photo_uri IS NOT NULL;
      UPDATE items SET photo_uri = NULL;
    `);
    version = 2;
  }

  // v3: uygulama ayarları (ör. ana ekran görünümü)
  if (version < 3) {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS settings (
        key    TEXT PRIMARY KEY,
        value  TEXT
      );
    `);
    version = 3;
  }

  // v4: kullanıcı şablonları ve elle sıralama
  if (version < 4) {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS user_templates (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT NOT NULL,
        fields      TEXT NOT NULL,              -- JSON: [{ name, type, options? }]
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );

      ALTER TABLE collections ADD COLUMN template_label TEXT;
      ALTER TABLE collections ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE items ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;

      -- Mevcut sırayı (en yeni en üstte) başlangıç sırası olarak yaz
      UPDATE collections SET sort_order = (
        SELECT COUNT(*) FROM collections c2
         WHERE c2.created_at > collections.created_at
            OR (c2.created_at = collections.created_at AND c2.id > collections.id)
      );
      UPDATE items SET sort_order = (
        SELECT COUNT(*) FROM items i2
         WHERE i2.collection_id = items.collection_id
           AND (i2.created_at > items.created_at
                OR (i2.created_at = items.created_at AND i2.id > items.id))
      );
    `);
    version = 4;
  }

  // v5: geri dönüşüm kutusu (silinen parçalar 30 gün saklanır)
  if (version < 5) {
    await db.execAsync(`
      ALTER TABLE items ADD COLUMN deleted_at TEXT;
      CREATE INDEX IF NOT EXISTS idx_items_deleted ON items(deleted_at);
    `);
    version = 5;
  }

  // v6: değer takibi (alış fiyatı, tahmini değer, değerleme tarihi)
  if (version < 6) {
    await db.execAsync(`
      ALTER TABLE items ADD COLUMN purchase_price REAL;
      ALTER TABLE items ADD COLUMN estimated_value REAL;
      ALTER TABLE items ADD COLUMN valued_at TEXT;
    `);
    version = 6;
  }

  // v7: her tutarın kendi para birimi. Mevcut tutarlar o anki ayar para birimiyle işaretlenir.
  if (version < 7) {
    await db.execAsync(`
      ALTER TABLE items ADD COLUMN purchase_currency TEXT;
      ALTER TABLE items ADD COLUMN estimated_currency TEXT;
      UPDATE items SET purchase_currency =
        COALESCE((SELECT value FROM settings WHERE key = 'currency'), 'TRY')
        WHERE purchase_price IS NOT NULL;
      UPDATE items SET estimated_currency =
        COALESCE((SELECT value FROM settings WHERE key = 'currency'), 'TRY')
        WHERE estimated_value IS NOT NULL;
    `);
    version = 7;
  }

  // v8: arkadaşlardan gelen (PDF içinden içe aktarılan) salt okunur listeler
  if (version < 8) {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS shared_lists (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        title        TEXT NOT NULL,
        sender       TEXT,
        payload      TEXT NOT NULL,          -- JSON; fotoğraflar shared/<id>/ klasöründe
        received_at  TEXT NOT NULL DEFAULT (datetime('now')),
        sort_order   INTEGER NOT NULL DEFAULT 0
      );
    `);
    version = 8;
  }

  // v9 (1.7): satıldı / ödünç verildi bilgileri ve tahmini değer geçmişi
  if (version < 9) {
    await db.execAsync(`
      ALTER TABLE items ADD COLUMN sold_price REAL;
      ALTER TABLE items ADD COLUMN sold_currency TEXT;
      ALTER TABLE items ADD COLUMN sold_at TEXT;          -- YYYY-MM-DD
      ALTER TABLE items ADD COLUMN loaned_to TEXT;
      ALTER TABLE items ADD COLUMN loaned_at TEXT;        -- YYYY-MM-DD
      ALTER TABLE items ADD COLUMN loan_due TEXT;         -- YYYY-MM-DD, boş = dönüş tarihi yok

      CREATE TABLE IF NOT EXISTS value_history (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        item_id      INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
        value        REAL NOT NULL,
        currency     TEXT NOT NULL,
        recorded_at  TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_value_history_item ON value_history(item_id, recorded_at);
    `);
    await seedValueHistory(db);
    version = 9;
  }

  // v10 (1.7): alan adlarının iki dildeki karşılığı (dil değişince ad bunlardan seçilir)
  if (version < 10) {
    await db.execAsync(`
      ALTER TABLE field_defs ADD COLUMN name_tr TEXT;
      ALTER TABLE field_defs ADD COLUMN name_en TEXT;
    `);
    version = 10;
  }

  await db.execAsync(`PRAGMA user_version = ${DB_VERSION}`);
}

// Geçmişi olmayan parçalar için bugünkü tahmini değer ilk kayıt olur
// (v9 geçişinde ve değer geçmişi içermeyen eski bir yedekten dönüldüğünde)
export async function seedValueHistory(db: SQLiteDatabase) {
  await db.runAsync(`
    INSERT INTO value_history (item_id, value, currency, recorded_at)
    SELECT i.id, i.estimated_value,
           COALESCE(i.estimated_currency, (SELECT value FROM settings WHERE key = 'currency'), 'TRY'),
           COALESCE(i.valued_at, i.created_at)
      FROM items i
     WHERE i.estimated_value IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM value_history h WHERE h.item_id = i.id)`);
}
