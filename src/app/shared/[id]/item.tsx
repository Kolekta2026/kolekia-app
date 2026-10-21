import { useCallback, useState } from 'react';
import {
  FlatList, Image, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View,
} from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { F } from '../../../constants/theme';
import { Palette, useStyles, useTheme } from '../../../lib/theme';
import { useI18n, type Currency } from '../../../lib/i18n';
import { photoUri } from '../../../lib/photos';
import { formatMoney } from '../../../lib/money';
import { PhotoViewer } from '../../../components/PhotoViewer';
import { loadSharedList, type SharedItem } from '../../../lib/shareData';

// Arkadaş listesindeki parçanın detayı; normal parça sayfasıyla aynı görünüm (düzenleme yok)
export default function SharedItemScreen() {
  const { id, ci, ii } = useLocalSearchParams<{ id: string; ci: string; ii: string }>();
  const { C } = useTheme();
  const s = useStyles(makeStyles);
  const db = useSQLiteContext();
  const { t, lang } = useI18n();
  const { width } = useWindowDimensions();
  const [item, setItem] = useState<SharedItem | null>(null);
  const [collection, setCollection] = useState('');
  const [sender, setSender] = useState('');
  const [page, setPage] = useState(0);
  const [viewerOpen, setViewerOpen] = useState(false);

  useFocusEffect(
    useCallback(() => {
      loadSharedList(db, Number(id)).then(r => {
        const c = r?.data.collections[Number(ci)];
        setCollection(c?.name ?? '');
        setSender(r?.sender ?? '');
        setItem(c?.items[Number(ii)] ?? null);
      });
    }, [db, id, ci, ii])
  );

  if (!item) return <View style={s.container} />;
  const photos = (item.photos?.length ? item.photos : item.photo ? [item.photo] : [])
    .map(p => photoUri(p)!)
    .filter(Boolean);
  const money = (m: { v: number; c: string }) => formatMoney(m.v, m.c as Currency, lang);

  return (
    <View style={s.container}>
      <Stack.Screen options={{ title: '' }} />
      <ScrollView contentContainerStyle={{ paddingBottom: 48 }}>
        {photos.length > 0 ? (
          <View>
            <FlatList
              data={photos}
              keyExtractor={(u, i) => `${i}-${u}`}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={e => setPage(Math.round(e.nativeEvent.contentOffset.x / width))}
              renderItem={({ item: uri }) => (
                <Pressable onPress={() => setViewerOpen(true)}>
                  <Image source={{ uri }} style={{ width, height: width, backgroundColor: C.paper }} />
                </Pressable>
              )}
            />
            {photos.length > 1 && (
              <View style={s.counter}>
                <Text style={s.counterText}>{page + 1} / {photos.length}</Text>
              </View>
            )}
          </View>
        ) : (
          <View style={[s.noPhoto, { height: width * 0.6 }]}>
            <Text style={s.initial}>{item.title.charAt(0).toLocaleUpperCase('tr')}</Text>
          </View>
        )}

        <View style={s.body}>
          <Text style={[s.status, item.status !== 'owned' && { color: C.accent }]}>
            {t(`status.${item.status}` as 'status.owned')}
          </Text>
          <Text style={s.title}>{item.title}</Text>
          <Text style={s.collection}>{sender ? `${sender}  ·  ${collection}` : collection}</Text>

          {item.fields.length > 0 && (
            <View style={s.table}>
              {item.fields.map(f => (
                <View key={f.name} style={s.row}>
                  <Text style={s.rowLabel}>{f.name}</Text>
                  <Text style={s.rowValue}>{f.value}</Text>
                </View>
              ))}
            </View>
          )}

          {(item.estimated || item.purchase) && (
            <View style={{ marginTop: 32 }}>
              <Text style={s.valueTitle}>{t('value.title')}</Text>
              <View style={s.table}>
                {item.estimated && (
                  <View style={s.row}>
                    <Text style={s.rowLabel}>{t('value.estimated')}</Text>
                    <Text style={s.bigValue}>{money(item.estimated)}</Text>
                  </View>
                )}
                {item.purchase && (
                  <View style={s.row}>
                    <Text style={s.rowLabel}>{t('value.purchase')}</Text>
                    <Text style={s.rowValue}>{money(item.purchase)}</Text>
                  </View>
                )}
              </View>
            </View>
          )}

          {item.story ? (
            <View style={{ marginTop: 28 }}>
              <Text style={s.storyLabel}>{t('form.story')}</Text>
              <Text style={s.storyText}>{item.story}</Text>
            </View>
          ) : null}
        </View>
      </ScrollView>

      <PhotoViewer photos={photos} index={page} visible={viewerOpen} onClose={() => setViewerOpen(false)} />
    </View>
  );
}

const makeStyles = (C: Palette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: C.white },
  counter: { position: 'absolute', right: 0, bottom: 0, backgroundColor: C.black, paddingHorizontal: 10, paddingVertical: 5 },
  counterText: { fontFamily: F.bold, fontSize: 13, color: C.white },
  noPhoto: { backgroundColor: C.paper, alignItems: 'center', justifyContent: 'center' },
  initial: { fontFamily: F.black, fontSize: 96, color: C.black, opacity: 0.1 },
  body: { paddingHorizontal: 20, paddingTop: 22 },
  status: { fontFamily: F.bold, fontSize: 13, color: C.grey },
  title: { fontFamily: F.black, fontSize: 32, color: C.black, letterSpacing: -0.9, marginTop: 6, lineHeight: 36 },
  collection: { fontFamily: F.medium, fontSize: 15, color: C.grey, marginTop: 6 },
  table: { borderTopWidth: 2, borderTopColor: C.black, marginTop: 26 },
  row: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.line, gap: 16,
  },
  rowLabel: { fontFamily: F.regular, fontSize: 15, color: C.grey },
  rowValue: { fontFamily: F.bold, fontSize: 15, color: C.black, flexShrink: 1, textAlign: 'right' },
  valueTitle: { fontFamily: F.heavy, fontSize: 18, color: C.black, marginBottom: -16 },
  bigValue: { fontFamily: F.black, fontSize: 20, color: C.black, letterSpacing: -0.4 },
  storyLabel: { fontFamily: F.bold, fontSize: 14, color: C.black, marginBottom: 8 },
  storyText: { fontFamily: F.regular, fontSize: 16, color: C.black, lineHeight: 25 },
});
