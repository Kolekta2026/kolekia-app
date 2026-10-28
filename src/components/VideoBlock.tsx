import { StyleSheet, Text, View } from 'react-native';
import { requireOptionalNativeModule } from 'expo';
import { Ionicons } from '@expo/vector-icons';
import { F } from '../constants/theme';
import { useTheme } from '../lib/theme';
import { useI18n } from '../lib/i18n';

// expo-video yerel bir modül: uygulamanın eski build'lerinde (ör. 1.8 öncesi geliştirme uygulaması)
// bulunmaz. Modül yoksa paket hiç yüklenmez, yerine kısa bir not gösterilir; uygulama çökmez.
const VIDEO_AVAILABLE = !!requireOptionalNativeModule('ExpoVideo');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ExpoVideo: typeof import('expo-video') | null = VIDEO_AVAILABLE ? require('expo-video') : null;

export function VideoBlock({ uri }: { uri: string }) {
  const { C } = useTheme();
  const { t } = useI18n();
  if (!ExpoVideo) {
    return (
      <View style={[s.wrap, s.missing, { backgroundColor: C.paper }]}>
        <Ionicons name="videocam-off-outline" size={26} color={C.grey} />
        <Text style={[s.missingText, { color: C.grey }]}>{t('video.unavailable')}</Text>
      </View>
    );
  }
  return <Player uri={uri} lib={ExpoVideo} />;
}

// Oynatıcı ayrı bileşende: kanca (useVideoPlayer) yalnızca modül varken çağrılır
function Player({ uri, lib }: { uri: string; lib: typeof import('expo-video') }) {
  const { C } = useTheme();
  const player = lib.useVideoPlayer(uri, p => {
    p.loop = false;
  });
  return (
    <View style={[s.wrap, { backgroundColor: C.paper }]}>
      <lib.VideoView
        player={player}
        style={StyleSheet.absoluteFill}
        contentFit="contain"
        nativeControls
        fullscreenOptions={{ enable: true }}
      />
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { width: '100%', aspectRatio: 16 / 9, marginTop: 22, overflow: 'hidden' },
  missing: { alignItems: 'center', justifyContent: 'center', gap: 8, padding: 20 },
  missingText: { fontFamily: F.medium, fontSize: 13, textAlign: 'center' },
});
