import { useCallback, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, Image, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View,
} from 'react-native';
import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { F } from '../../../constants/theme';
import { Palette, useStyles, useTheme } from '../../../lib/theme';
import { useI18n } from '../../../lib/i18n';
import { photoUri } from '../../../lib/photos';
import { PhotoViewer } from '../../../components/PhotoViewer';
import { SecondaryButton } from '../../../components/ui';
import * as WebBrowser from 'expo-web-browser';
import { formatDate, formatMoney } from '../../../lib/money';
import { convert, useFxRates } from '../../../lib/fx';
import { askAndSharePdf } from '../../../lib/shareAction';
import { duplicateItem, missingFields, moveItem } from '../../../lib/itemOps';
import { Ionicons } from '@expo/vector-icons';
import type { Currency } from '../../../lib/i18n';
import { buildQuery, marketSites } from '../../../lib/market';
import { useMenu } from '../../../lib/menu';
import { aiAvailable } from '../../../lib/gemini';
import { daysUntil, formatDay } from '../../../lib/dates';
import { ValueHistory } from '../../../components/ValueHistory';
import { StoryShare } from '../../../components/StoryShare';
import { VideoBlock } from '../../../components/VideoBlock';

type Item = {
  title: string;
  status: string;
  story: string | null;
  collection_name: string;
  template: string;
  purchase_price: number | null;
  estimated_value: number | null;
  valued_at: string | null;
  purchase_currency: string | null;
  estimated_currency: string | null;
  sold_price: number | null;
  sold_currency: string | null;
  sold_at: string | null;
  loaned_to: string | null;
  loaned_at: string | null;
  loan_due: string | null;
};
type Detail = { name: string; type: string; value: string | null };

export default function ItemScreen() {
  const { C } = useTheme();
  const s = useStyles(makeStyles);
  const { itemId } = useLocalSearchParams<{ itemId: string }>();
  const id = Number(itemId);
  const db = useSQLiteContext();
  const { t, lang, currency } = useI18n();
  const rates = useFxRates();
  const menu = useMenu();
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [collectionId, setCollectionId] = useState<number | null>(null);
  const { width } = useWindowDimensions();

  const [item, setItem] = useState<Item | null>(null);
  const [photos, setPhotos] = useState<string[]>([]);
  const [details, setDetails] = useState<Detail[]>([]);
  const [page, setPage] = useState(0);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [storyOpen, setStoryOpen] = useState(false);
  const [video, setVideo] = useState<string | null>(null);

  // Düzenleme ekranından dönünce de yenilensin
  useFocusEffect(
    useCallback(() => {
      (async () => {
        const it = await db.getFirstAsync<Item & { collection_id: number }>(`
          SELECT i.title, i.status, i.story, i.collection_id, c.name AS collection_name,
            c.template, i.purchase_price, i.estimated_value, i.valued_at,
            i.purchase_currency, i.estimated_currency,
            i.sold_price, i.sold_currency, i.sold_at, i.loaned_to, i.loaned_at, i.loan_due
          FROM items i JOIN collections c ON c.id = i.collection_id
          WHERE i.id = ?`, id);
        if (!it) return;
        setItem(it);
        setCollectionId(it.collection_id);

        const ph = await db.getAllAsync<{ uri: string }>(
          'SELECT uri FROM item_photos WHERE item_id = ? ORDER BY sort_order', id
        );
        setPhotos(ph.map(p => photoUri(p.uri)!));
        const vid = await db.getFirstAsync<{ uri: string }>(
          'SELECT uri FROM item_videos WHERE item_id = ? ORDER BY id LIMIT 1', id
        );
        setVideo(vid ? photoUri(vid.uri) : null);
        setPage(0);

        const rows = await db.getAllAsync<Detail>(`
          SELECT f.name, f.type, v.value
          FROM field_defs f
          LEFT JOIN item_values v ON v.field_id = f.id AND v.item_id = ?
          WHERE f.collection_id = ?
          ORDER BY f.sort_order`, id, it.collection_id);
        setDetails(rows.filter(r => r.value && r.value !== '0'));
      })();
    }, [db, id, reload])
  );

  // ⋯ menüsü: hikâyede paylaş, kopyala ve başka koleksiyona taşı
  function moreMenu() {
    menu(item!.title, undefined, [
      { text: t('story.title'), onPress: () => setStoryOpen(true) },
      { text: t('item.duplicate'), onPress: duplicate },
      { text: t('item.move'), onPress: pickTarget },
    ]);
  }

  async function duplicate() {
    const newId = await duplicateItem(db, id, t('item.copySuffix'));
    // Kopyanın adını ve fotoğraflarını hemen düzenleyebilmek için düzenleme ekranı açılır
    if (newId) router.push(`/item/${newId}/edit`);
  }

  async function pickTarget() {
    const cols = await db.getAllAsync<{ id: number; name: string }>(
      'SELECT id, name FROM collections WHERE id <> ? ORDER BY sort_order, id DESC', collectionId
    );
    if (cols.length === 0) {
      Alert.alert(t('item.move'), t('item.noOtherCollection'));
      return;
    }
    menu(t('item.moveTo'), undefined, cols.map(c => ({ text: c.name, onPress: () => confirmMove(c) })));
  }

  async function confirmMove(target: { id: number; name: string }) {
    const missing = await missingFields(db, id, target.id);
    const done = async (addMissing: boolean) => {
      await moveItem(db, id, target.id, addMissing);
      setReload(r => r + 1);
      Alert.alert(t('item.movedTitle'), t('item.moved', { name: target.name }));
    };
    if (missing.length === 0) {
      done(false);
      return;
    }
    // Hedefte olmayan alanlar varsa: alanları da ekle ya da o bilgileri bırak
    Alert.alert(
      t('item.missingTitle'),
      t('item.missingMsg', { name: target.name, fields: missing.map(f => f.name).join(', ') }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('item.moveWithout'), style: 'destructive', onPress: () => done(false) },
        { text: t('item.moveAddFields'), onPress: () => done(true) },
      ]
    );
  }

  if (!item) return <View style={s.container} />;

  const pCur = (item.purchase_currency ?? currency) as Currency;
  const eCur = (item.estimated_currency ?? currency) as Currency;
  const money = (v: number, c: Currency) => formatMoney(v, c, lang);
  // Fark tahmini değerin biriminde gösterilir; birimler farklıysa alış fiyatı günlük kurla çevrilir
  let gain: number | null = null;
  let gainApprox = false;
  if (item.purchase_price !== null && item.estimated_value !== null) {
    const p = convert(item.purchase_price, pCur, eCur, rates);
    if (p !== null) {
      gain = item.estimated_value - p;
      gainApprox = pCur !== eCur;
    }
  }

  // Satış: alış fiyatına göre kâr / zarar (birimler farklıysa kurla, "≈")
  const sCur = (item.sold_currency ?? currency) as Currency;
  let profit: number | null = null;
  let profitApprox = false;
  if (item.status === 'sold' && item.sold_price !== null && item.purchase_price !== null) {
    const p = convert(item.purchase_price, pCur, sCur, rates);
    if (p !== null) {
      profit = item.sold_price - p;
      profitApprox = pCur !== sCur;
    }
  }
  const loanLeft = item.status === 'loaned' && item.loan_due ? daysUntil(item.loan_due) : null;

  // Görselle ara: ekrandaki fotoğraf doğrudan Google Lens'te aranır (uygulama içinde)
  function searchByImage() {
    const uri = photos[page] ?? photos[0];
    if (!uri) {
      Alert.alert(t('lens.title'), t('lens.noPhoto'));
      return;
    }
    router.push(`/lens?itemId=${id}&uri=${encodeURIComponent(uri)}`);
  }

  function searchMarket() {
    const textValues = details.filter(d => d.type === 'text').map(d => d.value!);
    const query = buildQuery(item!.title, textValues);
    const sites = marketSites(query, item!.template, lang, t);
    menu(t('value.searchTitle'), query, [
      ...sites.map(site => ({
        text: site.label,
        onPress: () => { WebBrowser.openBrowserAsync(site.url); },
      })),
      { text: t('common.cancel'), style: 'cancel' as const },
    ]);
  }

  return (
    <View style={s.container}>
      <Stack.Screen
        options={{
          title: '',
          headerRight: () => (
            <View style={s.headerActions}>
              <Pressable hitSlop={12} accessibilityLabel={t('story.title')} onPress={() => setStoryOpen(true)}>
                <Ionicons name="logo-instagram" size={22} color={C.black} />
              </Pressable>
              <Pressable
                hitSlop={12}
                accessibilityLabel={t('share.title')}
                onPress={() =>
                  askAndSharePdf(db, { collectionId, itemId: id }, item.title, { t, lang, currency }, setBusy)
                }
              >
                <Ionicons name="share-outline" size={22} color={C.black} />
              </Pressable>
              <Pressable hitSlop={12} onPress={moreMenu} accessibilityLabel={t('item.more')}>
                <Ionicons name="ellipsis-horizontal" size={22} color={C.black} />
              </Pressable>
              <Pressable onPress={() => router.push(`/item/${id}/edit`)} hitSlop={12}>
                <Text style={s.editButton}>{t('common.edit')}</Text>
              </Pressable>
            </View>
          ),
        }}
      />
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
          <Text style={s.collection}>{item.collection_name}</Text>

          {item.status === 'loaned' && (
            <View style={s.statusCard}>
              <Ionicons name="arrow-redo" size={18} color={C.black} />
              <View style={{ flex: 1 }}>
                <Text style={s.statusCardTitle}>
                  {item.loaned_to ? t('loan.withName', { name: item.loaned_to }) : t('status.loaned')}
                </Text>
                {item.loaned_at && (
                  <Text style={s.statusCardSub}>{t('loan.sinceDate', { date: formatDay(item.loaned_at, lang) })}</Text>
                )}
                {item.loan_due && (
                  <Text style={[s.statusCardSub, loanLeft !== null && loanLeft < 0 && { color: C.accent, fontFamily: F.bold }]}>
                    {t('loan.dueDate', { date: formatDay(item.loan_due, lang) })}
                    {loanLeft === null ? '' : loanLeft < 0
                      ? ` · ${t('loan.overdue', { n: -loanLeft })}`
                      : loanLeft === 0 ? ` · ${t('loan.today')}` : ` · ${t('loan.left', { n: loanLeft })}`}
                  </Text>
                )}
              </View>
            </View>
          )}

          {video && <VideoBlock key={video} uri={video} />}

          {details.length > 0 && (
            <View style={s.table}>
              {details.map(d => (
                <View key={d.name} style={s.row}>
                  <Text style={s.rowLabel}>{d.name}</Text>
                  <Text style={s.rowValue}>{d.type === 'boolean' ? t('common.yes') : d.value}</Text>
                </View>
              ))}
            </View>
          )}

          <View style={s.valueBlock}>
            <Text style={s.valueTitle}>{t('value.title')}</Text>
            {(item.purchase_price !== null || item.estimated_value !== null || item.sold_price !== null) && (
              <View style={s.valueTable}>
                {item.estimated_value !== null && (
                  <View style={s.row}>
                    <Text style={s.rowLabel}>{t('value.estimated')}</Text>
                    <View style={{ alignItems: 'flex-end', flexShrink: 1 }}>
                      <Text style={s.bigValue}>{money(item.estimated_value, eCur)}</Text>
                      {item.valued_at && (
                        <Text style={s.valueDate}>
                          {t('value.valuedAt', { date: formatDate(item.valued_at, lang) })}
                        </Text>
                      )}
                    </View>
                  </View>
                )}
                {item.purchase_price !== null && (
                  <View style={s.row}>
                    <Text style={s.rowLabel}>{t('value.purchase')}</Text>
                    <Text style={s.rowValue}>{money(item.purchase_price, pCur)}</Text>
                  </View>
                )}
                {item.status === 'sold' && item.sold_price !== null && (
                  <View style={s.row}>
                    <Text style={s.rowLabel}>{t('sold.price')}</Text>
                    <View style={{ alignItems: 'flex-end', flexShrink: 1 }}>
                      <Text style={s.rowValue}>{money(item.sold_price, sCur)}</Text>
                      {item.sold_at && <Text style={s.valueDate}>{formatDay(item.sold_at, lang)}</Text>}
                    </View>
                  </View>
                )}
                {profit !== null && (
                  <View style={s.row}>
                    <Text style={s.rowLabel}>{t(profit < 0 ? 'sold.loss' : 'sold.profit')}</Text>
                    <Text style={[s.rowValue, profit < 0 && { color: C.accent }]}>
                      {profitApprox ? '≈ ' : ''}{profit > 0 ? '+' : profit < 0 ? '−' : ''}{money(Math.abs(profit), sCur)}
                    </Text>
                  </View>
                )}
                {gain !== null && item.status !== 'sold' && (
                  <View style={s.row}>
                    <Text style={s.rowLabel}>{t('value.gain')}</Text>
                    <Text style={[s.rowValue, gain < 0 && { color: C.accent }]}>
                      {gainApprox ? '≈ ' : ''}{gain > 0 ? '+' : gain < 0 ? '−' : ''}{money(Math.abs(gain), eCur)}
                    </Text>
                  </View>
                )}
              </View>
            )}
            {item.estimated_value !== null && (
              <ValueHistory itemId={id} currency={eCur} rates={rates} refresh={`${reload}:${item.valued_at ?? ''}:${item.estimated_currency ?? ''}`} />
            )}
            <View style={s.searchRow}>
              <SecondaryButton label={t('value.search')} onPress={searchMarket} style={{ flex: 1 }} />
              <SecondaryButton label={t('lens.button')} onPress={searchByImage} style={{ flex: 1 }} />
            </View>
            {aiAvailable && photos.length > 0 && (
              <SecondaryButton
                label={`✦ ${t('ai.button')}`}
                onPress={() => router.push(`/item/${id}/edit?ai=1`)}
                style={{ marginTop: 10 }}
              />
            )}
            <Text style={s.valueHint}>{t('value.hint')}</Text>
          </View>

          {item.story && (
            <View style={s.storyBlock}>
              <Text style={s.storyLabel}>{t('form.story')}</Text>
              <Text style={s.storyText}>{item.story}</Text>
            </View>
          )}
        </View>
      </ScrollView>

      {busy && (
        <View style={s.busy}>
          <ActivityIndicator color={C.white} size="large" />
        </View>
      )}

      <StoryShare
        visible={storyOpen}
        onClose={() => setStoryOpen(false)}
        item={{
          title: item.title,
          collection: item.collection_name,
          photo: photos[0] ?? null,
          lines: details.map(d => ({ k: d.name, v: d.type === 'boolean' ? t('common.yes') : d.value! })),
        }}
      />

      <PhotoViewer
        photos={photos}
        index={page}
        visible={viewerOpen}
        onClose={() => setViewerOpen(false)}
      />
    </View>
  );
}

const makeStyles = (C: Palette) => StyleSheet.create({
  searchRow: { flexDirection: 'row', gap: 10, marginTop: 16 },
  statusCard: {
    flexDirection: 'row', gap: 12, alignItems: 'flex-start', marginTop: 18,
    padding: 14, borderWidth: 1.5, borderColor: C.black,
  },
  statusCardTitle: { fontFamily: F.bold, fontSize: 15, color: C.black },
  statusCardSub: { fontFamily: F.regular, fontSize: 13, color: C.grey, marginTop: 3 },
  container: { flex: 1, backgroundColor: C.white },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 20 },
  busy: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  editButton: { fontFamily: F.bold, fontSize: 16, color: C.black },
  counter: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    backgroundColor: C.black,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  counterText: { fontFamily: F.bold, fontSize: 13, color: C.white },
  noPhoto: { backgroundColor: C.paper, alignItems: 'center', justifyContent: 'center' },
  initial: { fontFamily: F.black, fontSize: 96, color: C.black, opacity: 0.1 },
  body: { paddingHorizontal: 20, paddingTop: 22 },
  status: { fontFamily: F.bold, fontSize: 13, color: C.grey },
  title: { fontFamily: F.black, fontSize: 32, color: C.black, letterSpacing: -0.9, marginTop: 6, lineHeight: 36 },
  collection: { fontFamily: F.medium, fontSize: 15, color: C.grey, marginTop: 6 },
  table: { borderTopWidth: 2, borderTopColor: C.black, marginTop: 26 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.line,
    gap: 16,
  },
  rowLabel: { fontFamily: F.regular, fontSize: 15, color: C.grey },
  rowValue: { fontFamily: F.bold, fontSize: 15, color: C.black, flexShrink: 1, textAlign: 'right' },
  storyBlock: { marginTop: 28 },
  valueBlock: { marginTop: 32 },
  valueTitle: { fontFamily: F.heavy, fontSize: 18, color: C.black, marginBottom: 10 },
  valueTable: { borderTopWidth: 2, borderTopColor: C.black },
  bigValue: { fontFamily: F.black, fontSize: 20, color: C.black, letterSpacing: -0.4 },
  valueDate: { fontFamily: F.regular, fontSize: 12, color: C.grey, marginTop: 2 },
  valueHint: { fontFamily: F.regular, fontSize: 12, color: C.grey, marginTop: 10, lineHeight: 17 },
  storyLabel: { fontFamily: F.bold, fontSize: 14, color: C.black, marginBottom: 8 },
  storyText: { fontFamily: F.regular, fontSize: 16, color: C.black, lineHeight: 25 },
});
