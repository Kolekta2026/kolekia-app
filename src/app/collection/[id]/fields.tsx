import { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { Ionicons } from '@expo/vector-icons';
import { F } from '../../../constants/theme';
import { Palette, useStyles, useTheme } from '../../../lib/theme';
import {
  CollectionTemplate, FIELD_TYPES, FieldTemplate, FieldType, getTemplates, templateLabel,
} from '../../../constants/templates';
import { useI18n } from '../../../lib/i18n';
import { addFieldToCollections, addFieldToTemplate, loadExtras, mergeExtras } from '../../../lib/templateExtras';
import { Chips, FieldLabel, SecondaryButton } from '../../../components/ui';
import { useMenu } from '../../../lib/menu';

type Def = { id: number; name: string; type: FieldType; options: string | null; sort_order: number };
const norm = (s: string) => s.trim().toLocaleLowerCase('tr');

export default function FieldsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const collectionId = Number(id);
  const { C } = useTheme();
  const s = useStyles(makeStyles);
  const db = useSQLiteContext();
  const { t, lang } = useI18n();
  const typeLabel = (type: string) => t(`fieldType.${type}` as 'fieldType.text');
  const menu = useMenu();

  const [defs, setDefs] = useState<Def[]>([]);
  const [template, setTemplate] = useState<{ key: string; label: string } | null>(null);
  const [allTemplates, setAllTemplates] = useState<CollectionTemplate[]>([]);
  const [adding, setAdding] = useState(false);
  const [fName, setFName] = useState('');
  const [fType, setFType] = useState<FieldType>('text');
  const [fOptions, setFOptions] = useState('');

  const load = useCallback(async () => {
    const c = await db.getFirstAsync<{ template: string; template_label: string | null }>(
      'SELECT template, template_label FROM collections WHERE id = ?', collectionId
    );
    if (c) setTemplate({ key: c.template, label: templateLabel(c.template, c.template_label, lang, t('home.custom')) });
    setDefs(await db.getAllAsync<Def>(
      'SELECT id, name, type, options, sort_order FROM field_defs WHERE collection_id = ? ORDER BY sort_order, id',
      collectionId
    ));
    const extras = await loadExtras(db);
    const users = await db.getAllAsync<{ id: number; name: string; fields: string }>(
      'SELECT id, name, fields FROM user_templates'
    );
    setAllTemplates([
      ...mergeExtras(getTemplates(lang), extras),
      ...users.map(u => ({ key: `u:${u.id}`, label: u.name, fields: JSON.parse(u.fields) as FieldTemplate[] })),
    ]);
  }, [db, collectionId, lang, t]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const suggestions = useMemo(() => {
    const taken = new Set(defs.map(d => norm(d.name)));
    const seen = new Set<string>();
    const out: FieldTemplate[] = [];
    for (const tp of allTemplates) {
      for (const f of tp.fields) {
        const k = norm(f.name);
        if (taken.has(k) || seen.has(k)) continue;
        seen.add(k);
        out.push(f);
      }
    }
    return out;
  }, [allTemplates, defs]);

  async function addField(f: FieldTemplate) {
    await db.runAsync(
      `INSERT INTO field_defs (collection_id, name, type, options, sort_order)
       VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM field_defs WHERE collection_id = ?))`,
      collectionId, f.name, f.type, f.options ? JSON.stringify(f.options) : null, collectionId
    );
    await load();
    if (!template) return;

    // Aynı şablonu kullanan diğer koleksiyonlara ve şablonun kendisine de eklensin mi?
    const other = await db.getFirstAsync<{ n: number }>(
      'SELECT COUNT(*) AS n FROM collections WHERE template = ? AND id <> ?', template.key, collectionId
    );
    const n = other?.n ?? 0;
    Alert.alert(
      t('fields.applyTitle'),
      n > 0
        ? t('fields.applyMsg', { n, template: template.label, field: f.name })
        : t('fields.applyMsgNone', { template: template.label, field: f.name }),
      [
        { text: t('fields.onlyThis'), style: 'cancel' },
        {
          text: t('fields.applyAll'),
          onPress: async () => {
            await addFieldToCollections(db, template.key, collectionId, f);
            await addFieldToTemplate(db, template.key, f);
          },
        },
      ]
    );
  }

  function addCustomField() {
    const n = fName.trim();
    if (!n) {
      Alert.alert(t('err.fieldNameTitle'), t('err.fieldName'));
      return;
    }
    if (defs.some(d => norm(d.name) === norm(n))) {
      Alert.alert(t('err.fieldExists'));
      return;
    }
    let options: string[] | undefined;
    if (fType === 'select') {
      options = fOptions.split(',').map(o => o.trim()).filter(Boolean);
      if (options.length < 2) {
        Alert.alert(t('err.optionsTitle'), t('err.options'));
        return;
      }
    }
    setFName('');
    setFOptions('');
    setFType('text');
    addField({ name: n, type: fType, ...(options ? { options } : {}) });
  }

  async function move(index: number, dir: -1 | 1) {
    const j = index + dir;
    if (j < 0 || j >= defs.length) return;
    const next = [...defs];
    [next[index], next[j]] = [next[j], next[index]];
    setDefs(next);
    await db.withTransactionAsync(async () => {
      for (const [i, d] of next.entries()) {
        await db.runAsync('UPDATE field_defs SET sort_order = ? WHERE id = ?', i, d.id);
      }
    });
  }

  function remove(d: Def) {
    Alert.alert(t('fields.removeTitle'), t('fields.removeMsg', { field: d.name }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('newCol.remove'),
        style: 'destructive',
        onPress: async () => {
          await db.runAsync('DELETE FROM field_defs WHERE id = ?', d.id); // değerleri de siler
          load();
        },
      },
    ]);
  }

  function fieldMenu(index: number) {
    const d = defs[index];
    menu(d.name, typeLabel(d.type), [
      ...(index > 0 ? [{ text: t('newCol.moveEarlier'), onPress: () => move(index, -1) }] : []),
      ...(index < defs.length - 1 ? [{ text: t('newCol.moveLater'), onPress: () => move(index, 1) }] : []),
      { text: t('newCol.remove'), style: 'destructive' as const, onPress: () => remove(d) },
      { text: t('common.cancel'), style: 'cancel' as const },
    ]);
  }

  return (
    <ScrollView
      style={s.container}
      contentContainerStyle={s.content}
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets
    >
      <Stack.Screen options={{ title: t('fields.edit') }} />
      <FieldLabel>{t('newCol.tplFields', { n: defs.length })}</FieldLabel>
      <View style={s.boxes}>
        {defs.map((d, i) => (
          <Pressable
            key={d.id}
            onPress={() => fieldMenu(i)}
            style={({ pressed }) => [s.box, pressed && { backgroundColor: C.paper }]}
          >
            <Text style={s.boxName} numberOfLines={1}>{d.name}</Text>
            <Text style={s.boxType} numberOfLines={1}>{typeLabel(d.type)}</Text>
          </Pressable>
        ))}
        <Pressable
          onPress={() => setAdding(a => !a)}
          style={({ pressed }) => [s.box, s.addBox, (adding || pressed) && { backgroundColor: C.paper }]}
        >
          <Ionicons name={adding ? 'close' : 'add'} size={18} color={C.black} />
          <Text style={s.addBoxText}>{t('newCol.addFieldBox')}</Text>
        </Pressable>
      </View>
      <Text style={s.hint}>{t('newCol.fieldHint')}</Text>

      {adding && (
        <View style={{ marginTop: 8 }}>
          {suggestions.length > 0 && (
            <>
              <FieldLabel>{t('newCol.suggestions')}</FieldLabel>
              <View style={s.suggestions}>
                {suggestions.map(f => (
                  <Pressable
                    key={f.name}
                    onPress={() => addField(f)}
                    style={({ pressed }) => [s.suggestion, pressed && { backgroundColor: C.paper }]}
                  >
                    <Text style={s.suggestionText}>+ {f.name}</Text>
                  </Pressable>
                ))}
              </View>
            </>
          )}
          <FieldLabel>{t('newCol.newField')}</FieldLabel>
          <TextInput
            style={s.input}
            value={fName}
            onChangeText={setFName}
            placeholder={t('newCol.fieldNamePh')}
            placeholderTextColor={C.grey}
          />
          <View style={{ marginTop: 14 }}>
            <Chips
              options={FIELD_TYPES.map(k => ({ key: k, label: typeLabel(k) }))}
              value={fType}
              onChange={k => setFType(k as FieldType)}
            />
          </View>
          {fType === 'select' && (
            <TextInput
              style={[s.input, { marginTop: 14 }]}
              value={fOptions}
              onChangeText={setFOptions}
              placeholder={t('newCol.optionsPh')}
              placeholderTextColor={C.grey}
            />
          )}
          <SecondaryButton label={t('newCol.addField')} onPress={addCustomField} style={{ marginTop: 16 }} />
        </View>
      )}
    </ScrollView>
  );
}

const makeStyles = (C: Palette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: C.white },
  content: { padding: 20, paddingBottom: 48 },
  hint: { fontFamily: F.regular, fontSize: 13, color: C.grey, marginTop: 10, lineHeight: 18 },
  boxes: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  box: {
    minWidth: 100,
    maxWidth: '100%',
    borderWidth: 1.5,
    borderColor: C.black,
    paddingVertical: 9,
    paddingHorizontal: 12,
    backgroundColor: C.white,
  },
  boxName: { fontFamily: F.semi, fontSize: 14, color: C.black },
  boxType: { fontFamily: F.regular, fontSize: 11, color: C.grey, marginTop: 2 },
  addBox: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, borderStyle: 'dashed' },
  addBoxText: { fontFamily: F.semi, fontSize: 14, color: C.black },
  suggestions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  suggestion: { borderWidth: 1, borderColor: C.line, borderStyle: 'dashed', paddingVertical: 8, paddingHorizontal: 12 },
  suggestionText: { fontFamily: F.medium, fontSize: 14, color: C.black },
  input: {
    borderBottomWidth: 1,
    borderBottomColor: C.black,
    paddingVertical: 10,
    fontFamily: F.regular,
    fontSize: 16,
    color: C.black,
  },
});
