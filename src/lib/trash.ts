import type { SQLiteDatabase } from 'expo-sqlite';
import { deletePhoto } from './photos';

export const TRASH_DAYS = 30;

// Parçaları, fotoğraf ve video dosyalarını kalıcı olarak siler
export async function deleteItemsForever(db: SQLiteDatabase, ids: number[]) {
  if (ids.length === 0) return;
  const marks = ids.map(() => '?').join(',');
  const photos = await db.getAllAsync<{ uri: string }>(
    `SELECT uri FROM item_photos WHERE item_id IN (${marks})`, ...ids
  );
  const videos = await db.getAllAsync<{ uri: string }>(
    `SELECT uri FROM item_videos WHERE item_id IN (${marks})`, ...ids
  );
  await db.runAsync(`DELETE FROM items WHERE id IN (${marks})`, ...ids);
  [...photos, ...videos].forEach(p => deletePhoto(p.uri));
}

// Süresi dolan parçaları temizle (uygulama her açıldığında)
export async function purgeExpiredTrash(db: SQLiteDatabase) {
  const rows = await db.getAllAsync<{ id: number }>(
    `SELECT id FROM items
      WHERE deleted_at IS NOT NULL
        AND deleted_at <= datetime('now', '-${TRASH_DAYS} days')`
  );
  await deleteItemsForever(db, rows.map(r => r.id));
}
