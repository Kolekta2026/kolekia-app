import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRawStream, PDFString } from 'pdf-lib';
import * as PDFLib from 'pdf-lib';
import { inflate } from 'pako';
import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import type { SQLiteDatabase } from 'expo-sqlite';

// PDF'in içine gömülen Kolekia verisi
export const PAYLOAD_NAME = 'kolekta.json';
const FORMAT = 'kolekta-share';

export type SharedItem = {
  title: string;
  status: string;
  story?: string | null;
  fields: { name: string; value: string }[];
  purchase?: { v: number; c: string } | null;
  estimated?: { v: number; c: string } | null;
  photo?: string | null; // kapak; paylaşımda base64 JPEG, içe aktarınca göreli dosya yolu
  photos?: string[]; // tüm fotoğraflar (ilki kapak); aynı biçimde
};
export type SharedPayload = {
  format: string;
  v: number;
  title: string;
  createdAt: string;
  lang: string;
  includeValues: boolean;
  collections: { name: string; label: string; items: SharedItem[] }[];
};

export class ShareImportError extends Error {
  constructor(public code: 'noData' | 'invalid') {
    super(code);
  }
}

// ---------- UTF-8 (Hermes'te TextEncoder/Decoder'a güvenmemek için) ----------

export function utf8Encode(str: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
      const d = str.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
        i++;
      }
    }
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return new Uint8Array(out);
}

export function utf8Decode(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const a = bytes[i++];
    let c: number;
    if (a < 0x80) c = a;
    else if (a < 0xe0) c = ((a & 31) << 6) | (bytes[i++] & 63);
    else if (a < 0xf0) c = ((a & 15) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63);
    else c = ((a & 7) << 18) | ((bytes[i++] & 63) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63);
    if (c > 0xffff) {
      c -= 0x10000;
      out += String.fromCharCode(0xd800 + (c >> 10), 0xdc00 + (c & 1023));
    } else out += String.fromCharCode(c);
  }
  return out;
}

// ---------- Base64 ----------

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_LOOKUP = new Uint8Array(256);
for (let i = 0; i < B64.length; i++) B64_LOOKUP[B64.charCodeAt(i)] = i;

export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const a = B64_LOOKUP[clean.charCodeAt(i)];
    const b = B64_LOOKUP[clean.charCodeAt(i + 1)];
    const c = B64_LOOKUP[clean.charCodeAt(i + 2)];
    const d = B64_LOOKUP[clean.charCodeAt(i + 3)];
    out[o++] = (a << 2) | (b >> 4);
    if (i + 2 < clean.length) out[o++] = ((b & 15) << 4) | (c >> 2);
    if (i + 3 < clean.length) out[o++] = ((c & 3) << 6) | d;
  }
  return out.subarray(0, o);
}

// ---------- PDF'e gömme / PDF'ten çıkarma ----------

export async function embedPayload(pdfBytes: Uint8Array, payload: SharedPayload): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdfBytes);
  await doc.attach(utf8Encode(JSON.stringify(payload)), PAYLOAD_NAME, {
    mimeType: 'application/json',
    description: 'Kolekia data',
    creationDate: new Date(),
    modificationDate: new Date(),
  });
  doc.setTitle(payload.title);
  doc.setProducer('Kolekia');
  doc.setCreator('Kolekia');
  return doc.save();
}

function streamBytes(stream: PDFRawStream): Uint8Array {
  const decode = (PDFLib as unknown as { decodePDFRawStream?: (s: PDFRawStream) => { decode: () => Uint8Array } })
    .decodePDFRawStream;
  if (decode) {
    try {
      return decode(stream).decode();
    } catch {}
  }
  const filter = stream.dict.lookup(PDFName.of('Filter'));
  const raw = stream.getContents();
  return filter && String(filter).includes('FlateDecode') ? inflate(raw) : raw;
}

export async function extractPayload(pdfBytes: Uint8Array): Promise<SharedPayload> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true, updateMetadata: false });
  } catch {
    throw new ShareImportError('invalid');
  }
  const names = doc.catalog.lookupMaybe(PDFName.of('Names'), PDFDict);
  const embedded = names?.lookupMaybe(PDFName.of('EmbeddedFiles'), PDFDict);
  const list = embedded?.lookupMaybe(PDFName.of('Names'), PDFArray);
  if (!list) throw new ShareImportError('noData');

  for (let i = 0; i + 1 < list.size(); i += 2) {
    const key = list.lookup(i);
    const name = key instanceof PDFString || key instanceof PDFHexString ? key.decodeText() : '';
    if (name !== PAYLOAD_NAME) continue;
    const spec = list.lookup(i + 1, PDFDict);
    const ef = spec.lookup(PDFName.of('EF'), PDFDict);
    const stream = ef.lookup(PDFName.of('F')) as PDFRawStream;
    try {
      const payload = JSON.parse(utf8Decode(streamBytes(stream))) as SharedPayload;
      if (payload.format !== FORMAT || !Array.isArray(payload.collections)) throw new Error();
      return payload;
    } catch {
      throw new ShareImportError('invalid');
    }
  }
  throw new ShareImportError('noData');
}

// ---------- İçe aktarma ----------

// Dosyanın içeriğini okur. Android'de "Birlikte aç" ile gelen content:// adresleri
// dosya sistemiyle okunamayabildiği için fetch ile yedek bir yol var.
async function readBytes(uri: string): Promise<Uint8Array> {
  try {
    return await new File(uri).bytes();
  } catch {
    const res = await fetch(uri);
    return new Uint8Array(await res.arrayBuffer());
  }
}

export async function importFromUri(db: SQLiteDatabase, uri: string): Promise<number> {
  const bytes = await readBytes(uri);
  const payload = await extractPayload(bytes);

  const res = await db.runAsync(
    `INSERT INTO shared_lists (title, payload, sort_order)
     VALUES (?, '{}', (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM shared_lists))`,
    payload.title
  );
  const id = res.lastInsertRowId;

  // Fotoğrafları kendi klasörüne yaz, JSON'da göreli yol tut
  const root = new Directory(Paths.document, 'shared');
  if (!root.exists) root.create();
  const dir = new Directory(root, String(id));
  if (!dir.exists) dir.create();
  payload.collections.forEach((c, ci) =>
    c.items.forEach((it, ii) => {
      // Eski sürümlerden gelen paylaşımlarda sadece kapak var
      const sources = it.photos?.length ? it.photos : it.photo ? [it.photo] : [];
      const paths: string[] = [];
      sources.forEach((b64, k) => {
        try {
          const name = `${ci}-${ii}-${k}.jpg`;
          const f = new File(dir, name);
          if (f.exists) f.delete();
          f.create();
          f.write(base64ToBytes(b64));
          paths.push(`shared/${id}/${name}`);
        } catch {}
      });
      it.photos = paths;
      it.photo = paths[0] ?? null;
    })
  );
  await db.runAsync('UPDATE shared_lists SET payload = ? WHERE id = ?', JSON.stringify(payload), id);
  return id;
}

export async function pickAndImport(db: SQLiteDatabase): Promise<number | null> {
  const res = await DocumentPicker.getDocumentAsync({
    type: ['application/pdf'],
    copyToCacheDirectory: true,
  });
  if (res.canceled) return null;
  return importFromUri(db, res.assets[0].uri);
}

export async function deleteSharedList(db: SQLiteDatabase, id: number) {
  await db.runAsync('DELETE FROM shared_lists WHERE id = ?', id);
  try {
    const dir = new Directory(Paths.document, 'shared', String(id));
    if (dir.exists) dir.delete();
  } catch {}
}

export async function loadSharedList(db: SQLiteDatabase, id: number) {
  const row = await db.getFirstAsync<{ id: number; title: string; sender: string | null; payload: string; received_at: string }>(
    'SELECT id, title, sender, payload, received_at FROM shared_lists WHERE id = ?', id
  );
  if (!row) return null;
  return { ...row, data: JSON.parse(row.payload) as SharedPayload };
}
