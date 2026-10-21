import type { SQLiteDatabase } from 'expo-sqlite';

const norm = (s: string) => s.trim().toLocaleLowerCase('tr');

type FieldDef = { id: number; name: string; type: string; options: string | null };

// Parçanın kopyasını aynı koleksiyonda, hemen arkasına oluşturur.
// Alanlar, değerler, durum ve hikâye kopyalanır; fotoğraflar kopyalanmaz
// (benzer bir parça girerken fotoğraflar genelde farklıdır).
export async function duplicateItem(db: SQLiteDatabase, itemId: number, suffix: string): Promise<number | null> {
  const it = await db.getFirstAsync<{
    collection_id: number; title: string; status: string; story: string | null; sort_order: number;
    purchase_price: number | null; estimated_value: number | null; valued_at: string | null;
    purchase_currency: string | null; estimated_currency: string | null;
  }>(
    `SELECT collection_id, title, status, story, sort_order, purchase_price, estimated_value, valued_at,
            purchase_currency, estimated_currency
     FROM items WHERE id = ?`, itemId
  );
  if (!it) return null;
  let newId = 0;
  await db.withTransactionAsync(async () => {
    // Kopya, orijinalin hemen arkasına yerleşsin diye sonraki parçalar bir kaydırılır
    await db.runAsync(
      'UPDATE items SET sort_order = sort_order + 1 WHERE collection_id = ? AND sort_order > ?',
      it.collection_id, it.sort_order
    );
    const res = await db.runAsync(
      `INSERT INTO items (collection_id, title, status, story, sort_order, purchase_price, estimated_value,
                          valued_at, purchase_currency, estimated_currency)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      it.collection_id, `${it.title} ${suffix}`, it.status, it.story, it.sort_order + 1,
      it.purchase_price, it.estimated_value, it.valued_at, it.purchase_currency, it.estimated_currency
    );
    newId = res.lastInsertRowId;
    await db.runAsync(
      'INSERT INTO item_values (item_id, field_id, value) SELECT ?, field_id, value FROM item_values WHERE item_id = ?',
      newId, itemId
    );
  });
  return newId;
}

// Parçanın dolu alanlarından hedef koleksiyonda karşılığı olmayanlar
export async function missingFields(db: SQLiteDatabase, itemId: number, targetCollectionId: number) {
  const used = await db.getAllAsync<FieldDef>(
    `SELECT f.id, f.name, f.type, f.options FROM item_values v JOIN field_defs f ON f.id = v.field_id
     WHERE v.item_id = ? AND v.value IS NOT NULL AND v.value <> ''`, itemId
  );
  const target = await db.getAllAsync<{ name: string }>(
    'SELECT name FROM field_defs WHERE collection_id = ?', targetCollectionId
  );
  const names = new Set(target.map(t => norm(t.name)));
  return used.filter(f => !names.has(norm(f.name)));
}

// Parçayı başka bir koleksiyona taşır. Değerler alan adına göre eşleştirilir;
// addMissing açıksa hedefte olmayan alanlar hedef koleksiyona eklenir, aksi halde o değerler bırakılır.
export async function moveItem(db: SQLiteDatabase, itemId: number, targetCollectionId: number, addMissing: boolean) {
  await db.withTransactionAsync(async () => {
    const values = await db.getAllAsync<FieldDef & { value: string }>(
      `SELECT f.id, f.name, f.type, f.options, v.value FROM item_values v JOIN field_defs f ON f.id = v.field_id
       WHERE v.item_id = ?`, itemId
    );
    const target = await db.getAllAsync<{ id: number; name: string }>(
      'SELECT id, name FROM field_defs WHERE collection_id = ?', targetCollectionId
    );
    const byName = new Map(target.map(t => [norm(t.name), t.id]));

    if (addMissing) {
      for (const v of values) {
        if (!v.value || byName.has(norm(v.name))) continue;
        const res = await db.runAsync(
          `INSERT INTO field_defs (collection_id, name, type, options, sort_order)
           VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM field_defs WHERE collection_id = ?))`,
          targetCollectionId, v.name, v.type, v.options, targetCollectionId
        );
        byName.set(norm(v.name), res.lastInsertRowId);
      }
    }

    await db.runAsync('DELETE FROM item_values WHERE item_id = ?', itemId);
    for (const v of values) {
      const fid = byName.get(norm(v.name));
      if (fid && v.value) {
        await db.runAsync('INSERT INTO item_values (item_id, field_id, value) VALUES (?, ?, ?)', itemId, fid, v.value);
      }
    }
    // Hedef koleksiyonun sonuna eklenir
    await db.runAsync(
      `UPDATE items SET collection_id = ?,
         sort_order = (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM items WHERE collection_id = ?)
       WHERE id = ?`,
      targetCollectionId, targetCollectionId, itemId
    );
  });
}
