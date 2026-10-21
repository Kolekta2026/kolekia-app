import { Directory, File, Paths } from 'expo-file-system';

// Seçilen fotoğraf geçici klasörde durur; kalıcı klasöre kopyalıyoruz.
// Veritabanına tam yol değil göreli yol (photos/xxx.jpg) yazıyoruz,
// çünkü iOS uygulama güncellemelerinde klasör yolunu değiştirebiliyor.
export function persistPhoto(tempUri: string): string {
  try {
    const dir = new Directory(Paths.document, 'photos');
    if (!dir.exists) dir.create();
    const src = new File(tempUri);
    const ext = src.extension || '.jpg';
    const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
    src.copy(new File(dir, name));
    return `photos/${name}`;
  } catch (e) {
    console.warn('Fotoğraf kopyalanamadı', e);
    return tempUri;
  }
}

export function photoUri(ref: string | null): string | null {
  if (!ref) return null;
  if (ref.startsWith('file:')) return ref;
  return new File(Paths.document, ref).uri;
}

// Parça silinince ya da fotoğraf kaldırılınca dosyayı da temizle
export function deletePhoto(ref: string) {
  try {
    const file = ref.startsWith('file:') ? new File(ref) : new File(Paths.document, ref);
    if (file.exists) file.delete();
  } catch (e) {
    console.warn('Fotoğraf silinemedi', e);
  }
}
