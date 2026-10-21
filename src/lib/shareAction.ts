import { Alert } from 'react-native';
import type { SQLiteDatabase } from 'expo-sqlite';
import type { Currency, Lang, TFunction } from './i18n';
import { exportPdf, type Scope } from './export';

// Paylaşmadan önce değerlerin dahil edilip edilmeyeceğini sorar.
// Varsayılan (ilk) seçenek değerler olmadan paylaşmaktır.
export function askAndSharePdf(
  db: SQLiteDatabase,
  scope: Scope,
  title: string,
  ctx: { t: TFunction; lang: Lang; currency: Currency },
  setBusy: (b: boolean) => void
) {
  const { t } = ctx;
  const run = async (includeValues: boolean) => {
    setBusy(true);
    try {
      const ok = await exportPdf(db, scope, title, ctx, { includeValues });
      if (!ok) Alert.alert(t('export.empty'));
    } catch (e) {
      Alert.alert(t('backup.failed'), String(e));
    } finally {
      setBusy(false);
    }
  };
  Alert.alert(t('share.title'), t('share.message'), [
    { text: t('share.withoutValues'), onPress: () => run(false) },
    { text: t('share.withValues'), onPress: () => run(true) },
    { text: t('common.cancel'), style: 'cancel' },
  ]);
}
