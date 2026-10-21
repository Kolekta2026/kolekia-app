import type { SQLiteDatabase } from 'expo-sqlite';
import type { CollectionTemplate, FieldTemplate } from '../constants/templates';

const norm = (s: string) => s.trim().toLocaleLowerCase('tr');

// Hazır şablonlara kullanıcının sonradan eklediği alanlar (settings: tpl_extra:<şablon>)
export async function loadExtras(db: SQLiteDatabase): Promise<Record<string, FieldTemplate[]>> {
  const rows = await db.getAllAsync<{ key: string; value: string }>(
    "SELECT key, value FROM settings WHERE key LIKE 'tpl_extra:%'"
  );
  const out: Record<string, FieldTemplate[]> = {};
  for (const r of rows) {
    try {
      out[r.key.slice('tpl_extra:'.length)] = JSON.parse(r.value);
    } catch {}
  }
  return out;
}

export function mergeExtras(templates: CollectionTemplate[], extras: Record<string, FieldTemplate[]>) {
  return templates.map(tp => {
    const add = (extras[tp.key] ?? []).filter(f => !tp.fields.some(x => norm(x.name) === norm(f.name)));
    return add.length ? { ...tp, fields: [...tp.fields, ...add] } : tp;
  });
}

// Alanı şablonun kendisine ekler; bundan sonra oluşturulan koleksiyonlarda da gelir
export async function addFieldToTemplate(db: SQLiteDatabase, key: string, field: FieldTemplate) {
  if (key.startsWith('u:')) {
    const id = Number(key.slice(2));
    const row = await db.getFirstAsync<{ fields: string }>('SELECT fields FROM user_templates WHERE id = ?', id);
    if (!row) return;
    const fields: FieldTemplate[] = JSON.parse(row.fields);
    if (fields.some(f => norm(f.name) === norm(field.name))) return;
    await db.runAsync('UPDATE user_templates SET fields = ? WHERE id = ?', JSON.stringify([...fields, field]), id);
    return;
  }
  const settingKey = `tpl_extra:${key}`;
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key = ?', settingKey);
  const fields: FieldTemplate[] = row ? JSON.parse(row.value) : [];
  if (fields.some(f => norm(f.name) === norm(field.name))) return;
  await db.runAsync(
    'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
    settingKey, JSON.stringify([...fields, field])
  );
}

// Aynı şablonu kullanan diğer koleksiyonlara alanı ekler (zaten olanları atlar)
export async function addFieldToCollections(
  db: SQLiteDatabase, templateKey: string, exceptCollectionId: number, field: FieldTemplate
) {
  const cols = await db.getAllAsync<{ id: number }>(
    'SELECT id FROM collections WHERE template = ? AND id <> ?', templateKey, exceptCollectionId
  );
  for (const c of cols) {
    const existing = await db.getAllAsync<{ name: string }>(
      'SELECT name FROM field_defs WHERE collection_id = ?', c.id
    );
    if (existing.some(e => norm(e.name) === norm(field.name))) continue;
    await db.runAsync(
      `INSERT INTO field_defs (collection_id, name, type, options, sort_order)
       VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM field_defs WHERE collection_id = ?))`,
      c.id, field.name, field.type, field.options ? JSON.stringify(field.options) : null, c.id
    );
  }
}
