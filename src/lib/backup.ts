import JSZip from 'jszip';
import { Platform } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import type { SQLiteDatabase } from 'expo-sqlite';
import { DB_VERSION, seedValueHistory } from '../db/schema';
import { newExportFile, shareUri } from './share';
import { setProgress, yieldToUi } from './progress';

const FORMAT = 'koleksiyon-backup';

// Ekleme sırası: önce üst tablolar, sonra onlara bağlı olanlar
const TABLES = [
  'collections',
  'user_templates',
  'field_defs',
  'items',
  'item_values',
  'item_photos',
  'item_videos',
  'value_history',
  'settings',
  'shared_lists',
] as const;

type Row = Record<string, unknown>;
type BackupData = {
  format: string;
  schemaVersion: number;
  createdAt: string;
  tables: Record<string, Row[]>;
};
export type LoadedBackup = {
  data: BackupData;
  zip: JSZip;
  summary: { createdAt: string; collections: number; items: number; photos: number };
};

export class BackupError extends Error {
  constructor(public code: 'invalid' | 'tooNew') {
    super(code);
  }
}

// ---------- Yedek alma ----------

export async function createBackup(db: SQLiteDatabase, fileName: string) {
  const tables: Record<string, Row[]> = {};
  for (const t of TABLES) {
    tables[t] = await db.getAllAsync<Row>(`SELECT * FROM ${t}`);
  }

  const zip = new JSZip();
  const media = [...tables.item_photos, ...(tables.item_videos ?? [])];
  let done = 0;
  setProgress({ kind: 'backup', stage: 'collect', done, total: media.length });
  for (const row of media) {
    done++;
    if (done % 5 === 0 || done === media.length) {
      setProgress({ kind: 'backup', stage: 'collect', done, total: media.length });
      await yieldToUi();
    }
    const ref = String(row.uri);
    try {
      const file = ref.startsWith('file:') ? new File(ref) : new File(Paths.document, ref);
      if (!file.exists) continue;
      const path = ref.startsWith('file:') ? `photos/${file.name}` : ref;
      zip.file(path, await file.bytes());
      row.uri = path; // yedekte hep göreli yol tutulur
    } catch (e) {
      console.warn('Fotoğraf yedeğe eklenemedi', ref, e);
    }
  }

  // Arkadaş listelerinin fotoğrafları (shared/<id>/...)
  for (const row of tables.shared_lists ?? []) {
    try {
      const p = JSON.parse(String(row.payload));
      for (const c of p.collections ?? []) {
        for (const it of c.items ?? []) {
          const refs: string[] = [...(it.photos ?? []), ...(it.photo ? [it.photo] : [])];
          for (const ref of new Set(refs)) {
            if (typeof ref !== 'string' || !ref.startsWith('shared/')) continue;
            const f = new File(Paths.document, ref);
            if (f.exists) zip.file(ref, await f.bytes());
          }
        }
      }
    } catch {}
  }

  const data: BackupData = {
    format: FORMAT,
    schemaVersion: DB_VERSION,
    createdAt: new Date().toISOString(),
    tables,
  };
  zip.file('data.json', JSON.stringify(data));

  setProgress({ kind: 'backup', stage: 'build' });
  await yieldToUi();
  // Fotoğraflar zaten sıkıştırılmış (JPEG), tekrar sıkıştırmak sadece yavaşlatır
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'STORE' });

  const stamp = new Date().toISOString().slice(0, 10);
  const out = newExportFile(`${fileName}-${stamp}.zip`);
  out.create();
  out.write(bytes);
  setProgress(null); // paylaşım menüsünün önünde durmasın
  await shareUri(out.uri, 'application/zip', 'public.zip-archive');
}

// ---------- Yedek seçme ve kontrol ----------

export async function pickBackup(): Promise<LoadedBackup | null> {
  const res = await DocumentPicker.getDocumentAsync({
    // iPhone dosya türü adları (UTI) Android'de geçersiz; orada MIME türleri kullanılır
    type: Platform.OS === 'ios'
      ? ['application/zip', 'public.zip-archive', 'public.data']
      : ['application/zip', 'application/x-zip-compressed', 'application/octet-stream'],
    copyToCacheDirectory: true,
  });
  if (res.canceled) return null;

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(await new File(res.assets[0].uri).bytes());
  } catch {
    throw new BackupError('invalid');
  }
  const json = await zip.file('data.json')?.async('string');
  if (!json) throw new BackupError('invalid');

  let data: BackupData;
  try {
    data = JSON.parse(json);
  } catch {
    throw new BackupError('invalid');
  }
  if (data.format !== FORMAT || !data.tables) throw new BackupError('invalid');
  if (data.schemaVersion > DB_VERSION) throw new BackupError('tooNew');

  const items = (data.tables.items ?? []).filter(r => !r.deleted_at).length;
  return {
    data,
    zip,
    summary: {
      createdAt: data.createdAt,
      collections: (data.tables.collections ?? []).length,
      items,
      photos: (data.tables.item_photos ?? []).length,
    },
  };
}

// ---------- Geri yükleme ----------

export async function restoreBackup(db: SQLiteDatabase, { data, zip }: LoadedBackup) {
  setProgress({ kind: 'restore', stage: 'build' });
  // 1) Fotoğrafları yaz (adlar benzersiz; aynı ad varsa aynı dosyadır)
  const dir = new Directory(Paths.document, 'photos');
  if (!dir.exists) dir.create();
  for (const [path, entry] of Object.entries(zip.files)) {
    if (entry.dir || !(path.startsWith('photos/') || path.startsWith('shared/'))) continue;
    if (path.startsWith('shared/')) {
      // shared/<id>/ klasörlerini oluştur
      const parts = path.split('/');
      let d = new Directory(Paths.document, parts[0]);
      if (!d.exists) d.create();
      for (const part of parts.slice(1, -1)) {
        d = new Directory(d, part);
        if (!d.exists) d.create();
      }
    }
    const target = new File(Paths.document, path);
    if (target.exists) target.delete();
    target.create();
    target.write(await entry.async('uint8array'));
  }

  // 2) Veritabanını tek işlemde değiştir; hata olursa hiçbir şey değişmez
  const columns: Record<string, Set<string>> = {};
  for (const t of TABLES) {
    const info = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${t})`);
    columns[t] = new Set(info.map(c => c.name));
  }

  await db.withTransactionAsync(async () => {
    for (const t of [...TABLES].reverse()) {
      await db.runAsync(`DELETE FROM ${t}`);
    }
    for (const t of TABLES) {
      for (const row of data.tables[t] ?? []) {
        // Eski sürüm yedeklerinde olmayan sütunlar varsayılan değerini alır
        const cols = Object.keys(row).filter(c => columns[t].has(c));
        if (cols.length === 0) continue;
        await db.runAsync(
          `INSERT INTO ${t} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
          ...cols.map(c => row[c] as string | number | null)
        );
      }
    }
    // 1.7 öncesi yedeklerde değer geçmişi yok: mevcut tahmini değerler ilk kayıt olur
    await seedValueHistory(db);
  });

  // 3) Artık hiçbir parçaya ait olmayan eski fotoğrafları temizle
  const refs = new Set([...(data.tables.item_photos ?? []), ...(data.tables.item_videos ?? [])].map(r => String(r.uri)));
  for (const entry of dir.list()) {
    if (entry instanceof File && !refs.has(`photos/${entry.name}`)) {
      try { entry.delete(); } catch {}
    }
  }
}
