import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { Ionicons } from '@expo/vector-icons';
import { F } from '../constants/theme';
import { Palette, useStyles, useTheme } from '../lib/theme';
import {
  CollectionTemplate, FIELD_TYPES, FieldTemplate, FieldType, getTemplates,
} from '../constants/templates';
import { useI18n } from '../lib/i18n';
import { loadExtras, mergeExtras } from '../lib/templateExtras';
import { Chips, FieldLabel, PrimaryButton, SecondaryButton } from '../components/ui';
import { useMenu } from '../lib/menu';

const NEW = '__new__';
const norm = (s: string) => s.trim().toLocaleLowerCase('tr');

export default function NewCollectionScreen() {
  const { C } = useTheme();
  const s = useStyles(makeStyles);
  const db = useSQLiteContext();
  const { t, lang } = useI18n();
  const [extras, setExtras] = useState<Record<string, FieldTemplate[]>>({});
  const builtin = useMemo(() => mergeExtras(getTemplates(lang), extras), [lang, extras]);
  const fieldTypeLabel = (type: string) => t(`fieldType.${type}` as 'fieldType.text');
  const menu = useMenu();

  const [name, setName] = useState('');
  const [templateKey, setTemplateKey] = useState(builtin[0].key);
  const [userTemplates, setUserTemplates] = useState<CollectionTemplate[]>([]);
  const [saving, setSaving] = useState(false);

  // Seçilen şablonun alanları buraya kopyalanır; kullanıcı ekleyip çıkarabilir
  const [fields, setFields] = useState<FieldTemplate[]>(builtin[0].fields);
  const [tplName, setTplName] = useState('');
  const [adding, setAdding] = useState(false);
  const [fName, setFName] = useState('');
  const [fType, setFType] = useState<FieldType>('text');
  const [fOptions, setFOptions] = useState('');

  useEffect(() => {
    loadExtras(db).then(ex => {
      setExtras(ex);
      // Varsayılan şablonun eklenmiş alanlarını da göster
      setFields(prev => mergeExtras(getTemplates(lang), ex)[0]?.fields ?? prev);
    });
    db.getAllAsync<{ id: number; name: string; fields: string }>(
      'SELECT id, name, fields FROM user_templates ORDER BY created_at'
    ).then(rows =>
      setUserTemplates(rows.map(r => ({ key: `u:${r.id}`, label: r.name, fields: JSON.parse(r.fields) })))
    );
  }, [db]);

  const allTemplates = useMemo(() => [...builtin, ...userTemplates], [builtin, userTemplates]);
  const isNew = templateKey === NEW;
  const template = allTemplates.find(tp => tp.key === templateKey);

  function selectTemplate(key: string) {
    setTemplateKey(key);
    const tp = allTemplates.find(x => x.key === key);
    setFields(key === NEW ? [] : tp?.fields ?? []);
    setAdding(key === NEW);
  }

  // Tüm şablonlardaki alanlar; ada göre tekilleştirilmiş ve henüz eklenmemiş olanlar
  const suggestions = useMemo(() => {
    const taken = new Set(fields.map(f => norm(f.name)));
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
  }, [allTemplates, fields]);

  function addCustomField() {
    const n = fName.trim();
    if (!n) {
      Alert.alert(t('err.fieldNameTitle'), t('err.fieldName'));
      return;
    }
    if (fields.some(f => norm(f.name) === norm(n))) {
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
    setFields(prev => [...prev, { name: n, type: fType, ...(options ? { options } : {}) }]);
    setFName('');
    setFOptions('');
    setFType('text');
  }

  function fieldMenu(index: number) {
    const move = (dir: -1 | 1) =>
      setFields(prev => {
        const next = [...prev];
        const j = index + dir;
        if (j < 0 || j >= next.length) return prev;
        [next[index], next[j]] = [next[j], next[index]];
        return next;
      });
    menu(fields[index].name, undefined, [
      ...(index > 0 ? [{ text: t('newCol.moveEarlier'), onPress: () => move(-1) }] : []),
      ...(index < fields.length - 1 ? [{ text: t('newCol.moveLater'), onPress: () => move(1) }] : []),
      {
        text: t('newCol.remove'),
        style: 'destructive' as const,
        onPress: () => setFields(prev => prev.filter((_, i) => i !== index)),
      },
      { text: t('common.cancel'), style: 'cancel' as const },
    ]);
  }

  async function save() {
    const trimmed = name.trim();
    if (!trimmed) {
      Alert.alert(t('err.nameTitle'), t('err.collectionName'));
      return;
    }
    if (isNew) {
      if (!tplName.trim()) {
        Alert.alert(t('err.tplNameTitle'), t('err.tplName'));
        return;
      }
      if (fields.length === 0) {
        Alert.alert(t('err.fieldsTitle'), t('err.fields'));
        return;
      }
    }
    setSaving(true);
    try {
      await db.withTransactionAsync(async () => {
        let key: string, label: string;
        if (isNew) {
          const r = await db.runAsync(
            'INSERT INTO user_templates (name, fields) VALUES (?, ?)',
            tplName.trim(), JSON.stringify(fields)
          );
          key = `u:${r.lastInsertRowId}`;
          label = tplName.trim();
        } else {
          key = template!.key;
          label = template!.label;
        }
        // Yeni koleksiyon listenin en üstüne eklenir
        const res = await db.runAsync(
          `INSERT INTO collections (name, template, template_label, sort_order)
           VALUES (?, ?, ?, (SELECT COALESCE(MIN(sort_order), 0) - 1 FROM collections))`,
          trimmed, key, label
        );
        for (const [i, f] of fields.entries()) {
          await db.runAsync(
            'INSERT INTO field_defs (collection_id, name, type, options, sort_order) VALUES (?, ?, ?, ?, ?)',
            res.lastInsertRowId, f.name, f.type, f.options ? JSON.stringify(f.options) : null, i
          );
        }
      });
      router.back();
    } catch (e) {
      Alert.alert(t('err.saveFailed'), String(e));
      setSaving(false);
    }
  }

  return (
    <ScrollView
      style={s.container}
      contentContainerStyle={s.content}
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets
    >
      <FieldLabel>{t('newCol.name')}</FieldLabel>
      <TextInput
        style={s.bigInput}
        value={name}
        onChangeText={setName}
        placeholder={t('newCol.namePh')}
        placeholderTextColor={C.grey}
        autoFocus
        returnKeyType="done"
      />

      <FieldLabel>{t('newCol.type')}</FieldLabel>
      <Chips
        options={[
          ...allTemplates.map(tp => ({ key: tp.key, label: tp.label })),
          { key: NEW, label: t('newCol.newTemplate') },
        ]}
        value={templateKey}
        onChange={selectTemplate}
      />

      {isNew && (
        <View style={s.section}>
          <FieldLabel>{t('newCol.tplName')}</FieldLabel>
          <TextInput
            style={s.input}
            value={tplName}
            onChangeText={setTplName}
            placeholder={t('newCol.tplNamePh')}
            placeholderTextColor={C.grey}
          />
          <Text style={s.hint}>{t('newCol.tplHint')}</Text>
        </View>
      )}

      <FieldLabel>{t('newCol.tplFields', { n: fields.length })}</FieldLabel>
      <View style={s.boxes}>
        {fields.map((f, i) => (
          <Pressable
            key={f.name}
            onPress={() => fieldMenu(i)}
            style={({ pressed }) => [s.box, pressed && { backgroundColor: C.paper }]}
          >
            <Text style={s.boxName} numberOfLines={1}>{f.name}</Text>
            <Text style={s.boxType} numberOfLines={1}>{fieldTypeLabel(f.type)}</Text>
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
      {fields.length > 0 && <Text style={s.hint}>{t('newCol.fieldHint')}</Text>}

      {adding && (
        <View style={s.addPanel}>
          {suggestions.length > 0 && (
            <>
              <FieldLabel>{t('newCol.suggestions')}</FieldLabel>
              <View style={s.suggestions}>
                {suggestions.map(f => (
                  <Pressable
                    key={f.name}
                    onPress={() => setFields(prev => [...prev, f])}
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
              options={FIELD_TYPES.map(k => ({ key: k, label: fieldTypeLabel(k) }))}
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

      <PrimaryButton
        label={saving ? t('common.saving') : t('newCol.create')}
        onPress={save}
        disabled={saving}
        style={{ marginTop: 36 }}
      />
    </ScrollView>
  );
}

const makeStyles = (C: Palette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: C.white },
  content: { padding: 20, paddingBottom: 48 },
  bigInput: {
    borderBottomWidth: 2,
    borderBottomColor: C.black,
    paddingVertical: 10,
    fontFamily: F.semi,
    fontSize: 22,
    color: C.black,
  },
  input: {
    borderBottomWidth: 1,
    borderBottomColor: C.black,
    paddingVertical: 10,
    fontFamily: F.regular,
    fontSize: 16,
    color: C.black,
  },
  section: { marginTop: 12, paddingTop: 4, borderTopWidth: 3, borderTopColor: C.black },
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
  addBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderStyle: 'dashed',
  },
  addBoxText: { fontFamily: F.semi, fontSize: 14, color: C.black },
  addPanel: { marginTop: 8 },
  suggestions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  suggestion: {
    borderWidth: 1,
    borderColor: C.line,
    borderStyle: 'dashed',
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  suggestionText: { fontFamily: F.medium, fontSize: 14, color: C.black },
});
