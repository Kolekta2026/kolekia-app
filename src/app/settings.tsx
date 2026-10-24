import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSQLiteContext } from 'expo-sqlite';
import { router, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import { COLOR_THEMES, customTheme, F } from '../constants/theme';
import { Palette, ThemeMode, useStyles, useTheme } from '../lib/theme';
import { Chips, FieldLabel, PrimaryButton, SecondaryButton, Segmented } from '../components/ui';
import { Toast, ToastHandle } from '../components/Toast';
import { CURRENCIES, Currency, useI18n } from '../lib/i18n';
import { BackupError, createBackup, pickBackup, restoreBackup } from '../lib/backup';
import { formatDate } from '../lib/money';
import { LogoMark } from '../components/Logo';
import { APP_NAME } from '../constants/brand';
import { exportCsv, exportPdf } from '../lib/export';
import { pickAndImport, ShareImportError } from '../lib/shareData';
import { useLock } from '../lib/lock';
import { DigestMode, ensurePermission, getNotifPrefs, setNotifPref, syncNotifications } from '../lib/notifications';

export default function SettingsScreen() {
  const lock = useLock();
  const { C, mode, setMode, colorTheme, setColorTheme, vivid, setVivid, night, custom } = useTheme();
  const s = useStyles(makeStyles);
  const db = useSQLiteContext();
  const insets = useSafeAreaInsets();
  const { t, lang, setLang, currency, setCurrency, reloadPrefs } = useI18n();
  const [collections, setCollections] = useState<{ id: number; name: string }[]>([]);
  const [scope, setScope] = useState('all');
  const toastRef = useRef<ToastHandle>(null);
  const [busy, setBusy] = useState<null | 'export' | 'import' | 'pdf' | 'csv'>(null);
  const [notif, setNotif] = useState<{ loans: boolean; digest: DigestMode }>({ loans: true, digest: 'off' });

  useFocusEffect(useCallback(() => { getNotifPrefs(db).then(setNotif); }, [db]));

  // Bir bildirim türü açılınca izin istenir; reddedildiyse sistem ayarlarına yönlendirilir
  async function changeNotif(key: 'loans' | 'digest', value: boolean | DigestMode) {
    const turningOn = value === true || value === 'daily' || value === 'weekly';
    if (turningOn && !(await ensurePermission())) {
      Alert.alert(t('notif.deniedTitle'), t('notif.denied'), [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('notif.openSettings'), onPress: () => Linking.openSettings() },
      ]);
      return;
    }
    const next = { ...notif, [key]: value } as typeof notif;
    setNotif(next);
    await setNotifPref(db, key, key === 'loans' ? (value ? '1' : '0') : String(value));
    await syncNotifications(db, t);
  }

  useFocusEffect(
    useCallback(() => {
      db.getAllAsync<{ id: number; name: string }>(
        'SELECT id, name FROM collections ORDER BY sort_order, id DESC'
      ).then(rows => {
        setCollections(rows);
        setScope(prev => (prev === 'all' || rows.some(r => String(r.id) === prev) ? prev : 'all'));
      });
    }, [db])
  );

  async function onDocument(kind: 'pdf' | 'csv') {
    const collectionId = scope === 'all' ? null : Number(scope);
    const scopeName =
      scope === 'all' ? t('export.all') : collections.find(c => String(c.id) === scope)?.name ?? '';
    setBusy(kind);
    try {
      const ctx = { t, lang, currency };
      const ok = kind === 'pdf'
        ? await exportPdf(db, { collectionId }, scopeName, ctx, { includeValues: true })
        : await exportCsv(db, collectionId, scopeName, ctx);
      if (!ok) Alert.alert(t('export.empty'));
    } catch (e) {
      Alert.alert(t('backup.failed'), String(e));
    } finally {
      setBusy(null);
    }
  }

  async function onExport() {
    setBusy('export');
    try {
      await createBackup(db, t('backup.fileName'));
    } catch (e) {
      Alert.alert(t('backup.failed'), String(e));
    } finally {
      setBusy(null);
    }
  }

  async function onImportList() {
    try {
      const id = await pickAndImport(db);
      if (id !== null) router.push(`/shared/${id}`);
    } catch (e) {
      const msg = e instanceof ShareImportError ? t(e.code === 'noData' ? 'shared.noData' : 'shared.invalid') : String(e);
      Alert.alert(t('shared.importFailed'), msg);
    }
  }

  async function onImport() {
    try {
      const backup = await pickBackup();
      if (!backup) return;
      const { summary } = backup;
      Alert.alert(
        t('backup.confirmTitle'),
        t('backup.confirmMsg', {
          date: formatDate(summary.createdAt, lang),
          c: summary.collections,
          n: summary.items,
          ph: summary.photos,
        }),
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('backup.restore'),
            style: 'destructive',
            onPress: async () => {
              setBusy('import');
              try {
                await restoreBackup(db, backup);
                await reloadPrefs();
                toastRef.current?.show(t('backup.done'));
              } catch (e) {
                Alert.alert(t('backup.failed'), String(e));
              } finally {
                setBusy(null);
              }
            },
          },
        ]
      );
    } catch (e) {
      const msg =
        e instanceof BackupError
          ? t(e.code === 'tooNew' ? 'backup.tooNew' : 'backup.invalid')
          : String(e);
      Alert.alert(t('backup.failed'), msg);
    }
  }

  return (
    <View style={s.container}>
      <ScrollView contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 40 }]}>
        <FieldLabel>{t('settings.language')}</FieldLabel>
        <Segmented
          options={[
            { key: 'tr', label: '🇹🇷  Türkçe' },
            { key: 'en', label: '🇬🇧  English' },
          ]}
          value={lang}
          onChange={k => setLang(k as 'tr' | 'en')}
        />

        <View style={s.section}>
          <FieldLabel>{t('settings.theme')}</FieldLabel>
          <Segmented
            options={[
              { key: 'light', label: t('theme.light') },
              { key: 'dark', label: t('theme.dark') },
              { key: 'system', label: t('theme.system') },
            ]}
            value={mode}
            onChange={k => setMode(k as ThemeMode)}
          />
          {mode === 'system' && <Text style={s.hint}>{t('theme.systemHint')}</Text>}
        </View>

        <View style={s.section}>
          <FieldLabel>{t('settings.colorTheme')}</FieldLabel>
          <View style={s.swatches}>
            {[...COLOR_THEMES, customTheme(custom[0], custom[1])].map(ct => {
              // Kare, temanın şu anki moddaki iki rengini gösterir
              const pair = night ? ct.night : vivid ? ct.vivid : ct.day;
              const left = pair.ink;
              const right = pair.bg;
              const active = colorTheme === ct.key;
              return (
                <Pressable
                  key={ct.key}
                  // Özel tema her dokunuşta renk paletini açar
                  onPress={() => (ct.key === 'custom' ? router.push('/custom-theme') : setColorTheme(ct.key))}
                  style={s.swatch}
                  accessibilityLabel={t(`colorTheme.${ct.key}` as 'colorTheme.mono')}
                  accessibilityState={{ selected: active }}
                >
                  <View style={[s.swatchBox, active && s.swatchBoxOn]}>
                    <View style={{ flex: 1, backgroundColor: left }} />
                    <View style={{ flex: 1, backgroundColor: right }} />
                    {ct.key === 'custom' && (
                      <View style={s.swatchEdit}>
                        <Ionicons name="color-palette-outline" size={16} color={C.black} />
                      </View>
                    )}
                    {active && (
                      <View style={s.swatchCheck}>
                        <Ionicons name="checkmark" size={16} color={C.white} />
                      </View>
                    )}
                  </View>
                  <Text style={[s.swatchLabel, active && { color: C.black, fontFamily: F.bold }]} numberOfLines={2}>
                    {t(`colorTheme.${ct.key}` as 'colorTheme.mono')}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {/* Gece modunda da görünür ama kullanılamaz; nedenini açıklar */}
          {colorTheme !== 'mono' && (
            <View style={[s.vividRow, night && { opacity: 0.55 }]}>
              <View style={{ flex: 1 }}>
                <Text style={s.vividLabel}>{t('settings.vivid')}</Text>
                <Text style={s.hint}>{night ? t('settings.vividNight') : t('settings.vividHint')}</Text>
              </View>
              <Switch
                value={vivid && !night}
                onValueChange={setVivid}
                disabled={night}
                trackColor={{ true: C.black, false: C.line }}
              />
            </View>
          )}
        </View>

        <View style={s.section}>
          <FieldLabel>{t('settings.currency')}</FieldLabel>
          <Chips
            options={CURRENCIES.map(c => ({ key: c, label: c }))}
            value={currency}
            onChange={k => setCurrency(k as Currency)}
          />
          <Text style={s.hint}>{t('settings.currencyHint')}</Text>
        </View>

        <View style={s.section}>
          <FieldLabel>{t('lock.section')}</FieldLabel>
          <View style={s.switchRow}>
            <Text style={s.switchLabel}>{t('lock.toggle', { method: lock.methodLabel })}</Text>
            <Switch
              value={lock.enabled}
              onValueChange={on => lock.setEnabled(on)}
              trackColor={{ true: C.black, false: C.line }}
              thumbColor={Platform.OS === 'android' ? C.white : undefined}
              ios_backgroundColor={C.line}
            />
          </View>
          <Text style={s.hint}>{t('lock.hint', { method: lock.methodLabel })}</Text>
        </View>

        <View style={s.section}>
          <FieldLabel>{t('notif.section')}</FieldLabel>
          <View style={s.switchRow}>
            <Text style={s.switchLabel}>{t('notif.loans')}</Text>
            <Switch
              value={notif.loans}
              onValueChange={on => changeNotif('loans', on)}
              trackColor={{ true: C.black, false: C.line }}
              thumbColor={Platform.OS === 'android' ? C.white : undefined}
              ios_backgroundColor={C.line}
            />
          </View>
          <Text style={s.hint}>{t('notif.loansHint')}</Text>
          <Text style={[s.switchLabel, { marginTop: 20, marginBottom: 10 }]}>{t('notif.digest')}</Text>
          <Segmented
            options={[
              { key: 'off', label: t('notif.off') },
              { key: 'weekly', label: t('notif.weekly') },
              { key: 'daily', label: t('notif.daily') },
            ]}
            value={notif.digest}
            onChange={k => changeNotif('digest', k as DigestMode)}
          />
          <Text style={s.hint}>{t('notif.digestHint')}</Text>
        </View>

        <View style={s.section}>
          <FieldLabel>{t('export.title')}</FieldLabel>
          <Text style={[s.hint, { marginTop: 0, marginBottom: 16 }]}>{t('export.hint')}</Text>
          <Chips
            options={[
              { key: 'all', label: t('export.all') },
              ...collections.map(c => ({ key: String(c.id), label: c.name })),
            ]}
            value={scope}
            onChange={setScope}
          />
          {busy === 'pdf' || busy === 'csv' ? (
            <View style={s.busy}>
              <ActivityIndicator color={C.black} />
              <Text style={s.busyText}>{t('export.preparing')}</Text>
            </View>
          ) : (
            <View style={s.exportRow}>
              <PrimaryButton label={t('export.pdf')} onPress={() => onDocument('pdf')} style={{ flex: 1 }} />
              <SecondaryButton label={t('export.csv')} onPress={() => onDocument('csv')} style={{ flex: 1, paddingVertical: 16.5 }} />
            </View>
          )}
          <SecondaryButton label={t('shared.importButton')} onPress={onImportList} style={{ marginTop: 10 }} />
          <Text style={[s.hint, { marginTop: 8 }]}>{t('shared.importHint')}</Text>
        </View>

        <View style={s.section}>
          <FieldLabel>{t('settings.backup')}</FieldLabel>
          <Text style={[s.hint, { marginTop: 0, marginBottom: 16 }]}>{t('settings.backupHint')}</Text>
          {busy === 'export' || busy === 'import' ? (
            <View style={s.busy}>
              <ActivityIndicator color={C.black} />
              <Text style={s.busyText}>
                {busy === 'export' ? t('settings.exporting') : t('settings.importing')}
              </Text>
            </View>
          ) : (
            <>
              <PrimaryButton label={t('settings.export')} onPress={onExport} />
              <SecondaryButton label={t('settings.import')} onPress={onImport} style={{ marginTop: 10 }} />
            </>
          )}
        </View>

        <View style={s.section}>
          <FieldLabel>{t('settings.about')}</FieldLabel>
          <View style={s.aboutRow}>
            <LogoMark size={64} />
            <View style={{ flex: 1 }}>
              <Text style={s.appName}>{APP_NAME}</Text>
              <Text style={s.tagline}>{t('settings.tagline')}</Text>
              <Text style={s.about}>
                {t('settings.version', { v: Constants.expoConfig?.version ?? '1.0.0' })}
              </Text>
            </View>
          </View>
        </View>
      </ScrollView>
      <Toast ref={toastRef} bottom={insets.bottom + 16} />
    </View>
  );
}

const makeStyles = (C: Palette) => StyleSheet.create({
  vividRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 4 },
  vividLabel: { fontFamily: F.semi, fontSize: 15, color: C.black },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -6 },
  swatch: { width: '25%', paddingHorizontal: 6, marginBottom: 14, alignItems: 'center' },
  swatchBox: {
    width: '100%', aspectRatio: 1, flexDirection: 'row', borderWidth: 1, borderColor: C.line, overflow: 'hidden',
  },
  swatchBoxOn: { borderWidth: 2.5, borderColor: C.black },
  swatchEdit: {
    position: 'absolute', left: 0, top: 0, width: 24, height: 24, backgroundColor: C.white,
    alignItems: 'center', justifyContent: 'center',
  },
  swatchCheck: {
    position: 'absolute', right: 0, bottom: 0, width: 24, height: 24, backgroundColor: C.black,
    alignItems: 'center', justifyContent: 'center',
  },
  swatchLabel: { fontFamily: F.medium, fontSize: 11.5, color: C.grey, marginTop: 6, textAlign: 'center' },
  container: { flex: 1, backgroundColor: C.white },
  content: { paddingHorizontal: 20, paddingTop: 4 },
  section: { marginTop: 28, paddingTop: 4, borderTopWidth: 1, borderTopColor: C.line },
  hint: { fontFamily: F.regular, fontSize: 13, color: C.grey, lineHeight: 19, marginTop: 12 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16 },
  switchLabel: { fontFamily: F.semi, fontSize: 16, color: C.black, flex: 1 },
  exportRow: { flexDirection: 'row', gap: 10, marginTop: 16 },
  busy: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 18 },
  busyText: { fontFamily: F.medium, fontSize: 15, color: C.black },
  aboutRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  appName: { fontFamily: F.black, fontSize: 22, color: C.black, letterSpacing: -0.5 },
  tagline: { fontFamily: F.regular, fontSize: 14, color: C.black, marginTop: 2 },
  about: { fontFamily: F.regular, fontSize: 13, color: C.grey, marginTop: 4 },
});
