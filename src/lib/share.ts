import { Share } from 'react-native';
import * as Sharing from 'expo-sharing';
import { Directory, File, Paths } from 'expo-file-system';

// Dışa aktarılan dosyalar uygulamanın geçici klasörüne yazılır
// (yedeklemede sorunsuz çalıştığı kanıtlanmış yöntem)
export function newExportFile(name: string) {
  // Önceki denemelerden aynı adla kalmış dosya ya da klasör varsa temizle
  try {
    const d = new Directory(Paths.cache, name);
    if (d.exists) d.delete();
  } catch {}
  const f = new File(Paths.cache, name);
  try {
    if (f.exists) f.delete();
  } catch {}
  return f;
}

// Aynı gün aynı kapsamda tekrar dışa aktarınca dosya adları çakışmasın
export const uniqueStamp = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
};

export async function shareUri(uri: string, mimeType: string, UTI: string) {
  try {
    await Sharing.shareAsync(uri, { mimeType, UTI });
  } catch (e) {
    // Yedek yol: iOS'un kendi paylaşım menüsü
    console.warn('expo-sharing başarısız, sistem paylaşımı deneniyor', e);
    await Share.share({ url: uri });
  }
}
