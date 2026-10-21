import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { WebView } from 'react-native-webview';
import * as Clipboard from 'expo-clipboard';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { F } from '../constants/theme';
import { Palette, useStyles, useTheme } from '../lib/theme';
import { useI18n } from '../lib/i18n';
import { shareUri } from '../lib/share';
import { sendLensJson, sendLensText } from '../lib/lensBridge';
import { buildPrompt, parseLooseJson } from '../lib/aiFill';

// Fotoğrafı doğrudan Google Lens'e yükleyip sonuçları uygulama içinde gösterir.
// Yükleme, Google Lens'in web sayfasındaki "görsel yükle" formuyla aynı şekilde yapılır.
// Fotoğraf yalnızca kullanıcı bu ekranı açtığında ve doğrudan Google'a gönderilir.
const UPLOAD_URL = 'https://lens.google.com/v3/upload';

function uploadPage(base64: string, lang: string) {
  return `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="background:#fff">
<form id="f" method="POST" enctype="multipart/form-data" action="${UPLOAD_URL}?hl=${lang}&st=${Date.now()}">
  <input type="file" id="i" name="encoded_image" style="display:none">
</form>
<script>
  try {
    var b = atob("${base64}");
    var a = new Uint8Array(b.length);
    for (var k = 0; k < b.length; k++) a[k] = b.charCodeAt(k);
    var file = new File([a], "kolekta.jpg", { type: "image/jpeg" });
    var dt = new DataTransfer();
    dt.items.add(file);
    document.getElementById("i").files = dt.files;
    document.getElementById("f").submit();
  } catch (e) {
    window.ReactNativeWebView.postMessage("error:" + e);
  }
</script></body></html>`;
}

// Sayfadaki { ... } bloklarını arar; bulduklarını uygulamaya yollar (Gemini yanıtındaki JSON)
const SCAN_SCRIPT = `(function(){
  if (window.__kScan) return; window.__kScan = 1;
  var last = '', n = 0;
  function blocks(t){
    var out = [];
    for (var i = 0; i < t.length; i++) {
      if (t[i] !== '{') continue;
      var d = 0;
      for (var j = i; j < t.length && j < i + 5000; j++) {
        if (t[j] === '{') d++;
        else if (t[j] === '}') { d--; if (d === 0) { out.push(t.slice(i, j + 1)); i = j; break; } }
      }
    }
    return out;
  }
  function scan(){
    try {
      var bt = document.body ? document.body.innerText : '';
      if (/^\\s*400\\./.test(bt) || /That.s an error/.test(bt) && /malformed/.test(bt)) {
        window.ReactNativeWebView.postMessage('err400'); return;
      }
      var c = blocks(document.body ? document.body.innerText : '').filter(function(b){ return b.indexOf(':') > 0; }).slice(-6);
      var s = JSON.stringify(c);
      if (c.length && s !== last) { last = s; window.ReactNativeWebView.postMessage('json:' + s); }
    } catch (e) {}
    if (++n < 120) setTimeout(scan, 1500);
  }
  scan();
})(); true;`;

export default function LensScreen() {
  const { uri, itemId, target, fields } = useLocalSearchParams<{
    uri: string; itemId?: string; target?: string; fields?: string;
  }>();
  const { C } = useTheme();
  const s = useStyles(makeStyles);
  const db = useSQLiteContext();
  const { t, lang } = useI18n();
  const insets = useSafeAreaInsets();
  const [html, setHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const webRef = useRef<WebView>(null);
  const [found, setFound] = useState<Record<string, string> | null>(null);

  // Yüklemeyi hızlandırmak için fotoğraf küçültülür
  useEffect(() => {
    (async () => {
      try {
        const ctx = ImageManipulator.manipulate(uri);
        ctx.resize({ width: 1000 });
        const img = await ctx.renderAsync();
        const res = await img.saveAsync({ format: SaveFormat.JPEG, compress: 0.8, base64: true });
        if (!res.base64) throw new Error('no base64');
        setHtml(uploadPage(res.base64, lang));
      } catch {
        setFailed(true);
        setLoading(false);
      }
    })();
  }, [uri, lang]);

  // Google sonuçlarında seçip kopyaladığın metni parçanın hikâyesine ekler
  // Ekran açıldığında panoda olan metin, bu aramadan kopyalanmış sayılmaz
  // (önceki parçadan kalan metnin yanlışlıkla eklenmesini önler)
  const baseline = useRef<string | null>(null);
  // Formdan gelindiyse Gemini komutu panoya kopyalanır: Lens'te "soru sor" kutusuna yapıştırılır,
  // gelen JSON yanıtı kopyalanınca alanlar otomatik doldurulur
  // Formdan da parça detayından da açılsa AI doldurma her zaman açık
  const aiMode = target === 'form' || !!itemId;
  const prompt = useRef('');
  useEffect(() => {
    (async () => {
      try {
        if (aiMode) {
          let names: string[] = [];
          if (fields) {
            try { names = JSON.parse(fields); } catch {}
          } else if (itemId) {
            const rows = await db.getAllAsync<{ name: string }>(
              `SELECT f.name FROM field_defs f JOIN items i ON i.collection_id = f.collection_id
                WHERE i.id = ? ORDER BY f.sort_order`, Number(itemId)
            );
            names = rows.map(r => r.name);
          }
          prompt.current = buildPrompt(names, lang);
          await Clipboard.setStringAsync(prompt.current);
          baseline.current = prompt.current.trim();
        } else {
          baseline.current = (await Clipboard.getStringAsync()).trim();
        }
      } catch {}
    })();
  }, [aiMode]);

  async function copyPrompt() {
    await Clipboard.setStringAsync(prompt.current);
    baseline.current = prompt.current.trim();
    Alert.alert(t('ai.promptTitle'), t('ai.promptCopied'));
  }

  // Bulunan/kopyalanan JSON ile alanları doldurur
  function applyData(data: Record<string, string>) {
    if (target === 'form') {
      router.back();
      setTimeout(() => sendLensJson(data), 350);
    } else {
      sendLensJson(data); // dinleyen form yoksa bekletilir, form açılınca uygulanır
      router.replace(`/item/${itemId}/edit`);
    }
  }

  // Sayfadan gelen JSON adayları: en çok dolu değeri olan seçilir (komutun kendisi boş olduğu için elenir)
  function onCandidates(raw: string) {
    let list: string[] = [];
    try { list = JSON.parse(raw); } catch { return; }
    let best: Record<string, string> | null = null;
    for (const c of list) {
      const d = parseLooseJson(c);
      if (d && Object.keys(d).length >= 2 && (!best || Object.keys(d).length >= Object.keys(best).length)) best = d;
    }
    if (best) setFound(best);
  }

  async function addClipboardToStory() {
    if (found) {
      applyData(found);
      return;
    }
    const text = (await Clipboard.getStringAsync()).trim();
    if (!text || text === baseline.current) {
      Alert.alert(t('lens.title'), t('lens.clipboardEmpty'));
      return;
    }
    // Parça ekleme/düzenleme formundan gelindiyse metin açık formun hikâye alanına gider
    // Kopyalanan metin JSON ise alanlar doldurulur:
    // formdan gelindiyse forma dönülür, parça detayından gelindiyse düzenleme formu açılır
    const data = parseLooseJson(text);
    if (data) {
      await Clipboard.setStringAsync('');
      baseline.current = '';
      applyData(data);
      return;
    }
    if (target === 'form') {
      sendLensText(text);
      // Eklenen metin panodan silinir; aynı metin ikinci kez eklenmesin
    await Clipboard.setStringAsync('');
    baseline.current = '';
    Alert.alert(t('lens.added'), text.length > 140 ? `${text.slice(0, 140)}…` : text);
      return;
    }
    await db.runAsync(
      `UPDATE items SET story = CASE WHEN story IS NULL OR trim(story) = '' THEN ? ELSE story || char(10) || char(10) || ? END
       WHERE id = ?`,
      text, text, Number(itemId)
    );
    // Eklenen metin panodan silinir; aynı metin ikinci kez eklenmesin
    await Clipboard.setStringAsync('');
    baseline.current = '';
    Alert.alert(t('lens.added'), text.length > 140 ? `${text.slice(0, 140)}…` : text);
  }

  return (
    <View style={s.container}>
      <Stack.Screen
        options={{
          title: 'Google Lens',
          headerRight: () => (
            <Pressable
              hitSlop={12}
              onPress={() => shareUri(uri, 'image/jpeg', 'public.jpeg')}
              accessibilityLabel={t('lens.shareInstead')}
            >
              <Ionicons name="share-outline" size={22} color={C.black} />
            </Pressable>
          ),
        }}
      />

      {failed ? (
        <View style={s.center}>
          <Text style={s.failText}>{t('lens.failed')}</Text>
          <Pressable style={s.failBtn} onPress={() => shareUri(uri, 'image/jpeg', 'public.jpeg')}>
            <Text style={s.failBtnText}>{t('lens.shareInstead')}</Text>
          </Pressable>
        </View>
      ) : (
        html && (
          <WebView
            ref={webRef}
            source={{ html, baseUrl: 'https://lens.google.com' }}
            originWhitelist={['*']}
            onLoadEnd={e => {
              setLoading(false);
              if (!aiMode) return;
              const url = e.nativeEvent.url ?? '';
              // Google'ın sayfasına otomatik soru yazmak 400 hatası verdiği için yapılmaz;
              // kullanıcı AI Modu'nda komutu yapıştırırsa yanıttaki JSON yakalanır
              if (/google\.[a-z.]+\//.test(url)) webRef.current?.injectJavaScript(SCAN_SCRIPT);
            }}
            onMessage={e => {
              const d = e.nativeEvent.data;
              if (d.startsWith('error:')) setFailed(true);
              else if (d.startsWith('json:')) onCandidates(d.slice(5));
              else if (d === 'err400') {
                // Google isteği reddettiyse sonuç sayfasına geri dönülür, elle yöntem kalır
                webRef.current?.goBack();
                Alert.alert(t('ai.promptTitle'), t('ai.askFailed'));
              }
            }}
            onError={() => setFailed(true)}
            setSupportMultipleWindows={false}
            style={{ flex: 1 }}
          />
        )
      )}

      {loading && !failed && (
        <View style={[StyleSheet.absoluteFill, s.center, { backgroundColor: C.white }]}>
          <ActivityIndicator color={C.black} size="large" />
          <Text style={s.loadingText}>{t('lens.loading')}</Text>
        </View>
      )}

      {!failed && (
        <View style={[s.bar, { paddingBottom: insets.bottom + 10 }]}>
          <Text style={s.barHint}>
            {!aiMode ? t('lens.copyHint') : found ? t('ai.foundHint') : t('ai.hint')}
          </Text>
          {aiMode && (
            <Pressable onPress={copyPrompt} hitSlop={6} style={s.promptLink}>
              <Ionicons name="sparkles-outline" size={14} color={C.black} />
              <Text style={s.promptLinkText}>{t('ai.copyPrompt')}</Text>
            </Pressable>
          )}
          <Pressable
            onPress={addClipboardToStory}
            style={({ pressed }) => [s.barBtn, pressed && { opacity: 0.8 }]}
          >
            <Ionicons name={found ? 'sparkles' : 'clipboard-outline'} size={18} color={C.onBrand} />
            <Text style={s.barBtnText}>
              {found ? t('ai.fillFound', { n: Object.keys(found).length })
                : aiMode ? t('ai.addCopied') : t('lens.addToStory')}
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const makeStyles = (C: Palette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: C.white },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  loadingText: { fontFamily: F.medium, fontSize: 15, color: C.grey, marginTop: 14 },
  failText: { fontFamily: F.regular, fontSize: 15, color: C.black, textAlign: 'center', lineHeight: 21 },
  failBtn: { marginTop: 20, backgroundColor: C.brand, paddingVertical: 14, paddingHorizontal: 22 },
  failBtnText: { fontFamily: F.bold, fontSize: 15, color: C.onBrand },
  bar: {
    borderTopWidth: 1,
    borderTopColor: C.line,
    paddingHorizontal: 16,
    paddingTop: 10,
    backgroundColor: C.white,
  },
  barHint: { fontFamily: F.regular, fontSize: 12, color: C.grey, marginBottom: 8, lineHeight: 16 },
  promptLink: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  promptLinkText: { fontFamily: F.semi, fontSize: 13, color: C.black, textDecorationLine: 'underline' },
  barBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: C.brand,
    paddingVertical: 14,
  },
  barBtnText: { fontFamily: F.bold, fontSize: 15, color: C.onBrand },
});
