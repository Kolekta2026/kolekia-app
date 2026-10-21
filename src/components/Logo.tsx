import { Image, StyleSheet, Text, View } from 'react-native';
import { F } from '../constants/theme';
import { Palette, useStyles, useTheme } from '../lib/theme';
import { APP_NAME } from '../constants/brand';

const MARK_LIGHT = require('../../assets/images/icon.png');      // siyah kare, beyaz K
const MARK_DARK = require('../../assets/images/logo-dark.png');  // beyaz kare, siyah K

// Logo her iki modda da zeminden ayrışan bir kare olarak görünür
// Renk temalarında logo, temanın iki rengiyle çizilir (yazı renginde kare, zemin renginde K)
export function LogoMark({ size = 24 }: { size?: number }) {
  const { isDark, colorTheme, C } = useTheme();
  if (colorTheme !== 'mono') {
    return (
      <View style={{ width: size, height: size, backgroundColor: C.black, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontFamily: F.black, fontSize: size * 0.72, lineHeight: size * 0.9, color: C.white, includeFontPadding: false }}>
          K
        </Text>
      </View>
    );
  }
  return <Image source={isDark ? MARK_DARK : MARK_LIGHT} style={{ width: size, height: size }} />;
}

// Marka: logo + ad. "large" ana ekran başlığı olarak kullanılır.
export function Brand({ size = 'small' }: { size?: 'small' | 'large' }) {
  const s = useStyles(makeStyles);
  const large = size === 'large';
  return (
    <View style={[s.row, large && { gap: 12 }]}>
      <LogoMark size={large ? 34 : 22} />
      <Text style={large ? s.nameLarge : s.name}>{APP_NAME}</Text>
    </View>
  );
}

const makeStyles = (C: Palette) => StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { fontFamily: F.heavy, fontSize: 16, color: C.black, letterSpacing: -0.3 },
  nameLarge: { fontFamily: F.black, fontSize: 32, color: C.black, letterSpacing: -1 },
});
