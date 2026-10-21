// Google Lens ekranından parça formuna metin taşımak için basit köprü.
// Form henüz kaydedilmemiş olabileceği için metin veritabanına değil, açık formun hikâye alanına eklenir.
type Listener = (text: string) => void;
let listener: Listener | null = null;

export function onLensText(fn: Listener) {
  listener = fn;
  return () => {
    if (listener === fn) listener = null;
  };
}

export function sendLensText(text: string): boolean {
  if (!listener) return false;
  listener(text);
  return true;
}

// Gemini'den kopyalanan JSON: alanlar doldurulur, yeni anahtarlar şablona eklenir
type JsonListener = (data: Record<string, string>) => void;
let jsonListener: JsonListener | null = null;

export function onLensJson(fn: JsonListener) {
  jsonListener = fn;
  return () => {
    if (jsonListener === fn) jsonListener = null;
  };
}

// Açık form yoksa veri bekletilir; düzenleme formu açılıp alanları yüklenince alınır
let pendingJson: Record<string, string> | null = null;

export function sendLensJson(data: Record<string, string>): boolean {
  if (!jsonListener) {
    pendingJson = data;
    return false;
  }
  jsonListener(data);
  return true;
}

export function takePendingJson() {
  const d = pendingJson;
  pendingJson = null;
  return d;
}
