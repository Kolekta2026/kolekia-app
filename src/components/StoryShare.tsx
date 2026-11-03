import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { captureRef } from 'react-native-view-shot';
import { Ionicons } from '@expo/vector-icons';
import { F } from '../constants/theme';
import { useI18n } from '../lib/i18n';
import { shareUri } from '../lib/share';
import {
  CUSTOM_PANEL_H, fitTitle, Format, FormatToggle, FramedPhoto, OUT, previewSize, ShareBrand, shareScreen as s,
  Shape, ShapePicker, SHAPES, STORY_PAD, STORY_SIDE, StylePicker, useShareStyle,
} from './ShareStyle';

export type StoryItem = {
  title: string;
  collection: string;
  photo: string | null;
  lines: { k: string; v: string }[]; // en fazla 3 özellik; değerler (fiyat) hiç konmaz
};

// Parçadan paylaşım görseli: önce önizleme, sonra sistem paylaşım menüsü
// (Instagram'da "Hikâye" seçilince doğrudan hikâye ekranı açılır; X'te görsel gönderiye eklenir)
// photos: parçanın bütün fotoğrafları; birden çoksa paylaşılacak fotoğraf alttaki şeritten seçilir
export function StoryShare({ item, visible, onClose, photos = [], startIndex = 0 }: {
  item: StoryItem; visible: boolean; onClose: () => void; photos?: string[]; startIndex?: number;
}) {
  const [photoIdx, setPhotoIdx] = useState(startIndex);
  useEffect(() => { if (visible) setPhotoIdx(startIndex); }, [visible, startIndex]);
  const shown = photos.length ? photos[Math.min(photoIdx, photos.length - 1)] : item.photo;
  const multi = photos.length > 1;
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const ref = useRef<View>(null);
  const db = useSQLiteContext();
  const style = useShareStyle(visible, shown);
  const { st } = style;
  // Fotoğraf penceresinin şekli; seçim hatırlanır
  const [shape, setShape] = useState<Shape>('square');
  useEffect(() => {
    if (!visible) return;
    db.getFirstAsync<{ value: string }>("SELECT value FROM settings WHERE key = 'story_shape'")
      .then(r => { if (r && (SHAPES as string[]).includes(r.value)) setShape(r.value as Shape); })
      .catch(() => {});
  }, [visible, db]);
  function pickShape(sh: Shape) {
    setShape(sh);
    db.runAsync("INSERT OR REPLACE INTO settings (key, value) VALUES ('story_shape', ?)", sh).catch(() => {});
  }
  const [format, setFormat] = useState<Format>('story');
  const [busy, setBusy] = useState(false);

  const isX = format === 'x';
  const avail = height - insets.top - insets.bottom - 298 - (style.customOn ? CUSTOM_PANEL_H : 0) - (multi ? 62 : 0);
  const { w, h, u } = previewSize(format, width, avail);

  async function share() {
    if (!ref.current) return;
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

  const kicker = (top: number) => (
    <Text style={{ fontFamily: F.bold, fontSize: 13 * u, color: st.accentText, opacity: st.accentText === st.ink ? 0.7 : 1, marginTop: top * u }}>
      {t('story.kicker')}
    </Text>
  );

  const photo = (size: number) => (
    <FramedPhoto uri={shown} letter={item.title.charAt(0).toLocaleUpperCase('tr')} size={size} u={u} st={st} shape={shape} />
  );

  // Hikâyede başlık en fazla 2, X'te 3 satır; etiketler ve değerler iki sütunda hizalı
  const details = (base: number, maxLines: number, fitChars: number, top: number, width: number, inlineKicker = false) => {
    const ts = fitTitle(item.title, base, fitChars, width);
    const lh = 17 * u;
    const lines = item.lines.slice(0, 3);
    return (
      <>
        <Text
          numberOfLines={maxLines}
          style={{ fontFamily: F.black, fontSize: ts * u, lineHeight: ts * 1.08 * u, letterSpacing: -1 * u, color: st.ink, marginTop: top * u }}
        >
          {item.title}
        </Text>
        <Text numberOfLines={1} style={{ fontFamily: F.semi, fontSize: 14 * u, color: st.accentText, opacity: st.accentText === st.ink ? 0.7 : 1, marginTop: 6 * u }}>
          {inlineKicker ? `${t('story.kicker')} · ${item.collection}` : item.collection}
        </Text>
        {lines.length > 0 && (
          <View style={{ marginTop: 12 * u, flexDirection: 'row', gap: 10 * u }}>
            <View style={{ gap: 5 * u, maxWidth: '45%' }}>
              {lines.map(l => (
                <Text key={l.k} numberOfLines={1} style={{ fontFamily: F.regular, fontSize: 13 * u, lineHeight: lh, color: st.ink, opacity: 0.65 }}>{l.k}</Text>
              ))}
            </View>
            <View style={{ gap: 5 * u, flex: 1 }}>
              {lines.map(l => (
                <Text key={l.k} numberOfLines={1} style={{ fontFamily: F.bold, fontSize: 13 * u, lineHeight: lh, color: st.ink }}>{l.v}</Text>
              ))}
            </View>
          </View>
        )}
      </>
    );
  };

  // Alt bilgi akışın içinde, en altta: içerik uzasa da alanların üstüne binmez
  const footer = (
    <Text style={{ fontFamily: F.bold, fontSize: 13 * u, color: st.ink, opacity: 0.8, marginTop: 8 * u }}>
      kolekia.app
    </Text>
  );

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <View style={[s.screen, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 16 }]}>
        <View style={s.top}>
          <Pressable onPress={onClose} hitSlop={12} accessibilityLabel={t('common.close')}>
            <Ionicons name="close" size={28} color="#FFFFFF" />
          </Pressable>
          <Text style={s.heading}>{t(isX ? 'story.titleX' : 'story.title')}</Text>
          <View style={{ width: 28 }} />
        </View>

        <FormatToggle format={format} onChange={setFormat} />

        <View style={s.center}>
          <View
            ref={ref}
            collapsable={false}
            style={{ width: w, height: h, backgroundColor: st.bg, flexDirection: isX ? 'row' : 'column', ...(isX ? { padding: 24 * u } : STORY_PAD(u)) }}
          >
            {isX ? (
              <>
                {photo(h - 48 * u)}
                <View style={{ flex: 1, marginLeft: 24 * u }}>
                  <ShareBrand u={u} st={st} />
                  {kicker(26)}
                  {details(26, 3, 42, 18, 640 - 48 - 312 - 24)}
                  <View style={{ flex: 1 }} />
                  {footer}
                </View>
              </>
            ) : (
              <>
                <ShareBrand u={u} st={st} />
                <View style={{ marginTop: 14 * u }}>{photo(w - 2 * STORY_SIDE * u)}</View>
                {details(30, 2, 30, 12, 360 - 2 * STORY_SIDE, true)}
                <View style={{ flex: 1 }} />
                {footer}
              </>
            )}
          </View>
        </View>

        {multi && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={ps.wrap} contentContainerStyle={ps.strip}>
            {photos.map((p, i) => (
              <Pressable
                key={`${p}-${i}`}
                onPress={() => setPhotoIdx(i)}
                style={[ps.thumb, i === photoIdx && ps.thumbOn]}
                accessibilityLabel={`${t('story.photo')} ${i + 1}`}
                accessibilityState={{ selected: i === photoIdx }}
              >
                <Image source={{ uri: p }} style={{ width: '100%', height: '100%' }} />
              </Pressable>
            ))}
          </ScrollView>
        )}
        <ShapePicker value={shape} onChange={pickShape} />
        <StylePicker style={style} />

        <Pressable onPress={share} disabled={busy} style={({ pressed }) => [s.button, pressed && { opacity: 0.85 }]}>
          {busy ? <ActivityIndicator color="#000000" /> : (
            <>
              <Ionicons name={isX ? 'logo-x' : 'logo-instagram'} size={20} color="#000000" />
              <Text style={s.buttonText}>{t('story.share')}</Text>
            </>
          )}
        </Pressable>
        <Text style={s.hint}>{t(isX ? 'story.hintX' : 'story.hint')}</Text>
      </View>
    </Modal>
  );
}

const ps = StyleSheet.create({
  wrap: { flexGrow: 0, marginHorizontal: -20, marginBottom: 10 },
  strip: { flexDirection: 'row', gap: 8, paddingHorizontal: 20 },
  thumb: { width: 48, height: 48, borderWidth: 2, borderColor: 'transparent', opacity: 0.55, overflow: 'hidden' },
  thumbOn: { borderColor: '#FFFFFF', opacity: 1 },
});
