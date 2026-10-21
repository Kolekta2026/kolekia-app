import { useCallback, useMemo, useState } from 'react';
import { FlatList, Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { Ionicons } from '@expo/vector-icons';
import { F } from '../constants/theme';
import { Palette, useStyles, useTheme } from '../lib/theme';
import { useI18n } from '../lib/i18n';
import { photoUri } from '../lib/photos';

type Row = {
  id: number;
  title: string;
  status: string;
  collection_name: string;
  cover: string | null;
  vals: string | null; // "Alan\u001fDeğer\u001eAlan\u001fDeğer..."
};

type Entry = Row & {
  fields: { name: string; value: string }[];
  haystack: string;
};

const FIELD_SEP = '\u001f';
const PAIR_SEP = '\u001e';

// Türkçe karakterleri ve büyük/küçük harfi önemsemeden arama:
// "seiko", "SEİKO" ve "Seıko" aynı sonucu verir; "ç" ile "c" de eşleşir
export function normalize(s: string) {
  return s
    .toLocaleLowerCase('tr')
    .replace(/ç/g, 'c')
    .replace(/ğ/g, 'g')
    .replace(/ı/g, 'i')
    .replace(/ö/g, 'o')
    .replace(/ş/g, 's')
    .replace(/ü/g, 'u')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export default function SearchScreen() {
  const { C } = useTheme();
  const s = useStyles(makeStyles);
  const db = useSQLiteContext();
  const { t } = useI18n();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [query, setQuery] = useState('');

  // Tüm parçalar bir kez yüklenir; arama telefonda, yazarken anında yapılır
  useFocusEffect(
    useCallback(() => {
      db.getAllAsync<Row>(`
        SELECT i.id, i.title, i.status, c.name AS collection_name,
          (SELECT p.uri FROM item_photos p WHERE p.item_id = i.id ORDER BY p.sort_order LIMIT 1) AS cover,
          (SELECT group_concat(f.name || '${FIELD_SEP}' || v.value, '${PAIR_SEP}')
             FROM item_values v JOIN field_defs f ON f.id = v.field_id
            WHERE v.item_id = i.id AND v.value <> '') AS vals
        FROM items i JOIN collections c ON c.id = i.collection_id
        WHERE i.deleted_at IS NULL
        ORDER BY i.created_at DESC, i.id DESC
      `).then(rows =>
        setEntries(
          rows.map(r => {
            const fields = (r.vals ?? '')
              .split(PAIR_SEP)
              .filter(Boolean)
              .map(p => {
                const [name, value] = p.split(FIELD_SEP);
                return { name, value: value ?? '' };
              });
            const haystack = normalize(
              [r.title, r.collection_name, ...fields.map(f => f.value)].join(' ')
            );
            return { ...r, fields, haystack };
          })
        )
      );
    }, [db])
  );

  const tokens = useMemo(() => normalize(query).split(/\s+/).filter(Boolean), [query]);

  // Yazılan her kelime parçanın adında, koleksiyonunda ya da alanlarından birinde geçmeli
  const results = useMemo(() => {
    if (tokens.length === 0) return [];
    return entries.filter(e => tokens.every(tk => e.haystack.includes(tk)));
  }, [entries, tokens]);

  // Sonuçta, eşleşmeyi açıklayan alanı göster (ör. "Referans no: SRPD55")
  function matchedField(e: Entry) {
    if (tokens.every(tk => normalize(e.title).includes(tk))) return e.fields[0];
    return e.fields.find(f => tokens.some(tk => normalize(f.value).includes(tk))) ?? e.fields[0];
  }

  return (
    <View style={s.container}>
      <View style={s.searchRow}>
        <Ionicons name="search" size={20} color={C.grey} />
        <TextInput
          style={s.input}
          value={query}
          onChangeText={setQuery}
          placeholder={t('search.placeholder')}
          placeholderTextColor={C.grey}
          autoFocus
          autoCorrect={false}
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
      </View>

      <FlatList
        data={results}
        keyExtractor={e => String(e.id)}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ paddingBottom: 40 }}
        ListHeaderComponent={
          tokens.length > 0 ? (
            <Text style={s.count}>{t('search.count', { n: results.length })}</Text>
          ) : null
        }
        ListEmptyComponent={
          <Text style={s.hint}>{tokens.length === 0 ? t('search.hint') : t('search.empty')}</Text>
        }
        renderItem={({ item }) => {
          const uri = photoUri(item.cover);
          const f = matchedField(item);
          return (
            <Pressable
              onPress={() => router.push(`/item/${item.id}`)}
              style={({ pressed }) => [s.row, pressed && { backgroundColor: C.paper }]}
            >
              <View style={s.thumb}>
                {uri ? (
                  <Image source={{ uri }} style={StyleSheet.absoluteFill} />
                ) : (
                  <Text style={s.initial}>{item.title.charAt(0).toLocaleUpperCase('tr')}</Text>
                )}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.title} numberOfLines={1}>{item.title}</Text>
                <Text style={s.sub} numberOfLines={1}>
                  {item.collection_name}
                  {item.status !== 'owned' ? `  ·  ${t(`status.${item.status}` as 'status.owned')}` : ''}
                </Text>
                {f && (
                  <Text style={s.field} numberOfLines={1}>
                    <Text style={s.fieldName}>{f.name}</Text> {f.value}
                  </Text>
                )}
              </View>
              <Ionicons name="chevron-forward" size={18} color={C.grey} />
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const makeStyles = (C: Palette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: C.white },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 20,
    marginTop: 8,
    paddingBottom: 10,
    borderBottomWidth: 2,
    borderBottomColor: C.black,
  },
  input: { flex: 1, fontFamily: F.semi, fontSize: 20, color: C.black, paddingVertical: 6 },
  count: { fontFamily: F.semi, fontSize: 13, color: C.grey, marginHorizontal: 20, marginTop: 14, marginBottom: 4 },
  hint: { fontFamily: F.regular, fontSize: 15, color: C.grey, marginHorizontal: 20, marginTop: 20, lineHeight: 21 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.line,
  },
  thumb: {
    width: 60,
    height: 60,
    backgroundColor: C.paper,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  initial: { fontFamily: F.black, fontSize: 24, color: C.black, opacity: 0.15 },
  title: { fontFamily: F.bold, fontSize: 16, color: C.black },
  sub: { fontFamily: F.regular, fontSize: 13, color: C.grey, marginTop: 2 },
  field: { fontFamily: F.regular, fontSize: 13, color: C.black, marginTop: 3 },
  fieldName: { fontFamily: F.bold },
});
