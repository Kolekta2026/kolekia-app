import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Image, PanResponder, Pressable, ScrollView, StyleSheet, Switch, Text,
  TextInput, useWindowDimensions, View,
} from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { Ionicons } from '@expo/vector-icons';
import { F, STATUS_KEYS } from '../../../constants/theme';
import { Palette, useStyles, useTheme } from '../../../lib/theme';
import { useI18n } from '../../../lib/i18n';
import { persistPhoto } from '../../../lib/photos';
import { FieldLabel, PrimaryButton, Segmented, SecondaryButton } from '../../../components/ui';
import { sortReading, type Box } from '../../../lib/detect';
import { detectInPhoto, type Detection } from '../../../lib/detectPhoto';

// Çerçeve, fotoğrafa göre 0..1 arası oranlarla tutulur
type Frame = { l: number; t: number; r: number; b: number };
type Photo = { uri: string; width: number; height: number };

const PAD = 16;
const HANDLE = 30;
const MIN_SIZE = 0.08;
const MIN_CELL = 0.03; // ara çizgiler arasında kalması gereken en küçük pay
const even = (n: number) => Array.from({ length: n - 1 }, (_, i) => (i + 1) / n);
const MAX_GRID = 12;
const MAX_SOURCE = 3000; // çok büyük fotoğraflar bellek için önce küçültülür
const MAX_ITEM = 1200;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Tek fotoğraftaki birden fazla parçayı ızgarayla ayırıp koleksiyona ekler
export default function BatchAddScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const collectionId = Number(id);
  const { C } = useTheme();
  const s = useStyles(makeStyles);
  const db = useSQLiteContext();
  const { t } = useI18n();
  const { width: screenW, height: screenH } = useWindowDimensions();

  const [photo, setPhoto] = useState<Photo | null>(null);
  const [frame, setFrame] = useState<Frame>({ l: 0.04, t: 0.04, r: 0.96, b: 0.96 });
  const [rows, setRows] = useState(2);
  const [cols, setCols] = useState(3);
  const [off, setOff] = useState<Set<string>>(new Set());
  // Ara çizgilerin çerçeve içindeki konumları (0..1); sürüklenerek ayarlanır
  const [xs, setXs] = useState<number[]>(even(3));
  const [ys, setYs] = useState<number[]>(even(2));
  const [name, setName] = useState('');
  const [status, setStatus] = useState<string>('owned');
  const [attachGroup, setAttachGroup] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  // Otomatik algılama: bulunan kutular fotoğrafa göre 0..1 oranlarıyla tutulur
  const [mode, setMode] = useState<'grid' | 'auto'>('grid');
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [detected, setDetected] = useState(false);
  const [foundGrid, setFoundGrid] = useState<{ rows: number; cols: number } | null>(null);

  useEffect(() => {
    db.getFirstAsync<{ name: string }>('SELECT name FROM collections WHERE id = ?', collectionId)
      .then(c => setName(n => n || c?.name || ''));
  }, [db, collectionId]);

  // Izgara boyutu değişince ara çizgiler eşit dağılır, işaretlenen boş kareler sıfırlanır
  function changeRows(n: number) {
    setRows(n);
    setYs(even(n));
    setOff(new Set());
  }
  function changeCols(n: number) {
    setCols(n);
    setXs(even(n));
    setOff(new Set());
  }

  // Algılama sonucu: kutular otomatik sekmeye; bölmeli düzen bulunduysa ızgara da ona oturtulur
  function applyDetection(d: Detection) {
    setBoxes(d.boxes);
    setDetected(true);
    setFoundGrid(d.kind === 'grid' ? { rows: d.rows, cols: d.cols } : null);
    if (d.kind === 'grid') {
      setFrame(d.frame);
      setRows(d.rows);
      setCols(d.cols);
      setXs(d.xs);
      setYs(d.ys);
      setOff(new Set());
    }
  }

  // Fotoğrafın ekrandaki boyutu (ekrana sığacak şekilde)
  const disp = useMemo(() => {
    if (!photo) return { w: 0, h: 0 };
    let w = screenW - PAD * 2;
    let h = (w * photo.height) / photo.width;
    const maxH = screenH * 0.55;
    if (h > maxH) {
      h = maxH;
      w = (h * photo.width) / photo.height;
    }
    return { w, h };
  }, [photo, screenW, screenH]);

  // --- Fotoğraf seçme ---

  async function pick(source: 'camera' | 'library') {
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1 };
    let res: ImagePicker.ImagePickerResult;
    if (source === 'camera') {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(t('err.cameraTitle'), t('err.camera'));
        return;
      }
      res = await ImagePicker.launchCameraAsync(opts);
    } else {
      res = await ImagePicker.launchImageLibraryAsync(opts);
    }
    if (res.canceled) return;
    // Yönü düzeltilmiş ve gerekirse küçültülmüş bir kopya üzerinde çalışılır
    const a = res.assets[0];
    const ctx = ImageManipulator.manipulate(a.uri);
    const big = Math.max(a.width, a.height);
    if (big > MAX_SOURCE) {
      if (a.width >= a.height) ctx.resize({ width: MAX_SOURCE });
      else ctx.resize({ height: MAX_SOURCE });
    }
    const img = await ctx.renderAsync();
    const saved = await img.saveAsync({ format: SaveFormat.JPEG, compress: 0.92 });
    setPhoto({ uri: saved.uri, width: saved.width, height: saved.height });
    setFrame({ l: 0.04, t: 0.04, r: 0.96, b: 0.96 });
    setBoxes([]);
    setSelected(null);
    setDetected(false);
    setFoundGrid(null);
    setRows(2);
    setCols(3);
    setXs(even(3));
    setYs(even(2));
    setOff(new Set());
    setMode('grid');
    // Fotoğraf seçilir seçilmez parçalar aranır; bulunursa otomatik modda açılır
    setDetecting(true);
    try {
      const found = await detectInPhoto(saved.uri, saved.width, saved.height);
      applyDetection(found);
      if (found.boxes.length >= 2) setMode('auto');
    } catch {
      // Algılama başarısız olursa ızgarayla devam edilir
    } finally {
      setDetecting(false);
    }
  }

  // --- Köşe tutamaçları ---

  const dragStart = useRef(0);
  const frameRef = useRef(frame);
  frameRef.current = frame;
  const dispRef = useRef(disp);
  dispRef.current = disp;

  const handles = useMemo(
    () =>
      (['tl', 'tr', 'bl', 'br'] as const).map(corner => {
        let start: Frame = frameRef.current;
        return {
          corner,
          responder: PanResponder.create({
            onStartShouldSetPanResponder: () => true,
            onMoveShouldSetPanResponder: () => true,
            onPanResponderTerminationRequest: () => false,
            onPanResponderGrant: () => { start = frameRef.current; },
            onPanResponderMove: (_, g) => {
              const dx = g.dx / dispRef.current.w;
              const dy = g.dy / dispRef.current.h;
              const f = { ...start };
              if (corner === 'tl' || corner === 'bl') f.l = clamp(start.l + dx, 0, start.r - MIN_SIZE);
              else f.r = clamp(start.r + dx, start.l + MIN_SIZE, 1);
              if (corner === 'tl' || corner === 'tr') f.t = clamp(start.t + dy, 0, start.b - MIN_SIZE);
              else f.b = clamp(start.b + dy, start.t + MIN_SIZE, 1);
              setFrame(f);
            },
          }),
        };
      }),
    []
  );

  function toggleCell(key: string) {
    setOff(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const count = mode === 'grid' ? rows * cols - off.size : boxes.length;

  // --- Otomatik bul ---

  async function runDetect() {
    if (!photo) return;
    setMode('auto');
    setSelected(null);
    setDetecting(true);
    try {
      // Izgara sekmesinde çerçeve daraltıldıysa yalnızca o bölgede aranır
      const found = await detectInPhoto(photo.uri, photo.width, photo.height, frameRef.current);
      applyDetection(found);
      if (found.boxes.length === 0) Alert.alert(t('batch.autoTitle'), t('batch.autoNone'));
    } catch (e) {
      Alert.alert(t('batch.autoTitle'), String(e));
    } finally {
      setDetecting(false);
    }
  }

  function chooseMode(m: string) {
    if (m === 'auto') {
      if (!detected) runDetect();
      else setMode('auto');
    } else {
      setMode('grid');
      setSelected(null);
    }
  }

  // Yeni kutu: mevcut kutuların tipik boyutunda, ortada
  function addBox() {
    const w = boxes.length ? boxes.reduce((a, b) => a + b.w, 0) / boxes.length : 0.25;
    const h = boxes.length ? boxes.reduce((a, b) => a + b.h, 0) / boxes.length : 0.25;
    setBoxes(prev => [...prev, { x: 0.5 - w / 2, y: 0.5 - h / 2, w, h }]);
    setSelected(boxes.length);
  }

  // --- Kaydetme ---

  async function save() {
    if (!photo) return;
    const base = name.trim();
    if (!base) {
      Alert.alert(t('err.nameTitle'), t('batch.nameRequired'));
      return;
    }
    if (count === 0) return;

    // Kesilecek dikdörtgenler (piksel): ızgaradan ya da algılanan kutulardan
    const rects: { originX: number; originY: number; width: number; height: number }[] = [];
    if (mode === 'grid') {
      const fW = (frame.r - frame.l) * photo.width;
      const fH = (frame.b - frame.t) * photo.height;
      const bx = [0, ...xs, 1];
      const by = [0, ...ys, 1];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (off.has(`${r}-${c}`)) continue;
          rects.push({
            originX: frame.l * photo.width + bx[c] * fW,
            originY: frame.t * photo.height + by[r] * fH,
            width: (bx[c + 1] - bx[c]) * fW,
            height: (by[r + 1] - by[r]) * fH,
          });
        }
      }
    } else {
      // Numaralar okuma sırasına göre: satır satır, soldan sağa
      for (const b of sortReading(boxes)) {
        rects.push({ originX: b.x * photo.width, originY: b.y * photo.height, width: b.w * photo.width, height: b.h * photo.height });
      }
    }
    const cells = rects.map(r => {
      const originX = clamp(Math.round(r.originX), 0, photo.width - 2);
      const originY = clamp(Math.round(r.originY), 0, photo.height - 2);
      return {
        originX,
        originY,
        width: Math.max(2, Math.min(Math.round(r.width), photo.width - originX)),
        height: Math.max(2, Math.min(Math.round(r.height), photo.height - originY)),
      };
    });
    setProgress({ done: 0, total: cells.length });

    try {
      // Aynı adla daha önce eklenmiş parçalar varsa numaralandırma kaldığı yerden sürer
      const existing = await db.getAllAsync<{ title: string }>(
        'SELECT title FROM items WHERE collection_id = ? AND title LIKE ?', collectionId, `${base} #%`
      );
      const re = new RegExp(`^${escapeRe(base)} #(\\d+)$`);
      let num = existing.reduce((m, e) => Math.max(m, Number(re.exec(e.title)?.[1] ?? 0)), 0);

      const maxOrder = await db.getFirstAsync<{ m: number | null }>(
        'SELECT MAX(sort_order) AS m FROM items WHERE collection_id = ?', collectionId
      );
      let order = (maxOrder?.m ?? -1) + 1;

      for (const [i, cell] of cells.entries()) {
        const { originX, originY, width, height } = cell;

        const ctx = ImageManipulator.manipulate(photo.uri);
        ctx.crop({ originX, originY, width, height });
        if (Math.max(width, height) > MAX_ITEM) {
          if (width >= height) ctx.resize({ width: MAX_ITEM });
          else ctx.resize({ height: MAX_ITEM });
        }
        const img = await ctx.renderAsync();
        const out = await img.saveAsync({ format: SaveFormat.JPEG, compress: 0.85 });
        const refs = [persistPhoto(out.uri)];
        // İstenirse toplu fotoğraf da her parçaya ikinci fotoğraf olarak eklenir (her biri ayrı kopya)
        if (attachGroup) refs.push(persistPhoto(photo.uri));

        num += 1;
        await db.withTransactionAsync(async () => {
          const res = await db.runAsync(
            'INSERT INTO items (collection_id, title, status, sort_order) VALUES (?, ?, ?, ?)',
            collectionId, `${base} #${num}`, status, order++
          );
          for (const [k, ref] of refs.entries()) {
            await db.runAsync(
              'INSERT INTO item_photos (item_id, uri, sort_order) VALUES (?, ?, ?)', res.lastInsertRowId, ref, k
            );
          }
        });
        setProgress({ done: i + 1, total: cells.length });
      }

      setProgress(null);
      Alert.alert(t('batch.doneTitle'), t('batch.done', { n: cells.length }), [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (e) {
      setProgress(null);
      Alert.alert(t('err.saveFailed'), String(e));
    }
  }

  // --- Ekran ---

  if (!photo) {
    return (
      <View style={s.container}>
        <Stack.Screen options={{ title: t('batch.title') }} />
        <View style={s.intro}>
          <Ionicons name="grid-outline" size={44} color={C.black} />
          <Text style={s.introTitle}>{t('batch.introTitle')}</Text>
          <Text style={s.introText}>{t('batch.introText')}</Text>
          <PrimaryButton label={t('batch.camera')} onPress={() => pick('camera')} style={{ marginTop: 28, alignSelf: 'stretch' }} />
          <SecondaryButton label={t('batch.library')} onPress={() => pick('library')} style={{ marginTop: 10, alignSelf: 'stretch' }} />
        </View>
      </View>
    );
  }

  const fx = frame.l * disp.w;
  const fy = frame.t * disp.h;
  const fw = (frame.r - frame.l) * disp.w;
  const fh = (frame.b - frame.t) * disp.h;

  return (
    <View style={s.container}>
      <Stack.Screen options={{ title: t('batch.title') }} />
      <ScrollView contentContainerStyle={{ padding: PAD, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
        <View style={{ marginBottom: 14 }}>
          <Segmented
            options={[{ key: 'grid', label: t('batch.modeGrid') }, { key: 'auto', label: t('batch.modeAuto') }]}
            value={mode}
            onChange={chooseMode}
          />
        </View>
        <View style={{ width: disp.w, height: disp.h, alignSelf: 'center' }}>
          <Image source={{ uri: photo.uri }} style={{ width: disp.w, height: disp.h }} />
          {mode === 'auto' && (
            <>
              {/* Boş alana dokununca seçim kalkar */}
              <Pressable style={StyleSheet.absoluteFill} onPress={() => setSelected(null)} />
              {boxes.map((b, i) => (
                <AutoBox
                  key={i}
                  box={b}
                  index={sortReading(boxes).indexOf(b) + 1}
                  disp={disp}
                  selected={selected === i}
                  onSelect={() => setSelected(selected === i ? null : i)}
                  onChange={nb => setBoxes(prev => prev.map((x, k) => (k === i ? nb : x)))}
                  onDelete={() => {
                    setBoxes(prev => prev.filter((_, k) => k !== i));
                    setSelected(null);
                  }}
                />
              ))}
              {detecting && (
                <View style={[StyleSheet.absoluteFill, s.detecting]}>
                  <ActivityIndicator color="#FFFFFF" />
                  <Text style={s.detectingText}>{t('batch.detecting')}</Text>
                </View>
              )}
            </>
          )}
          {mode === 'grid' && detecting && (
            <View style={[StyleSheet.absoluteFill, s.detecting]}>
              <ActivityIndicator color="#FFFFFF" />
              <Text style={s.detectingText}>{t('batch.detecting')}</Text>
            </View>
          )}
          {mode === 'grid' && !detecting && (<>
          <View style={[s.frame, { left: fx, top: fy, width: fw, height: fh }]}>
            {[0, ...ys].map((y0, r) =>
              [0, ...xs].map((x0, c) => {
                const x1 = c < xs.length ? xs[c] : 1;
                const y1 = r < ys.length ? ys[r] : 1;
                const key = `${r}-${c}`;
                const isOff = off.has(key);
                return (
                  <Pressable
                    key={key}
                    onPress={() => toggleCell(key)}
                    style={[
                      s.cell,
                      { left: x0 * fw, top: y0 * fh, width: (x1 - x0) * fw, height: (y1 - y0) * fh },
                      isOff && s.cellOff,
                    ]}
                  >
                    {isOff ? <Ionicons name="close" size={18} color="#FFFFFF" /> : null}
                  </Pressable>
                );
              })
            )}
            {xs.map((x, i) => (
              <Divider
                key={`x${i}`}
                vertical
                pos={x * fw}
                length={fh}
                onMove={dpx =>
                  setXs(prev => {
                    const lo = (i === 0 ? 0 : prev[i - 1]) + MIN_CELL;
                    const hi = (i === prev.length - 1 ? 1 : prev[i + 1]) - MIN_CELL;
                    const next = [...prev];
                    next[i] = clamp(dragStart.current + dpx / fw, lo, hi);
                    return next;
                  })
                }
                onStart={() => { dragStart.current = xs[i]; }}
              />
            ))}
            {ys.map((y, i) => (
              <Divider
                key={`y${i}`}
                pos={y * fh}
                length={fw}
                onMove={dpx =>
                  setYs(prev => {
                    const lo = (i === 0 ? 0 : prev[i - 1]) + MIN_CELL;
                    const hi = (i === prev.length - 1 ? 1 : prev[i + 1]) - MIN_CELL;
                    const next = [...prev];
                    next[i] = clamp(dragStart.current + dpx / fh, lo, hi);
                    return next;
                  })
                }
                onStart={() => { dragStart.current = ys[i]; }}
              />
            ))}
          </View>
          {handles.map(h => {
            const left = (h.corner === 'tl' || h.corner === 'bl' ? fx : fx + fw) - HANDLE / 2;
            const top = (h.corner === 'tl' || h.corner === 'tr' ? fy : fy + fh) - HANDLE / 2;
            return <View key={h.corner} {...h.responder.panHandlers} style={[s.handle, { left, top }]} />;
          })}
          </>)}
        </View>

        {mode === 'grid' ? (
          <>
            <Text style={s.hint}>{t('batch.gridHint')}</Text>
            <View style={s.steppers}>
              <Stepper label={t('batch.rows')} value={rows} onChange={changeRows} />
              <Stepper label={t('batch.cols')} value={cols} onChange={changeCols} />
            </View>
          </>
        ) : (
          <>
            <Text style={s.hint}>
              {detecting
                ? ''
                : foundGrid
                  ? t('batch.autoGridFound', { n: boxes.length, rows: foundGrid.rows, cols: foundGrid.cols })
                  : t('batch.autoFound', { n: boxes.length })}{' '}
              {t('batch.autoHint')}
            </Text>
            <View style={s.autoActions}>
              <SecondaryButton label={t('batch.addBox')} onPress={addBox} style={{ flex: 1 }} />
              <SecondaryButton label={t('batch.redetect')} onPress={runDetect} style={{ flex: 1 }} />
            </View>
          </>
        )}

        <FieldLabel>{t('batch.name')}</FieldLabel>
        <TextInput
          style={s.input}
          value={name}
          onChangeText={setName}
          placeholder={t('batch.namePh')}
          placeholderTextColor={C.grey}
        />
        <Text style={s.hint}>{t('batch.nameHint', { name: name.trim() || '…' })}</Text>

        <FieldLabel>{t('form.status')}</FieldLabel>
        <Segmented
          options={STATUS_KEYS.slice(0, 3).map(k => ({ key: k, label: t(`status.${k}` as 'status.owned') }))}
          value={status}
          onChange={setStatus}
        />

        <View style={s.switchRow}>
          <Text style={s.switchLabel}>{t('batch.attachGroup')}</Text>
          <Switch value={attachGroup} onValueChange={setAttachGroup} trackColor={{ true: C.black, false: C.line }} />
        </View>

        <PrimaryButton
          label={t('batch.add', { n: count })}
          onPress={save}
          disabled={count === 0 || !!progress}
          style={{ marginTop: 28 }}
        />
        <SecondaryButton label={t('batch.another')} onPress={() => pick('library')} style={{ marginTop: 10 }} />
      </ScrollView>

      {progress && (
        <View style={[StyleSheet.absoluteFill, s.busy]}>
          <ActivityIndicator color="#FFFFFF" size="large" />
          <Text style={s.busyText}>{t('batch.progress', { done: progress.done, total: progress.total })}</Text>
        </View>
      )}
    </View>
  );
}

// Algılanan bir kutu: dokununca seçilir; seçiliyken gövdesinden taşınır,
// köşelerinden boyutlandırılır, sağ üstteki ✕ ile silinir
function AutoBox({ box, index, disp, selected, onSelect, onChange, onDelete }: {
  box: Box;
  index: number;
  disp: { w: number; h: number };
  selected: boolean;
  onSelect: () => void;
  onChange: (b: Box) => void;
  onDelete: () => void;
}) {
  const s = useStyles(makeStyles);
  const cb = useRef({ box, disp, selected, onSelect, onChange });
  cb.current = { box, disp, selected, onSelect, onChange };

  const make = (kind: 'move' | 'tl' | 'br') => {
    let start = box;
    let moved = false;
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => { start = cb.current.box; moved = false; },
      onPanResponderMove: (_, g) => {
        if (Math.abs(g.dx) + Math.abs(g.dy) > 4) moved = true;
        // Seçili değilken gövde sürüklenmez (yanlışlıkla kaydırmayı önler)
        if (kind === 'move' && !cb.current.selected) return;
        const dx = g.dx / cb.current.disp.w, dy = g.dy / cb.current.disp.h;
        const MIN = 0.03;
        if (kind === 'move') {
          cb.current.onChange({ ...start, x: clamp(start.x + dx, 0, 1 - start.w), y: clamp(start.y + dy, 0, 1 - start.h) });
        } else if (kind === 'br') {
          cb.current.onChange({ ...start, w: clamp(start.w + dx, MIN, 1 - start.x), h: clamp(start.h + dy, MIN, 1 - start.y) });
        } else {
          const x = clamp(start.x + dx, 0, start.x + start.w - MIN);
          const y = clamp(start.y + dy, 0, start.y + start.h - MIN);
          cb.current.onChange({ x, y, w: start.x + start.w - x, h: start.y + start.h - y });
        }
      },
      onPanResponderRelease: () => {
        if (kind === 'move' && !moved) cb.current.onSelect();
      },
    });
  };
  const move = useRef(make('move')).current;
  const tl = useRef(make('tl')).current;
  const br = useRef(make('br')).current;

  const left = box.x * disp.w, top = box.y * disp.h, w = box.w * disp.w, h = box.h * disp.h;
  return (
    <>
      <View
        {...move.panHandlers}
        style={[s.autoBox, selected && s.autoBoxOn, { left, top, width: w, height: h }]}
      >
        <View style={[s.autoNum, selected && s.autoNumOn]}>
          <Text style={s.autoNumText}>{index}</Text>
        </View>
      </View>
      {selected && (
        <>
          <View {...tl.panHandlers} style={[s.handle, { left: left - HANDLE / 2, top: top - HANDLE / 2 }]} />
          <View {...br.panHandlers} style={[s.handle, { left: left + w - HANDLE / 2, top: top + h - HANDLE / 2 }]} />
          <Pressable onPress={onDelete} hitSlop={8} style={[s.autoDelete, { left: left + w - 14, top: top - 14 }]}>
            <Ionicons name="close" size={16} color="#FFFFFF" />
          </Pressable>
        </>
      )}
    </>
  );
}

// Sürüklenebilir ara çizgi: çizginin tamamı geniş, görünmez bir dokunma alanı; ortasında tutamaç
function Divider({ vertical, pos, length, onStart, onMove }: {
  vertical?: boolean;
  pos: number;
  length: number;
  onStart: () => void;
  onMove: (deltaPx: number) => void;
}) {
  const s = useStyles(makeStyles);
  const cb = useRef({ onStart, onMove });
  cb.current = { onStart, onMove };
  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => cb.current.onStart(),
      onPanResponderMove: (_, g) => cb.current.onMove(vertical ? g.dx : g.dy),
    })
  ).current;
  const T = 26; // dokunma alanı kalınlığı
  return (
    <View
      {...responder.panHandlers}
      style={[
        s.divider,
        vertical
          ? { left: pos - T / 2, top: 0, width: T, height: length }
          : { top: pos - T / 2, left: 0, height: T, width: length },
      ]}
    >
      <View style={vertical ? [s.dividerLine, { width: 2, height: '100%' }] : [s.dividerLine, { height: 2, width: '100%' }]} />
      <View style={[s.dividerKnob, vertical ? s.knobV : s.knobH]} />
    </View>
  );
}

function Stepper({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  const { C } = useTheme();
  const s = useStyles(makeStyles);
  return (
    <View style={s.stepper}>
      <Text style={s.stepLabel}>{label}</Text>
      <View style={s.stepRow}>
        <Pressable hitSlop={6} onPress={() => onChange(Math.max(1, value - 1))} style={s.stepBtn}>
          <Ionicons name="remove" size={18} color={C.black} />
        </Pressable>
        <Text style={s.stepValue}>{value}</Text>
        <Pressable hitSlop={6} onPress={() => onChange(Math.min(MAX_GRID, value + 1))} style={s.stepBtn}>
          <Ionicons name="add" size={18} color={C.black} />
        </Pressable>
      </View>
    </View>
  );
}

const makeStyles = (C: Palette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: C.white },
  intro: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  introTitle: { fontFamily: F.black, fontSize: 24, color: C.black, letterSpacing: -0.6, marginTop: 16, textAlign: 'center' },
  introText: { fontFamily: F.regular, fontSize: 15, color: C.grey, marginTop: 8, textAlign: 'center', lineHeight: 21 },
  frame: { position: 'absolute', borderWidth: 2, borderColor: '#FFFFFF' },
  cell: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  autoBox: { position: 'absolute', borderWidth: 2, borderColor: '#FFFFFF', backgroundColor: 'rgba(46,59,255,0.08)' },
  autoBoxOn: { borderColor: C.accent, borderWidth: 3, backgroundColor: 'rgba(46,59,255,0.18)' },
  autoNum: { position: 'absolute', left: 0, top: 0, backgroundColor: 'rgba(0,0,0,0.7)', paddingHorizontal: 5, paddingVertical: 2 },
  autoNumOn: { backgroundColor: C.accent },
  autoNumText: { fontFamily: F.bold, fontSize: 11, color: '#FFFFFF' },
  autoDelete: {
    position: 'absolute',
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#D93025',
    alignItems: 'center',
    justifyContent: 'center',
  },
  autoActions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  detecting: { backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
  detectingText: { fontFamily: F.bold, fontSize: 14, color: '#FFFFFF', marginTop: 10 },
  divider: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  dividerLine: { backgroundColor: 'rgba(255,255,255,0.95)' },
  dividerKnob: {
    position: 'absolute',
    backgroundColor: '#FFFFFF',
    borderWidth: 2.5,
    borderColor: C.accent,
    borderRadius: 6,
  },
  knobV: { width: 12, height: 30 },
  knobH: { width: 30, height: 12 },
  cellOff: { backgroundColor: 'rgba(0,0,0,0.6)' },
  handle: {
    position: 'absolute',
    width: HANDLE,
    height: HANDLE,
    borderRadius: HANDLE / 2,
    backgroundColor: '#FFFFFF',
    borderWidth: 3,
    borderColor: C.accent,
  },
  hint: { fontFamily: F.regular, fontSize: 13, color: C.grey, marginTop: 10, lineHeight: 18 },
  steppers: { flexDirection: 'row', gap: 24, marginTop: 18 },
  stepper: { flex: 1 },
  stepLabel: { fontFamily: F.bold, fontSize: 13, color: C.black, marginBottom: 8 },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  stepBtn: {
    width: 34,
    height: 34,
    borderWidth: 1.5,
    borderColor: C.black,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepValue: { fontFamily: F.black, fontSize: 20, color: C.black, minWidth: 24, textAlign: 'center' },
  input: {
    borderBottomWidth: 1,
    borderBottomColor: C.black,
    paddingVertical: 10,
    fontFamily: F.semi,
    fontSize: 17,
    color: C.black,
  },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginTop: 22 },
  switchLabel: { fontFamily: F.medium, fontSize: 15, color: C.black, flex: 1 },
  busy: { backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
  busyText: { fontFamily: F.bold, fontSize: 15, color: '#FFFFFF', marginTop: 14 },
});
