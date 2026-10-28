import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { F } from '../constants/theme';
import { Palette, useStyles, useTheme } from '../lib/theme';
import { useI18n } from '../lib/i18n';
import { useProgress } from '../lib/progress';

// Uygulamanın en üst katmanında, uzun işler sürerken görünen ilerleme kartı
export function ProgressHost() {
  const p = useProgress();
  const { C } = useTheme();
  const s = useStyles(makeStyles);
  const { t } = useI18n();
  if (!p) return null;

  const title = t(`progress.${p.kind}` as 'progress.backup');
  const detail =
    p.stage === 'collect'
      ? p.total ? t('progress.collectN', { done: p.done ?? 0, total: p.total }) : t('progress.collect')
      : p.stage === 'build' ? t(p.kind === 'restore' ? 'progress.restoring' : 'progress.build') : t('progress.share');
  const ratio = p.stage === 'collect' && p.total ? Math.min(1, (p.done ?? 0) / p.total) : null;

  return (
    <Animated.View entering={FadeIn.duration(150)} exiting={FadeOut.duration(150)} style={s.back} pointerEvents="auto">
      <View style={s.card}>
        <ActivityIndicator color={C.black} size="large" />
        <Text style={s.title}>{title}</Text>
        <Text style={s.detail}>{detail}</Text>
        {ratio !== null && (
          <View style={s.bar}>
            <View style={[s.fill, { width: `${Math.round(ratio * 100)}%` }]} />
          </View>
        )}
        <Text style={s.hint}>{t('progress.hint')}</Text>
      </View>
    </Animated.View>
  );
}

const makeStyles = (C: Palette) => StyleSheet.create({
  back: {
    ...StyleSheet.absoluteFill, zIndex: 9999, elevation: 9999,
    backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', padding: 32,
  },
  card: { alignSelf: 'stretch', backgroundColor: C.white, padding: 24, alignItems: 'center', borderWidth: 2, borderColor: C.black },
  title: { fontFamily: F.heavy, fontSize: 18, color: C.black, marginTop: 16, textAlign: 'center' },
  detail: { fontFamily: F.medium, fontSize: 14, color: C.black, marginTop: 6, textAlign: 'center' },
  bar: { alignSelf: 'stretch', height: 6, backgroundColor: C.line, marginTop: 16 },
  fill: { height: 6, backgroundColor: C.black },
  hint: { fontFamily: F.regular, fontSize: 12, color: C.grey, marginTop: 14, textAlign: 'center' },
});
