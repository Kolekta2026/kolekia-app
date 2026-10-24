// Yerel bildirimler (sunucu yok, hiçbir veri cihazdan çıkmaz):
//  - Ödünç hatırlatması: dönüş günü sabah 10:00
//  - "Koleksiyonundan bugün": seçilen sıklıkta, akşam 19:30'da rastgele bir parça
// Planlanmış bildirimler her açılışta, ayar değişince ve parça kaydedilince baştan kurulur.
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import type { SQLiteDatabase } from 'expo-sqlite';
import type { TFunction } from './i18n';
import { daysUntil } from './dates';

export type DigestMode = 'off' | 'daily' | 'weekly';

const KEY_LOANS = 'notif_loans';   // '0' = kapalı, varsayılan açık
const KEY_DIGEST = 'notif_digest'; // 'off' | 'daily' | 'weekly', varsayılan kapalı
const LOAN_HOUR = 10;
const DIGEST_HOUR = 19;
const DIGEST_MINUTE = 30;
// iOS en fazla 64 planlı bildirim tutar; günlük özet bir hafta, haftalık özet bir ay ileriye kurulur
const MAX_LOANS = 40;

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

async function setting(db: SQLiteDatabase, key: string) {
  const r = await db.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key = ?', key);
  return r?.value ?? null;
}

export async function getNotifPrefs(db: SQLiteDatabase) {
  const loans = (await setting(db, KEY_LOANS)) !== '0';
  const d = await setting(db, KEY_DIGEST);
  const digest: DigestMode = d === 'daily' || d === 'weekly' ? d : 'off';
  return { loans, digest };
}

export async function setNotifPref(db: SQLiteDatabase, key: 'loans' | 'digest', value: string) {
  await db.runAsync(
    'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
    key === 'loans' ? KEY_LOANS : KEY_DIGEST, value
  );
}

// İzin yoksa ister; reddedilmişse false döner (Ayarlar'dan açılması gerekir)
export async function ensurePermission(): Promise<boolean> {
  try {
    const cur = await Notifications.getPermissionsAsync();
    if (cur.granted) return true;
    if (!cur.canAskAgain) return false;
    const req = await Notifications.requestPermissionsAsync();
    return req.granted;
  } catch {
    return false;
  }
}

async function hasPermission() {
  try {
    return (await Notifications.getPermissionsAsync()).granted;
  } catch {
    return false;
  }
}

function at(day: string, hour: number, minute = 0): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), hour, minute);
}

let running: Promise<void> | null = null;

// Tüm planlı bildirimleri silip güncel verilere göre yeniden kurar
export function syncNotifications(db: SQLiteDatabase, t: TFunction) {
  // Üst üste çağrılırsa (ör. kayıt + odaklanma) sırayla çalışsın
  const next = (running ?? Promise.resolve()).then(() => doSync(db, t)).catch(() => {});
  running = next;
  return next;
}

async function doSync(db: SQLiteDatabase, t: TFunction) {
  if (!(await hasPermission())) return;
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Kolekia',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
  await Notifications.cancelAllScheduledNotificationsAsync();
  const prefs = await getNotifPrefs(db);
  const now = Date.now();

  if (prefs.loans) {
    const loans = await db.getAllAsync<{ id: number; title: string; loaned_to: string | null; loan_due: string }>(`
      SELECT id, title, loaned_to, loan_due FROM items
       WHERE status = 'loaned' AND loan_due IS NOT NULL AND deleted_at IS NULL
       ORDER BY loan_due LIMIT ?`, MAX_LOANS);
    for (const it of loans) {
      const left = daysUntil(it.loan_due);
      if (left === null || left < 0) continue;
      const date = at(it.loan_due, LOAN_HOUR);
      if (!date || date.getTime() <= now) continue;
      await Notifications.scheduleNotificationAsync({
        identifier: `loan-${it.id}`,
        content: {
          title: t('notif.loanTitle'),
          body: it.loaned_to
            ? t('notif.loanBodyTo', { title: it.title, to: it.loaned_to })
            : t('notif.loanBody', { title: it.title }),
          data: { itemId: it.id },
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date },
      });
    }
  }

  if (prefs.digest !== 'off') {
    const count = prefs.digest === 'daily' ? 7 : 4;
    const step = prefs.digest === 'daily' ? 1 : 7;
    // Fotoğraflı ve elde olan parçalar öncelikli; her bildirime farklı parça
    const picks = await db.getAllAsync<{ id: number; title: string; collection_name: string }>(`
      SELECT i.id, i.title, c.name AS collection_name
        FROM items i JOIN collections c ON c.id = i.collection_id
       WHERE i.deleted_at IS NULL AND i.status IN ('owned', 'loaned')
       ORDER BY EXISTS (SELECT 1 FROM item_photos p WHERE p.item_id = i.id) DESC, RANDOM()
       LIMIT ?`, count);
    if (picks.length > 0) {
      const first = new Date();
      first.setHours(DIGEST_HOUR, DIGEST_MINUTE, 0, 0);
      if (first.getTime() <= now) first.setDate(first.getDate() + 1);
      for (let i = 0; i < count; i++) {
        const it = picks[i % picks.length];
        const date = new Date(first);
        date.setDate(first.getDate() + i * step);
        await Notifications.scheduleNotificationAsync({
          identifier: `digest-${i}`,
          content: {
            title: t('notif.digestTitle'),
            body: t('notif.digestBody', { title: it.title, collection: it.collection_name }),
            data: { itemId: it.id },
          },
          trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date },
        });
      }
    }
  }
}

// Bildirime dokununca ilgili parça açılır
export function itemIdFromResponse(r: Notifications.NotificationResponse | null | undefined): number | null {
  const id = Number(r?.notification.request.content.data?.itemId);
  return Number.isFinite(id) && id > 0 ? id : null;
}
