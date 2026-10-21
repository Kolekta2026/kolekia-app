import { Stack } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SQLiteDatabase, SQLiteProvider } from 'expo-sqlite';
import {
  useFonts,
  Archivo_400Regular,
  Archivo_500Medium,
  Archivo_600SemiBold,
  Archivo_700Bold,
  Archivo_800ExtraBold,
  Archivo_900Black,
} from '@expo-google-fonts/archivo';
import { migrateDb } from '../db/schema';
import { purgeExpiredTrash } from '../lib/trash';
import { I18nProvider, useI18n } from '../lib/i18n';
import { F } from '../constants/theme';
import { ThemeProvider, useTheme } from '../lib/theme';
import { StatusBar } from 'expo-status-bar';
import { ActionSheetProvider } from '@expo/react-native-action-sheet';
import Sortable from 'react-native-sortables';
import { LockProvider } from '../lib/lock';

async function initDb(db: SQLiteDatabase) {
  await migrateDb(db);
  await purgeExpiredTrash(db);
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Archivo_400Regular,
    Archivo_500Medium,
    Archivo_600SemiBold,
    Archivo_700Bold,
    Archivo_800ExtraBold,
    Archivo_900Black,
  });

  if (!fontsLoaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SQLiteProvider databaseName="koleksiyon.db" onInit={initDb}>
        <I18nProvider>
          <ThemeProvider>
            <ActionSheetProvider>
              {/* Sürüklenen öğeyi en üst katmana taşır; kaydırma alanları (özellikle Android'de)
                  sürüklenen kutuyu kırpıp görünmez yapmasın diye */}
              <Sortable.PortalProvider>
                {/* Face ID kilidi açıksa tüm uygulamanın üstünde kilit ekranı gösterir */}
                <LockProvider>
                  <AppStack />
                </LockProvider>
              </Sortable.PortalProvider>
            </ActionSheetProvider>
          </ThemeProvider>
        </I18nProvider>
      </SQLiteProvider>
    </GestureHandlerRootView>
  );
}

function AppStack() {
  const { t } = useI18n();
  const { C, isDark } = useTheme();
  return (
    <>
    <StatusBar style={isDark ? 'light' : 'dark'} />
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: C.white },
        headerShadowVisible: false,
        headerTintColor: C.black,
        headerTitleStyle: { fontFamily: F.bold, fontSize: 16 },
        headerBackButtonDisplayMode: 'minimal',
        contentStyle: { backgroundColor: C.white },
      }}
    >
      <Stack.Screen name="index" options={{ title: '', headerShown: false }} />
      <Stack.Screen name="new-collection" options={{ title: t('nav.newCollection'), presentation: 'modal' }} />
      <Stack.Screen name="collection/[id]/index" options={{ title: '' }} />
      <Stack.Screen name="collection/[id]/new-item" options={{ title: t('nav.newItem'), presentation: 'modal' }} />
      <Stack.Screen name="item/[itemId]/index" options={{ title: '' }} />
      <Stack.Screen name="item/[itemId]/edit" options={{ title: t('nav.edit'), presentation: 'modal' }} />
      <Stack.Screen name="trash" options={{ title: t('nav.trash') }} />
      <Stack.Screen name="settings" options={{ title: t('nav.settings') }} />
      <Stack.Screen name="custom-theme" options={{ title: t('custom.title'), presentation: 'modal' }} />
      <Stack.Screen name="search" options={{ title: t('nav.search') }} />
      <Stack.Screen name="lens" options={{ title: 'Google Lens' }} />
      <Stack.Screen name="collection/[id]/fields" options={{ title: t('fields.edit') }} />
      <Stack.Screen name="collection/[id]/batch" options={{ title: t('batch.title') }} />
      <Stack.Screen name="shared/[id]/index" options={{ title: '' }} />
      <Stack.Screen name="shared/[id]/item" options={{ title: '' }} />
      <Stack.Screen name="import" options={{ title: '', headerShown: false }} />
    </Stack>
    </>
  );
}
