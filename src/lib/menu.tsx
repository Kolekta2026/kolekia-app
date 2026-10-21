import { useCallback } from 'react';
import type { AlertButton } from 'react-native';
import { useActionSheet } from '@expo/react-native-action-sheet';
import { F } from '../constants/theme';
import { useI18n } from './i18n';
import { useTheme } from './theme';

// Seçenek menüleri için alttan açılan sayfa. Android'deki uyarı pencereleri en fazla
// üç buton gösterebildiği için tüm menüler bunu kullanır. Alert.alert ile aynı biçimde
// çağrılır; "Vazgeç" butonunu kendisi ekler.
export function useMenu() {
  const { showActionSheetWithOptions } = useActionSheet();
  const { t } = useI18n();
  const { C, isDark } = useTheme();

  return useCallback(
    (title: string | undefined, message: string | undefined, buttons: AlertButton[]) => {
      const items = buttons.filter(b => b.style !== 'cancel');
      const options = [...items.map(b => b.text ?? ''), t('common.cancel')];
      const destructive = items.flatMap((b, i) => (b.style === 'destructive' ? [i] : []));
      showActionSheetWithOptions(
        {
          title,
          message,
          options,
          cancelButtonIndex: items.length,
          destructiveButtonIndex: destructive.length ? destructive : undefined,
          userInterfaceStyle: isDark ? 'dark' : 'light',
          destructiveColor: '#D93025',
          containerStyle: { backgroundColor: C.white },
          textStyle: { color: C.black, fontFamily: F.medium },
          titleTextStyle: { color: C.black, fontFamily: F.bold },
          messageTextStyle: { color: C.grey, fontFamily: F.regular },
        },
        idx => {
          if (idx !== undefined && idx < items.length) items[idx].onPress?.();
        }
      );
    },
    [showActionSheetWithOptions, t, C, isDark]
  );
}
