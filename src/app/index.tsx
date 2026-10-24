import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, BackHandler, Image, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSQLiteContext } from 'expo-sqlite';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { countsAsOwned, F, STATUS_ICON } from '../constants/theme';
import { Palette, useStyles, useTheme } from '../lib/theme';
import { useI18n, type Currency } from '../lib/i18n';
import { deleteItemsForever } from '../lib/trash';
import { PrimaryButton } from '../components/ui';
import { AddSheet, type AddOption } from '../components/AddSheet';
import { photoUri } from '../lib/photos';
import { convert, useFxRates } from '../lib/fx';
import { formatMoney } from '../lib/money';
import { Brand } from '../components/Logo';
import Animated, { FadeIn, FadeOut, ZoomIn, ZoomOut, useAnimatedRef } from 'react-native-reanimated';
import Sortable from 'react-native-sortables';
import { Toast, ToastHandle } from '../components/Toast';
import { deleteSharedList, pickAndImport, ShareImportError } from '../lib/shareData';
import { parseSortMode, sortItems, type SortMode } from '../lib/sort';
import { useMenu } from '../lib/menu';
import { EmptyShowcase } from '../components/EmptyShowcase';
import { getDemoCollectionId, loadDemo, removeDemo } from '../lib/demo';

type CollectionRow = { id: number; name: string; cover: string | null; all_count: number };
type ItemRow = {
  id: number;
  collection_id: number;
  title: string;
  status: string;
  sort_order: number;
  created_at: string;
  cover: string | null;
  estimated_value: number | null;
  estimated_currency: string | null;
};
type StatusFilter = 'all' | 'owned' | 'wishlist' | 'trade' | 'loaned' | 'sold';
type SharedRow = { id: number; title: string; sender: string | null; payload: string };
type SharedTile = { id: number; title: string; cover: string | null };

const HL = 100; // öne çıkanlar kutusu
const HL_GAP = 12;
const TRASH_SIZE = 72;
const TRASH_HIT_RADIUS = 80;
const GRID_GAP = 2;

export default function HomeScreen() {
  const { C } = useTheme();
  const s = useStyles(makeStyles);
  const db = useSQLiteContext();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  const toastRef = useRef<ToastHandle>(null);
  const lastDrag = useRef(0);
  const overTrashRef = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [overTrash, setOverTrash] = useState(false);
  const trashBottom = insets.bottom + 16;
  const trashCenter = { x: width / 2, y: height - trashBottom - TRASH_SIZE / 2 };
  const [cols, setCols] = useState<2 | 3 | 4>(3);
  const [sortPrefs, setSortPrefs] = useState<Record<number, SortMode>>({});
  const cell = (width - GRID_GAP * (cols - 1)) / cols;
  const { t, lang, setLang, currency } = useI18n();
  const rates = useFxRates();
  const menu = useMenu();

  const [collections, setCollections] = useState<CollectionRow[]>([]);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [trashCount, setTrashCount] = useState(0);
  // Örnek koleksiyon (yeni kullanıcı "Örnek koleksiyonla dene" dediyse)
  const [demoId, setDemoId] = useState<number | null>(null);
  const [demoLoading, setDemoLoading] = useState(false);
  // Veriler ilk kez okunana kadar boş ekran gösterilmez (koleksiyonu olan kullanıcıda bir an görünmesin)
  const [loaded, setLoaded] = useState(false);
  const [sharedLists, setSharedLists] = useState<SharedTile[]>([]);
  const [selected, setSelected] = useState<number | null>(null); // null = Tümü
  const [status, setStatus] = useState<StatusFilter>('all');
  const [masked, setMasked] = useState(false);
  // Seçim modu: parçalara dokununca seçilir, toplu silinir
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<number>>(new Set());

  const load = useCallback(async () => {
    const cols = await db.getAllAsync<CollectionRow>(`
      SELECT c.id, c.name,
        (SELECT p.uri FROM items i JOIN item_photos p ON p.item_id = i.id
          WHERE i.collection_id = c.id AND i.deleted_at IS NULL
          ORDER BY i.sort_order, i.id DESC, p.sort_order LIMIT 1) AS cover,
        (SELECT COUNT(*) FROM items i WHERE i.collection_id = c.id AND i.deleted_at IS NULL) AS all_count
      FROM collections c
      ORDER BY c.sort_order, c.id DESC
    `);
    const its = await db.getAllAsync<ItemRow>(`
      SELECT i.id, i.collection_id, i.title, i.status, i.sort_order, i.created_at, i.estimated_value, i.estimated_currency,
        (SELECT p.uri FROM item_photos p WHERE p.item_id = i.id ORDER BY p.sort_order LIMIT 1) AS cover
      FROM items i
      WHERE i.deleted_at IS NULL
      ORDER BY i.created_at DESC, i.id DESC
    `);
    // Koleksiyonların sıralama tercihleri (koleksiyon sayfasında seçilir)
    const sortRows = await db.getAllAsync<{ key: string; value: string }>(
      "SELECT key, value FROM settings WHERE key LIKE 'sort:%'"
    );
    setSortPrefs(Object.fromEntries(sortRows.map(r => [Number(r.key.slice(5)), parseSortMode(r.value)])));
    const colPref = await db.getFirstAsync<{ value: string }>("SELECT value FROM settings WHERE key = 'home_cols'");
    const nc = Number(colPref?.value);
    if (nc === 2 || nc === 3 || nc === 4) setCols(nc);
    const mask = await db.getFirstAsync<{ value: string }>(
      "SELECT value FROM settings WHERE key = 'mask_value'"
    );
    setMasked(mask?.value === '1');
    const trash = await db.getFirstAsync<{ n: number }>(
      'SELECT COUNT(*) AS n FROM items WHERE deleted_at IS NOT NULL'
    );
    const shared = await db.getAllAsync<SharedRow>(
      'SELECT id, title, sender, payload FROM shared_lists ORDER BY sort_order, id'
    );
    setSharedLists(
      shared.map(r => {
        let cover: string | null = null;
        try {
          const p = JSON.parse(r.payload);
          for (const c of p.collections ?? []) {
            const hit = (c.items ?? []).find((i: { photo?: string }) => i.photo);
            if (hit) { cover = hit.photo; break; }
          }
        } catch {}
        // Kutuda gönderenin adı (girildiyse), yoksa listenin adı görünür
        return { id: r.id, title: r.sender || r.title, cover };
      })
    );
    setDemoId(await getDemoCollectionId(db));
    setCollections(cols);
    setItems(its);
    setLoaded(true);
    setTrashCount(trash?.n ?? 0);
    setSelected(prev => (prev !== null && !cols.some(c => c.id === prev) ? null : prev));
  }, [db]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Özet: koleksiyon, sahip olunan parça ve toplam tahmini değer
  const owned = items.filter(i => countsAsOwned(i.status));
  const valueText = useMemo(() => {
    const vals = owned.filter(i => i.estimated_value !== null);
    if (vals.length === 0) return null;
    let sum = 0;
    let approx = false;
    for (const i of vals) {
      const c = (i.estimated_currency ?? currency) as Currency;
      const v = convert(i.estimated_value!, c, currency, rates);
      if (v === null) return null;
      if (c !== currency) approx = true;
      sum += v;
    }
    return `${approx ? '≈ ' : ''}${formatMoney(sum, currency, lang)}`;
  }, [owned, currency, rates, lang]);

  // Izgara: seçili koleksiyon ve durum sekmesine göre
  const visible = useMemo(() => {
    // Tümü: en son eklenen üstte; tek koleksiyon: koleksiyondaki sıraya göre
    let list = selected === null
      ? items
      : sortItems(items.filter(i => i.collection_id === selected), sortPrefs[selected] ?? 'manual', { currency, rates });
    if (status !== 'all') list = list.filter(i => i.status === status);
    return list;
  }, [items, selected, status, sortPrefs, currency, rates]);

  // Izgara sütun sayısı: 3 → 4 → 2 → 3 ... (tercih hatırlanır)
  function cycleCols() {
    const next = cols === 3 ? 4 : cols === 4 ? 2 : 3;
    setCols(next);
    db.runAsync("INSERT OR REPLACE INTO settings (key, value) VALUES ('home_cols', ?)", String(next));
  }

  // Tahmini değere dokununca gizlenir/görünür; tercih hatırlanır
  function toggleMask() {
    const next = !masked;
    setMasked(next);
    db.runAsync("INSERT OR REPLACE INTO settings (key, value) VALUES ('mask_value', ?)", next ? '1' : '0');
  }

  function onHighlightPress(id: number | null) {
    if (Date.now() - lastDrag.current < 400) return;
    // Seçili koleksiyona tekrar dokununca koleksiyon sayfası açılır
    if (id !== null && id === selected) router.push(`/collection/${id}`);
    else setSelected(id);
  }

  async function tryDemo() {
    setDemoLoading(true);
    try {
      await loadDemo(db, lang);
      await load();
    } catch (e) {
      Alert.alert(t('err.saveFailed'), String(e));
    } finally {
      setDemoLoading(false);
    }
  }

  function confirmRemoveDemo() {
    Alert.alert(t('demo.removeTitle'), t('demo.removeMsg'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          await removeDemo(db);
          setSelected(null);
          load();
        },
      },
    ]);
  }

  function confirmDelete(c: CollectionRow) {
    if (c.all_count > 0) {
      Alert.alert(t('home.deleteTitle'), t('home.deleteNotEmpty'));
      return;
    }
    Alert.alert(t('home.deleteTitle'), t('home.deleteMsg', { name: c.name }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          // Geri dönüşüm kutusundaki parçaları da fotoğraflarıyla birlikte temizle
          const trashed = await db.getAllAsync<{ id: number }>(
            'SELECT id FROM items WHERE collection_id = ?', c.id
          );
          await deleteItemsForever(db, trashed.map(r => r.id));
          await db.runAsync('DELETE FROM collections WHERE id = ?', c.id);
          load();
        },
      },
    ]);
  }

  // ---------- Sürükle-bırak ----------

  function dragStart() {
    lastDrag.current = Date.now();
    setDragging(true);
  }

  function dragMove(touch: { absoluteX: number; absoluteY: number }) {
    const dx = touch.absoluteX - trashCenter.x;
    const dy = touch.absoluteY - trashCenter.y;
    const over = dx * dx + dy * dy < TRASH_HIT_RADIUS * TRASH_HIT_RADIUS;
    if (over !== overTrashRef.current) {
      overTrashRef.current = over;
      setOverTrash(over);
    }
  }

  // Bırakıldığında çöp kutusunun üzerinde miydi? (durumu sıfırlar)
  function dragEnd() {
    lastDrag.current = Date.now();
    setDragging(false);
    setOverTrash(false);
    const wasOver = overTrashRef.current;
    overTrashRef.current = false;
    return wasOver;
  }

  async function onCollectionsReordered(next: CollectionRow[], key: string) {
    if (dragEnd()) {
      const c = collections.find(x => String(x.id) === key);
      if (c) confirmDelete(c);
      return;
    }
    setCollections(next);
    await db.withTransactionAsync(async () => {
      for (const [i, c] of next.entries()) {
        await db.runAsync('UPDATE collections SET sort_order = ? WHERE id = ?', i, c.id);
      }
    });
  }

  async function onItemsReordered(next: ItemRow[], key: string) {
    if (dragEnd()) {
      moveToTrash(Number(key));
      return;
    }
    if (selected === null) {
      // "Tümü"nde sıra koleksiyonlar arasında anlamsız; eski haline dön
      load();
      toastRef.current?.show(t('home.sortHint'));
      return;
    }
    if ((sortPrefs[selected] ?? 'manual') !== 'manual') {
      // Koleksiyon otomatik sıralanıyorsa elle yer değiştirme kaydedilmez
      load();
      toastRef.current?.show(t('sort.manualHint'));
      return;
    }
    // Filtreli görünümde sadece görünen parçalar kendi aralarında yer değiştirir
    const slots = visible.map(i => i.sort_order).sort((a, b) => a - b);
    const order = new Map(next.map((it, idx) => [it.id, slots[idx]]));
    setItems(prev => prev.map(i => (order.has(i.id) ? { ...i, sort_order: order.get(i.id)! } : i)));
    await db.withTransactionAsync(async () => {
      for (const [id, o] of order) await db.runAsync('UPDATE items SET sort_order = ? WHERE id = ?', o, id);
    });
  }

  function startSelecting() {
    setPicked(new Set());
    setSelecting(true);
  }
  function stopSelecting() {
    setSelecting(false);
    setPicked(new Set());
  }
  function togglePick(id: number) {
    setPicked(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  // Filtre ya da koleksiyon değişince görünmeyen parçalar seçili kalmasın
  useEffect(() => setPicked(new Set()), [selected, status]);

  // Parmağı sürükleyerek çoklu seçim (iPhone Fotoğraflar gibi): yatay başlayan sürükleme
  // seçmeye başlar, sonra her yöne uzatılabilir. Dikey başlayan hareket sayfayı kaydırır.
  // İlk dokunulan parça seçili değilse aradakiler seçilir, seçiliyse seçimleri kaldırılır.
  const dragSel = useRef<{ start: number; add: boolean; base: Set<number> } | null>(null);
  const [dragSelecting, setDragSelecting] = useState(false); // sürüklerken sayfa kaymasın
  function indexAt(x: number, y: number) {
    const step = cell + GRID_GAP;
    const col = Math.min(cols - 1, Math.max(0, Math.floor(x / step)));
    const row = Math.max(0, Math.floor(y / step));
    return Math.min(visible.length - 1, row * cols + col);
  }
  function applyRange(cur: number) {
    const d = dragSel.current;
    if (!d) return;
    const next = new Set(d.base);
    const [a, b] = d.start <= cur ? [d.start, cur] : [cur, d.start];
    for (let i = a; i <= b; i++) {
      const id = visible[i]?.id;
      if (id === undefined) continue;
      if (d.add) next.add(id);
      else next.delete(id);
    }
    setPicked(next);
  }
  const selectPan = Gesture.Pan()
    .runOnJS(true)
    .activeOffsetX([-12, 12])
    .failOffsetY([-12, 12])
    .onStart(e => {
      if (visible.length === 0) return;
      const start = indexAt(e.x, e.y);
      dragSel.current = { start, add: !picked.has(visible[start].id), base: new Set(picked) };
      setDragSelecting(true);
      applyRange(start);
    })
    .onUpdate(e => {
      if (dragSel.current) applyRange(indexAt(e.x, e.y));
    })
    .onFinalize(() => {
      dragSel.current = null;
      setDragSelecting(false);
    });

  // Android geri tuşu seçim modundan çıkar
  useEffect(() => {
    if (!selecting) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      stopSelecting();
      return true;
    });
    return () => sub.remove();
  }, [selecting]);

  // Seçilenleri çöp kutusuna taşır; bildirimden tek dokunuşla geri alınabilir
  async function trashPicked() {
    const ids = visible.filter(i => picked.has(i.id)).map(i => i.id);
    if (ids.length === 0) return;
    const marks = ids.map(() => '?').join(',');
    setItems(prev => prev.filter(i => !picked.has(i.id)));
    await db.runAsync(`UPDATE items SET deleted_at = datetime('now') WHERE id IN (${marks})`, ...ids);
    stopSelecting();
    load();
    toastRef.current?.show(t('select.trashed', { n: ids.length }), {
      label: t('common.undo'),
      onPress: async () => {
        await db.runAsync(`UPDATE items SET deleted_at = NULL WHERE id IN (${marks})`, ...ids);
        load();
      },
    });
  }

  async function moveToTrash(itemId: number) {
    const item = items.find(i => i.id === itemId);
    if (!item) return;
    setItems(prev => prev.filter(i => i.id !== itemId));
    await db.runAsync("UPDATE items SET deleted_at = datetime('now') WHERE id = ?", itemId);
    load();
    toastRef.current?.show(t('trash.moved', { title: item.title }), {
      label: t('common.undo'),
      onPress: async () => {
        await db.runAsync('UPDATE items SET deleted_at = NULL WHERE id = ?', itemId);
        load();
      },
    });
  }

  function openItem(id: number) {
    if (Date.now() - lastDrag.current < 400) return;
    router.push(`/item/${id}`);
  }

  async function importList() {
    try {
      const id = await pickAndImport(db);
      if (id !== null) router.push(`/shared/${id}`);
    } catch (e) {
      const msg = e instanceof ShareImportError ? t(e.code === 'noData' ? 'shared.noData' : 'shared.invalid') : String(e);
      Alert.alert(t('shared.importFailed'), msg);
    }
  }

  function sharedMenu(l: SharedTile) {
    menu(l.title, undefined, [
      { text: t('home.open'), onPress: () => router.push(`/shared/${l.id}`) },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: () =>
          Alert.alert(t('shared.deleteTitle'), t('shared.deleteMsg', { title: l.title }), [
            { text: t('common.cancel'), style: 'cancel' },
            { text: t('common.delete'), style: 'destructive', onPress: async () => { await deleteSharedList(db, l.id); load(); } },
          ]),
      },
      { text: t('common.cancel'), style: 'cancel' },
    ]);
  }

  const [addOpen, setAddOpen] = useState(false);

  // Koleksiyon belliyse doğrudan gider; değilse menünün içinde koleksiyon seçtirilir
  function target(kind: 'new-item' | 'batch'): Pick<AddOption, 'onPress' | 'choices'> {
    const id = selected ?? (collections.length === 1 ? collections[0].id : null);
    if (id !== null) return { onPress: () => router.push(`/collection/${id}/${kind}`) };
    return {
      choices: collections.map(c => ({
        key: String(c.id),
        label: c.name,
        image: photoUri(c.cover),
        onPress: () => router.push(`/collection/${c.id}/${kind}`),
      })),
    };
  }

  const addOptions: AddOption[] = [
    { key: 'item', icon: 'add', title: t('add.item'), sub: t('add.itemSub'), ...target('new-item') },
    { key: 'batch', icon: 'grid-outline', title: t('add.batch'), sub: t('add.batchSub'), ...target('batch') },
    { key: 'collection', icon: 'albums-outline', title: t('add.collection'), sub: t('add.collectionSub'), onPress: () => router.push('/new-collection') },
    { key: 'import', icon: 'download-outline', title: t('add.import'), sub: t('add.importSub'), onPress: importList },
  ];

  const tabs: { key: StatusFilter; icon: keyof typeof Ionicons.glyphMap; iconOn: keyof typeof Ionicons.glyphMap; label: string }[] = [
    { key: 'all', icon: 'grid-outline', iconOn: 'grid', label: t('filter.all') },
    { key: 'owned', icon: 'checkmark-circle-outline', iconOn: 'checkmark-circle', label: t('status.owned') },
    { key: 'wishlist', icon: 'heart-outline', iconOn: 'heart', label: t('status.wishlist') },
    { key: 'trade', icon: 'swap-horizontal-outline', iconOn: 'swap-horizontal', label: t('status.trade') },
    // Ödünç ve Satıldı sekmeleri yalnızca o durumda parça varken görünür
    ...(items.some(i => i.status === 'loaned') || status === 'loaned'
      ? [{ key: 'loaned' as const, icon: 'arrow-redo-outline' as const, iconOn: 'arrow-redo' as const, label: t('status.loaned') }]
      : []),
    ...(items.some(i => i.status === 'sold') || status === 'sold'
      ? [{ key: 'sold' as const, icon: 'pricetag-outline' as const, iconOn: 'pricetag' as const, label: t('status.sold') }]
      : []),
  ];

  const header = (
    // Sürüklenen koleksiyon kutusu aşağıdaki sekme ve fotoğrafların üzerinde görünsün diye
    // başlık bölümü öne alınıyor
    <View style={s.headerLayer}>
      <View style={s.topRow}>
        <Brand size="large" />
        <View style={s.topActions}>
          <Pressable onPress={() => router.push('/search')} hitSlop={12} accessibilityLabel={t('nav.search')}>
            <Ionicons name="search" size={24} color={C.black} />
          </Pressable>
          <Pressable
            onPress={() => setLang(lang === 'tr' ? 'en' : 'tr')}
            hitSlop={12}
            accessibilityLabel={t('settings.language')}
          >
            <Text style={s.flag}>{lang === 'tr' ? '🇹🇷' : '🇬🇧'}</Text>
          </Pressable>
          <Pressable onPress={() => router.push('/settings')} hitSlop={12} accessibilityLabel={t('nav.settings')}>
            <Ionicons name="settings-outline" size={24} color={C.black} />
          </Pressable>
        </View>
      </View>

      {collections.length > 0 && (
        <View style={s.stats}>
          <Stat value={String(collections.length)} label={t('home.statCollections')} />
          <Stat value={String(owned.length)} label={t('home.statItems')} />
          {valueText && (
            <Pressable
              onPress={toggleMask}
              hitSlop={8}
              style={{ flex: 1 }}
              accessibilityLabel={t('value.estimated')}
              accessibilityHint={masked ? t('home.showValue') : t('home.hideValue')}
            >
              <Text style={s.statValue} numberOfLines={1} adjustsFontSizeToFit>
                {masked ? '******' : valueText}
              </Text>
              <View style={s.statLabelRow}>
                <Text style={s.statLabel}>{t('value.estimated')}</Text>
                <Ionicons name={masked ? 'eye-off-outline' : 'eye-outline'} size={13} color={C.grey} />
              </View>
            </Pressable>
          )}
        </View>
      )}

      <ScrollView
        // iOS kaydırma alanları taşan içeriği kırpar; sürüklenen kutu şeritten çıkınca
        // görünmez olmasın diye kırpma kapatılıyor
        style={s.highlightsScroll}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.highlights}
      >
        {collections.length > 0 && (
          <Highlight label={t('filter.all')} on={selected === null} onPress={() => onHighlightPress(null)}>
            <View style={[s.hlBox, s.hlAll]}>
              <Ionicons name="grid" size={24} color={C.onBrand} />
            </View>
          </Highlight>
        )}
        {collections.length > 0 && (
          <View style={{ width: collections.length * HL + (collections.length - 1) * HL_GAP }}>
            <Sortable.Grid
              // Sütun sayısı koleksiyon sayısına bağlı; koleksiyon eklenip silinince
              // ızgarayı yeniden kurmazsak yeni kutu ölçülmeden boş yer kalıyor
              key={collections.map(c => c.id).join(',')}
              columns={collections.length}
              columnGap={HL_GAP}
              data={collections}
              keyExtractor={c => String(c.id)}
              autoScrollEnabled={false}
              hapticsEnabled
              onDragStart={dragStart}
              onDragMove={({ touchData }) => dragMove(touchData)}
              onDragEnd={({ key, data: next }) => onCollectionsReordered(next, key)}
              renderItem={({ item: c }) => {
                const uri = photoUri(c.cover);
                return (
                  <Highlight label={c.name} on={selected === c.id} onPress={() => onHighlightPress(c.id)}>
                    <View style={s.hlBox}>
                      {uri ? (
                        <Image source={{ uri }} style={StyleSheet.absoluteFill} />
                      ) : (
                        <Text style={s.hlInitial}>{c.name.charAt(0).toLocaleUpperCase('tr')}</Text>
                      )}
                    </View>
                  </Highlight>
                );
              }}
            />
          </View>
        )}
        {sharedLists.map(l => {
          const uri = photoUri(l.cover);
          return (
            <Highlight
              key={`s${l.id}`}
              label={l.title}
              on={false}
              shared
              onPress={() => router.push(`/shared/${l.id}`)}
              onLongPress={() => sharedMenu(l)}
            >
              <View style={[s.hlBox, s.hlShared]}>
                {uri ? (
                  <Image source={{ uri }} style={StyleSheet.absoluteFill} />
                ) : (
                  <Ionicons name="people-outline" size={30} color={C.accent} />
                )}
              </View>
            </Highlight>
          );
        })}
        <Highlight label={t('home.new')} on={false} onPress={() => router.push('/new-collection')}>
          <View style={[s.hlBox, s.hlNew]}>
            <Ionicons name="add" size={28} color={C.black} />
          </View>
        </Highlight>
      </ScrollView>

      {collections.length > 0 && (
        <View style={s.tabs}>
          {tabs.map(tb => {
            const on = status === tb.key;
            return (
              <Pressable
                key={tb.key}
                onPress={() => setStatus(tb.key)}
                style={s.tab}
                accessibilityLabel={tb.label}
                accessibilityState={{ selected: on }}
              >
                <Ionicons name={on ? tb.iconOn : tb.icon} size={22} color={on ? C.black : C.grey} />
                <Text style={[s.tabLabel, on && s.tabLabelOn]} numberOfLines={1}>{tb.label}</Text>
                <View style={[s.tabLine, on && { backgroundColor: C.brand }]} />
              </Pressable>
            );
          })}
          <Pressable
            onPress={selecting ? stopSelecting : startSelecting}
            style={s.colsBtn}
            accessibilityLabel={selecting ? t('common.cancel') : t('select.button')}
          >
            <Ionicons name={selecting ? 'close-circle' : 'checkmark-circle-outline'} size={20} color={C.black} />
            <Text style={[s.tabLabel, selecting && s.tabLabelOn]}>{selecting ? t('common.cancel') : t('select.button')}</Text>
          </Pressable>
          <Pressable
            onPress={cycleCols}
            style={s.colsBtn}
            accessibilityLabel={t('collection.columns', { n: cols })}
          >
            <View style={s.colsIcon}>
              {Array.from({ length: cols }).map((_, k) => <View key={k} style={s.colsBar} />)}
            </View>
            <Text style={s.tabLabel}>{cols}</Text>
          </Pressable>
        </View>
      )}
    </View>
  );

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      <Animated.ScrollView ref={scrollRef} scrollEnabled={!dragSelecting} contentContainerStyle={{ paddingBottom: insets.bottom + 120 }}>
        {header}
        {demoId !== null && collections.length > 0 && (
          <View style={s.demoBar}>
            <View style={{ flex: 1 }}>
              <Text style={s.demoTitle}>{t('demo.bannerTitle')}</Text>
              <Text style={s.demoText}>{t('demo.bannerText')}</Text>
            </View>
            <Pressable onPress={confirmRemoveDemo} style={({ pressed }) => [s.demoBtn, pressed && { opacity: 0.8 }]}>
              <Text style={s.demoBtnText}>{t('common.delete')}</Text>
            </Pressable>
          </View>
        )}
        {visible.length === 0 ? (
          !loaded ? null : collections.length === 0 ? (
            <EmptyShowcase
              onCreate={() => router.push('/new-collection')}
              onDemo={tryDemo}
              demoLoading={demoLoading}
            />
          ) : (
            <View style={s.empty}>
              <Text style={s.emptyText}>{t('home.emptyFilter')}</Text>
            </View>
          )
        ) : selecting ? (
          // Seçim modunda sıralama kapalı; dokunmak ya da parmağı sürüklemek seçer
          <GestureDetector gesture={selectPan}>
          <View style={s.selGrid}>
            {visible.map(item => {
              const uri = photoUri(item.cover);
              const on = picked.has(item.id);
              return (
                <Pressable
                  key={item.id}
                  onPress={() => togglePick(item.id)}
                  style={{ width: cell, height: cell }}
                  accessibilityLabel={item.title}
                  accessibilityState={{ selected: on }}
                >
                  <View style={s.cell}>
                    {uri ? (
                      <Image source={{ uri }} style={StyleSheet.absoluteFill} />
                    ) : (
                      <Text style={s.cellTitle} numberOfLines={3}>{item.title}</Text>
                    )}
                  </View>
                  {on && <View style={s.selShade} />}
                  <View style={[s.selDot, on && s.selDotOn]}>
                    {on && <Ionicons name="checkmark" size={16} color={C.onBrand} />}
                  </View>
                </Pressable>
              );
            })}
          </View>
          </GestureDetector>
        ) : (
          <Sortable.Grid
            key={`${selected ?? 'all'}-${status}-${cols}-${selected !== null ? sortPrefs[selected] ?? 'manual' : ''}`}
            columns={cols}
            columnGap={GRID_GAP}
            rowGap={GRID_GAP}
            data={visible}
            keyExtractor={i => String(i.id)}
            scrollableRef={scrollRef}
            autoScrollEnabled={!overTrash}
            hapticsEnabled
            onDragStart={dragStart}
            onDragMove={({ touchData }) => dragMove(touchData)}
            onDragEnd={({ key, data: next }) => onItemsReordered(next, key)}
            renderItem={({ item }) => {
              const uri = photoUri(item.cover);
              return (
                <Pressable
                  onPress={() => openItem(item.id)}
                  style={({ pressed }) => [{ width: cell, height: cell }, pressed && { opacity: 0.7 }]}
                  accessibilityLabel={item.title}
                >
                  <View style={s.cell}>
                    {uri ? (
                      <Image source={{ uri }} style={StyleSheet.absoluteFill} />
                    ) : (
                      <Text style={s.cellTitle} numberOfLines={3}>{item.title}</Text>
                    )}
                  </View>
                  {item.collection_id === demoId && (
                    <View style={s.demoTag}><Text style={s.demoTagText}>{t('demo.tag')}</Text></View>
                  )}
                  {item.status !== 'owned' && (
                    <View style={s.badge}>
                      <Ionicons
                        name={STATUS_ICON[item.status] ?? 'ellipse'}
                        size={12}
                        color="#FFFFFF"
                      />
                    </View>
                  )}
                </Pressable>
              );
            }}
          />
        )}
      </Animated.ScrollView>

      {selecting ? (
        <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(100)} style={[s.bottomBar, { bottom: insets.bottom + 12 }]}>
          <Pressable
            onPress={() =>
              setPicked(picked.size === visible.length ? new Set() : new Set(visible.map(i => i.id)))
            }
            style={({ pressed }) => [s.selAllBtn, pressed && { backgroundColor: C.paper }]}
          >
            <Text style={s.selAllText}>{picked.size === visible.length && visible.length > 0 ? t('select.none') : t('select.all')}</Text>
          </Pressable>
          <PrimaryButton
            icon="trash-outline"
            label={picked.size > 0 ? t('select.delete', { n: picked.size }) : t('select.hint')}
            onPress={trashPicked}
            disabled={picked.size === 0}
            style={{ flex: 1 }}
          />
        </Animated.View>
      ) : dragging ? (
        <Animated.View
          entering={ZoomIn.duration(160)}
          exiting={ZoomOut.duration(140)}
          pointerEvents="none"
          style={[s.trashWrap, { bottom: trashBottom }]}
        >
          <Text style={[s.trashHint, overTrash && { color: C.black }]}>{t('collection.dropToTrash')}</Text>
          <View style={[s.trashCircle, overTrash && s.trashCircleActive, { transform: [{ scale: overTrash ? 1.15 : 1 }] }]}>
            <Ionicons name={overTrash ? 'trash' : 'trash-outline'} size={30} color={overTrash ? C.white : C.black} />
          </View>
        </Animated.View>
      ) : (
        <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(100)} style={[s.bottomBar, { bottom: insets.bottom + 12 }]}>
        {/* İlk koleksiyon yoksa doğrudan oluşturulur; varsa ikonlu seçenekler açılır */}
        {/* Boş ekranda çağrı kartı zaten ortada; alttaki düğme tekrar etmesin */}
        {collections.length > 0 || !loaded ? (
          <PrimaryButton icon="add" label={t('add.button')} onPress={() => setAddOpen(true)} style={{ flex: 1 }} />
        ) : (
          <View style={{ flex: 1 }} />
        )}
        <Pressable
          onPress={() => router.push('/trash')}
          accessibilityLabel={t('nav.trash')}
          style={({ pressed }) => [s.trashButton, pressed && { backgroundColor: C.paper }]}
        >
          <Ionicons name="trash-outline" size={22} color={C.black} />
          {trashCount > 0 && (
            <View style={s.trashBadge}>
              <Text style={s.trashBadgeText}>{trashCount > 99 ? '99+' : trashCount}</Text>
            </View>
          )}
        </Pressable>
        </Animated.View>
      )}

      <AddSheet visible={addOpen} options={addOptions} onClose={() => setAddOpen(false)} />
      <Toast ref={toastRef} bottom={insets.bottom + 84} />
    </View>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  const s = useStyles(makeStyles);
  return (
    <View>
      <Text style={s.statValue} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

function Highlight({ label, on, shared, onPress, onLongPress, children }: {
  label: string;
  on: boolean;
  shared?: boolean;
  onPress: () => void;
  onLongPress?: () => void;
  children: ReactNode;
}) {
  const s = useStyles(makeStyles);
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [s.hl, pressed && { opacity: 0.7 }]}
      accessibilityLabel={label}
      accessibilityState={{ selected: on }}
    >
      {children}
      <View style={[s.hlLine, on && s.hlLineOn]} />
      <Text style={[s.hlLabel, on && s.hlLabelOn, shared && s.hlLabelShared]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

const makeStyles = (C: Palette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: C.white },
  headerLayer: { zIndex: 10, elevation: 10 },
  highlightsScroll: { overflow: 'visible', zIndex: 10 },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  topActions: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  flag: { fontSize: 22 },

  stats: { flexDirection: 'row', gap: 28, paddingHorizontal: 20, marginTop: 22 },
  statValue: { fontFamily: F.black, fontSize: 21, color: C.black, letterSpacing: -0.5 },
  statLabel: { fontFamily: F.medium, fontSize: 12, color: C.grey, marginTop: 1 },
  statLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },

  highlights: { paddingHorizontal: 20, paddingTop: 22, paddingBottom: 16, gap: 12 },
  hl: { width: HL },
  hlBox: {
    width: HL,
    height: HL,
    backgroundColor: C.paper,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  hlAll: { backgroundColor: C.brand },
  hlNew: { backgroundColor: C.white, borderWidth: 1.5, borderColor: C.black, borderStyle: 'dashed' },
  hlInitial: { fontFamily: F.black, fontSize: 40, color: C.black, opacity: 0.15 },
  hlShared: { borderWidth: 2, borderColor: C.accent, borderStyle: 'dashed' },
  hlLine: { width: HL, height: 3, marginTop: 5, backgroundColor: 'transparent' },
  hlLineOn: { backgroundColor: C.brand },
  hlLabel: { fontFamily: F.semi, fontSize: 13, color: C.black, marginTop: 6 },
  hlLabelOn: { fontFamily: F.heavy },
  hlLabelShared: { color: C.accent },

  tabs: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: C.line,
    marginBottom: GRID_GAP,
  },
  tab: { flex: 1, alignItems: 'center', paddingTop: 10 },
  colsBtn: { width: 44, alignItems: 'center', paddingTop: 12, borderLeftWidth: 1, borderLeftColor: C.line },
  colsIcon: { flexDirection: 'row', gap: 2, height: 18, width: 22 },
  colsBar: { flex: 1, backgroundColor: C.black },
  tabLabel: { fontFamily: F.medium, fontSize: 10.5, color: C.grey, marginTop: 4 },
  tabLabelOn: { fontFamily: F.bold, color: C.black },
  tabLine: { height: 2.5, alignSelf: 'stretch', marginHorizontal: 14, marginTop: 8, backgroundColor: 'transparent' },

  cell: {
    flex: 1,
    backgroundColor: C.paper,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 8,
  },
  selGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: GRID_GAP },
  selShade: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.25)' },
  selDot: {
    position: 'absolute', top: 6, right: 6, width: 24, height: 24, borderRadius: 12,
    borderWidth: 2, borderColor: '#FFFFFF', backgroundColor: 'rgba(0,0,0,0.2)',
    alignItems: 'center', justifyContent: 'center',
  },
  selDotOn: { backgroundColor: C.brand, borderColor: C.onBrand },
  selAllBtn: {
    paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: C.black, backgroundColor: C.white,
  },
  selAllText: { fontFamily: F.bold, fontSize: 15, color: C.black },
  cellTitle: { fontFamily: F.bold, fontSize: 13, color: C.black, textAlign: 'center' },
  demoBar: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    marginHorizontal: 16, marginTop: 4, marginBottom: 10, padding: 12, borderWidth: 1.5, borderColor: C.black,
  },
  demoTitle: { fontFamily: F.bold, fontSize: 13, color: C.black },
  demoText: { fontFamily: F.regular, fontSize: 12, color: C.grey, marginTop: 2 },
  demoBtn: { backgroundColor: C.brand, paddingHorizontal: 14, paddingVertical: 8 },
  demoBtnText: { fontFamily: F.bold, fontSize: 13, color: C.onBrand },
  demoTag: { position: 'absolute', left: 4, top: 4, backgroundColor: C.black, paddingHorizontal: 5, paddingVertical: 2 },
  demoTagText: { fontFamily: F.bold, fontSize: 9, letterSpacing: 0.5, color: C.white },
  badge: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 20,
    height: 20,
    backgroundColor: C.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },

  empty: { paddingHorizontal: 20, paddingTop: 28 },
  emptyTitle: { fontFamily: F.bold, fontSize: 20, color: C.black },
  emptyText: { fontFamily: F.regular, fontSize: 15, color: C.grey, marginTop: 6 },

  bottomBar: { position: 'absolute', left: 20, right: 20, flexDirection: 'row', gap: 10 },
  trashButton: {
    width: 56,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: C.black,
    backgroundColor: C.white,
  },
  trashWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  trashHint: { fontFamily: F.semi, fontSize: 13, color: C.grey, marginBottom: 10 },
  trashCircle: {
    width: TRASH_SIZE,
    height: TRASH_SIZE,
    borderRadius: TRASH_SIZE / 2,
    borderWidth: 2,
    borderColor: C.black,
    backgroundColor: C.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trashCircleActive: { backgroundColor: C.black },
  trashBadge: {
    position: 'absolute',
    top: -8,
    right: -8,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 5,
    backgroundColor: C.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trashBadgeText: { fontFamily: F.bold, fontSize: 11, color: '#FFFFFF' },
});
