import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Image, Pressable, StyleSheet, Text, useWindowDimensions, View,
} from 'react-native';
import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeIn, FadeOut, ZoomIn, ZoomOut, useAnimatedRef } from 'react-native-reanimated';
import Sortable from 'react-native-sortables';
import { Ionicons } from '@expo/vector-icons';
import { F, STATUS_KEYS } from '../../../constants/theme';
import { Palette, useStyles, useTheme } from '../../../lib/theme';
import { PrimaryButton, Segmented } from '../../../components/ui';
import { Toast, ToastHandle } from '../../../components/Toast';
import { photoUri } from '../../../lib/photos';
import { askAndSharePdf } from '../../../lib/shareAction';
import { useI18n } from '../../../lib/i18n';
import { summarize, useFxRates } from '../../../lib/fx';
import type { Currency } from '../../../lib/i18n';
import { useMenu } from '../../../lib/menu';
import { parseSortMode, sortItems, SORT_MODES, type SortMode } from '../../../lib/sort';

type ItemRow = {
  id: number;
  title: string;
  status: string;
  sort_order: number;
  created_at: string;
  estimated_value: number | null;
  estimated_currency: string | null;
  cover: string | null;
  subtitle: string | null;
};

const PAD = 20;
const GAP = 14;
const TRASH_SIZE = 72;
const TRASH_HIT_RADIUS = 80;

export default function CollectionScreen() {
  const { C } = useTheme();
  const s = useStyles(makeStyles);
  const { id } = useLocalSearchParams<{ id: string }>();
  const collectionId = Number(id);
  const db = useSQLiteContext();
  const { t, lang, currency } = useI18n();
  const menu = useMenu();
  const rates = useFxRates();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [cols, setCols] = useState<2 | 3 | 4>(2);
  const [sortMode, setSortMode] = useState<SortMode>('manual');
  const [gridKey, setGridKey] = useState(0);
  // Sütun sayısına göre boşluk ve kutu boyutu
  const colGap = cols === 2 ? GAP : cols === 3 ? 10 : 6;
  const rowGap = cols === 2 ? 22 : cols === 3 ? 16 : 6;
  const tile = (width - PAD * 2 - colGap * (cols - 1)) / cols;
  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  const toastRef = useRef<ToastHandle>(null);
  const lastDrag = useRef(0);
  const overTrashRef = useRef(false);

  const [name, setName] = useState('');
  const [items, setItems] = useState<ItemRow[]>([]);
  const [filter, setFilter] = useState('all');
  const [dragging, setDragging] = useState(false);
  const [overTrash, setOverTrash] = useState(false);
  const [busy, setBusy] = useState(false);

  const filters = [
    { key: 'all', label: t('filter.all') },
    ...STATUS_KEYS.map(k => ({ key: k, label: t(`status.${k}`) })),
  ];

  // Çöp kutusunun ekrandaki merkezi (sürükleme koordinatları pencereye göre)
  const trashBottom = insets.bottom + 16;
  const trashCenter = { x: width / 2, y: height - trashBottom - TRASH_SIZE / 2 };

  // Sıralama tercihi de her koleksiyon için ayrı hatırlanır
  function changeSort(m: SortMode) {
    setSortMode(m);
    db.runAsync('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', `sort:${collectionId}`, m);
  }

  function sortMenu() {
    menu(t('sort.title'), undefined, SORT_MODES.map(m => ({
      text: `${m === sortMode ? '✓  ' : ''}${t(`sort.${m}` as 'sort.manual')}`,
      onPress: () => changeSort(m),
    })));
  }

  // Görünüm tercihi her koleksiyon için ayrı hatırlanır
  function changeCols(n: 2 | 3 | 4) {
    setCols(n);
    db.runAsync('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', `cols:${collectionId}`, String(n));
  }

  const load = useCallback(async () => {
    const pref = await db.getFirstAsync<{ value: string }>(
      'SELECT value FROM settings WHERE key = ?', `cols:${collectionId}`
    );
    const n = Number(pref?.value);
    if (n === 2 || n === 3 || n === 4) setCols(n);
    const sortPref = await db.getFirstAsync<{ value: string }>(
      'SELECT value FROM settings WHERE key = ?', `sort:${collectionId}`
    );
    setSortMode(parseSortMode(sortPref?.value));
    const c = await db.getFirstAsync<{ name: string }>(
      'SELECT name FROM collections WHERE id = ?', collectionId
    );
    setName(c?.name ?? '');
    const rows = await db.getAllAsync<ItemRow>(`
      SELECT i.id, i.title, i.status, i.sort_order, i.created_at, i.estimated_value, i.estimated_currency,
        (SELECT p.uri FROM item_photos p
          WHERE p.item_id = i.id ORDER BY p.sort_order LIMIT 1) AS cover,
        (SELECT v.value FROM item_values v
           JOIN field_defs f ON f.id = v.field_id
          WHERE v.item_id = i.id AND f.type IN ('text', 'number')
            AND v.value IS NOT NULL AND v.value <> ''
          ORDER BY f.sort_order LIMIT 1) AS subtitle
      FROM items i
      WHERE i.collection_id = ? AND i.deleted_at IS NULL
      ORDER BY i.sort_order, i.id DESC
    `, collectionId);
    setItems(rows);
  }, [db, collectionId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const filtered = filter === 'all' ? items : items.filter(i => i.status === filter);
  const visible = sortItems(filtered, sortMode, { currency, rates });
  const owned = items.filter(i => i.status === 'owned');
  const ownedCount = owned.length;
  const ownedTotal = summarize(
    owned
      .filter(i => i.estimated_value !== null)
      .map(i => ({ v: i.estimated_value!, c: (i.estimated_currency ?? currency) as Currency })),
    currency, rates, lang, t
  );

  const open = (itemId: number) => {
    if (Date.now() - lastDrag.current < 400) return;
    router.push(`/item/${itemId}`);
  };

  // Filtreli görünümde sadece görünen parçalar kendi aralarında yer değiştirir
  async function saveOrder(next: ItemRow[]) {
    const slots = visible.map(i => i.sort_order).sort((a, b) => a - b);
    const newOrder = new Map(next.map((it, idx) => [it.id, slots[idx]]));
    const updated = items
      .map(i => (newOrder.has(i.id) ? { ...i, sort_order: newOrder.get(i.id)! } : i))
      .sort((a, b) => a.sort_order - b.sort_order);
    setItems(updated);
    await db.withTransactionAsync(async () => {
      for (const [itemId, order] of newOrder) {
        await db.runAsync('UPDATE items SET sort_order = ? WHERE id = ?', order, itemId);
      }
    });
  }

  async function moveToTrash(itemId: number) {
    const item = items.find(i => i.id === itemId);
    if (!item) return;
    setItems(prev => prev.filter(i => i.id !== itemId));
    await db.runAsync("UPDATE items SET deleted_at = datetime('now') WHERE id = ?", itemId);
    toastRef.current?.show(t('trash.moved', { title: item.title }), {
      label: t('common.undo'),
      onPress: async () => {
        await db.runAsync('UPDATE items SET deleted_at = NULL WHERE id = ?', itemId);
        load();
      },
    });
  }

  return (
    <View style={s.container}>
      <Stack.Screen
        options={{
          title: '',
          headerRight: () => (
            <View style={s.headerActions}>
              <Pressable
                hitSlop={12}
                accessibilityLabel={t('share.title')}
                onPress={() => {
                  // Açık filtre neyse o paylaşılır (ör. sadece istek listesi)
                  const label = filters.find(f => f.key === filter)?.label;
                  const title = filter === 'all' ? name : `${name} — ${label}`;
                  askAndSharePdf(
                    db,
                    { collectionId, status: filter === 'all' ? null : filter },
                    title,
                    { t, lang, currency },
                    setBusy
                  );
                }}
              >
                <Ionicons name="share-outline" size={22} color={C.black} />
              </Pressable>
              <Pressable
                hitSlop={12}
                accessibilityLabel={t('fields.edit')}
                onPress={() =>
                  menu(name, undefined, [
                    { text: t('batch.menu'), onPress: () => router.push(`/collection/${collectionId}/batch`) },
                    { text: t('fields.edit'), onPress: () => router.push(`/collection/${collectionId}/fields`) },
                    { text: t('common.cancel'), style: 'cancel' },
                  ])
                }
              >
                <Ionicons name="ellipsis-horizontal" size={22} color={C.black} />
              </Pressable>
            </View>
          ),
        }}
      />
      <Animated.ScrollView ref={scrollRef} contentContainerStyle={{ paddingBottom: 140 }}>
        <View style={s.header}>
          <Text style={s.title}>{name}</Text>
          <Text style={s.summary}>
            {t('collection.summary', { n: ownedCount })}
            {ownedTotal ? `  ·  ${ownedTotal.text}` : ''}
          </Text>
          {ownedTotal?.note && <Text style={s.fxNote}>{ownedTotal.note}</Text>}
          <View style={{ marginTop: 20 }}>
            <Segmented options={filters} value={filter} onChange={setFilter} />
          </View>
          <View style={s.controls}>
            <Pressable
              onPress={sortMenu}
              hitSlop={6}
              style={s.sortBtn}
              accessibilityLabel={t('sort.title')}
            >
              <Ionicons name="swap-vertical" size={16} color={C.black} />
              <Text style={s.sortText}>{t(`sort.${sortMode}` as 'sort.manual')}</Text>
            </Pressable>
            <View style={s.colsRow}>
            <Ionicons name="grid-outline" size={15} color={C.grey} />
            {([2, 3, 4] as const).map(n => (
              <Pressable
                key={n}
                onPress={() => changeCols(n)}
                hitSlop={6}
                accessibilityLabel={t('collection.columns', { n })}
                accessibilityState={{ selected: cols === n }}
                style={[s.colsBtn, cols === n && s.colsBtnOn]}
              >
                <Text style={[s.colsText, cols === n && s.colsTextOn]}>{n}</Text>
              </Pressable>
            ))}
            </View>
          </View>
        </View>

        {visible.length === 0 ? (
          <View style={s.empty}>
            <Text style={s.emptyTitle}>
              {filter === 'all' ? t('collection.empty') : t('collection.emptyFiltered')}
            </Text>
          </View>
        ) : (
          <View style={{ paddingHorizontal: PAD }}>
            <Sortable.Grid
              key={`${filter}-${cols}-${sortMode}-${gridKey}`}
              columns={cols}
              columnGap={colGap}
              rowGap={rowGap}
              data={visible}
              keyExtractor={i => String(i.id)}
              scrollableRef={scrollRef}
              autoScrollEnabled={!overTrash}
              hapticsEnabled
              onDragStart={() => {
                lastDrag.current = Date.now();
                setDragging(true);
              }}
              onDragMove={({ touchData }) => {
                const dx = touchData.absoluteX - trashCenter.x;
                const dy = touchData.absoluteY - trashCenter.y;
                const over = dx * dx + dy * dy < TRASH_HIT_RADIUS * TRASH_HIT_RADIUS;
                if (over !== overTrashRef.current) {
                  overTrashRef.current = over;
                  setOverTrash(over);
                }
              }}
              onDragEnd={({ key, data: next }) => {
                lastDrag.current = Date.now();
                setDragging(false);
                setOverTrash(false);
                if (overTrashRef.current) {
                  overTrashRef.current = false;
                  moveToTrash(Number(key));
                } else if (sortMode !== 'manual') {
                  // Otomatik sıralamada elle yer değiştirme kaydedilmez; ızgara eski haline döner
                  setGridKey(k => k + 1);
                  toastRef.current?.show(t('sort.manualHint'));
                } else {
                  saveOrder(next);
                }
              }}
              renderItem={({ item }) => {
                const uri = photoUri(item.cover);
                return (
                  <Pressable
                    onPress={() => open(item.id)}
                    style={({ pressed }) => [s.tile, pressed && { opacity: 0.6 }]}
                  >
                    <View style={[s.photo, { width: tile, height: tile }]}>
                      {uri ? (
                        <Image source={{ uri }} style={StyleSheet.absoluteFill} />
                      ) : (
                        <Text style={s.initial}>{item.title.charAt(0).toLocaleUpperCase('tr')}</Text>
                      )}
                    </View>
                    {cols === 4 ? (
                      // 4 sütunda sadece fotoğraf; durum köşede küçük işaretle
                      item.status !== 'owned' && (
                        <View style={s.badge}>
                          <Ionicons name={item.status === 'wishlist' ? 'heart' : 'swap-horizontal'} size={10} color="#FFFFFF" />
                        </View>
                      )
                    ) : (
                      <>
                        {item.status !== 'owned' && (
                          <Text style={[s.status, cols === 3 && { fontSize: 10.5, marginTop: 7 }]}>
                            {t(`status.${item.status}` as 'status.owned')}
                          </Text>
                        )}
                        <Text
                          style={[s.itemTitle, cols === 3 && { fontSize: 13, marginTop: 6, lineHeight: 16 }]}
                          numberOfLines={cols === 3 ? 1 : 2}
                        >
                          {item.title}
                        </Text>
                        {cols === 2 && item.subtitle && <Text style={s.itemSub} numberOfLines={1}>{item.subtitle}</Text>}
                      </>
                    )}
                  </Pressable>
                );
              }}
            />
          </View>
        )}
      </Animated.ScrollView>

      {dragging ? (
        <Animated.View
          entering={ZoomIn.duration(160)}
          exiting={ZoomOut.duration(140)}
          pointerEvents="none"
          style={[s.trashWrap, { bottom: trashBottom }]}
        >
          <Text style={[s.trashHint, overTrash && { color: C.black }]}>{t('collection.dropToTrash')}</Text>
          <View
            style={[
              s.trash,
              overTrash && s.trashActive,
              { transform: [{ scale: overTrash ? 1.15 : 1 }] },
            ]}
          >
            <Ionicons
              name={overTrash ? 'trash' : 'trash-outline'}
              size={30}
              color={overTrash ? C.white : C.black}
            />
          </View>
        </Animated.View>
      ) : (
        <Animated.View
          entering={FadeIn.duration(160)}
          exiting={FadeOut.duration(100)}
          style={[s.cta, { bottom: insets.bottom + 12 }]}
        >
          <PrimaryButton
            label={t('collection.addItem')}
            onPress={() => router.push(`/collection/${collectionId}/new-item`)}
            style={{ flex: 1 }}
          />
          <Pressable
            onPress={() => router.push(`/collection/${collectionId}/batch`)}
            accessibilityLabel={t('batch.title')}
            style={({ pressed }) => [s.batchButton, pressed && { backgroundColor: C.paper }]}
          >
            <Ionicons name="grid-outline" size={18} color={C.black} />
            <Text style={s.batchButtonText}>{t('home.batchShort')}</Text>
          </Pressable>
        </Animated.View>
      )}

      {busy && (
        <View style={s.busy}>
          <ActivityIndicator color={C.white} size="large" />
        </View>
      )}
      <Toast ref={toastRef} bottom={insets.bottom + 84} />
    </View>
  );
}

const makeStyles = (C: Palette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: C.white },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 20 },
  busy: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: { paddingHorizontal: PAD, paddingBottom: 24 },
  title: { fontFamily: F.black, fontSize: 36, color: C.black, letterSpacing: -1 },
  summary: { fontFamily: F.medium, fontSize: 15, color: C.grey, marginTop: 4 },
  fxNote: { fontFamily: F.regular, fontSize: 12, color: C.grey, marginTop: 2 },
  tile: { backgroundColor: C.white },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14 },
  sortBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 },
  sortText: { fontFamily: F.semi, fontSize: 13, color: C.black },
  colsRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  colsBtn: {
    width: 28,
    height: 28,
    borderWidth: 1.5,
    borderColor: C.black,
    alignItems: 'center',
    justifyContent: 'center',
  },
  colsBtnOn: { backgroundColor: C.brand },
  colsText: { fontFamily: F.bold, fontSize: 13, color: C.black },
  colsTextOn: { color: C.onBrand },
  badge: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 16,
    height: 16,
    backgroundColor: C.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photo: { backgroundColor: C.paper, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  initial: { fontFamily: F.black, fontSize: 56, color: C.black, opacity: 0.12 },
  status: { fontFamily: F.bold, fontSize: 12, color: C.accent, marginTop: 10 },
  itemTitle: { fontFamily: F.bold, fontSize: 15, color: C.black, marginTop: 8, lineHeight: 19 },
  itemSub: { fontFamily: F.regular, fontSize: 13, color: C.grey, marginTop: 2 },
  empty: { paddingHorizontal: PAD },
  emptyTitle: { fontFamily: F.medium, fontSize: 16, color: C.grey },
  cta: { position: 'absolute', left: PAD, right: PAD, flexDirection: 'row', gap: 10 },
  batchButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 14,
    borderWidth: 1.5,
    borderColor: C.black,
    backgroundColor: C.white,
  },
  batchButtonText: { fontFamily: F.bold, fontSize: 14, color: C.black },
  trashWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  trashHint: { fontFamily: F.semi, fontSize: 13, color: C.grey, marginBottom: 10 },
  trash: {
    width: TRASH_SIZE,
    height: TRASH_SIZE,
    borderRadius: TRASH_SIZE / 2,
    borderWidth: 2,
    borderColor: C.black,
    backgroundColor: C.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trashActive: { backgroundColor: C.black },
});
