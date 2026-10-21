# Kolekia'ya hoş geldin 👋

Kolekia, her türlü koleksiyonu (saat, forma, para, kart, plak…) fotoğraflarıyla takip etmeye yarayan bir mobil uygulama. App Store'da yayında, Google Play'e de çıkıyor. Bu belge, projeye kod tarafında katkı vermeye başlaman için gereken her şeyi anlatıyor.

Takıldığın her yerde soru sormaktan çekinme. Burada hiçbir soru saçma değil.

---

## 1. Teknoloji

| Ne | Ne işe yarıyor |
|---|---|
| **React Native + Expo (SDK 57)** | Tek kodla iOS ve Android uygulaması |
| **TypeScript** | Tipli JavaScript; hataları yazarken yakalar |
| **expo-router** | Ekranlar `src/app` klasöründeki dosyalardan oluşur (dosya = ekran) |
| **expo-sqlite** | Tüm veri telefonda, SQLite veritabanında durur. Sunucu ya da hesap yok |
| **Cloudflare Worker + Google Gemini** | "Yapay zekâ ile doldur" özelliği. Fotoğrafı tanıyıp alanları doldurur |

---

## 2. Kurulum (Windows)

1. Şunları kur:
   - [Node.js LTS](https://nodejs.org)
   - [Git](https://git-scm.com)
   - [VS Code](https://code.visualstudio.com)
   - Telefonuna **Expo Go** uygulaması
2. GitHub'da sana gelen davetiyeyi kabul et.
3. PowerShell'de projeyi indir ve kur:
   ```
   git clone https://github.com/Kolekta2026/kolekia-app.git kolekia
   cd kolekia
   npm.cmd install
   ```
4. Uygulamayı başlat:
   ```
   npx.cmd expo start
   ```
   Ekrana gelen QR kodu Expo Go ile okut, uygulama telefonunda açılır. Kodda bir şey değiştirip kaydettiğinde telefonda anında yenilenir.

> **Neden `.cmd`?** Windows PowerShell normalde `npm` ve `npx` betiklerini engelliyor, `npm.cmd` / `npx.cmd` bu engeli aşıyor. Kalıcı çözüm olarak bir kez şunu çalıştırabilirsin:
> `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`

> **"Yapay zekâ ile doldur" butonunu göremeyeceksin.** Bu normal: butonun çalışması için gereken `.env` ayarı sende yok. Uygulamanın geri kalanı tamamen çalışır.

---

## 3. Proje haritası

```
src/
  app/                  Ekranlar (expo-router: dosya yolu = ekran adresi)
    index.tsx           Ana ekran (koleksiyon şeridi, parça ızgarası, seçme modu)
    collection/[id]/    Koleksiyon ekranı, toplu ekleme (batch), alan düzenleme (fields)
    item/[itemId]/      Parça detayı ve düzenleme
    settings.tsx        Ayarlar (tema, dil, kilit, para birimi…)
    lens.tsx            Google Lens ile görselle arama
  components/
    ItemForm.tsx        Parça ekleme/düzenleme formu (yapay zekâ doldurma burada)
    ui.tsx              Ortak bileşenler: PrimaryButton, Chips, Segmented…
    AddSheet.tsx        Ana ekrandaki "Ekle" alt menüsü
  constants/
    templates.ts        Hazır koleksiyon şablonları (Saat, Para, Forma, Plak…)
    theme.ts            Renk temaları, yazı tipleri, durumlar (STATUS_KEYS)
  db/
    schema.ts           Veritabanı tabloları ve sürüm geçişleri (migration)
  lib/
    i18n.tsx            Tüm Türkçe/İngilizce metinler ve t() fonksiyonu
    theme.tsx           useTheme() ve useStyles(); renkler buradan gelir
    aiFill.ts           Yapay zekâdan gelen JSON'u okuma ve alanlarla eşleştirme
    gemini.ts           Yapay zekâ isteği, günlük hak sayacı
    detect*.ts          Toplu eklemede fotoğraftaki bölmeleri bulan algoritmalar
```

### Bilmen gereken 4 kural

1. **Metinler doğrudan yazılmaz.** Ekranda görünen her metin `lib/i18n.tsx` içinde hem Türkçe hem İngilizce olarak tanımlanır, kodda `t('anahtar')` ile kullanılır.
   ```tsx
   const { t } = useI18n();
   <Text>{t('form.save')}</Text>
   ```
2. **Renkler doğrudan yazılmaz.** Uygulamada gece modu ve takım renkleri gibi birçok tema var. Renkler her zaman temadan gelir: `C.black` (yazı rengi), `C.white` (zemin), `C.grey`, `C.line`, `C.brand`… Stiller `makeStyles = (C: Palette) => StyleSheet.create({...})` kalıbıyla yazılır.
3. **Kullanıcının verisi kutsaldır.** İnsanlar yıllardır biriktirdikleri koleksiyonları buraya giriyor. Veritabanında bir değişiklik gerekiyorsa `db/schema.ts` içindeki sürüm (`user_version`) mantığıyla yeni bir adım eklenir. Mevcut tablolar ve veriler asla silinmez.
4. **Şunlara dokunma** (eski sürümlerle uyumluluk için bilerek eski adlarıyla duruyorlar):
   - `app.json` içindeki paket kimliği (`com.selimcaglar.kolekta`) ve `scheme` (`kolekta`)
   - PDF paylaşımındaki `kolekta.json` ve `'kolekta-share'` biçimi

---

## 4. Çalışma düzenimiz

1. Her iş için yeni bir dal aç:
   ```
   git checkout main
   git pull
   git checkout -b es-anlamli-alanlar
   ```
2. Küçük adımlarla çalış, anlamlı commit mesajları yaz: `Yapay zekâ: Brand → Marka eşleştirmesi`
3. GitHub'a gönder ve **Pull Request (PR)** aç:
   ```
   git push -u origin es-anlamli-alanlar
   ```
4. PR açıklamasına **ne yaptığını kendi cümlelerinle** yaz ve önemliyse ekran görüntüsü ekle.
5. Selim inceler. Yorum gelirse düzeltip aynı dala tekrar gönderirsin. Onaylanınca `main`'e birleştirilir.

### PR göndermeden önce kontrol listesi

- [ ] Uygulama telefonda açılıyor, değiştirdiğin ekran çalışıyor
- [ ] Yeni metinlerin hem Türkçe hem İngilizcesi var
- [ ] **Gece modunda** ve renkli bir temada (ör. Sarı-Kırmızı) da düzgün görünüyor
- [ ] Mevcut bir koleksiyonu ve parçaları bozmadı
- [ ] `npx.cmd tsc --noEmit` hata vermiyor

### Yapay zekâ araçları (Claude, ChatGPT…)

Kullanabilirsin, öğrenmeyi hızlandırırlar. Tek kural: **anlamadığın kodu PR'a koyma.** Bir satırın ne yaptığını açıklayamıyorsan önce onu öğren.

### Güvenlik

- Şifre, API anahtarı ya da `.env` dosyası **asla** commit edilmez.
- Mağaza hesapları, build ve yayınlama Selim'de. Sen kodla ilgilenirsin.

---

## 5. İlk görevin: Yapay zekâ için eş anlamlı alanlar

### Sorun
"Yapay zekâ ile doldur" özelliği, Gemini'den bir JSON alıyor. Örneğin:
```json
{ "Parça adı": "Gümüş cep saati", "Brand": "Waltham", "Üretici": "Waltham", "Year": "1895" }
```
Koleksiyonun şablonunda **Marka** ve **Yıl** alanları var. Ama Gemini bazen "Brand", "Üretici" ya da "Year" diyor. Şu an kod yalnızca **birebir aynı** adları eşleştiriyor, bu yüzden "Brand" yeni bir alan olarak ekleniyor ve şablonda gereksiz alanlar birikiyor.

### Hedef
Aynı anlama gelen anahtarlar mevcut alana gitsin:

| Gemini'nin dediği | Gitmesi gereken alan |
|---|---|
| Brand, Üretici, Manufacturer, Maker | Marka |
| Year, Üretim yılı, Yapım yılı | Yıl |
| Country, Menşei | Ülke |
| Condition, Durumu | Kondisyon |
| Model name, Model adı | Model |

Listeyi genişletebilirsin, şablonlardaki (`constants/templates.ts`) alan adlarına bak.

### Nereden başlamalı
1. `src/lib/aiFill.ts` dosyasını oku:
   - `norm()` adları karşılaştırmak için sadeleştiriyor.
   - `parseLooseJson()` metinden JSON'u çıkarıyor.
   - `KEY_TITLE` gibi listeler eş anlamlı kelime gruplarına güzel bir örnek.
2. `src/components/ItemForm.tsx` içinde `applyRef.current = async (data) => {` ile başlayan bölümü bul. Gelen anahtarlar orada `byName` ile alanlara eşleniyor.
3. `aiFill.ts` içine eş anlamlı grupları (`SYNONYMS`) ve şu imzada bir fonksiyon ekle:
   ```ts
   // Gelen anahtara karşılık gelen alan adını döndürür; yoksa null
   export function matchField(key: string, fieldNames: string[]): string | null
   ```
4. `ItemForm.tsx` içinde birebir eşleşme bulunamayınca `matchField` kullanılsın.

### Testler (bu görevin önemli kısmı)
`src/lib/aiFill.test.ts` adında bir dosya aç ve Node'un yerleşik test aracıyla testler yaz:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchField, parseLooseJson } from './aiFill';

test('Brand, Marka alanına eşleşir', () => {
  assert.equal(matchField('Brand', ['Marka', 'Model', 'Yıl']), 'Marka');
});

test('bilinmeyen anahtar null döner', () => {
  assert.equal(matchField('Kasa çapı', ['Marka', 'Model']), null);
});

test('```json çitleri arasındaki JSON okunur', () => {
  assert.deepEqual(parseLooseJson('```json\n{"Marka":"Seiko"}\n```'), { Marka: 'Seiko' });
});
```
Çalıştırmak için:
```
npx.cmd tsx --test src/lib/aiFill.test.ts
```
En az 8-10 test yaz: büyük/küçük harf, Türkçe karakterler ("ÜRETİCİ"), boşluklar, şablonda o alan hiç yoksa ne olacağı…

### Bitti sayılması için
- [ ] Testler geçiyor
- [ ] Gerçek bir denemede "Brand" yeni alan açmıyor, Marka'ya yazılıyor (Selim kendi telefonunda deneyecek)
- [ ] PR açıklamasında nasıl çalıştığını anlattın

---

## 6. Sonraki görevler

1. **Yeni koleksiyon şablonları:** Sneaker, Figür/Oyuncak, Fotoğraf makinesi gibi. Önce `constants/templates.ts` içinde hangilerinin zaten olduğuna bak. Her alanın hem Türkçe hem İngilizce adı olmalı.
2. **Satıldı ve Ödünç verildi durumları:** `STATUS_KEYS`'e yeni durumlar, ana ekrandaki sekmeler ve filtreler, formdaki seçim, detay sayfası. Bir özelliği uçtan uca eklemeyi öğreteceği güzel bir görev.
3. **Değer geçmişi:** Tahmini değer her değiştiğinde kaydedilsin, detay sayfasında küçük bir grafik çizilsin. Veritabanına yeni tablo gerektirir, kural 3'ü hatırla!

---

## 7. Faydalı kaynaklar

- [Expo belgeleri](https://docs.expo.dev)
- [React Native belgeleri](https://reactnative.dev/docs/getting-started)
- [TypeScript el kitabı](https://www.typescriptlang.org/docs/handbook/intro.html)
- [Git'e giriş (Türkçe, Pro Git kitabı)](https://git-scm.com/book/tr/v2)

Kolay gelsin, aramıza hoş geldin! 🎉
