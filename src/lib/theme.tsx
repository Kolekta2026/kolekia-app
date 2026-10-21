import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import { COLOR_THEMES, customTheme, DARK, DEFAULT_CUSTOM, isDarkColor, LIGHT, Palette, paletteFrom } from '../constants/theme';

export type ThemeMode = 'light' | 'dark' | 'system';
export type { Palette };

type ThemeCtx = {
  mode: ThemeMode;
  setMode: (m: ThemeMode) => void;
  colorTheme: string;
  setColorTheme: (k: string) => void;
  vivid: boolean;
  setVivid: (v: boolean) => void;
  custom: [string, string];
  setCustom: (c: [string, string]) => void;
  night: boolean; // gece modu seçili mi (ayar), isDark ise zeminin gerçekten koyu olup olmadığı
  isDark: boolean;
  C: Palette;
};

const Ctx = createContext<ThemeCtx | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  const system = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>('light');
  const [colorTheme, setColorThemeState] = useState('mono');
  const [vivid, setVividState] = useState(false);
  const [custom, setCustomState] = useState<[string, string]>(DEFAULT_CUSTOM);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    db.getAllAsync<{ key: string; value: string }>("SELECT key, value FROM settings WHERE key IN ('theme', 'color_theme', 'color_vivid', 'custom_colors')")
      .then(rows => {
        for (const r of rows) {
          if (r.key === 'theme' && (r.value === 'light' || r.value === 'dark' || r.value === 'system')) setModeState(r.value);
          if (r.key === 'color_theme' && (r.value === 'custom' || COLOR_THEMES.some(c => c.key === r.value))) setColorThemeState(r.value);
          if (r.key === 'custom_colors') {
            const [a, b] = r.value.split(',');
            if (/^#[0-9A-Fa-f]{6}$/.test(a) && /^#[0-9A-Fa-f]{6}$/.test(b)) setCustomState([a, b]);
          }
          if (r.key === 'color_vivid') setVividState(r.value === '1');
        }
      })
      .finally(() => setReady(true));
  }, [db]);

  const setColorTheme = useCallback((k: string) => {
    setColorThemeState(k);
    db.runAsync("INSERT OR REPLACE INTO settings (key, value) VALUES ('color_theme', ?)", k);
  }, [db]);

  const setCustom = useCallback((c: [string, string]) => {
    setCustomState(c);
    db.runAsync("INSERT OR REPLACE INTO settings (key, value) VALUES ('custom_colors', ?)", c.join(','));
  }, [db]);

  const setVivid = useCallback((v: boolean) => {
    setVividState(v);
    db.runAsync("INSERT OR REPLACE INTO settings (key, value) VALUES ('color_vivid', ?)", v ? '1' : '0');
  }, [db]);

  const setMode = useCallback((m: ThemeMode) => {
    setModeState(m);
    db.runAsync("INSERT OR REPLACE INTO settings (key, value) VALUES ('theme', ?)", m);
  }, [db]);

  const night = mode === 'dark' || (mode === 'system' && system === 'dark');
  const value = useMemo(() => {
    const ct = colorTheme === 'custom' ? customTheme(custom[0], custom[1]) : COLOR_THEMES.find(c => c.key === colorTheme);
    let C: Palette;
    if (!ct || ct.key === 'mono') C = night ? DARK : LIGHT;
    else C = paletteFrom(night ? ct.night : vivid ? ct.vivid : ct.day);
    // Durum çubuğu, menüler ve logo için: zemin koyu mu?
    const isDark = isDarkColor(C.white);
    return { mode, setMode, colorTheme, setColorTheme, vivid, setVivid, custom, setCustom, night, isDark, C };
  }, [mode, setMode, colorTheme, setColorTheme, vivid, setVivid, custom, setCustom, night]);

  if (!ready) return null;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}

// Stil tablosunu aktif renklere göre üretir; tema değişince yeniden hesaplanır
export function useStyles<T>(factory: (C: Palette) => T): T {
  const { C } = useTheme();
  return useMemo(() => factory(C), [C, factory]);
}
