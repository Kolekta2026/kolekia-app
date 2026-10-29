import { useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Image, Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { captureRef } from 'react-native-view-shot';
import { Ionicons } from '@expo/vector-icons';
import { F } from '../constants/theme';
import { useI18n } from '../lib/i18n';
import { shareUri } from '../lib/share';
import {
  CUSTOM_PANEL_H, fitTitle, Format, FormatToggle, OUT, previewSize, ShareBrand, shareScreen,
  STORY_PAD, STORY_SIDE, StylePicker, Swatch, useShareStyle,
} from './ShareStyle';

export type CollageItem = { id: number; title: string; photo: string | null };

const MAX = 9;
const STRIP_H = 92; // parça seçme şeridinin kapladığı yükseklik

// Seçilen parça sayısına ve alanın en-boy oranına göre sütun sayısı: hücreler kareye en yakın
// olsun, boş kalan yer az olsun. Son satır eksikse oradaki fotoğraflar genişleyip satırı doldurur.
function pickCols(n: number, W: number, H: number, gap: number) {
  let best = 1;
  let bestScore = -Infinity;
  for (let cols = 1; cols <= Math.min(n, 4); cols++) {
    const rows = Math.ceil(n / cols);
    const cw = (W - gap * (cols - 1)) / cols;
    const ch = (H - gap * (rows - 1)) / rows;
    const square = Math.min(cw, ch) / Math.max(cw, ch);
    const lastRow = n - (rows - 1) * cols; // son satırdaki fotoğraf sayısı
    const stretch = lastRow < cols ? (cols - lastRow) / cols : 0; // son satırdaki genişleme oranı
    const score = square - stretch * 0.35;
    if (score > bestScore) {
      bestScore = score;
      best = cols;
    }
  }
  return best;
}

// Koleksiyondan seçilen parçalarla tek görsellik kolaj: Instagram hikâyesi (9:16) ya da X gönderisi (16:9)
export function CollageShare({ collection, items, visible, onClose }: {
  collection: string;
  items: CollageItem[];
  visible: boolean;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const ref = useRef<View>(null);
  const style = useShareStyle(visible);
  const { st } = style;
  const [format, setFormat] = useState<Format>('story');
  const [names, setNames] = useState(false);
  const [busy, setBusy] = useState(false);
  // Açılışta fotoğraflı ilk 6 parça seçili gelir; önizleme hemen dolu görünür.
  // (Ekran her açılışta yeniden oluşturulur, seçim yalnızca ilk açılışta hazırlanır.)
  const [picked, setPicked] = useState<number[]>(() => {
    const withPhoto = items.filter(i => i.photo);
    return (withPhoto.length ? withPhoto : items).slice(0, 6).map(i => i.id);
  });

  const isX = format === 'x';
  const avail = height - insets.top - insets.bottom - 248 - STRIP_H - (style.customOn ? CUSTOM_PANEL_H : 0);
  const { w, h, u } = previewSize(format, width, avail);
  const chosen = picked.map(id => items.find(i => i.id === id)).filter((x): x is CollageItem => !!x);

  function toggle(id: number) {
    setPicked(prev => {
      if (prev.includes(id)) return prev.filter(x => x !== id);
      if (prev.length >= MAX) {
        Alert.alert(t('collage.max', { n: MAX }));
        return prev;
      }
      return [...prev, id];
    });
  }

  async function share() {
    if (!ref.current || chosen.length === 0) return;
    setBusy(true);
    try {
      const uri = await captureRef(ref, { format: 'png', width: OUT[format].w, height: OUT[format].h, result: 'tmpfile' });
      await shareUri(uri, 'image/png', 'public.png');
    } catch (e) {
      Alert.alert(t('story.failed'), String(e));
    } finally {
      setBusy(false);
    }
  }

  const gap = 6 * u;
  const sub = `${t('story.kicker')} · ${t('collage.count', { n: chosen.length })}`;

  // Hikâyede başlık ve alt yazıdan sonra kalan alan, X'te sağ taraf (sütun sayısı seçimi için yaklaşık ölçü)
  const area = isX
    ? { W: (640 - 48 - 190 - 20) * u, H: (360 - 48) * u }
    : { W: (360 - 2 * STORY_SIDE) * u, H: (640 - 96 - 112 - 24) * u };
  const cols = chosen.length ? pickCols(chosen.length, area.W, area.H, gap) : 1;
  const rows: CollageItem[][] = [];
  for (let i = 0; i < chosen.length; i += cols) rows.push(chosen.slice(i, i + cols));

  const grid = (
    <View style={{ flex: 1, gap }}>
      {rows.length === 0 ? (
        <View style={{ flex: 1, borderWidth: 2 * u, borderColor: st.ink, borderStyle: 'dashed', opacity: 0.4 }} />
      ) : rows.map((row, r) => (
        <View key={r} style={{ flex: 1, flexDirection: 'row', gap }}>
          {row.map(it => <Cell key={it.id} item={it} u={u} st={st} names={names} />)}
        </View>
      ))}
    </View>
  );

  const title = (base: number, lines: number, fit: number, top: number) => {
    const ts = fitTitle(collection, base, fit);
    return (
      <>
        <Text
          numberOfLines={lines}
          style={{ fontFamily: F.black, fontSize: ts * u, lineHeight: ts * 1.08 * u, letterSpacing: -1 * u, color: st.ink, marginTop: top * u }}
        >
          {collection}
        </Text>
        <Text numberOfLines={1} style={{ fontFamily: F.semi, fontSize: 14 * u, color: st.ink, opacity: 0.7, marginTop: 6 * u }}>
          {sub}
        </Text>
      </>
    );
  };

  const footer = (
    <Text style={{ fontFamily: F.bold, fontSize: 13 * u, color: st.ink, opacity: 0.8, marginTop: 8 * u }}>kolekia.app</Text>
  );

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <View style={[shareScreen.screen, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 16 }]}>
        <View style={shareScreen.top}>
          <Pressable onPress={onClose} hitSlop={12} accessibilityLabel={t('common.close')}>
            <Ionicons name="close" size={28} color="#FFFFFF" />
          </Pressable>
          <Text style={shareScreen.heading}>{t('collage.title')}</Text>
          <View style={{ width: 28 }} />
        </View>

        <FormatToggle format={format} onChange={setFormat} />

        <View style={shareScreen.center}>
          <View
            ref={ref}
            collapsable={false}
            style={{ width: w, height: h, backgroundColor: st.bg, flexDirection: isX ? 'row' : 'column', ...(isX ? { padding: 24 * u } : STORY_PAD(u)) }}
          >
            {isX ? (
              <>
                <View style={{ width: 190 * u }}>
                  <ShareBrand u={u} st={st} />
                  {title(28, 3, 36, 26)}
                  <View style={{ flex: 1 }} />
                  {footer}
                </View>
                <View style={{ flex: 1, marginLeft: 20 * u }}>{grid}</View>
              </>
            ) : (
              <>
                <ShareBrand u={u} st={st} />
                {title(30, 1, 18, 12)}
                <View style={{ flex: 1, marginTop: 14 * u }}>{grid}</View>
                {footer}
              </>
            )}
          </View>
        </View>

        {/* Parça seçimi: dokunulan sırayla kolaja girer */}
        <View style={s.stripHead}>
          <Text style={s.stripLabel}>{t('collage.pick')} · {chosen.length}/{MAX}</Text>
          <Pressable
            onPress={() => setNames(v => !v)}
            hitSlop={8}
            style={[s.namesBtn, names && s.namesOn]}
            accessibilityState={{ selected: names }}
          >
            <Text style={[s.namesText, names && { color: '#000000' }]}>Aa</Text>
            <Text style={[s.namesText, names && { color: '#000000' }]}>{t('home.titles')}</Text>
          </Pressable>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.stripWrap} contentContainerStyle={s.strip}>
          {items.map(it => {
            const order = picked.indexOf(it.id);
            const on = order >= 0;
            return (
              <Pressable
                key={it.id}
                onPress={() => toggle(it.id)}
                style={[s.thumb, on && s.thumbOn]}
                accessibilityLabel={it.title}
                accessibilityState={{ selected: on }}
              >
                {it.photo ? (
                  <Image source={{ uri: it.photo }} style={StyleSheet.absoluteFill} />
                ) : (
                  <Text style={s.thumbInitial}>{it.title.charAt(0).toLocaleUpperCase('tr')}</Text>
                )}
                {on && (
                  <View style={s.order}>
                    <Text style={s.orderText}>{order + 1}</Text>
                  </View>
                )}
              </Pressable>
            );
          })}
        </ScrollView>

        <StylePicker style={style} />

        <Pressable
          onPress={share}
          disabled={busy || chosen.length === 0}
          style={({ pressed }) => [shareScreen.button, (pressed || chosen.length === 0) && { opacity: 0.6 }]}
        >
          {busy ? <ActivityIndicator color="#000000" /> : (
            <>
              <Ionicons name={isX ? 'logo-x' : 'logo-instagram'} size={20} color="#000000" />
              <Text style={shareScreen.buttonText}>{t('story.share')}</Text>
            </>
          )}
        </Pressable>
        <Text style={shareScreen.hint}>{t(isX ? 'story.hintX' : 'story.hint')}</Text>
      </View>
    </Modal>
  );
}

// Kolajdaki tek fotoğraf: yazı renginde ince çerçeve, istenirse altında parçanın adı
function Cell({ item, u, st, names }: { item: CollageItem; u: number; st: Swatch; names: boolean }) {
  return (
    <View style={{ flex: 1, backgroundColor: st.ink, padding: 3 * u }}>
      <View style={{ flex: 1, backgroundColor: st.bg, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
        {item.photo ? (
          <Image source={{ uri: item.photo }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        ) : (
          <Text style={{ fontFamily: F.black, fontSize: 40 * u, color: st.ink, opacity: 0.25 }}>
            {item.title.charAt(0).toLocaleUpperCase('tr')}
          </Text>
        )}
      </View>
      {names && (
        <Text
          numberOfLines={1}
          style={{ fontFamily: F.bold, fontSize: 9.5 * u, lineHeight: 12 * u, color: st.bg, paddingTop: 3 * u, paddingHorizontal: 1 * u }}
        >
          {item.title}
        </Text>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  stripHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  stripLabel: { fontFamily: F.semi, fontSize: 12, color: '#AAAAAA' },
  namesBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, height: 26, paddingHorizontal: 10,
    borderWidth: 1, borderColor: '#555555',
  },
  namesOn: { backgroundColor: '#FFFFFF', borderColor: '#FFFFFF' },
  namesText: { fontFamily: F.bold, fontSize: 12, color: '#FFFFFF' },
  stripWrap: { flexGrow: 0, marginHorizontal: -20, marginTop: 8, marginBottom: 14 },
  strip: { flexDirection: 'row', gap: 8, paddingHorizontal: 20 },
  thumb: {
    width: 52, height: 52, backgroundColor: '#2A2A2A', alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: 'transparent', overflow: 'hidden', opacity: 0.55,
  },
  thumbOn: { borderColor: '#FFFFFF', opacity: 1 },
  thumbInitial: { fontFamily: F.black, fontSize: 22, color: '#777777' },
  order: {
    position: 'absolute', top: 0, right: 0, minWidth: 18, height: 18, paddingHorizontal: 3,
    backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center',
  },
  orderText: { fontFamily: F.black, fontSize: 11, color: '#000000' },
});
