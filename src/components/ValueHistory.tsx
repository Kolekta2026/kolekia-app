import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import { F } from '../constants/theme';
import { Palette, useStyles, useTheme } from '../lib/theme';
import { useI18n, type Currency } from '../lib/i18n';
import { formatDate, formatMoney } from '../lib/money';
import { convert, type Rates } from '../lib/fx';

type Row = { value: number; currency: string; recorded_at: string };

const MAX_BARS = 12;
const CHART_H = 72;

// Tahmini değerin zaman içindeki değişimi: en az iki kayıt varsa görünür.
// Farklı birimdeki eski kayıtlar güncel birime günlük kurla çevrilir.
export function ValueHistory({ itemId, currency, rates, refresh }: {
  itemId: number;
  currency: Currency;
  rates: Rates | null;
  refresh: string; // değiştiğinde geçmiş yeniden okunur
}) {
  const { C } = useTheme();
  const s = useStyles(makeStyles);
  const db = useSQLiteContext();
  const { t, lang } = useI18n();
  const [rows, setRows] = useState<Row[]>([]);

  useEffect(() => {
    db.getAllAsync<Row>(
      'SELECT value, currency, recorded_at FROM value_history WHERE item_id = ? ORDER BY recorded_at, id', itemId
    ).then(setRows).catch(() => setRows([]));
  }, [db, itemId, refresh]);

  const points = rows
    .map(r => ({ v: convert(r.value, r.currency as Currency, currency, rates), at: r.recorded_at, approx: r.currency !== currency }))
    .filter((p): p is { v: number; at: string; approx: boolean } => p.v !== null)
    .slice(-MAX_BARS);
  if (points.length < 2) return null;

  const max = Math.max(...points.map(p => p.v));
  const min = Math.min(...points.map(p => p.v));
  // Çubuklar en düşük değerin biraz altından başlar ki küçük değişimler de görünsün
  const floor = min === max ? 0 : Math.max(0, min - (max - min) * 0.5);
  const first = points[0];
  const last = points[points.length - 1];
  const diff = last.v - first.v;
  const pct = first.v > 0 ? Math.round((diff / first.v) * 100) : null;
  const approx = points.some(p => p.approx);
  const money = (v: number) => formatMoney(v, currency, lang);

  return (
    <View style={s.wrap}>
      <View style={s.head}>
        <Text style={s.title}>{t('history.title')}</Text>
        <Text style={[s.change, diff < 0 && { color: C.accent }]}>
          {approx ? '≈ ' : ''}{diff > 0 ? '+' : diff < 0 ? '−' : ''}{money(Math.abs(diff))}
          {pct !== null && diff !== 0 ? `  (${diff > 0 ? '+' : '−'}%${Math.abs(pct)})` : ''}
        </Text>
      </View>
      <View style={s.chart} accessibilityLabel={t('history.a11y', { from: money(first.v), to: money(last.v), n: points.length })}>
        {points.map((p, i) => {
          const h = max === floor ? CHART_H : 6 + ((p.v - floor) / (max - floor)) * (CHART_H - 6);
          const isLast = i === points.length - 1;
          return <View key={i} style={[s.bar, { height: h, backgroundColor: isLast ? C.black : C.line }]} />;
        })}
      </View>
      <View style={s.axis}>
        <Text style={s.axisText}>{formatDate(first.at, lang)}</Text>
        <Text style={s.axisText}>{formatDate(last.at, lang)}</Text>
      </View>
      <Text style={s.sub}>{t('history.sub', { n: rows.length, first: money(first.v) })}</Text>
    </View>
  );
}

const makeStyles = (C: Palette) => StyleSheet.create({
  wrap: { marginTop: 18, paddingTop: 14, borderTopWidth: 1, borderTopColor: C.line },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 },
  title: { fontFamily: F.bold, fontSize: 14, color: C.black },
  change: { fontFamily: F.bold, fontSize: 14, color: C.black },
  chart: { flexDirection: 'row', alignItems: 'flex-end', gap: 4, height: CHART_H, marginTop: 12 },
  bar: { flex: 1 },
  axis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  axisText: { fontFamily: F.regular, fontSize: 11, color: C.grey },
  sub: { fontFamily: F.regular, fontSize: 12, color: C.grey, marginTop: 6 },
});
