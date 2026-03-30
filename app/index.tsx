import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Image,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { SvgXml } from 'react-native-svg';
import * as Clipboard from 'expo-clipboard';

type ScryfallAutocompleteResponse = {
  data: string[];
};

type CategoriesResponse = {
  categories: string[];
};

type ShareRulingResponse = {
  success?: boolean;
  id?: string;
};

/** Production web app origin when building share links on iOS/Android. */
const SHARE_APP_ORIGIN_NATIVE = 'https://the-arbiter-steel.vercel.app';

const SHARE_RULING_TITLE = "Arbiter's verdict for MTG";

function buildShareRulingUrl(shareId: string): string {
  const origin =
    Platform.OS === 'web' && typeof window !== 'undefined'
      ? window.location.origin
      : SHARE_APP_ORIGIN_NATIVE;
  return `${origin}/ruling/${shareId}`;
}

/** Plain text for Web Share / native share sheets (no rich formatting). Cards joined with " v ". */
function buildSharePlainBody(url: string, cardNames: string[]): string {
  const names = cardNames.map((n) => n.trim()).filter(Boolean);
  const cardLine = names.join(' v ');
  if (cardLine) {
    return `${SHARE_RULING_TITLE}\n${cardLine}\n${url}`;
  }
  return `${SHARE_RULING_TITLE}\n${url}`;
}

async function copyShareUrlToClipboard(url: string): Promise<void> {
  try {
    await Clipboard.setStringAsync(url);
  } catch {
    if (
      Platform.OS === 'web' &&
      typeof navigator !== 'undefined' &&
      navigator.clipboard?.writeText
    ) {
      await navigator.clipboard.writeText(url);
      return;
    }
    throw new Error('Clipboard unavailable');
  }
}

/**
 * Web: Web Share API when available; otherwise clipboard (caller shows "copied" UI).
 * Native: system share sheet with plain text (title, "Card A v Card B …", URL).
 * @returns 'clipboard' if URL was copied as fallback; otherwise undefined
 */
async function presentRulingShare(
  url: string,
  cardNames: string[],
): Promise<'clipboard' | undefined> {
  const text = buildSharePlainBody(url, cardNames);

  if (Platform.OS === 'web') {
    if (
      typeof navigator !== 'undefined' &&
      typeof navigator.share === 'function'
    ) {
      try {
        // Omit `url` — `text` already ends with the link; including both duplicates it in many browsers.
        await navigator.share({
          title: SHARE_RULING_TITLE,
          text,
        });
        return undefined;
      } catch (e) {
        const aborted =
          e !== null &&
          typeof e === 'object' &&
          'name' in e &&
          (e as { name: string }).name === 'AbortError';
        if (aborted) return undefined;
        await copyShareUrlToClipboard(url);
        return 'clipboard';
      }
    }
    await copyShareUrlToClipboard(url);
    return 'clipboard';
  }

  await Share.share({
    title: SHARE_RULING_TITLE,
    message: text,
  });
  return undefined;
}

type RulingResponse = {
  ruling: string;
  explanation: string;
  rules_cited: string[];
  oracle_referenced: string;
  cr_version?: string;
};

type SelectedCard = {
  name: string;
  image_uri: string | null;
};

function CardName({ name }: { name: string }) {
  return <Text style={styles.cardNameText}>{name}</Text>;
}

const MAX_CARDS = 4;
const BACKEND_BASE_URL = process.env.EXPO_PUBLIC_BACKEND_URL 

const RATE_LIMIT_MESSAGE =
  "You've reached the limit of 60 verdicts per hour. Please try again later.";

const GENERIC_ERROR_MESSAGE = 'Something went wrong. Please try again.';

const NO_CATEGORIES_MESSAGE =
  "Couldn't load interaction categories. You can still describe your situation below and get a verdict.";

const NO_RULING_MESSAGE =
  "The Arbiter couldn't reach a verdict. Please try again or rephrase your situation.";

const COLOURS = {
  background: '#000000',
  surface: '#111111',
  titleAccent: '#c8a882',
  primaryButton: '#9b2335',
  highlight: '#9b2335',
  chipSelected: '#93c572',
  chipUnselected: '#111111',
  cardName: '#c8a882',
  rulesTag: '#c8a882',
  rulingText: '#93c572',
  text: '#f0f0f0',
  textMuted: '#a0a0a0',
  border: '#1e1e1e',
} as const;

const TITLE_FONT = 'serif';
const BODY_FONT = 'sans-serif';

/** Synced from assets/images/arbiter_logo.svg (RN loads via SvgXml; keep in sync when editing the file). */
const ARBITER_LOGO_XML = `
<svg width="800" height="118" viewBox="0 62 800 118" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="gold" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%"   stop-color="#c8a882"/>
      <stop offset="45%"  stop-color="#e8c9a0"/>
      <stop offset="65%"  stop-color="#c8a882"/>
      <stop offset="100%" stop-color="#9a7a58"/>
    </linearGradient>
  </defs>
  <!-- Background (cropped viewBox keeps wordmark vertically centred in frame) -->
  <rect x="0" y="62" width="800" height="118" fill="#000000"/>
  <!-- Main wordmark — all caps, Palatino -->
  <text
    x="400"
    y="155"
    font-family="'Palatino Linotype', 'Palatino', 'Book Antiqua', Georgia, serif"
    font-size="110"
    font-weight="700"
    fill="url(#gold)"
    text-anchor="middle"
    letter-spacing="12"
  >ARBITER</text>
</svg>
`.trim();

function uniqCaseInsensitive(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const key = item.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item.trim());
  }
  return out;
}

function selectedCategoriesPayload(categories: string[]): string | undefined {
  return categories.length > 0 ? categories.join(', ') : undefined;
}

export default function Index() {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [selectedCards, setSelectedCards] = useState<SelectedCard[]>([]);

  const [categories, setCategories] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string[]>([]);
  const [isCategoriesLoading, setIsCategoriesLoading] = useState(false);

  const [situation, setSituation] = useState('');
  const [isRulingLoading, setIsRulingLoading] = useState(false);

  const [rulingResult, setRulingResult] = useState<RulingResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activeStep3Card, setActiveStep3Card] = useState<SelectedCard | null>(null);
  const [maxCardsError, setMaxCardsError] = useState<string | null>(null);

  const [flagged, setFlagged] = useState(false);
  const [flagModalVisible, setFlagModalVisible] = useState(false);
  const [flagReason, setFlagReason] = useState('');
  const [flagging, setFlagging] = useState(false);
  const [flagError, setFlagError] = useState<string | null>(null);

  const [sharing, setSharing] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const [shareCopied, setShareCopied] = useState(false);
  const shareCopiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [refineText, setRefineText] = useState('');
  const [refining, setRefining] = useState(false);
  const [refineError, setRefineError] = useState('');

  const scrollViewRef = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const sessionId = useRef(Math.random().toString(36).substring(2)).current;
  const generateId = () => {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  };
  const caseId = useRef(generateId());
  const { width } = useWindowDimensions();
  const cardWidth = Platform.OS === 'web' ? Math.min(width - 32, 400) : width - 32;
  const [cardIndex, setCardIndex] = useState(0);
  const cardFadeOpacity = useRef(new Animated.Value(1)).current;
  const rulingCardScrollYRef = useRef(0);

  const autocompleteAbortRef = useRef<AbortController | null>(null);
  const categoriesAbortRef = useRef<AbortController | null>(null);
  const rulingAbortRef = useRef<AbortController | null>(null);
  /** Keeps latest appeal text in sync for logCase (state can lag one frame behind the last keystroke). */
  const flagReasonRef = useRef('');

  const canRequestCategories = selectedCards.length >= 1;
  const canRequestRuling = selectedCards.length >= 1 && !isRulingLoading;
  const canGoToStep2 = selectedCards.length >= 1;

  // Used to avoid refetching categories when only image_uri changes.
  const selectedCardNamesKey = useMemo(
    () => selectedCards.map((c) => c.name).join('|'),
    [selectedCards]
  );

  useEffect(() => {
    return () => {
      if (shareCopiedTimerRef.current) {
        clearTimeout(shareCopiedTimerRef.current);
      }
    };
  }, []);

  const prevSelectedCardsLengthRef = useRef(selectedCards.length);
  useEffect(() => {
    // Reset to the first card when cards are removed; when cards are added,
    // jump to the newly-added (last) card.
    if (selectedCards.length > prevSelectedCardsLengthRef.current) {
      setCardIndex(selectedCards.length - 1);
    } else {
      setCardIndex(0);
    }
    prevSelectedCardsLengthRef.current = selectedCards.length;
  }, [selectedCards.length]);

  useEffect(() => {
    if (selectedCards.length <= 1) return;

    Animated.timing(cardFadeOpacity, {
      toValue: 0,
      duration: 100,
      useNativeDriver: false,
    }).start(({ finished }) => {
      if (!finished) return;
      Animated.timing(cardFadeOpacity, {
        toValue: 1,
        duration: 150,
        useNativeDriver: false,
      }).start();
    });
  }, [cardIndex, cardFadeOpacity, selectedCards.length]);

  const logCase = async (data: Record<string, unknown>) => {
    try {
      await fetch(`${BACKEND_BASE_URL}/log`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, case_id: caseId.current, ...data }),
      });
    } catch (e) {
      // Fail silently — logging should never block the user
    }
  };

  const fetchAutocomplete = useCallback(async (q: string) => {
    autocompleteAbortRef.current?.abort();
    const controller = new AbortController();
    autocompleteAbortRef.current = controller;

    try {
      const res = await fetch(
        `https://api.scryfall.com/cards/autocomplete?q=${encodeURIComponent(q)}`,
        { signal: controller.signal }
      );
      if (!res.ok) throw new Error('Scryfall autocomplete failed');
      const json = (await res.json()) as ScryfallAutocompleteResponse;
      const deduped = uniqCaseInsensitive(json.data ?? []);
      setSuggestions(deduped.slice(0, 12));
    } catch (err) {
      if ((err as { name?: string } | null)?.name === 'AbortError') return;
      setSuggestions([]);
    }
  }, []);

  const fetchCardImageUri = useCallback(async (cardName: string) => {
    try {
      const url = `https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(
        cardName
      )}`;
      const res = await fetch(url);
      if (!res.ok) return null;
      const data = await res.json();
      return (
        data.image_uris?.normal ||
        data.image_uris?.large ||
        data.card_faces?.[0]?.image_uris?.normal ||
        null
      );
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    setErrorMessage(null);
    if (query.trim().length < 2) {
      setSuggestions([]);
      autocompleteAbortRef.current?.abort();
      return;
    }

    const trimmed = query.trim();
    const handle = setTimeout(() => {
      void fetchAutocomplete(trimmed);
    }, 250);

    return () => clearTimeout(handle);
  }, [query, fetchAutocomplete]);

  const addCard = useCallback(
    (cardName: string) => {
      setErrorMessage(null);

      const normalized = cardName.trim().toLowerCase();

      setSelectedCards((prev) => {
        const existsIndex = prev.findIndex(
          (c) => c.name.trim().toLowerCase() === normalized
        );

        if (existsIndex !== -1) {
          // Preserve existing image_uri; only refresh the display name casing.
          setMaxCardsError(null);
          return prev.map((c, idx) => (idx === existsIndex ? { ...c, name: cardName } : c));
        }

        if (prev.length >= MAX_CARDS) {
          setMaxCardsError('4 cards maximum — remove one to add another');
          return prev;
        }

        const updated = [...prev, { name: cardName, image_uri: null }].slice(
          0,
          MAX_CARDS
        );
        setMaxCardsError(null);
        setCardIndex(updated.length - 1);
        return updated;
      });

      void (async () => {
        const image_uri = await fetchCardImageUri(cardName);
        setSelectedCards((prev) =>
          prev.map((c) =>
            c.name.trim().toLowerCase() === normalized
              ? { ...c, image_uri }
              : c
          )
        );
      })();

      setQuery('');
      setSuggestions([]);
      setRulingResult(null);
      setStep((prev) => (prev === 3 ? 2 : prev));
    },
    [fetchCardImageUri]
  );

  const removeCard = useCallback((cardName: string) => {
    const normalized = cardName.trim().toLowerCase();
    setSelectedCards((prev) =>
      prev.filter((c) => c.name.trim().toLowerCase() !== normalized)
    );
    setMaxCardsError(null);
    setRulingResult(null);
    setStep((prev) => (prev === 3 ? 2 : prev));
  }, []);

  const toggleCategory = useCallback((category: string) => {
    setSelectedCategory((prev) =>
      prev.includes(category)
        ? prev.filter((c) => c !== category)
        : [...prev, category]
    );
    setRulingResult(null);
    setStep((prev) => (prev === 3 ? 2 : prev));
  }, []);

  const fetchCategories = useCallback(async (cards: string[]) => {
    categoriesAbortRef.current?.abort();
    const controller = new AbortController();
    categoriesAbortRef.current = controller;

    setIsCategoriesLoading(true);
    try {
      const res = await fetch(`${BACKEND_BASE_URL}/categories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cards }),
        signal: controller.signal,
      });

      if (res.status === 429) {
        setCategories([]);
        setSelectedCategory([]);
        setErrorMessage(RATE_LIMIT_MESSAGE);
        return;
      }
      if (!res.ok) throw new Error('Failed to fetch categories');
      const json = (await res.json()) as CategoriesResponse;
      const next = Array.isArray(json.categories) ? json.categories : [];
      setCategories(next);
      setSelectedCategory((prev) => prev.filter((c) => next.includes(c)));
    } catch (err) {
      if ((err as { name?: string } | null)?.name === 'AbortError') return;
      setCategories([]);
      setSelectedCategory([]);
      setErrorMessage(NO_CATEGORIES_MESSAGE);
    } finally {
      setIsCategoriesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (step !== 2 || !canRequestCategories) {
      categoriesAbortRef.current?.abort();
      if (step < 2) {
        setCategories([]);
        setSelectedCategory([]);
      }
      return;
    }

    void fetchCategories(selectedCards.map((c) => c.name));
  }, [canRequestCategories, fetchCategories, selectedCardNamesKey, step]);

  useEffect(() => {
    if (step > 1 && selectedCards.length < 1) {
      setStep(1);
    }
  }, [selectedCards.length, step]);

  const requestRuling = useCallback(async () => {
    setErrorMessage(null);
    setRulingResult(null);

    const categoryPayload = selectedCategoriesPayload(selectedCategory);
    void logCase({
      cards: selectedCards.map((c) => c.name),
      selected_category: categoryPayload,
      situation: situation.trim() || undefined,
    });

    rulingAbortRef.current?.abort();
    const controller = new AbortController();
    rulingAbortRef.current = controller;

    setIsRulingLoading(true);
    try {
    const payload: { cards: string[]; situation?: string; category?: string } = {
      cards: selectedCards.map((c) => c.name),
    };
      if (categoryPayload) payload.category = categoryPayload;
      if (situation.trim()) payload.situation = situation.trim();

      const res = await fetch(`${BACKEND_BASE_URL}/ruling`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (res.status === 429) {
        setErrorMessage(RATE_LIMIT_MESSAGE);
        return;
      }
      if (!res.ok) throw new Error('Failed to fetch ruling');
      const json = (await res.json()) as RulingResponse;

      void logCase({
        cards: selectedCards.map((c) => c.name),
        selected_category: categoryPayload,
        situation: situation.trim() || undefined,
        ruling: json.ruling,
        explanation: json.explanation,
        rules_cited: json.rules_cited,
        cr_version: json.cr_version,
      });

      if (shareCopiedTimerRef.current) {
        clearTimeout(shareCopiedTimerRef.current);
        shareCopiedTimerRef.current = null;
      }
      setShareCopied(false);
      setShareError(null);
      setRulingResult(json);
      setStep(3);
    } catch (err) {
      if ((err as { name?: string } | null)?.name === 'AbortError') return;
      setErrorMessage(NO_RULING_MESSAGE);
    } finally {
      setIsRulingLoading(false);
    }
  }, [selectedCards, selectedCategory, situation]);

  const onPressRuleTag = useCallback((ruleLine: string) => {
    Alert.alert('Rule cited', ruleLine);
  }, []);

  const onShareRuling = useCallback(async () => {
    if (!rulingResult || sharing) return;
    if (shareCopiedTimerRef.current) {
      clearTimeout(shareCopiedTimerRef.current);
      shareCopiedTimerRef.current = null;
    }
    setShareCopied(false);
    setShareError(null);
    setSharing(true);
    try {
      const res = await fetch(`${BACKEND_BASE_URL}/share`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          case_id: caseId.current,
          cards: selectedCards.map((c) => c.name),
          ...(selectedCategory.length > 0
            ? { category: selectedCategory }
            : {}),
          ...(situation.trim() ? { situation: situation.trim() } : {}),
          ruling: rulingResult.ruling,
          explanation: rulingResult.explanation,
          rules_cited: rulingResult.rules_cited ?? [],
          cr_version: rulingResult.cr_version,
        }),
      });
      if (res.status === 429) {
        setShareError(RATE_LIMIT_MESSAGE);
        return;
      }
      if (!res.ok) throw new Error('Share failed');
      const json = (await res.json()) as ShareRulingResponse;
      if (!json.id || typeof json.id !== 'string') throw new Error('Share failed');
      const url = buildShareRulingUrl(json.id);
      const usedClipboard = await presentRulingShare(
        url,
        selectedCards.map((c) => c.name),
      );
      if (usedClipboard === 'clipboard') {
        setShareCopied(true);
        shareCopiedTimerRef.current = setTimeout(() => {
          setShareCopied(false);
          shareCopiedTimerRef.current = null;
        }, 3000);
      }
    } catch {
      setShareError(GENERIC_ERROR_MESSAGE);
    } finally {
      setSharing(false);
    }
  }, [
    rulingResult,
    selectedCards,
    selectedCategory,
    situation,
    sharing,
  ]);

  const onFlag = useCallback(async () => {
    if (!rulingResult || flagging || flagged) return;
    setFlagError(null);
    setFlagging(true);
    try {
      const categoryPayload = selectedCategoriesPayload(selectedCategory);
      const res = await fetch(`${BACKEND_BASE_URL}/flag`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cards: selectedCards.map((c) => c.name),
          category: categoryPayload,
          situation: situation.trim() || undefined,
          ruling: rulingResult.ruling,
          explanation: rulingResult.explanation,
          rules_cited: rulingResult.rules_cited,
          reason: '',
        }),
      });
      if (!res.ok) throw new Error('Flag request failed');
      setFlagged(true);
      setFlagModalVisible(true);
      void logCase({
        cards: selectedCards.map((c) => c.name),
        selected_category: categoryPayload,
        situation: situation.trim() || undefined,
        ruling: rulingResult.ruling,
        cr_version: rulingResult.cr_version,
        flagged: true,
        flag_reason: flagReason,
      });
    } catch {
      setFlagError(GENERIC_ERROR_MESSAGE);
    } finally {
      setFlagging(false);
    }
  }, [rulingResult, selectedCards, selectedCategory, situation, flagging, flagged, flagReason]);

  const onSubmitFlagReason = useCallback(async () => {
    if (!rulingResult || flagging) return;
    setFlagError(null);
    setFlagging(true);
    try {
      const categoryPayload = selectedCategoriesPayload(selectedCategory);
      const res = await fetch(`${BACKEND_BASE_URL}/flag`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cards: selectedCards.map((c) => c.name),
          category: categoryPayload,
          situation: situation.trim() || undefined,
          ruling: rulingResult.ruling,
          explanation: rulingResult.explanation,
          rules_cited: rulingResult.rules_cited,
          reason: flagReason.trim() || undefined,
        }),
      });
      if (!res.ok) throw new Error('Flag request failed');
      const trimmedReason = flagReasonRef.current.trim();
      void logCase({
        cards: selectedCards.map((c) => c.name),
        selected_category: categoryPayload,
        situation: situation.trim() || undefined,
        ruling: rulingResult.ruling,
        explanation: rulingResult.explanation,
        rules_cited: rulingResult.rules_cited,
        cr_version: rulingResult.cr_version,
        flagged: true,
        flag_reason: trimmedReason,
      });
      setFlagModalVisible(false);
      flagReasonRef.current = '';
      setFlagReason('');
    } catch {
      setFlagError(GENERIC_ERROR_MESSAGE);
    } finally {
      setFlagging(false);
    }
  }, [rulingResult, selectedCards, selectedCategory, situation, flagReason, flagging]);

  const onRefineRuling = useCallback(async () => {
    const detail = refineText.trim();
    if (!detail || refining) return;
    setRefineError('');
    setRefining(true);
    try {
      const categoryPayload = selectedCategoriesPayload(selectedCategory);
      const res = await fetch(`${BACKEND_BASE_URL}/ruling`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cards: selectedCards.map((c) => c.name),
          ...(categoryPayload ? { category: categoryPayload } : {}),
          situation: detail,
        }),
      });
      if (res.status === 429) {
        setRefineError('');
        setErrorMessage(RATE_LIMIT_MESSAGE);
        return;
      }
      if (!res.ok) throw new Error('Failed to refine ruling');
      const json = (await res.json()) as RulingResponse;
      if (shareCopiedTimerRef.current) {
        clearTimeout(shareCopiedTimerRef.current);
        shareCopiedTimerRef.current = null;
      }
      setShareCopied(false);
      setShareError(null);
      setRulingResult(json);
      setRefineText('');
      requestAnimationFrame(() => {
        scrollViewRef.current?.scrollTo({
          y: Math.max(0, rulingCardScrollYRef.current - 8),
          animated: true,
        });
      });
    } catch {
      setRefineError(NO_RULING_MESSAGE);
    } finally {
      setRefining(false);
    }
  }, [refineText, refining, selectedCards, selectedCategory]);

  const goToStep1 = useCallback(() => {
    if (shareCopiedTimerRef.current) {
      clearTimeout(shareCopiedTimerRef.current);
      shareCopiedTimerRef.current = null;
    }
    setShareCopied(false);
    setShareError(null);
    setErrorMessage(null);
    setRulingResult(null);
    setSelectedCategory([]);
    setSituation('');
    setFlagged(false);
    setFlagModalVisible(false);
    setFlagging(false);
    flagReasonRef.current = '';
    setFlagReason('');
    setFlagError(null);
    setRefineText('');
    setRefining(false);
    setRefineError('');
    setStep(1);
  }, []);

  const goToStep2 = useCallback(() => {
    setErrorMessage(null);
    setRulingResult(null);
    setStep(2);
  }, []);

  const swipeThreshold = 20;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: (_, gestureState) => {
        return true;
      },
      onMoveShouldSetPanResponder: (_, gestureState) => {
        return Math.abs(gestureState.dx) > 10;
      },
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dx < -swipeThreshold) {
          // Swipe left — go to next card
          setCardIndex((prev) =>
            prev < selectedCards.length - 1 ? prev + 1 : prev
          );
        } else if (gestureState.dx > swipeThreshold) {
          // Swipe right — go to previous card
          setCardIndex((prev) => (prev > 0 ? prev - 1 : prev));
        }
      },
    })
  ).current;

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: '#000000',
        overflow: 'hidden',
      }}>
      <ScrollView
        ref={scrollViewRef}
        bounces={false}
        overScrollMode="never"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          flexGrow: 1,
          paddingHorizontal: 16,
          paddingVertical: 24,
          maxWidth: 600,
          width: '100%',
          alignSelf: 'center',
        }}
        keyboardShouldPersistTaps="handled"
        scrollEnabled={true}
        directionalLockEnabled={true}>
        <SvgXml
          xml={ARBITER_LOGO_XML}
          width={280}
          height={41}
          style={{ alignSelf: 'center', marginVertical: 10 }}
        />

      {step === 1 ? (
        <>
          <Text style={styles.step1Tagline}>
            Demystifying card interactions for Magic: The Gathering
          </Text>
          <View style={styles.section}>
            <Text style={styles.stepLabel}>Step 1: Specify cards</Text>
            {selectedCards.length < MAX_CARDS ? (
              <View style={styles.searchRow}>
                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Search for a card..."
                  placeholderTextColor={COLOURS.textMuted}
                  style={[styles.input, styles.searchInput]}
                  autoCorrect={false}
                  autoCapitalize="none"
                />
              </View>
            ) : (
              <Text style={styles.helperHint}>4 cards maximum — remove one to add another</Text>
            )}

            {maxCardsError && selectedCards.length < MAX_CARDS ? (
              <Text style={styles.helperHint}>{maxCardsError}</Text>
            ) : null}

            {suggestions.length > 0 && selectedCards.length < MAX_CARDS ? (
              <View style={styles.suggestions}>
                {suggestions.map((s) => (
                  <Pressable
                    key={s}
                    onPress={() => addCard(s)}
                    style={({ pressed }) => [
                      styles.suggestionRow,
                      pressed && styles.pressed,
                    ]}>
                    <Text style={styles.suggestionText}>
                      <CardName name={s} />
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : null}

            {!canGoToStep2 ? (
              <Text style={styles.helperHint}>
                Add at least 1 card to continue.
              </Text>
            ) : null}

            {selectedCards.length > 0 ? (
              <View style={styles.chipsRow}>
                {selectedCards.map((card) => (
                  <Pressable
                    key={card.name}
                    onPress={() => removeCard(card.name)}
                    style={({ pressed }) => [styles.chip, pressed && styles.pressed]}>
                    <Text style={styles.chipText} numberOfLines={1}>
                      <CardName name={card.name} /> {'  '}
                      <Text style={styles.removeMark}>×</Text>
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : null}

            {selectedCards.length > 0 ? (
              <View style={{ width: '100%', alignItems: 'center', marginTop: 12 }}>
                <View
                  style={{
                    width: cardWidth,
                    position: 'relative',
                    overflow: 'visible',
                  }}>
                  <View pointerEvents="box-only">
                    <Animated.View
                      {...panResponder.panHandlers}
                      style={{
                        opacity: cardFadeOpacity,
                        width: '100%',
                        aspectRatio: 63 / 88,
                      }}>
                    {selectedCards[cardIndex]?.image_uri ? (
                      <Image
                        source={{ uri: selectedCards[cardIndex]!.image_uri as string }}
                        style={{
                          width: '100%',
                          height: '100%',
                          borderRadius: 8,
                          borderWidth: 1,
                          borderColor: '#1e1e1e',
                        }}
                        resizeMode="cover"
                      />
                    ) : null}
                    </Animated.View>
                  </View>

                  {selectedCards.length > 1 && cardIndex > 0 ? (
                    <TouchableOpacity
                      onPress={() => setCardIndex((i) => Math.max(0, i - 1))}
                      style={[
                        styles.carouselArrow,
                        { left: -18, opacity: Platform.OS === 'web' ? 1 : 0.5 },
                      ]}>
                      <Text style={styles.carouselArrowLabel}>‹</Text>
                    </TouchableOpacity>
                  ) : null}

                  {selectedCards.length > 1 && cardIndex < selectedCards.length - 1 ? (
                    <TouchableOpacity
                      onPress={() =>
                        setCardIndex((i) =>
                          Math.min(selectedCards.length - 1, i + 1)
                        )
                      }
                      style={[
                        styles.carouselArrow,
                        { right: -18, opacity: Platform.OS === 'web' ? 1 : 0.5 },
                      ]}>
                      <Text style={styles.carouselArrowLabel}>›</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>

                {selectedCards.length > 1 ? (
                  <View style={styles.carouselDotsRow}>
                    {selectedCards.map((_, index) => (
                      <View
                        key={index}
                        style={[
                          styles.carouselDot,
                          index === cardIndex ? styles.carouselDotActive : null,
                        ]}
                      />
                    ))}
                  </View>
                ) : null}

                <Text style={styles.carouselCardName}>
                  {selectedCards[cardIndex]?.name ?? ''}
                </Text>
              </View>
            ) : null}
          </View>

          <View style={styles.section}>
            <Pressable
              onPress={() => {
                void logCase({ cards: selectedCards.map((c) => c.name) });
                goToStep2();
              }}
              disabled={!canGoToStep2}
              style={({ pressed }) => [
                styles.primaryButton,
                !canGoToStep2 && styles.primaryButtonDisabled,
                pressed && canGoToStep2 && styles.primaryButtonPressed,
              ]}>
              <Text style={styles.primaryButtonText}>Present your case</Text>
            </Pressable>
          </View>
        </>
      ) : null}

      {step === 2 ? (
        <>
          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { marginTop: 0 }]}>Selected cards</Text>
            <View style={styles.chipsRow}>
              {selectedCards.map((card) => (
                <Pressable
                  key={card.name}
                  onPress={() => removeCard(card.name)}
                  style={({ pressed }) => [styles.chip, pressed && styles.pressed]}>
                  <Text style={styles.chipText} numberOfLines={1}>
                    <CardName name={card.name} /> {'  '}
                    <Text style={styles.removeMark}>×</Text>
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          <View style={[styles.section, { borderBottomWidth: 0 }]}>
            <Text style={styles.stepLabel}>Step 2: Select interaction and/or describe situation</Text>
            {isCategoriesLoading ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator color={COLOURS.chipSelected} />
                <Text style={styles.loadingText}>Finding likely interactions…</Text>
              </View>
            ) : null}

            <View style={styles.chipsRow}>
              {categories.map((cat) => {
                const selected = selectedCategory.includes(cat);
                return (
                  <Pressable
                    key={cat}
                    onPress={() => toggleCategory(cat)}
                    style={({ pressed }) => [
                      styles.categoryChip,
                      selected && styles.categoryChipSelected,
                      pressed && styles.pressed,
                    ]}>
                    <Text
                      style={[
                        styles.categoryChipText,
                        {
                          color: selected ? '#111111' : '#a0a0a0',
                          fontWeight: selected ? '700' : '400',
                        },
                      ]}>
                      {cat}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={styles.section}>
            <TextInput
              value={situation}
              onChangeText={setSituation}
              placeholder="Describe the situation (optional)..."
              placeholderTextColor="#3a3a3a"
              style={[styles.input, styles.multilineInput]}
              multiline
              textAlignVertical="top"
            />
          </View>

          <View style={styles.section}>
            <View style={{ flexDirection: 'row', gap: 8, width: '100%' }}>
              <TouchableOpacity
                style={{
                  flex: 1,
                  backgroundColor: '#111111',
                  borderWidth: 1,
                  borderColor: '#1e1e1e',
                  borderRadius: 10,
                  height: 52,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                onPress={goToStep1}
              >
                <Text style={{ color: '#a0a0a0', fontSize: 15 }}>Back</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{
                  flex: 3,
                  backgroundColor: '#9b2335',
                  borderRadius: 10,
                  height: 52,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                onPress={requestRuling}
                disabled={!canRequestRuling}
              >
                {isRulingLoading ? (
                  <View style={styles.loadingRow}>
                    <ActivityIndicator color={COLOURS.text} />
                    <Text style={styles.primaryButtonText}>Jury deliberating…</Text>
                  </View>
                ) : (
                  <Text
                    style={{
                      color: '#f0f0f0',
                      fontSize: 15,
                      fontWeight: '700',
                    }}>
                    Get Verdict
                  </Text>
                )}
              </TouchableOpacity>
            </View>

            {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}
          </View>
        </>
      ) : null}

      {step === 3 ? (
        <>
          {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}

          {rulingResult ? (
            <>
              <View style={styles.section}>
                <Text style={[styles.sectionLabel, { marginTop: 0 }]}>Selected cards</Text>
                <View style={styles.chipsRow}>
                  {selectedCards.map((card) => (
                    <Pressable
                      key={card.name}
                      accessibilityRole="button"
                      accessibilityLabel={`Show card image for ${card.name}`}
                      onPress={() => setActiveStep3Card(card)}
                      style={({ pressed }) => [styles.chip, pressed && styles.pressed]}>
                      <Text style={styles.chipText} numberOfLines={1}>
                        <CardName name={card.name} />
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>

              <View
                style={[styles.section, { paddingBottom: 0 }]}
                onLayout={(e) => {
                  rulingCardScrollYRef.current = e.nativeEvent.layout.y;
                }}>
                <Text style={styles.stepLabel}>Step 3: Receive Verdict</Text>
                <Text style={[styles.sectionLabel, { marginTop: 0 }]}>RULING</Text>
                <Text style={styles.rulingText}>{rulingResult.ruling}</Text>

                <Text style={styles.sectionLabel}>
                  EXPLANATION
                </Text>
                {(() => {
                  const explanationLines = rulingResult.explanation
                    .split('\n')
                    .map((line) => line.replace(/^[\s\*\-•]+/, '').trim())
                    .filter(Boolean);

                  return explanationLines.map((line, index) => (
                    <View
                      key={index}
                      style={{
                        flexDirection: 'row',
                        marginTop: 0,
                        marginBottom: 6,
                        paddingRight: 8,
                      }}>
                      <Text
                        style={[
                          styles.explanationText,
                          {
                            minWidth: 24,
                            flexShrink: 0,
                          },
                        ]}
                        accessible={false}>
                        {'\u2022'}
                      </Text>
                      <Text style={[styles.explanationText, { flex: 1 }]}>{line}</Text>
                    </View>
                  ));
                })()}

                <Text style={styles.sectionLabel}>
                  RULES CITED
                </Text>
                <View style={styles.rulesRow}>
                  {(rulingResult.rules_cited ?? []).map((r) => (
                    <Pressable
                      key={r}
                      onPress={() => onPressRuleTag(r)}
                      style={({ pressed }) => [styles.ruleTag, pressed && styles.pressed]}>
                      <Text style={styles.ruleTagText} numberOfLines={2}>
                        {r}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>

              <View style={styles.refineDivider} />

              <View style={styles.section}>
                <View style={{ width: '100%', gap: 8 }}>
                {refineError ? (
                  <Text style={styles.refineErrorText}>{refineError}</Text>
                ) : null}

                <View style={{ flexDirection: 'row', width: '100%', gap: 8 }}>
                  <TouchableOpacity
                    onPress={goToStep2}
                    style={[
                      styles.tertiaryButton,
                      { flex: 1, marginTop: 0, height: 52, alignItems: 'center', justifyContent: 'center' },
                    ]}>
                    <Text style={styles.tertiaryButtonText}>Back</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => {
                      setSelectedCards([]);
                      setCardIndex(0);
                      caseId.current = generateId();
                      goToStep1();
                    }}
                    style={[
                      styles.primaryButton,
                      {
                        flex: 3,
                        marginTop: 0,
                        backgroundColor: COLOURS.chipSelected,
                        height: 52,
                        alignItems: 'center',
                        justifyContent: 'center',
                      },
                    ]}>
                    <Text
                      style={[
                        styles.primaryButtonText,
                        { color: COLOURS.chipUnselected },
                      ]}>
                      Present Another Case
                    </Text>
                  </TouchableOpacity>
                </View>

                <TouchableOpacity
                  onPress={onShareRuling}
                  disabled={sharing}
                  style={[
                    styles.shareButton,
                    sharing && styles.primaryButtonDisabled,
                  ]}>
                  {sharing ? (
                    <View style={styles.loadingRow}>
                      <ActivityIndicator color="#c8a882" />
                      <Text style={styles.shareButtonText}>Sharing…</Text>
                    </View>
                  ) : shareCopied ? (
                    <Text style={styles.shareButtonText}>✓ Link copied!</Text>
                  ) : (
                    <Text style={styles.shareButtonText}>Share this ruling</Text>
                  )}
                </TouchableOpacity>
                {shareError ? <Text style={styles.flagErrorText}>{shareError}</Text> : null}

                {flagged ? (
                  <Text style={styles.flagConfirmText}>✓ Ruling flagged for review. Thank you.</Text>
                ) : (
                  <>
                    <TouchableOpacity
                      onPress={onFlag}
                      disabled={flagging}
                      style={[
                        styles.flagButton,
                        flagging && styles.primaryButtonDisabled,
                      ]}>
                      {flagging ? (
                        <View style={styles.loadingRow}>
                          <ActivityIndicator color="#9b2335" />
                          <Text style={styles.flagButtonText}>Appealing…</Text>
                        </View>
                      ) : (
                        <Text style={styles.flagButtonText}>Appeal this ruling</Text>
                      )}
                    </TouchableOpacity>
                    {flagError ? <Text style={styles.flagErrorText}>{flagError}</Text> : null}
                  </>
                )}
                </View>
              </View>
            </>
          ) : (
            <View nativeID="arbiter-helper-verdict" style={styles.helperBox}>
              <Text style={[styles.helperText, { color: COLOURS.textMuted }]}>
                No ruling yet. Go back and request one.
              </Text>
            </View>
          )}
        </>
      ) : null}
      <Modal
        visible={activeStep3Card !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setActiveStep3Card(null)}>
        <View style={styles.cardImageModalRoot}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Dismiss card image"
            style={styles.cardImageModalBackdrop}
            onPress={() => setActiveStep3Card(null)}
          />
          <View style={styles.cardImageModalCenterLayer} pointerEvents="box-none">
            <View style={[styles.cardModalImageFrame, { width: cardWidth }]}>
              {activeStep3Card?.image_uri ? (
                <Image
                  source={{ uri: activeStep3Card.image_uri }}
                  style={styles.cardModalImage}
                  resizeMode="cover"
                />
              ) : (
                <View style={styles.cardModalFallbackWrap}>
                  <Text style={styles.cardModalFallbackText}>No image found</Text>
                </View>
              )}
            </View>
          </View>
        </View>
      </Modal>
      <Modal transparent animationType="fade" visible={flagModalVisible}>
        <View style={styles.flagModalOverlay}>
          <View style={styles.flagModalCard}>
            <Text style={styles.flagModalTitle}>Thanks for Appealing</Text>
            <Text style={styles.flagModalSubtitle}>
              Would you like to tell us what was wrong? (optional)
            </Text>
            <TextInput
              value={flagReason}
              onChangeText={(t) => {
                flagReasonRef.current = t;
                setFlagReason(t);
              }}
              placeholder="What was wrong with the ruling? (optional)"
              placeholderTextColor="#3a3a3a"
              style={[styles.input, styles.multilineInput, styles.flagModalInput]}
              multiline
              textAlignVertical="top"
            />
            <View style={styles.flagModalActions}>
              <Pressable
                onPress={() => {
                  setFlagModalVisible(false);
                  flagReasonRef.current = '';
                  setFlagReason('');
                }}
                disabled={flagging}
                style={({ pressed }) => [
                  styles.tertiaryButton,
                  styles.flagModalActionButton,
                  { flex: 1 },
                  pressed && !flagging && styles.pressed,
                ]}>
                <Text style={styles.tertiaryButtonText}>Skip</Text>
              </Pressable>
              <Pressable
                onPress={onSubmitFlagReason}
                disabled={flagging}
                style={({ pressed }) => [
                  styles.primaryButton,
                  styles.flagModalActionButton,
                  { flex: 3 },
                  flagging && styles.primaryButtonDisabled,
                  pressed && !flagging && styles.primaryButtonPressed,
                ]}>
                {flagging ? (
                  <View style={styles.loadingRow}>
                    <ActivityIndicator color={COLOURS.text} />
                    <Text style={styles.primaryButtonText}>Submitting…</Text>
                  </View>
                ) : (
                  <Text style={styles.primaryButtonText}>Submit</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    paddingBottom: 40,
    backgroundColor: COLOURS.background,
    minHeight: '100%',
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
    color: COLOURS.titleAccent,
    marginBottom: 16,
    letterSpacing: 3,
    fontFamily: TITLE_FONT,
  },
  section: {
    marginBottom: 20,
    paddingBottom: 20,
    borderBottomWidth: 0,
    borderBottomColor: COLOURS.border,
  },
  stepLabel: {
    color: COLOURS.text,
    fontSize: 10,
    fontWeight: '700',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 3,
    fontFamily: BODY_FONT,
  },
  step1Tagline: {
    color: '#a0a0a0',
    fontSize: 14,
    fontFamily: 'serif',
    textAlign: 'center',
    marginBottom: 16,
  },
  sectionLabel: {
    color: '#585858',
    fontWeight: '600',
    letterSpacing: 3,
    fontSize: 10,
    fontFamily: BODY_FONT,
    textTransform: 'uppercase',
    marginTop: 14,
    marginBottom: 8,
  },
  searchRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
  },
  input: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLOURS.border,
    backgroundColor: COLOURS.surface,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: COLOURS.text,
    fontSize: 16,
    fontFamily: BODY_FONT,
  },
  searchInput: {
    fontSize: 16,
  },
  multilineInput: {
    minHeight: 100,
    padding: 14,
  },
  flagSection: {
    marginTop: 20,
    width: '100%',
  },
  flagModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  flagModalCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#111111',
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    borderColor: '#1e1e1e',
  },
  flagModalTitle: {
    color: '#f0f0f0',
    fontSize: 16,
    fontWeight: '700',
    fontFamily: BODY_FONT,
  },
  flagModalSubtitle: {
    color: '#a0a0a0',
    fontSize: 13,
    marginTop: 8,
    fontFamily: BODY_FONT,
  },
  flagModalInput: {
    marginTop: 12,
    flex: 0,
  },
  flagModalActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
  },
  flagModalActionButton: {
    flex: 1,
  },
  cardImageModalRoot: {
    flex: 1,
  },
  cardImageModalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.85)',
  },
  cardImageModalCenterLayer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardModalImageFrame: {
    aspectRatio: 63 / 88,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: COLOURS.background,
    borderWidth: 1,
    borderColor: COLOURS.border,
  },
  cardModalImage: {
    width: '100%',
    height: '100%',
  },
  cardModalFallbackWrap: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 24,
  },
  cardModalFallbackText: {
    color: COLOURS.textMuted,
    fontSize: 13,
    fontFamily: BODY_FONT,
    textAlign: 'center',
  },
  flagReasonInput: {
    minHeight: 60,
    padding: 14,
    marginTop: 0,
    flex: 0,
  },
  flagConfirmText: {
    marginTop: 20,
    color: '#93c572',
    fontSize: 14,
    fontFamily: BODY_FONT,
    fontWeight: '600',
    textAlign: 'center',
  },
  flagErrorText: {
    marginTop: 8,
    color: COLOURS.highlight,
    fontSize: 13,
    fontFamily: BODY_FONT,
    fontWeight: '600',
    textAlign: 'center',
  },
  counterPill: {
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLOURS.border,
    backgroundColor: COLOURS.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  counterText: {
    color: COLOURS.textMuted,
    fontWeight: '700',
    fontFamily: BODY_FONT,
    fontSize: 14,
  },
  suggestions: {
    marginTop: 10,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: COLOURS.border,
    backgroundColor: COLOURS.surface,
  },
  suggestionRow: {
    minHeight: 44,
    paddingHorizontal: 12,
    justifyContent: 'center',
    borderTopWidth: 0,
    borderTopColor: 'transparent',
  },
  suggestionText: {
    color: COLOURS.text,
    fontSize: 14,
    fontFamily: BODY_FONT,
  },
  cardNameText: {
    color: COLOURS.cardName,
    fontWeight: '500',
    fontFamily: BODY_FONT,
    fontSize: 13,
  },
  chipsRow: {
    marginTop: 8,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#c8a882',
    backgroundColor: COLOURS.chipUnselected,
    justifyContent: 'center',
    maxWidth: '100%',
  },
  chipText: {
    color: '#c8a882',
    fontWeight: '500',
    fontFamily: BODY_FONT,
    fontSize: 13,
  },
  removeMark: {
    color: '#9b2335',
    fontWeight: 'bold',
    fontFamily: BODY_FONT,
  },
  categoryChip: {
    minHeight: 40,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    backgroundColor: '#111111',
    justifyContent: 'center',
  },
  categoryChipSelected: {
    backgroundColor: '#93c572',
    borderColor: '#93c572',
  },
  categoryChipText: {
    fontFamily: BODY_FONT,
    fontSize: 13,
  },
  primaryButton: {
    minHeight: 52,
    borderRadius: 10,
    backgroundColor: COLOURS.primaryButton,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  primaryButtonDisabled: {
    opacity: 0.5,
  },
  primaryButtonPressed: {
    opacity: 0.9,
  },
  primaryButtonText: {
    color: COLOURS.text,
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 1,
    fontFamily: BODY_FONT,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
    marginTop: 20,
  },
  tertiaryButton: {
    minHeight: 48,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLOURS.border,
    backgroundColor: COLOURS.surface,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
    flexGrow: 0,
  },
  tertiaryButtonText: {
    color: COLOURS.textMuted,
    fontSize: 15,
    fontWeight: '400',
    fontFamily: BODY_FONT,
  },
  startOverButton: {
    backgroundColor: COLOURS.titleAccent,
    borderColor: COLOURS.titleAccent,
  },
  startOverButtonText: {
    color: '#1a1200',
    fontWeight: '600',
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  loadingText: {
    color: COLOURS.textMuted,
    fontWeight: '700',
    fontFamily: BODY_FONT,
    fontSize: 14,
  },
  errorText: {
    marginTop: 10,
    color: COLOURS.highlight,
    fontWeight: '700',
    lineHeight: 20,
    fontFamily: BODY_FONT,
    fontSize: 14,
  },
  helperBox: {
    padding: 12,
    borderRadius: 12,
    borderWidth: 0,
    backgroundColor: COLOURS.surface,
    marginBottom: 16,
  },
  helperHint: {
    color: '#a0a0a0',
    fontFamily: 'serif',
    textAlign: 'left',
    fontSize: 12,
    marginTop: 8,
  },
  helperText: {
    color: COLOURS.textMuted,
    lineHeight: 20,
    fontWeight: '400',
    fontFamily: BODY_FONT,
    fontSize: 14,
  },
  rulingText: {
    color: COLOURS.rulingText,
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 24,
    fontFamily: BODY_FONT,
  },
  explanationText: {
    color: '#f0f0f0',
    fontSize: 14,
    lineHeight: 22,
    marginBottom: 6,
    fontFamily: Platform.OS === 'ios' ? 'Helvetica Neue' : 'sans-serif',
  },
  rulesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  ruleTag: {
    minHeight: 30,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#c8a882',
    backgroundColor: '#1a1200',
    justifyContent: 'center',
    maxWidth: '100%',
  },
  ruleTagText: {
    color: '#c8a882',
    fontWeight: '600',
    fontFamily: BODY_FONT,
    fontSize: 12,
  },
  refineDivider: {
    height: 1,
    backgroundColor: '#1e1e1e',
    width: '100%',
    marginVertical: 16,
  },
  refineInput: {
    backgroundColor: '#111111',
    borderWidth: 1,
    borderColor: '#1e1e1e',
    borderRadius: 12,
    padding: 14,
    color: '#f0f0f0',
    fontSize: 16,
    minHeight: 80,
    fontFamily: BODY_FONT,
  },
  refineButtonBase: {
    minHeight: 44,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderWidth: 1,
    marginTop: 12,
  },
  refineButtonEnabled: {
    backgroundColor: COLOURS.primaryButton,
    borderColor: COLOURS.primaryButton,
  },
  refineButtonDisabled: {
    backgroundColor: '#111111',
    borderColor: '#1e1e1e',
  },
  refineButtonTextEnabled: {
    color: COLOURS.text,
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 1,
    fontFamily: BODY_FONT,
  },
  refineButtonTextDisabled: {
    color: '#3a3a3a',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 1,
    fontFamily: BODY_FONT,
  },
  refineErrorText: {
    color: '#9b2335',
    fontSize: 12,
    marginTop: 4,
    fontFamily: BODY_FONT,
  },
  secondaryButton: {
    marginTop: 12,
    minHeight: 52,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#9b2335',
    backgroundColor: 'transparent',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  secondaryButtonText: {
    color: '#9b2335',
    fontSize: 13,
    fontWeight: '400',
    fontFamily: BODY_FONT,
    textAlign: 'center',
  },
  flagButton: {
    width: '100%',
    marginTop: 0,
    minHeight: 52,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#9b2335',
    backgroundColor: 'transparent',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  shareButton: {
    width: '100%',
    marginTop: 0,
    minHeight: 52,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#c8a882',
    backgroundColor: 'transparent',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  flagButtonText: {
    color: '#9b2335',
    fontSize: 15,
    fontWeight: '700',
    fontFamily: BODY_FONT,
    textAlign: 'center',
  },
  shareButtonText: {
    color: '#c8a882',
    fontSize: 15,
    fontWeight: '700',
    fontFamily: BODY_FONT,
    textAlign: 'center',
  },
  carouselArrow: {
    position: 'absolute',
    top: '50%',
    width: 36,
    height: 36,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    transform: [{ translateY: -18 }],
    zIndex: 2,
  },
  carouselArrowLabel: {
    color: '#c8a882',
    fontSize: 24,
  },
  carouselDotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
  },
  carouselDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    margin: 3,
    backgroundColor: '#2a2a2a',
  },
  carouselDotActive: {
    backgroundColor: '#c8a882',
  },
  carouselCardName: {
    color: '#c8a882',
    fontSize: 13,
    textAlign: 'center',
    letterSpacing: 1,
    marginTop: 6,
    fontFamily: BODY_FONT,
  },
  pressed: {
    opacity: 0.85,
  },
});

