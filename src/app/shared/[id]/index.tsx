import { useCallback, useState } from 'react';
import {
  Alert, FlatList, Image, Pressable, StyleSheet, Text, TextInput, useWindowDimensions, View,
} from 'react-native';
import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { Ionicons } from '@expo/vector-icons';
import { F, STATUS_KEYS } from '../../../constants/theme';
import { Palette, useStyles, useTheme } from '../../../lib/theme';
import { useI18n } from '../../../lib/i18n';
import { photoUri } from '../../../lib/photos';
import { formatDate } from '../../../lib/money';
import { Segmented } from '../../../components/ui';
import { useMenu } from '../../../lib/menu';
import { deleteSharedList, loadSharedList, type SharedItem, type SharedPayload } from '../../../lib/shareData';

type Row = SharedItem & { ci: number; ii: number; collection: string };
const PAD = 20;

// Arkadaştan gelen salt okunur liste; görünüşü normal koleksiyon sayfasıyla aynı
export default function SharedListScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const listId = Number(id);
  const { C } = useTheme();
  const s = useStyles(makeStyles);
  const db = useSQLiteContext();
  const { t, lang } = useI18n();
  const showMenu = useMenu();
  const { width } = useWindowDimensions();

  const [title, setTitle] = useState('');
  const [sender, setSender] = useState('');
  const [receivedAt, setReceivedAt] = useState('');
  const [data, setData] = useState<SharedPayload | null>(null);
  const [filter, setFilter] = useState('all');
  const [cols, setCols] = useState<2 | 3 | 4>(2);

  const colGap = cols === 2 ? 14 : cols === 3 ? 10 : 6;
  const rowGap = cols === 2 ? 22 : cols === 3 ? 16 : 6;
  const tile = (width - PAD * 2 - colGap * (cols - 1)) / cols;

  useFocusEffect(
    useCallback(() => {
      loadSharedList(db, listId).then(r => {
        if (!r) return;
        setTitle(r.title);
        setSender(r.sender ?? '');
        setReceivedAt(r.received_at);
        setData(r.data);
      });
    }, [db, listId])
  );

  function saveSender(v: string) {
    const clean = v.trim();
    setSender(clean);
    db.runAsync('UPDATE shared_lists SET sender = ? WHERE id = ?', clean || null, listId);
  }

  const rows: Row[] = (data?.collections ?? []).flatMap((c, ci) =>
    c.items.map((it, ii) => ({ ...it, ci, ii, collection: c.name }))
  );
  const present = new Set(rows.map(r => r.status));
  const filters = [
    { key: 'all', label: t('filter.all') },
    ...STATUS_KEYS.filter(k => present.has(k)).map(k => ({ key: k, label: t(`status.${k}`) })),
  ];
  const visible = filter === 'all' ? rows : rows.filter(r => r.status === filter);

  function saveTitle(v: string) {
    const clean = v.trim();
    if (!clean) return;
    setTitle(clean);
    db.runAsync('UPDATE shared_lists SET title = ? WHERE id = ?', clean, listId);
  }

  function openMenu() {
    showMenu(title, undefined, [
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: () =>
          Alert.alert(t('shared.deleteTitle'), t('shared.deleteMsg', { title }), [
            { text: t('common.cancel'), style: 'cancel' },
            {
              text: t('common.delete'),
              style: 'destructive',
              onPress: async () => {
                await deleteSharedList(db, listId);
                router.back();
              },
            },
          ]),
      },
    ]);
  }

  return (
    <View style={s.container}>
      <Stack.Screen
        options={{
          title: '',
          headerRight: () => (
            <Pressable onPress={openMenu} hitSlop={12} accessibilityLabel={t('shared.options')}>
              <Ionicons name="ellipsis-horizontal" size={22} color={C.black} />
            </Pressable>
          ),
        }}
      />
      <FlatList
        key={cols}
        data={visible}
        keyExtractor={r => `${r.ci}-${r.ii}`}
        numColumns={cols}
        columnWrapperStyle={{ gap: colGap, paddingHorizontal: PAD }}
        contentContainerStyle={{ gap: rowGap, paddingBottom: 48 }}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={s.header}>
            {/* Kimden: isteğe bağlı, istediğin zaman değiştirilebilir */}
            <View style={s.fromRow}>
              <Ionicons name="person-outline" size={16} color={C.accent} />
              <TextInput
                style={s.fromInput}
                defaultValue={sender}
                key={sender}
                placeholder={t('shared.fromPh')}
                placeholderTextColor={C.grey}
                onEndEditing={e => saveSender(e.nativeEvent.text)}
                returnKeyType="done"
              />
            </View>
            {/* Liste adı dokunarak düzenlenebilir */}
            <TextInput
              style={s.title}
              defaultValue={title}
              key={title}
              onEndEditing={e => saveTitle(e.nativeEvent.text)}
              returnKeyType="done"
              multiline={false}
            />
            <Text style={s.summary}>
              {t('export.itemCount', { n: rows.length })}
              {receivedAt ? `  ·  ${t('shared.received', { date: formatDate(receivedAt, lang) })}` : ''}
            </Text>
            {filters.length > 2 && (
              <View style={{ marginTop: 20 }}>
                <Segmented options={filters} value={filter} onChange={setFilter} />
              </View>
            )}
            <View style={s.colsRow}>
              <Ionicons name="grid-outline" size={15} color={C.grey} />
              {([2, 3, 4] as const).map(n => (
                <Pressable
                  key={n}
                  onPress={() => setCols(n)}
                  hitSlop={6}
                  style={[s.colsBtn, cols === n && s.colsBtnOn]}
                  accessibilityLabel={t('collection.columns', { n })}
                >
                  <Text style={[s.colsText, cols === n && s.colsTextOn]}>{n}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        }
        renderItem={({ item }) => {
          const uri = photoUri(item.photo ?? null);
          return (
            <Pressable
              onPress={() => router.push(`/shared/${listId}/item?ci=${item.ci}&ii=${item.ii}`)}
              style={({ pressed }) => [{ width: tile }, pressed && { opacity: 0.6 }]}
            >
              <View style={[s.photo, { width: tile, height: tile }]}>
                {uri ? (
                  <Image source={{ uri }} style={StyleSheet.absoluteFill} />
                ) : (
                  <Text style={s.initial}>{item.title.charAt(0).toLocaleUpperCase('tr')}</Text>
                )}
              </View>
              {cols === 4 ? (
                item.status !== 'owned' && (
                  <View style={s.badge}>
                    <Ionicons name={item.status === 'wishlist' ? 'heart' : 'swap-horizontal'} size={10} color="#FFFFFF" />
                  </View>
                )
              ) : (
                <>
                  {item.status !== 'owned' && (
                    <Text style={s.status}>{t(`status.${item.status}` as 'status.owned')}</Text>
                  )}
                  <Text style={[s.itemTitle, cols === 3 && { fontSize: 13 }]} numberOfLines={cols === 3 ? 1 : 2}>
                    {item.title}
                  </Text>
                  {cols === 2 && item.fields[0] && (
                    <Text style={s.itemSub} numberOfLines={1}>{item.fields[0].value}</Text>
                  )}
                </>
              )}
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const makeStyles = (C: Palette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: C.white },
  header: { paddingHorizontal: PAD, paddingBottom: 24 },
  fromRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderBottomWidth: 1.5,
    borderBottomColor: C.accent,
    paddingBottom: 6,
    marginBottom: 14,
  },
  fromInput: { flex: 1, fontFamily: F.bold, fontSize: 16, color: C.accent, paddingVertical: 4 },
  title: { fontFamily: F.black, fontSize: 32, color: C.black, letterSpacing: -1, padding: 0 },
  summary: { fontFamily: F.medium, fontSize: 14, color: C.grey, marginTop: 4 },
  colsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 8, marginTop: 14 },
  colsBtn: { width: 28, height: 28, borderWidth: 1.5, borderColor: C.black, alignItems: 'center', justifyContent: 'center' },
  colsBtnOn: { backgroundColor: C.brand },
  colsText: { fontFamily: F.bold, fontSize: 13, color: C.black },
  colsTextOn: { color: C.onBrand },
  photo: { backgroundColor: C.paper, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  initial: { fontFamily: F.black, fontSize: 48, color: C.black, opacity: 0.12 },
  status: { fontFamily: F.bold, fontSize: 12, color: C.accent, marginTop: 10 },
  itemTitle: { fontFamily: F.bold, fontSize: 15, color: C.black, marginTop: 8, lineHeight: 19 },
  itemSub: { fontFamily: F.regular, fontSize: 13, color: C.grey, marginTop: 2 },
  badge: {
    position: 'absolute', top: 4, right: 4, width: 16, height: 16,
    backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center',
  },
});
