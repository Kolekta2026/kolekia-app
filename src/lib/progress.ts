// Uzun süren işler (yedek, PDF, CSV, geri yükleme) için ekranın üstünde ilerleme kartı.
// İşi yapan fonksiyon setProgress ile durumu bildirir; kartı kök düzendeki ProgressHost çizer.
// Paylaşım menüsü açılmadan hemen önce kart kapatılır (menünün önünde durmasın).
import { useEffect, useState } from 'react';

export type ProgressKind = 'backup' | 'restore' | 'pdf' | 'csv';
export type ProgressStage = 'collect' | 'build' | 'share';
export type ProgressState = { kind: ProgressKind; stage: ProgressStage; done?: number; total?: number } | null;

let current: ProgressState = null;
const listeners = new Set<(p: ProgressState) => void>();

export function setProgress(p: ProgressState) {
  current = p;
  listeners.forEach(l => l(p));
}

export function useProgress() {
  const [p, setP] = useState<ProgressState>(current);
  useEffect(() => {
    listeners.add(setP);
    return () => { listeners.delete(setP); };
  }, []);
  return p;
}

// Arayüzün güncellenmesine fırsat verir (uzun döngülerde ilerleme görünür olsun)
export const yieldToUi = () => new Promise<void>(r => setTimeout(r, 0));
