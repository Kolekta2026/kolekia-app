import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Alert, AppState, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { useSQLiteContext } from 'expo-sqlite';
import { Ionicons } from '@expo/vector-icons';
import { F } from '../constants/theme';
import { LogoMark } from '../components/Logo';
import { useI18n } from './i18n';
import { useTheme } from './theme';

// Arka planda bu süreden kısa kalınırsa (ör. fotoğraf seçmek, paylaşmak) tekrar kilitlenmez
const GRACE_MS = 30_000;

type LockContext = {
  enabled: boolean;
  methodLabel: string;
  setEnabled: (on: boolean) => Promise<void>;
};

const Ctx = createContext<LockContext | null>(null);

export function useLock() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useLock must be used inside LockProvider');
  return c;
}

export function LockProvider({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  const { t } = useI18n();
  const { C } = useTheme();

  const [ready, setReady] = useState(false);
  const [enabled, setEnabledState] = useState(false);
  const [locked, setLocked] = useState(false);
  const [cover, setCover] = useState(false); // uygulama değiştiricide içeriği gizler
  const [methodLabel, setMethodLabel] = useState('Face ID');

  const authenticating = useRef(false);
  const backgroundAt = useRef<number | null>(null);
  const enabledRef = useRef(false);
  enabledRef.current = enabled;

  // Cihazın desteklediği yönteme göre ad: Face ID, Touch ID ya da Android'de biyometrik kilit
  useEffect(() => {
    LocalAuthentication.supportedAuthenticationTypesAsync().then(types => {
      const face = types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION);
      const finger = types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT);
      if (Platform.OS === 'ios') setMethodLabel(face ? 'Face ID' : finger ? 'Touch ID' : t('lock.passcode'));
      else setMethodLabel(t('lock.biometric'));
    });
  }, [t]);

  // Açılışta: kilit açıksa uygulama kilitli başlar
  useEffect(() => {
    db.getFirstAsync<{ value: string }>("SELECT value FROM settings WHERE key = 'lock_enabled'").then(r => {
      const on = r?.value === '1';
      setEnabledState(on);
      setLocked(on);
      setReady(true);
    });
  }, [db]);

  const unlock = useCallback(async () => {
    if (authenticating.current) return;
    authenticating.current = true;
    try {
      const res = await LocalAuthentication.authenticateAsync({
        promptMessage: t('lock.prompt'),
        cancelLabel: t('common.cancel'),
        disableDeviceFallback: false, // Face ID başarısız olursa cihaz şifresiyle açılabilir
      });
      if (res.success) setLocked(false);
    } finally {
      // Kimlik doğrulama penceresi kapanırken gelen uygulama durumu değişikliklerini yok say
      setTimeout(() => { authenticating.current = false; }, 600);
    }
  }, [t]);

  // Arka plana gidip dönünce kilitle; uygulama değiştiricide içeriği gizle
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (!enabledRef.current || authenticating.current) return;
      if (state === 'background' || state === 'inactive') {
        setCover(true);
        if (state === 'background' && backgroundAt.current === null) backgroundAt.current = Date.now();
      } else if (state === 'active') {
        if (backgroundAt.current !== null && Date.now() - backgroundAt.current > GRACE_MS) setLocked(true);
        backgroundAt.current = null;
        setCover(false);
      }
    });
    return () => sub.remove();
  }, []);

  // Kilit ekranı göründüğünde doğrulamayı kendiliğinden başlat
  useEffect(() => {
    if (locked && AppState.currentState === 'active') unlock();
  }, [locked, unlock]);

  const setEnabled = useCallback(
    async (on: boolean) => {
      if (on) {
        const hasHardware = await LocalAuthentication.hasHardwareAsync();
        const level = await LocalAuthentication.getEnrolledLevelAsync();
        if (!hasHardware && level === LocalAuthentication.SecurityLevel.NONE) {
          Alert.alert(t('lock.unavailableTitle'), t('lock.unavailable'));
          return;
        }
        if (level === LocalAuthentication.SecurityLevel.NONE) {
          Alert.alert(t('lock.unavailableTitle'), t('lock.notEnrolled'));
          return;
        }
        // Açmadan önce bir kez doğrula; kullanıcı kendini dışarıda bırakmasın
        authenticating.current = true;
        try {
          const res = await LocalAuthentication.authenticateAsync({
            promptMessage: t('lock.confirm'),
            cancelLabel: t('common.cancel'),
            disableDeviceFallback: false,
          });
          if (!res.success) return;
        } finally {
          setTimeout(() => { authenticating.current = false; }, 600);
        }
      }
      await db.runAsync("INSERT OR REPLACE INTO settings (key, value) VALUES ('lock_enabled', ?)", on ? '1' : '0');
      setEnabledState(on);
    },
    [db, t]
  );

  const showOverlay = !ready || (enabled && (locked || cover));

  return (
    <Ctx.Provider value={{ enabled, methodLabel, setEnabled }}>
      {children}
      {showOverlay && (
        <View style={[StyleSheet.absoluteFill, styles.overlay, { backgroundColor: C.white }]}>
          {ready && (
            <>
              <LogoMark size={64} />
              <Text style={[styles.title, { color: C.black }]}>Kolekia</Text>
              {locked && (
                <>
                  <Text style={[styles.sub, { color: C.grey }]}>{t('lock.locked')}</Text>
                  <Pressable
                    onPress={unlock}
                    style={({ pressed }) => [styles.btn, { backgroundColor: C.brand }, pressed && { opacity: 0.8 }]}
                    accessibilityLabel={t('lock.unlock', { method: methodLabel })}
                  >
                    <Ionicons name={methodLabel === 'Face ID' ? 'scan-outline' : 'finger-print'} size={20} color={C.onBrand} />
                    <Text style={[styles.btnText, { color: C.onBrand }]}>{t('lock.unlock', { method: methodLabel })}</Text>
                  </Pressable>
                </>
              )}
            </>
          )}
        </View>
      )}
    </Ctx.Provider>
  );
}

const styles = StyleSheet.create({
  overlay: { zIndex: 1000, elevation: 1000, alignItems: 'center', justifyContent: 'center', padding: 32 },
  title: { fontFamily: F.black, fontSize: 34, letterSpacing: -1, marginTop: 16 },
  sub: { fontFamily: F.medium, fontSize: 15, marginTop: 6 },
  btn: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 36, paddingVertical: 16, paddingHorizontal: 26 },
  btnText: { fontFamily: F.bold, fontSize: 16 },
});
