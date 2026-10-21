import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { contrast, customTheme, F, paletteFrom, PICKER_COLORS } from '../constants/theme';
import { Palette, useStyles, useTheme } from '../lib/theme';
import { useI18n } from '../lib/i18n';
import { PrimaryButton } from '../components/ui';

// Özel renk teması: paletten iki renk seçilir, gündüz/gece/canlı hâlleri otomatik üretilir
export default function CustomThemeScreen() {
  const { C, custom, setCustom, setColorTheme, night, vivid } = useTheme();
  const s = useStyles(makeStyles);
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const [colors, setColors] = useState<[string, string]>(custom);
  const [which, setWhich] = useState<0 | 1>(0);

  const theme = customTheme(colors[0], colors[1]);
  const pv = (pair: { bg: string; ink: string }) => paletteFrom(pair);
  const previews = [
    { key: 'day', label: t('theme.light'), P: pv(theme.day) },
    { key: 'night', label: t('theme.dark'), P: pv(theme.night) },
    { key: 'vivid', label: t('settings.vivid'), P: pv(theme.vivid) },
  ];
  const weak = contrast(colors[0], colors[1]) < 2;

  function pick(c: string) {
    setColors(prev => (which === 0 ? [c, prev[1]] : [prev[0], c]));
  }

  function save() {
    setCustom(colors);
    setColorTheme('custom');
    router.back();
  }

  return (
    <View style={s.container}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 100 }}>
        {/* Üç hâlin canlı önizlemesi */}
        <View style={s.previews}>
          {previews.map(({ key, label, P }) => {
            const current = key === (night ? 'night' : vivid ? 'vivid' : 'day');
            return (
              <View key={key} style={{ flex: 1 }}>
                <View style={[s.mini, { backgroundColor: P.white, borderColor: current ? C.black : C.line }]}>
                  <View style={s.miniTop}>
                    <View style={[s.miniLogo, { backgroundColor: P.black }]}>
                      <Text style={[s.miniK, { color: P.white }]}>K</Text>
                    </View>
                    <Text style={[s.miniTitle, { color: P.black }]}>Kolekia</Text>
                  </View>
                  <View style={[s.miniTiles]}>
                    {[0, 1, 2].map(i => (
                      <View key={i} style={[s.miniTile, { backgroundColor: i === 0 ? P.black : P.paper }]} />
                    ))}
                  </View>
                  <View style={[s.miniLine, { backgroundColor: P.line }]} />
                  <Text style={[s.miniText, { color: P.grey }]}>Sahibim · İstek</Text>
                  <View style={[s.miniBtn, { backgroundColor: P.black }]}>
                    <Text style={[s.miniBtnText, { color: P.white }]}>+ {t('add.button')}</Text>
                  </View>
                </View>
                <Text style={[s.previewLabel, current && { color: C.black, fontFamily: F.bold }]}>{label}</Text>
              </View>
            );
          })}
        </View>

        {/* Hangi renk değiştiriliyor */}
        <View style={s.slots}>
          {([0, 1] as const).map(i => (
            <Pressable
              key={i}
              onPress={() => setWhich(i)}
              style={[s.slot, which === i && s.slotOn]}
              accessibilityState={{ selected: which === i }}
            >
              <View style={[s.slotSwatch, { backgroundColor: colors[i] }]} />
              <Text style={[s.slotText, which === i && { color: C.black }]}>
                {i === 0 ? t('custom.main') : t('custom.second')}
              </Text>
            </Pressable>
          ))}
          <Pressable
            onPress={() => setColors([colors[1], colors[0]])}
            style={s.swap}
            accessibilityLabel={t('custom.swap')}
            hitSlop={8}
          >
            <Ionicons name="swap-horizontal" size={22} color={C.black} />
          </Pressable>
        </View>

        <View style={s.grid}>
          {PICKER_COLORS.map(c => {
            const on = colors[which].toUpperCase() === c.toUpperCase();
            return (
              <Pressable key={c} onPress={() => pick(c)} style={s.cellWrap} accessibilityLabel={c}>
                <View style={[s.cell, { backgroundColor: c }, on && s.cellOn]}>
                  {on && <Ionicons name="checkmark" size={16} color={contrast(c, '#000000') > 7 ? '#000000' : '#FFFFFF'} />}
                </View>
              </Pressable>
            );
          })}
        </View>

        <Text style={s.hint}>{weak ? t('custom.weak') : t('custom.hint')}</Text>
      </ScrollView>

      <View style={[s.bar, { paddingBottom: insets.bottom + 12 }]}>
        <PrimaryButton label={t('custom.save')} onPress={save} />
      </View>
    </View>
  );
}

const makeStyles = (C: Palette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: C.white },
  previews: { flexDirection: 'row', gap: 10 },
  mini: { borderWidth: 2, padding: 8, gap: 7 },
  miniTop: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  miniLogo: { width: 14, height: 14, alignItems: 'center', justifyContent: 'center' },
  miniK: { fontFamily: F.black, fontSize: 10, lineHeight: 12 },
  miniTitle: { fontFamily: F.black, fontSize: 13, letterSpacing: -0.4 },
  miniTiles: { flexDirection: 'row', gap: 4 },
  miniTile: { flex: 1, aspectRatio: 1 },
  miniLine: { height: 1 },
  miniText: { fontFamily: F.medium, fontSize: 9 },
  miniBtn: { paddingVertical: 6, alignItems: 'center' },
  miniBtnText: { fontFamily: F.bold, fontSize: 10 },
  previewLabel: { fontFamily: F.medium, fontSize: 12, color: C.grey, textAlign: 'center', marginTop: 6 },
  slots: { flexDirection: 'row', gap: 10, marginTop: 22, alignItems: 'center' },
  slot: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10,
    borderWidth: 1.5, borderColor: C.line,
  },
  slotOn: { borderColor: C.black },
  slotSwatch: { width: 28, height: 28, borderWidth: 1, borderColor: C.line },
  slotText: { fontFamily: F.semi, fontSize: 14, color: C.grey },
  swap: { width: 40, height: 48, alignItems: 'center', justifyContent: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 16, marginHorizontal: -3 },
  cellWrap: { width: '10%', padding: 3 },
  cell: {
    aspectRatio: 1, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(0,0,0,0.12)',
  },
  cellOn: { borderWidth: 2.5, borderColor: C.black },
  hint: { fontFamily: F.regular, fontSize: 13, color: C.grey, marginTop: 14, lineHeight: 18 },
  bar: {
    position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 12,
    backgroundColor: C.white, borderTopWidth: 1, borderTopColor: C.line,
  },
});
