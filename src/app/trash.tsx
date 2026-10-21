import { useCallback, useRef, useState } from 'react';
import { Alert, FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Stack, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { F } from '../constants/theme';
import { Palette, useStyles, useTheme } from '../lib/theme';
import { Toast, ToastHandle } from '../components/Toast';
import { photoUri } from '../lib/photos';
import { deleteItemsForever } from '../lib/trash';
import { useI18n } from '../lib/i18n';
import { useMenu } from '../lib/menu';

type Row = {
  id: number;
  title: string;
  collection_name: string;
  cover: string | null;
  days_left: number;
};

export default function TrashScreen() {
  const { C } = useTheme();
  const s = useStyles(makeStyles);
  const db = useSQLiteContext();
  const { t } = useI18n();
  const menu = useMenu();
  const insets = useSafeAreaInsets();
  const toastRef = useRef<ToastHandle>(null);
  const [rows, setRows] = useState<Row[]>([]);

  const load = useCallback(async () => {
    const r = await db.getAllAsync<Row>(`
      SELECT i.id, i.title, c.name AS collection_name,
        (SELECT p.uri FROM item_photos p WHERE p.item_id = i.id ORDER BY p.sort_order LIMIT 1) AS cover,
        julianday(i.deleted_at, '+30 days') - julianday('now') AS days_left
      FROM items i
      JOIN collections c ON c.id = i.collection_id
      WHERE i.deleted_at IS NOT NULL
      ORDER BY i.deleted_at DESC
    `);
    setRows(r);
  }, [db]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function restore(row: Row) {
    await db.runAsync('UPDATE items SET deleted_at = NULL WHERE id = ?', row.id);
    setRows(prev => prev.filter(r => r.id !== row.id));
    toastRef.current?.show(t('trash.restored', { title: row.title }));
  }

  function confirmDeleteForever(row: Row) {
    Alert.alert(t('trash.deleteForever'), t('trash.deleteForeverMsg', { title: row.title }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          await deleteItemsForever(db, [row.id]);
          setRows(prev => prev.filter(r => r.id !== row.id));
        },
      },
    ]);
  }

  function itemMenu(row: Row) {
    menu(row.title, undefined, [
      { text: t('trash.restore'), onPress: () => restore(row) },
      { text: t('trash.deleteForever'), style: 'destructive', onPress: () => confirmDeleteForever(row) },
      { text: t('common.cancel'), style: 'cancel' },
    ]);
  }

  function confirmEmpty() {
    Alert.alert(t('trash.emptyAllTitle'), t('trash.emptyAllMsg', { n: rows.length }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('trash.emptyAll'),
        style: 'destructive',
        onPress: async () => {
          await deleteItemsForever(db, rows.map(r => r.id));
          setRows([]);
        },
      },
    ]);
  }

  return (
    <View style={s.container}>
      <Stack.Screen
        options={{
          headerRight: () =>
            rows.length > 0 ? (
              <Pressable onPress={confirmEmpty} hitSlop={12}>
                <Text style={s.headerAction}>{t('trash.emptyAll')}</Text>
              </Pressable>
            ) : null,
        }}
      />
      <FlatList
        data={rows}
        keyExtractor={r => String(r.id)}
        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
        ListHeaderComponent={<Text style={s.info}>{t('trash.info')}</Text>}
        ListEmptyComponent={
          <View style={s.empty}>
            <Ionicons name="trash-outline" size={40} color={C.line} />
            <Text style={s.emptyText}>{t('trash.empty')}</Text>
          </View>
        }
        renderItem={({ item }) => {
          const uri = photoUri(item.cover);
          const days = Math.max(1, Math.ceil(item.days_left));
          return (
            <Pressable
              onPress={() => itemMenu(item)}
              style={({ pressed }) => [s.row, pressed && { backgroundColor: C.paper }]}
            >
              <View style={s.thumb}>
                {uri ? (
                  <Image source={{ uri }} style={StyleSheet.absoluteFill} />
                ) : (
                  <Text style={s.initial}>{item.title.charAt(0).toLocaleUpperCase('tr')}</Text>
                )}
              </View>
              <View style={s.body}>
                <Text style={s.title} numberOfLines={1}>{item.title}</Text>
                <Text style={s.meta} numberOfLines={1}>{item.collection_name}</Text>
                <Text style={[s.days, days <= 3 && { color: C.black }]}>
                  {t('trash.daysLeft', { n: days })}
                </Text>
              </View>
              <Pressable onPress={() => restore(item)} hitSlop={10}>
                <Text style={s.restore}>{t('trash.restore')}</Text>
              </Pressable>
            </Pressable>
          );
        }}
      />
      <Toast ref={toastRef} bottom={insets.bottom + 16} />
    </View>
  );
}

const makeStyles = (C: Palette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: C.white },
  headerAction: { fontFamily: F.bold, fontSize: 16, color: C.black },
  info: {
    fontFamily: F.regular,
    fontSize: 14,
    color: C.grey,
    lineHeight: 20,
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 18,
    borderBottomWidth: 3,
    borderBottomColor: C.black,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.line,
  },
  thumb: {
    width: 64,
    height: 64,
    backgroundColor: C.paper,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  initial: { fontFamily: F.black, fontSize: 28, color: C.black, opacity: 0.12 },
  body: { flex: 1 },
  title: { fontFamily: F.bold, fontSize: 16, color: C.black },
  meta: { fontFamily: F.regular, fontSize: 13, color: C.grey, marginTop: 2 },
  days: { fontFamily: F.semi, fontSize: 12, color: C.accent, marginTop: 5 },
  restore: { fontFamily: F.bold, fontSize: 14, color: C.black, textDecorationLine: 'underline' },
  empty: { alignItems: 'center', paddingTop: 60, gap: 12 },
  emptyText: { fontFamily: F.medium, fontSize: 16, color: C.grey },
});
