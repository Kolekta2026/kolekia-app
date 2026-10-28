import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Image, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSQLiteContext } from 'expo-sqlite';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { F, STATUS_KEYS } from '../constants/theme';
import { Palette, useStyles, useTheme } from '../lib/theme';
import type { FieldType } from '../constants/templates';
import { Chips, FieldLabel, PrimaryButton } from './ui';
import { deletePhoto, persistPhoto, photoUri } from '../lib/photos';
import { CURRENCIES, Currency, TFunction, useI18n } from '../lib/i18n';
import { formatDate, moneyToInput, parseMoney } from '../lib/money';
import { addDays, addMonths, dayInputPlaceholder, dayToInput, inputToDay, today } from '../lib/dates';
import { ensurePermission, getNotifPrefs, syncNotifications } from '../lib/notifications';
import { useMenu } from '../lib/menu';
import { onLensJson, onLensText, takePendingJson } from '../lib/lensBridge';
import {
  coerce, findKey, isMetaKey, KEY_CURRENCY, KEY_STORY, KEY_TITLE, KEY_VALUE, meaningfulTitle, norm,
} from '../lib/aiFill';
import { addFieldToTemplate } from '../lib/templateExtras';
import { learnPairs, splitPair, type Pair } from '../lib/fieldI18n';
import { PhotoEditor } from './PhotoEditor';
import { aiAvailable, aiDailyLimit, aiRemaining, countAiUse, hasAiConsent, identifyItem, refreshAiLimit, setAiConsent } from '../lib/gemini';
import { ActivityIndicator } from 'react-native';

type FieldDef = { id: number; name: string; type: FieldType; options: string | null; name_tr?: string | null; name_en?: string | null };

// ref: veritabanındaki kayıtlı yol (yeni seçilenlerde null), uri: ekranda gösterilecek adres
type PhotoEntry = { key: string; ref: string | null; uri: string };
type VideoEntry = { ref: string | null; uri: string; duration: number | null };

const MAX_PHOTOS = 10;
const MAX_VIDEO_SEC = 60; // parça başına bir video, en fazla bir dakika

let keySeq = 0;
const nextKey = () => `p${++keySeq}`;

export function ItemForm({ collectionId, itemId, autoAi, askPhoto }: {
  collectionId?: number; itemId?: number; autoAi?: boolean;
  askPhoto?: boolean; // yeni parçada ekran açılır açılmaz kamera / galeri seçeneği sorulur
}) {
  const { C } = useTheme();
  const s = useStyles(makeStyles);
  const db = useSQLiteContext();
  const { t, lang, currency } = useI18n();
  const menu = useMenu();
  const isEdit = itemId !== undefined;

  const [cid, setCid] = useState<number | undefined>(collectionId);
  const [fields, setFields] = useState<FieldDef[]>([]);
  const [values, setValues] = useState<Record<number, string>>({});
  const [title, setTitle] = useState('');
  // Ad önerileri: daha önce girilmiş parça adları (önce bu koleksiyondakiler)
  const [knownTitles, setKnownTitles] = useState<{ title: string; cid: number }[]>([]);
  const [titleFocused, setTitleFocused] = useState(false);
  const [status, setStatus] = useState('owned');
  const [photos, setPhotos] = useState<PhotoEntry[]>([]);
  // Kırpma / döndürme ekranında açık olan fotoğrafın sırası
  const [editIndex, setEditIndex] = useState<number | null>(null);
  const [video, setVideo] = useState<VideoEntry | null>(null);
  const originalVideo = useRef<string | null>(null);
  const [story, setStory] = useState('');

  // Google Lens'ten kopyalanan metin hikâyenin sonuna eklenir
  useEffect(
    () =>
      onLensText(text =>
        setStory(prev => (prev.trim() ? `${prev.trimEnd()}\n\n${text}` : text))
      ),
    []
  );
  // Satıldı / Ödünç verildi bilgileri (tarihler kutuya yazıldığı hâliyle tutulur)
  const [soldPrice, setSoldPrice] = useState('');
  const [soldCur, setSoldCur] = useState<Currency>(currency);
  const [soldAt, setSoldAt] = useState('');
  const [loanedTo, setLoanedTo] = useState('');
  const [loanedAt, setLoanedAt] = useState('');
  const [loanDue, setLoanDue] = useState('');
  const [purchase, setPurchase] = useState('');
  const [estimated, setEstimated] = useState('');
  const [purchaseCur, setPurchaseCur] = useState<Currency>(currency);
  const [estimatedCur, setEstimatedCur] = useState<Currency>(currency);
  const original = useRef<{ estimated: number | null; estimatedCur: string | null; valuedAt: string | null }>({ estimated: null, estimatedCur: null, valuedAt: null });
  const [saving, setSaving] = useState(false);
  // Kaydet düğmesi form boyunca altta yüzer; sayfanın sonuna gelince asıl düğme görünür ve yüzen kaybolur
  const insets = useSafeAreaInsets();
  const [atEnd, setAtEnd] = useState(true);
  const scrollBox = useRef({ y: 0, h: 0, content: 0 });
  const updateAtEnd = () => {
    const b = scrollBox.current;
    setAtEnd(b.y + b.h >= b.content - 150);
  };
  const originalRefs = useRef<string[]>([]);
  // Dolu alanlar üstte gösterilir; sıra yazarken zıplamasın diye yükleme/doldurma anında sabitlenir
  const [filledSnap, setFilledSnap] = useState<Set<number> | null>(null);
  const [showEmpty, setShowEmpty] = useState(false);
  const [ready, setReady] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  // Bekleme aşaması: 0 gönderiliyor, 1 tanınıyor, 2 Google yoğun
  const [aiStage, setAiStage] = useState(0);
  const [aiLeft, setAiLeft] = useState<number | null>(null);
  useEffect(() => {
    if (!aiAvailable) return;
    // Önce bilinen değer gösterilir, sonra sunucudaki güncel hak sayısıyla yenilenir
    aiRemaining(db).then(setAiLeft).catch(() => {});
    refreshAiLimit(db).then(() => aiRemaining(db)).then(setAiLeft).catch(() => {});
  }, [db]);

  useEffect(() => {
    (async () => {
      let resolved = collectionId;
      let loaded: Record<number, string> = {};
      if (isEdit) {
        const item = await db.getFirstAsync<{
          collection_id: number; title: string; status: string; story: string | null;
          purchase_price: number | null; estimated_value: number | null; valued_at: string | null;
          purchase_currency: string | null; estimated_currency: string | null;
          sold_price: number | null; sold_currency: string | null; sold_at: string | null;
          loaned_to: string | null; loaned_at: string | null; loan_due: string | null;
        }>(
          `SELECT collection_id, title, status, story, purchase_price, estimated_value, valued_at,
                  purchase_currency, estimated_currency,
                  sold_price, sold_currency, sold_at, loaned_to, loaned_at, loan_due
             FROM items WHERE id = ?`,
          itemId
        );
        if (!item) return;
        resolved = item.collection_id;
        setTitle(item.title);
        setStatus(item.status);
        setStory(item.story ?? '');
        setPurchase(moneyToInput(item.purchase_price, lang));
        setEstimated(moneyToInput(item.estimated_value, lang));
        if (item.purchase_currency) setPurchaseCur(item.purchase_currency as Currency);
        if (item.estimated_currency) setEstimatedCur(item.estimated_currency as Currency);
        setSoldPrice(moneyToInput(item.sold_price, lang));
        if (item.sold_currency) setSoldCur(item.sold_currency as Currency);
        setSoldAt(dayToInput(item.sold_at, lang));
        setLoanedTo(item.loaned_to ?? '');
        setLoanedAt(dayToInput(item.loaned_at, lang));
        setLoanDue(dayToInput(item.loan_due, lang));
        original.current = {
          estimated: item.estimated_value,
          estimatedCur: item.estimated_currency,
          valuedAt: item.valued_at,
        };

        const vals = await db.getAllAsync<{ field_id: number; value: string }>(
          'SELECT field_id, value FROM item_values WHERE item_id = ?', itemId
        );
        loaded = Object.fromEntries(vals.map(v => [v.field_id, v.value]));
        setValues(loaded);

        const ph = await db.getAllAsync<{ uri: string }>(
          'SELECT uri FROM item_photos WHERE item_id = ? ORDER BY sort_order', itemId
        );
        originalRefs.current = ph.map(p => p.uri);
        const vid = await db.getFirstAsync<{ uri: string; duration: number | null }>(
          'SELECT uri, duration FROM item_videos WHERE item_id = ? ORDER BY id LIMIT 1', itemId
        );
        if (vid) {
          originalVideo.current = vid.uri;
          setVideo({ ref: vid.uri, uri: photoUri(vid.uri)!, duration: vid.duration });
        }
        setPhotos(ph.map(p => ({ key: nextKey(), ref: p.uri, uri: photoUri(p.uri)! })));
      }
      setCid(resolved);
      const defs = await db.getAllAsync<FieldDef>(
        'SELECT id, name, type, options, name_tr, name_en FROM field_defs WHERE collection_id = ? ORDER BY sort_order',
        resolved!
      );
      setFields(defs);
      setFilledSnap(new Set(defs.filter(d => loaded[d.id]?.trim() && loaded[d.id] !== '0').map(d => d.id)));
      setReady(true);
    })();
  }, [db, collectionId, itemId, isEdit]);

  // Satıldı / Ödünç seçilince tarih kutuları bugünle başlar
  function changeStatus(k: string) {
    setStatus(k);
    if (k === 'sold' && !soldAt) setSoldAt(dayToInput(today(), lang));
    if (k === 'loaned' && !loanedAt) setLoanedAt(dayToInput(today(), lang));
  }

  // Dönüş tarihi kısayolları: verildiği günden itibaren
  function setDueIn(kind: 'none' | '1w' | '2w' | '1m' | '3m') {
    if (kind === 'none') return setLoanDue('');
    const from = inputToDay(loanedAt, lang) ?? today();
    const day = kind === '1w' ? addDays(from, 7) : kind === '2w' ? addDays(from, 14)
      : kind === '1m' ? addMonths(from, 1) : addMonths(from, 3);
    setLoanDue(dayToInput(day, lang));
  }

  useEffect(() => {
    db.getAllAsync<{ title: string; cid: number }>(
      `SELECT title, MAX(collection_id) AS cid FROM items
        WHERE deleted_at IS NULL AND (? IS NULL OR id <> ?)
        GROUP BY title ORDER BY MAX(created_at) DESC LIMIT 3000`,
      itemId ?? null, itemId ?? null
    ).then(setKnownTitles).catch(() => {});
  }, [db, itemId]);

  const suggestions = useMemo(() => {
    const q = norm(title);
    if (q.length < 2) return [];
    const seen = new Set<string>();
    return knownTitles
      .filter(k => {
        const n = norm(k.title);
        if (n === q || !n.includes(q) || seen.has(n)) return false;
        seen.add(n);
        return true;
      })
      .map(k => ({ ...k, score: (k.cid === cid ? 0 : 2) + (norm(k.title).startsWith(q) ? 0 : 1) }))
      .sort((a, b) => a.score - b.score)
      .slice(0, 5);
  }, [title, knownTitles, cid]);

  const setValue = (fieldId: number, v: string) => setValues(prev => ({ ...prev, [fieldId]: v }));

  // --- Gemini JSON ile doldurma ---
  // Şablonda olan alanlar doğrudan doldurulur (kullanıcının yazdıkları korunur),
  // olmayan anahtarlar bu koleksiyona ve şablona yeni alan olarak eklenir.
  const applyRef = useRef<(d: Record<string, string>) => Promise<void> | void>(() => {});
  useEffect(() => onLensJson(d => applyRef.current(d)), []);
  // Parça detayından Lens'e gidilip JSON kopyalandıysa: alanlar yüklenince uygulanır
  useEffect(() => {
    if (!ready) return;
    const d = takePendingJson();
    if (d) applyRef.current(d);
  }, [ready]);

  applyRef.current = async (data: Record<string, string>) => {
    if (!cid) return;
    try {
      const next = { ...values };
      // Alan hem görünen adıyla hem diğer dildeki karşılığıyla eşleşir
      const byName = new Map<string, FieldDef>();
      for (const f of fields) {
        for (const n of [f.name, f.name_tr, f.name_en]) if (n && !byName.has(norm(n))) byName.set(norm(n), f);
      }
      const fresh: [string, string][] = [];
      let filled = 0;

      for (const [k, v] of Object.entries(data)) {
        if (isMetaKey(k)) continue;
        // Yeni alanlar "Türkçe ad | English name" biçiminde gelir
        const pair = splitPair(k);
        const f = byName.get(norm(k)) ?? byName.get(norm(pair.tr)) ?? byName.get(norm(pair.en));
        if (!f) {
          fresh.push([k, v]);
          continue;
        }
        if (next[f.id]?.trim() && next[f.id] !== '0') continue;
        const c = coerce(f.type, f.options, v);
        if (c) {
          next[f.id] = c;
          filled++;
        }
      }

      const added: FieldDef[] = [];
      if (fresh.length) {
        const col = await db.getFirstAsync<{ template: string }>('SELECT template FROM collections WHERE id = ?', cid);
        const pairs: Pair[] = [];
        const tidy = (x: string, l: 'tr' | 'en') => {
          const raw = x.trim().replace(/[_]+/g, ' ').slice(0, 40);
          return raw.charAt(0).toLocaleUpperCase(l) + raw.slice(1);
        };
        for (const [k, v] of fresh) {
          const p = splitPair(k);
          const nameTr = tidy(p.tr, 'tr');
          const nameEn = tidy(p.en, 'en');
          const name = lang === 'tr' ? nameTr : nameEn;
          if (added.some(a => norm(a.name) === norm(name))) continue;
          const res = await db.runAsync(
            `INSERT INTO field_defs (collection_id, name, name_tr, name_en, type, options, sort_order)
             VALUES (?, ?, ?, ?, 'text', NULL, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM field_defs WHERE collection_id = ?))`,
            cid, name, nameTr, nameEn, cid
          );
          pairs.push({ tr: nameTr, en: nameEn });
          const def: FieldDef = { id: res.lastInsertRowId, name, type: 'text', options: null, name_tr: nameTr, name_en: nameEn };
          added.push(def);
          next[def.id] = v;
          if (col) await addFieldToTemplate(db, col.template, { name, type: 'text' });
        }
        await learnPairs(db, pairs);
      }

      // Parça adı: "Parça adı" anahtarı, yoksa alan sırasına göre ilk anlamlı değer
      let titleSet = false;
      if (!title.trim()) {
        const tk = findKey(data, KEY_TITLE);
        const ordered: [string, string][] = [...fields, ...added]
          .filter(f => f.type === 'text' && next[f.id]?.trim())
          .map(f => [f.name, next[f.id]]);
        const tt = (tk && data[tk]) || meaningfulTitle(ordered);
        if (tt) {
          setTitle(tt.slice(0, 80));
          titleSet = true;
        }
      }

      // Tahmini değer ve para birimi (boşsa)
      const vk = findKey(data, KEY_VALUE);
      if (vk && !estimated.trim()) {
        const raw = data[vk];
        const m = raw.replace(/\s/g, '').match(/\d[\d.,]*/);
        if (m) {
          let n = m[0];
          n = /^\d{1,3}([.,]\d{3})+$/.test(n) ? n.replace(/[.,]/g, '') : n.replace(/\.(?=.*[.,])/g, '').replace(',', '.');
          const num = Number(n);
          if (isFinite(num) && num > 0) setEstimated(moneyToInput(num, lang));
        }
        const ck = findKey(data, KEY_CURRENCY);
        const curSrc = `${ck ? data[ck] : ''} ${raw}`.toUpperCase();
        const cur =
          /\bTRY\b|\bTL\b|₺/.test(curSrc) ? 'TRY'
          : /\bEUR\b|€/.test(curSrc) ? 'EUR'
          : /\bGBP\b|£/.test(curSrc) ? 'GBP'
          : /\bUSD\b|\$/.test(curSrc) ? 'USD'
          : null;
        if (cur && (CURRENCIES as readonly string[]).includes(cur)) setEstimatedCur(cur as Currency);
      }

      const sk = findKey(data, KEY_STORY);
      if (sk) setStory(prev => (prev.trim() ? `${prev.trimEnd()}\n\n${data[sk]}` : data[sk]));

      const all = [...fields, ...added];
      if (added.length) setFields(all);
      setValues(next);
      setFilledSnap(new Set(all.filter(f => next[f.id]?.trim() && next[f.id] !== '0').map(f => f.id)));
      setShowEmpty(false);

      const nothing = filled + added.length + (titleSet ? 1 : 0) === 0;
      // Form uzun olduğu için kaydet düğmesi aşağıda kalıyor: doğrudan buradan kaydedilebilir
      Alert.alert(
        t('ai.doneTitle'),
        nothing ? t('ai.nothing') : t('ai.done', { filled: filled + (titleSet ? 1 : 0), added: added.length }),
        nothing
          ? [{ text: t('common.close') }]
          : [
              { text: t('ai.review'), style: 'cancel' },
              // Düğmeye basıldığında form yeni değerlerle yeniden çizilmiş olur; güncel save çağrılır
              { text: t('ai.saveNow'), onPress: () => saveRef.current() },
            ]
      );
    } catch (e) {
      Alert.alert(t('ai.doneTitle'), String(e));
    }
  };

  // --- Fotoğraflar ---

  async function pick(source: 'camera' | 'library') {
    // Parça başına en fazla 10 fotoğraf (video ayrıca)
    if (photos.length >= MAX_PHOTOS) {
      Alert.alert(t('form.photoLimitTitle'), t('form.photoLimit', { n: MAX_PHOTOS }));
      return;
    }
    if (source === 'camera') {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(t('err.cameraTitle'), t('err.camera'));
        return;
      }
      const res = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 });
      if (!res.canceled) {
        // Çekilen fotoğraf hemen düzenleme ekranında açılır (istenirse doğrudan "Bitti")
        setPhotos(prev => {
          setEditIndex(prev.length);
          return [...prev, { key: nextKey(), ref: null, uri: res.assets[0].uri }];
        });
      }
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      orderedSelection: true,
      selectionLimit: MAX_PHOTOS - photos.length,
      quality: 0.8,
    });
    if (!res.canceled) {
      const added = res.assets.map(a => ({ key: nextKey(), ref: null, uri: a.uri }));
      setPhotos(prev => {
        // Tek fotoğraf seçildiyse düzenleme ekranı açılır; çoklu seçimde her biri sonradan düzenlenebilir
        if (added.length === 1) setEditIndex(prev.length);
        return [...prev, ...added];
      });
    }
  }

  // --- Video (parça başına bir tane) ---
  async function pickVideo(source: 'camera' | 'library') {
    const opts: ImagePicker.ImagePickerOptions = {
      mediaTypes: ['videos'],
      videoMaxDuration: MAX_VIDEO_SEC,
      allowsEditing: true, // iOS'ta kırpma (baş / son) ekranı açılır
      videoQuality: ImagePicker.UIImagePickerControllerQualityType.Medium,
    };
    if (source === 'camera') {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(t('err.cameraTitle'), t('err.camera'));
        return;
      }
    }
    const res = source === 'camera'
      ? await ImagePicker.launchCameraAsync(opts)
      : await ImagePicker.launchImageLibraryAsync(opts);
    if (res.canceled) return;
    const a = res.assets[0];
    const sec = a.duration ? a.duration / 1000 : null;
    if (sec !== null && sec > MAX_VIDEO_SEC + 1) {
      Alert.alert(t('video.tooLongTitle'), t('video.tooLong', { n: MAX_VIDEO_SEC }));
      return;
    }
    setVideo({ ref: null, uri: a.uri, duration: sec });
  }

  function videoMenu() {
    menu(t('video.title'), video ? undefined : t('video.hint', { n: MAX_VIDEO_SEC }), [
      { text: t('video.record'), onPress: () => pickVideo('camera') },
      { text: t('video.library'), onPress: () => pickVideo('library') },
      ...(video ? [{ text: t('video.remove'), style: 'destructive' as const, onPress: () => setVideo(null) }] : []),
      { text: t('common.cancel'), style: 'cancel' as const },
    ]);
  }

  // Kapak fotoğrafını Gemini'ye gönderip alanları doldurur
  async function runAi(askedConsent = false) {
    if (!aiAvailable || aiBusy || !cid) return;
    const cover = photos[0];
    if (!cover) {
      Alert.alert(t('ai.title'), t('ai.noPhoto'));
      return;
    }
    const left = await aiRemaining(db);
    setAiLeft(left);
    if (left <= 0) {
      Alert.alert(t('ai.title'), t('ai.limit', { n: await aiDailyLimit(db) }));
      return;
    }
    if (!askedConsent && !(await hasAiConsent(db))) {
      Alert.alert(t('ai.consentTitle'), t('ai.consentMsg'), [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('ai.consentOk'), onPress: async () => { await setAiConsent(db); runAi(true); } },
      ]);
      return;
    }
    setAiBusy(true);
    setAiStage(0);
    const stageTimers = [
      setTimeout(() => setAiStage(1), 3000),
      setTimeout(() => setAiStage(2), 15000),
    ];
    try {
      const col = await db.getFirstAsync<{ name: string }>('SELECT name FROM collections WHERE id = ?', cid);
      const data = await identifyItem(cover.uri, fields.map(f => f.name), col?.name ?? '', lang);
      if (!data) Alert.alert(t('ai.title'), t('ai.failed'));
      else {
        // Hak yalnızca başarılı doldurmada düşer
        setAiLeft(await countAiUse(db));
        await applyRef.current(data);
      }
    } catch (e: any) {
      Alert.alert(t('ai.title'), e?.friendly ? e.message : `${t('ai.failed')}\n\n${e?.message ?? e}`);
    } finally {
      stageTimers.forEach(clearTimeout);
      setAiBusy(false);
    }
  }

  // Parça detayındaki "Yapay zekâ ile doldur"dan gelindiyse alanlar yüklenince bir kez çalışır
  const autoRan = useRef(false);
  useEffect(() => {
    if (autoAi && ready && photos.length && !autoRan.current) {
      autoRan.current = true;
      runAi();
    }
  }, [autoAi, ready, photos.length]);

  function openLens(index: number) {
    const p = photos[index];
    if (!p) return;
    const names = encodeURIComponent(JSON.stringify(fields.map(f => f.name)));
    router.push(`/lens?target=form&fields=${names}&uri=${encodeURIComponent(p.uri)}`);
  }

  function addPhotoMenu() {
    menu(t('form.addPhoto'), undefined, [
      { text: t('form.takePhoto'), onPress: () => pick('camera') },
      { text: t('form.library'), onPress: () => pick('library') },
      { text: t('common.cancel'), style: 'cancel' },
    ]);
  }

  // Yeni parça: ekran açılınca fotoğraf kaynağı hemen sorulur (bir dokunuş daha kazanılır)
  const asked = useRef(false);
  useEffect(() => {
    if (!askPhoto || isEdit || !ready || asked.current || photos.length) return;
    asked.current = true;
    const timer = setTimeout(() => {
      menu(t('form.addPhoto'), undefined, [
        { text: t('form.takePhoto'), onPress: () => pick('camera') },
        { text: t('form.library'), onPress: () => pick('library') },
        { text: t('form.photoLater'), style: 'cancel' },
      ]);
    }, 450); // ekranın açılış animasyonu bitsin
    return () => clearTimeout(timer);
  }, [askPhoto, isEdit, ready]);

  function photoMenu(index: number) {
    menu(t('form.photo'), undefined, [
      { text: t('edit.menu'), onPress: () => setEditIndex(index) },
      { text: t('lens.button'), onPress: () => openLens(index) },
      ...(index > 0
        ? [{
            text: t('form.makeCover'),
            onPress: () => setPhotos(prev => [prev[index], ...prev.filter((_, i) => i !== index)]),
          }]
        : []),
      {
        text: t('form.remove'),
        style: 'destructive' as const,
        onPress: () => setPhotos(prev => prev.filter((_, i) => i !== index)),
      },
      { text: t('common.cancel'), style: 'cancel' as const },
    ]);
  }

  // --- Kaydet / sil ---

  const saveRef = useRef<() => void>(() => {});
  saveRef.current = () => { save(); };

  async function save() {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      Alert.alert(t('err.nameTitle'), t('err.itemName'));
      return;
    }
    if (!cid) return;
    // Tarihler: boş bırakılabilir ama yazıldıysa anlaşılır olmalı
    const soldDay = status === 'sold' ? inputToDay(soldAt, lang) : null;
    const loanedDay = status === 'loaned' ? inputToDay(loanedAt, lang) : null;
    const dueDay = status === 'loaned' ? inputToDay(loanDue, lang) : null;
    const badDate =
      (status === 'sold' && soldAt.trim() && !soldDay) ||
      (status === 'loaned' && ((loanedAt.trim() && !loanedDay) || (loanDue.trim() && !dueDay)));
    if (badDate) {
      Alert.alert(t('date.invalidTitle'), t('date.invalid', { ph: dayInputPlaceholder(lang) }));
      return;
    }
    setSaving(true);
    try {
      const refs = photos.map(p => p.ref ?? persistPhoto(p.uri));
      const videoRef = video ? video.ref ?? persistPhoto(video.uri) : null;
      const purchasePrice = parseMoney(purchase, lang);
      const estimatedValue = parseMoney(estimated, lang);
      const soldValue = status === 'sold' ? parseMoney(soldPrice, lang) : null;
      // Değer geçmişine yeni kayıt: yeni parçada değer girildiyse ya da değer / birim değiştiyse
      const valueChanged =
        estimatedValue !== null &&
        (!isEdit || estimatedValue !== original.current.estimated || estimatedCur !== original.current.estimatedCur);
      const extra = [
        soldValue, soldValue === null ? null : soldCur, soldDay,
        status === 'loaned' ? loanedTo.trim() || null : null, loanedDay, dueDay,
      ];
      // Tahmini değer değiştiyse değerleme tarihi bugün olur
      const valuedAt =
        estimatedValue === null
          ? null
          : estimatedValue !== original.current.estimated || estimatedCur !== original.current.estimatedCur
            ? new Date().toISOString()
            : original.current.valuedAt;

      await db.withTransactionAsync(async () => {
        let id = itemId;
        if (isEdit) {
          await db.runAsync(
            `UPDATE items SET title = ?, status = ?, story = ?,
               purchase_price = ?, estimated_value = ?, valued_at = ?,
               purchase_currency = ?, estimated_currency = ?,
               sold_price = ?, sold_currency = ?, sold_at = ?, loaned_to = ?, loaned_at = ?, loan_due = ?
             WHERE id = ?`,
            trimmedTitle, status, story.trim() || null, purchasePrice, estimatedValue, valuedAt,
            purchasePrice === null ? null : purchaseCur, estimatedValue === null ? null : estimatedCur,
            ...extra, id!
          );
          await db.runAsync('DELETE FROM item_values WHERE item_id = ?', id!);
          await db.runAsync('DELETE FROM item_photos WHERE item_id = ?', id!);
        } else {
          // Yeni parça en üste eklenir
          const res = await db.runAsync(
            `INSERT INTO items (collection_id, title, status, story,
               purchase_price, estimated_value, valued_at, purchase_currency, estimated_currency,
               sold_price, sold_currency, sold_at, loaned_to, loaned_at, loan_due, sort_order)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
               (SELECT COALESCE(MIN(sort_order), 0) - 1 FROM items WHERE collection_id = ?))`,
            cid, trimmedTitle, status, story.trim() || null, purchasePrice, estimatedValue, valuedAt,
            purchasePrice === null ? null : purchaseCur, estimatedValue === null ? null : estimatedCur,
            ...extra, cid
          );
          id = res.lastInsertRowId;
        }
        for (const f of fields) {
          const v = values[f.id]?.trim();
          if (v) {
            await db.runAsync(
              'INSERT INTO item_values (item_id, field_id, value) VALUES (?, ?, ?)', id!, f.id, v
            );
          }
        }
        for (const [i, ref] of refs.entries()) {
          await db.runAsync(
            'INSERT INTO item_photos (item_id, uri, sort_order) VALUES (?, ?, ?)', id!, ref, i
          );
        }
        await db.runAsync('DELETE FROM item_videos WHERE item_id = ?', id!);
        if (videoRef) {
          await db.runAsync(
            'INSERT INTO item_videos (item_id, uri, duration) VALUES (?, ?, ?)', id!, videoRef, video?.duration ?? null
          );
        }
        if (valueChanged) {
          await db.runAsync(
            'INSERT INTO value_history (item_id, value, currency, recorded_at) VALUES (?, ?, ?, ?)',
            id!, estimatedValue, estimatedCur, valuedAt ?? new Date().toISOString()
          );
        }
      });

      // Dönüş tarihi girildiyse hatırlatma için izin istenir (ayarlardan kapatılmadıysa)
      if (status === 'loaned' && dueDay && (await getNotifPrefs(db)).loans) await ensurePermission();
      syncNotifications(db, t);

      // Düzenlemede kaldırılan fotoğrafların dosyalarını temizle
      originalRefs.current.filter(r => !refs.includes(r)).forEach(deletePhoto);
      if (originalVideo.current && originalVideo.current !== videoRef) deletePhoto(originalVideo.current);
      router.back();
    } catch (e) {
      Alert.alert(t('err.saveFailed'), String(e));
      setSaving(false);
    }
  }

  function confirmDelete() {
    // Kalıcı silme yok: parça 30 günlüğüne geri dönüşüm kutusuna gider
    Alert.alert(t('form.delete'), t('form.deleteMsg', { title }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          await db.runAsync("UPDATE items SET deleted_at = datetime('now') WHERE id = ?", itemId!);
          router.dismissTo(`/collection/${cid}`);
        },
      },
    ]);
  }

  const snap = filledSnap && filledSnap.size > 0 ? filledSnap : null;
  const topFields = snap ? fields.filter(f => snap.has(f.id)) : fields;
  const restFields = snap ? fields.filter(f => !snap.has(f.id)) : [];

  const renderField = (f: FieldDef) =>
    f.type === 'boolean' ? (
      <View key={f.id} style={s.switchRow}>
        <Text style={s.switchLabel}>{f.name}</Text>
        <Switch
          value={values[f.id] === '1'}
          onValueChange={on => setValue(f.id, on ? '1' : '')}
          trackColor={{ true: C.black, false: C.line }}
          thumbColor={C.white}
          ios_backgroundColor={C.line}
        />
      </View>
    ) : (
      <View key={f.id}>
        <FieldLabel>{f.name}</FieldLabel>
        <FieldInput def={f} value={values[f.id] ?? ''} onChange={v => setValue(f.id, v)} t={t} />
      </View>
    );

  return (
    <View style={s.container}>
    <ScrollView
      style={s.container}
      contentContainerStyle={s.content}
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets
      scrollEventThrottle={32}
      onScroll={e => {
        scrollBox.current.y = e.nativeEvent.contentOffset.y;
        updateAtEnd();
      }}
      onLayout={e => {
        scrollBox.current.h = e.nativeEvent.layout.height;
        updateAtEnd();
      }}
      onContentSizeChange={(_, h) => {
        scrollBox.current.content = h;
        updateAtEnd();
      }}
    >
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.strip}
        style={s.stripWrap}
      >
        {photos.map((p, i) => (
          <Pressable key={p.key} onPress={() => photoMenu(i)} style={s.thumb}>
            <Image source={{ uri: p.uri }} style={StyleSheet.absoluteFill} />
            {i === 0 && (
              <View style={s.coverTag}>
                <Text style={s.coverText}>{t('form.cover')}</Text>
              </View>
            )}
          </Pressable>
        ))}
        <Pressable onPress={addPhotoMenu} style={[s.thumb, s.addThumb]}>
          <Text style={s.plus}>+</Text>
          <Text style={s.addText}>{t('form.addPhotoShort')}</Text>
        </Pressable>
      </ScrollView>
      {photos.length > 1 && (
        <Text style={s.hint}>{t('form.photoHint')}</Text>
      )}
      <Pressable onPress={videoMenu} style={({ pressed }) => [s.videoBtn, pressed && { backgroundColor: C.paper }]}>
        <Ionicons name={video ? 'videocam' : 'videocam-outline'} size={18} color={C.black} />
        <Text style={s.videoText}>
          {video
            ? video.duration ? t('video.added', { d: fmtDuration(video.duration) }) : t('video.addedNoTime')
            : t('video.add', { n: MAX_VIDEO_SEC })}
        </Text>
        <Ionicons name={video ? 'ellipsis-horizontal' : 'add'} size={18} color={C.grey} />
      </Pressable>
      {photos.length > 0 && aiAvailable && (
        <Pressable
          onPress={() => runAi()}
          disabled={aiBusy}
          style={({ pressed }) => [s.aiBtn, pressed && { opacity: 0.85 }]}
        >
          {aiBusy
            ? <ActivityIndicator color={C.onBrand} />
            : <Ionicons name="sparkles" size={18} color={C.onBrand} />}
          <View style={{ flex: 1 }}>
            <Text style={s.aiTitle}>{aiBusy ? t(`ai.stage${aiStage}`) : t('ai.button')}</Text>
            {aiBusy ? (
              <Text style={s.aiSub}>{t('ai.waitHint')}</Text>
            ) : (
            <Text style={s.aiSub}>
              {aiLeft === 0 ? t('ai.limitShort') : t('ai.sub')}
              {aiLeft !== null && aiLeft > 0 ? ` · ${t('ai.left', { n: aiLeft })}` : ''}
            </Text>
            )}
          </View>
        </Pressable>
      )}
      {photos.length > 0 && (
        <Pressable
          onPress={() => openLens(0)}
          style={({ pressed }) => [s.lensBtn, pressed && { backgroundColor: C.paper }]}
        >
          <Ionicons name="scan-outline" size={18} color={C.black} />
          <View style={{ flex: 1 }}>
            <Text style={s.lensTitle}>{t('lens.formTitle')}</Text>
            <Text style={s.lensSub}>{t('lens.formSub')}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={C.grey} />
        </Pressable>
      )}

      <FieldLabel>{t('form.name')}</FieldLabel>
      <TextInput
        style={s.titleInput}
        value={title}
        onChangeText={setTitle}
        placeholder={t('form.namePh')}
        placeholderTextColor={C.grey}
        onFocus={() => setTitleFocused(true)}
        onBlur={() => setTimeout(() => setTitleFocused(false), 150)}
        autoCorrect={false}
      />
      {titleFocused && suggestions.length > 0 && (
        <View style={s.suggest}>
          {suggestions.map(sg => (
            <Pressable
              key={sg.title}
              onPress={() => setTitle(sg.title)}
              style={({ pressed }) => [s.suggestItem, pressed && { backgroundColor: C.paper }]}
              accessibilityLabel={sg.title}
            >
              <Ionicons name="time-outline" size={14} color={C.grey} />
              <Text style={s.suggestText} numberOfLines={1}>{sg.title}</Text>
            </Pressable>
          ))}
        </View>
      )}

      <FieldLabel>{t('form.status')}</FieldLabel>
      <Chips
        options={STATUS_KEYS.map(k => ({ key: k, label: t(`status.${k}`) }))}
        value={status}
        onChange={changeStatus}
      />

      {status === 'sold' && (
        <View style={s.statusBox}>
          <View style={s.valueRow}>
            <View style={{ flex: 1 }}>
              <FieldLabel>{t('sold.price')}</FieldLabel>
              <View style={s.moneyBox}>
                <TextInput
                  style={[s.input, { flex: 1 }]}
                  value={soldPrice}
                  onChangeText={setSoldPrice}
                  keyboardType="decimal-pad"
                  placeholder="0"
                  placeholderTextColor={C.grey}
                />
                <CurrencyPicker value={soldCur} onChange={setSoldCur} t={t} />
              </View>
            </View>
            <View style={{ flex: 1 }}>
              <FieldLabel>{t('sold.date')}</FieldLabel>
              <DateInput value={soldAt} onChange={setSoldAt} />
            </View>
          </View>
        </View>
      )}

      {status === 'loaned' && (
        <View style={s.statusBox}>
          <FieldLabel>{t('loan.to')}</FieldLabel>
          <TextInput
            style={s.input}
            value={loanedTo}
            onChangeText={setLoanedTo}
            placeholder={t('loan.toPh')}
            placeholderTextColor={C.grey}
          />
          <View style={s.valueRow}>
            <View style={{ flex: 1 }}>
              <FieldLabel>{t('loan.since')}</FieldLabel>
              <DateInput value={loanedAt} onChange={setLoanedAt} />
            </View>
            <View style={{ flex: 1 }}>
              <FieldLabel>{t('loan.due')}</FieldLabel>
              <DateInput value={loanDue} onChange={setLoanDue} />
            </View>
          </View>
          <View style={s.quickRow}>
            {(['1w', '2w', '1m', '3m', 'none'] as const).map(k => (
              <Pressable key={k} onPress={() => setDueIn(k)} style={s.quick} hitSlop={4}>
                <Text style={s.quickText}>{t(`loan.in.${k}`)}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={s.hint}>{t('loan.hint')}</Text>
        </View>
      )}

      {topFields.map(renderField)}

      {restFields.length > 0 && (
        <Pressable
          onPress={() => setShowEmpty(v => !v)}
          style={s.emptyToggle}
          accessibilityState={{ expanded: showEmpty }}
        >
          <Text style={s.emptyToggleText}>{t('form.emptyFields', { n: restFields.length })}</Text>
          <Ionicons name={showEmpty ? 'chevron-up' : 'chevron-down'} size={16} color={C.grey} />
        </Pressable>
      )}
      {showEmpty && restFields.map(renderField)}

      <View style={s.valueSection}>
        <Text style={s.sectionTitle}>{t('value.title')}</Text>
        <View style={s.valueRow}>
          <View style={{ flex: 1 }}>
            <FieldLabel>{t('value.purchase')}</FieldLabel>
            <View style={s.moneyBox}>
              <TextInput
                style={[s.input, { flex: 1 }]}
                value={purchase}
                onChangeText={setPurchase}
                keyboardType="decimal-pad"
                placeholder="0"
                placeholderTextColor={C.grey}
              />
              <CurrencyPicker value={purchaseCur} onChange={setPurchaseCur} t={t} />
            </View>
          </View>
          <View style={{ flex: 1 }}>
            <FieldLabel>{t('value.estimated')}</FieldLabel>
            <View style={s.moneyBox}>
              <TextInput
                style={[s.input, { flex: 1 }]}
                value={estimated}
                onChangeText={setEstimated}
                keyboardType="decimal-pad"
                placeholder="0"
                placeholderTextColor={C.grey}
              />
              <CurrencyPicker value={estimatedCur} onChange={setEstimatedCur} t={t} />
            </View>
          </View>
        </View>
        {original.current.valuedAt && parseMoney(estimated, lang) === original.current.estimated &&
          estimatedCur === original.current.estimatedCur && (
          <Text style={s.hint}>{t('value.valuedAt', { date: formatDate(original.current.valuedAt, lang) })}</Text>
        )}
      </View>

      <FieldLabel>{t('form.story')}</FieldLabel>
      <TextInput
        style={[s.input, s.story]}
        value={story}
        onChangeText={setStory}
        placeholder={t('form.storyPh')}
        placeholderTextColor={C.grey}
        multiline
      />

      <PrimaryButton
        label={saving ? t('common.saving') : isEdit ? t('form.saveChanges') : t('form.save')}
        onPress={save}
        disabled={saving}
        style={{ marginTop: 32 }}
      />

      {isEdit && (
        <Pressable onPress={confirmDelete} style={s.deleteButton}>
          <Text style={s.deleteText}>{t('form.delete')}</Text>
        </Pressable>
      )}
    </ScrollView>
    <PhotoEditor
      visible={editIndex !== null}
      uri={editIndex !== null ? photos[editIndex]?.uri ?? null : null}
      onCancel={() => setEditIndex(null)}
      onDone={uri => {
        const i = editIndex;
        setEditIndex(null);
        if (i === null) return;
        // Düzenlenen fotoğraf yeni dosyadır; eskisi kayıtta temizlenir
        setPhotos(prev => prev.map((p, j) => (j === i ? { key: p.key, ref: null, uri } : p)));
      }}
    />
    {!atEnd && (
      <View style={[s.floatSave, { paddingBottom: insets.bottom + 12 }]} pointerEvents="box-none">
        <PrimaryButton
          label={saving ? t('common.saving') : isEdit ? t('form.saveChanges') : t('form.save')}
          onPress={save}
          disabled={saving}
          style={s.floatButton}
        />
      </View>
    )}
    </View>
  );
}

// Tutarın yanındaki para birimi: dokununca seçenekler açılır
function CurrencyPicker({ value, onChange, t }: {
  value: Currency;
  onChange: (c: Currency) => void;
  t: TFunction;
}) {
  const { C } = useTheme();
  const s = useStyles(makeStyles);
  const menu = useMenu();
  return (
    <Pressable
      hitSlop={8}
      onPress={() =>
        menu(t('form.currency'), undefined, [
          ...CURRENCIES.map(c => ({ text: c, onPress: () => onChange(c) })),
          { text: t('common.cancel'), style: 'cancel' as const },
        ])
      }
      style={s.curPicker}
    >
      <Text style={s.curText}>{value}</Text>
      <Ionicons name="chevron-down" size={12} color={C.black} />
    </Pressable>
  );
}

// Gün kutusu: TR "GG.AA.YYYY", EN "MM/DD/YYYY"; kayıtta çözümlenir
function DateInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { C } = useTheme();
  const s = useStyles(makeStyles);
  const { lang } = useI18n();
  return (
    <TextInput
      style={s.input}
      value={value}
      onChangeText={v => onChange(v.replace(/[^0-9./\-]/g, ''))}
      keyboardType="numbers-and-punctuation"
      placeholder={dayInputPlaceholder(lang)}
      placeholderTextColor={C.grey}
      maxLength={10}
    />
  );
}

function FieldInput({ def, value, onChange, t }: {
  def: FieldDef;
  value: string;
  onChange: (v: string) => void;
  t: TFunction;
}) {
  const { C } = useTheme();
  const s = useStyles(makeStyles);
  if (def.type === 'select') {
    const opts: string[] = def.options ? JSON.parse(def.options) : [];
    return (
      <Chips
        options={opts.map(o => ({ key: o, label: o }))}
        value={value}
        onChange={k => onChange(k === value ? '' : k)}
      />
    );
  }
  return (
    <TextInput
      style={s.input}
      value={value}
      onChangeText={t => onChange(def.type === 'number' ? t.replace(/[^0-9.,]/g, '') : t)}
      keyboardType={def.type === 'number' ? 'decimal-pad' : 'default'}
      placeholder={def.type === 'date' ? t('form.datePh') : undefined}
      placeholderTextColor={C.grey}
    />
  );
}

const THUMB = 104;

const fmtDuration = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;

const makeStyles = (C: Palette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: C.white },
  content: { padding: 20, paddingBottom: 48 },
  stripWrap: { marginHorizontal: -20 },
  strip: { paddingHorizontal: 20, gap: 10 },
  lensBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1.5,
    borderColor: C.black,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginTop: 14,
  },
  lensTitle: { fontFamily: F.bold, fontSize: 15, color: C.black },
  lensSub: { fontFamily: F.regular, fontSize: 12, color: C.grey, marginTop: 2 },
  thumb: { width: THUMB, height: THUMB, backgroundColor: C.paper, overflow: 'hidden' },
  addThumb: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: C.black,
    backgroundColor: C.white,
  },
  plus: { fontFamily: F.regular, fontSize: 34, color: C.black, lineHeight: 38 },
  addText: { fontFamily: F.semi, fontSize: 13, color: C.black },
  coverTag: {
    position: 'absolute',
    left: 0,
    bottom: 0,
    backgroundColor: C.black,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  coverText: { fontFamily: F.bold, fontSize: 11, color: C.white },
  hint: { fontFamily: F.regular, fontSize: 13, color: C.grey, marginTop: 10 },
  titleInput: {
    borderBottomWidth: 2,
    borderBottomColor: C.black,
    paddingVertical: 10,
    fontFamily: F.semi,
    fontSize: 22,
    color: C.black,
  },
  input: {
    borderBottomWidth: 1,
    borderBottomColor: C.black,
    paddingVertical: 10,
    fontFamily: F.regular,
    fontSize: 16,
    color: C.black,
  },
  story: { minHeight: 90, textAlignVertical: 'top' },
  valueSection: { marginTop: 32, paddingTop: 14, borderTopWidth: 2, borderTopColor: C.black },
  sectionTitle: { fontFamily: F.heavy, fontSize: 18, color: C.black },
  valueRow: { flexDirection: 'row', gap: 16 },
  moneyBox: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  curPicker: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderWidth: 1,
    borderColor: C.black,
    paddingHorizontal: 7,
    paddingVertical: 5,
  },
  curText: { fontFamily: F.bold, fontSize: 12, color: C.black },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 24,
    paddingVertical: 6,
  },
  switchLabel: { fontFamily: F.bold, fontSize: 14, color: C.black },
  aiBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 12,
    paddingVertical: 12, paddingHorizontal: 14, backgroundColor: C.brand,
  },
  aiTitle: { fontFamily: F.bold, fontSize: 15, color: C.onBrand },
  aiSub: { fontFamily: F.regular, fontSize: 12, color: C.onBrand, opacity: 0.8, marginTop: 2 },
  emptyToggle: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 20, paddingVertical: 12, borderTopWidth: 1, borderBottomWidth: 1, borderColor: C.line,
  },
  emptyToggleText: { fontFamily: F.semi, fontSize: 14, color: C.grey },
  suggest: { borderWidth: 1, borderColor: C.line, borderTopWidth: 0 },
  suggestItem: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 10 },
  suggestText: { flex: 1, fontFamily: F.medium, fontSize: 15, color: C.black },
  videoBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12,
    paddingVertical: 11, paddingHorizontal: 14, borderWidth: 1, borderColor: C.line,
  },
  videoText: { flex: 1, fontFamily: F.semi, fontSize: 14, color: C.black },
  statusBox: { marginTop: 4, paddingLeft: 14, borderLeftWidth: 2, borderLeftColor: C.black },
  quickRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  quick: { borderWidth: 1, borderColor: C.black, paddingHorizontal: 10, paddingVertical: 6 },
  quickText: { fontFamily: F.semi, fontSize: 12, color: C.black },
  floatSave: { position: 'absolute', left: 20, right: 20, bottom: 0 },
  floatButton: {
    opacity: 0.88,
    shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 6,
  },
  deleteButton: { marginTop: 20, paddingVertical: 14, alignItems: 'center' },
  deleteText: { fontFamily: F.semi, fontSize: 15, color: C.black, textDecorationLine: 'underline' },
});
