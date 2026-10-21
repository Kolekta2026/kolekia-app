import { useEffect, useRef } from 'react';
import { ActivityIndicator, Alert, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { Palette, useStyles, useTheme } from '../lib/theme';
import { useI18n } from '../lib/i18n';
import { importFromUri, ShareImportError } from '../lib/shareData';

// "Kolekia ile aç" ile gelen PDF'i içe aktarır ve listeyi açar
export default function ImportScreen() {
  const { uri } = useLocalSearchParams<{ uri: string }>();
  const { C } = useTheme();
  const s = useStyles(makeStyles);
  const db = useSQLiteContext();
  const { t } = useI18n();
  const started = useRef(false);

  useEffect(() => {
    if (started.current || !uri) return;
    started.current = true;
    importFromUri(db, uri)
      .then(id => router.replace(`/shared/${id}`))
      .catch(e => {
        const msg = e instanceof ShareImportError
          ? t(e.code === 'noData' ? 'shared.noData' : 'shared.invalid')
          : String(e);
        Alert.alert(t('shared.importFailed'), msg, [{ text: 'OK', onPress: () => router.replace('/') }]);
      });
  }, [db, uri, t]);

  return (
    <View style={s.container}>
      <ActivityIndicator color={C.black} size="large" />
    </View>
  );
}

const makeStyles = (C: Palette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: C.white, alignItems: 'center', justifyContent: 'center' },
});
