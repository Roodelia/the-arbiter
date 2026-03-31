import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

const BACKEND_BASE_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

const GENERIC_ERROR_MESSAGE = 'Something went wrong. Please try again.';

const COLOURS = {
  background: '#000000',
  surface: '#111111',
  titleAccent: '#c8a882',
  primaryButton: '#9b2335',
  chipUnselected: '#111111',
  cardName: '#7C6F9B',
  rulingText: '#93c572',
  text: '#f0f0f0',
  textMuted: '#a0a0a0',
  border: '#1e1e1e',
} as const;

const BODY_FONT = 'sans-serif';

type SharedRulingRow = {
  id: string;
  case_id?: string | null;
  cards?: unknown;
  /** Stored as text: legacy plain/comma-separated string, or JSON.stringify(string[]). */
  category?: unknown;
  situation?: string | null;
  ruling: string;
  explanation: string;
  rules_cited?: unknown;
  cr_version?: string | null;
  created_at?: string;
};

function normalizeCardNames(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((c) => (typeof c === 'string' ? c.trim() : String(c).trim()))
    .filter(Boolean);
}

function normalizeRulesCited(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((r) => (typeof r === 'string' ? r.trim() : String(r).trim()))
    .filter(Boolean);
}

/** Shared ruling category: native array from DB, JSON array string, legacy comma-separated, or single label. */
function parseSharedCategoryLabels(raw: unknown): string[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) {
    return raw
      .map((x) => (typeof x === 'string' ? x.trim() : String(x).trim()))
      .filter(Boolean);
  }
  if (typeof raw !== 'string') return [];
  const trimmed = raw.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed
          .map((x) => (typeof x === 'string' ? x.trim() : String(x).trim()))
          .filter(Boolean);
      }
    } catch {
      /* fall through */
    }
  }
  if (trimmed.includes(',')) {
    return trimmed
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [trimmed];
}

function formatCrVersionLabel(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (
    Number.isNaN(date.getTime()) ||
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  const readable = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
  return `Comprehensive Rules (${readable})`;
}

export default function SharedRulingScreen() {
  const rawId = useLocalSearchParams<{ id: string | string[] }>().id;
  const shareId =
    typeof rawId === 'string'
      ? rawId
      : Array.isArray(rawId)
        ? rawId[0] ?? ''
        : '';

  const router = useRouter();
  const { width: windowWidth } = useWindowDimensions();
  /** Same width rule as Step 1 carousel in app/index.tsx */
  const cardPreviewWidth =
    Platform.OS === 'web'
      ? Math.min(windowWidth - 32, 400)
      : windowWidth - 32;

  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [ruling, setRuling] = useState<SharedRulingRow | null>(null);
  /** Card name → image URI or null after Scryfall fetch (undefined = not yet fetched). */
  const [imageUriCache, setImageUriCache] = useState<
    Record<string, string | null>
  >({});
  const imageUriCacheRef = useRef(imageUriCache);
  imageUriCacheRef.current = imageUriCache;
  const [activeCardPopup, setActiveCardPopup] = useState<string | null>(null);

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
    let cancelled = false;

    async function load() {
      if (!shareId || !BACKEND_BASE_URL) {
        setNotFound(!shareId);
        setLoading(false);
        setErrorMessage(shareId ? GENERIC_ERROR_MESSAGE : null);
        return;
      }

      setLoading(true);
      setNotFound(false);
      setErrorMessage(null);
      setRuling(null);

      try {
        const res = await fetch(
          `${BACKEND_BASE_URL}/share/${encodeURIComponent(shareId)}`
        );
        if (res.status === 404) {
          if (!cancelled) {
            setNotFound(true);
          }
          return;
        }
        if (!res.ok) {
          throw new Error('fetch failed');
        }
        const json = (await res.json()) as SharedRulingRow;
        if (cancelled) return;
        setRuling(json);
      } catch {
        if (!cancelled) {
          setErrorMessage(GENERIC_ERROR_MESSAGE);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [shareId]);

  useEffect(() => {
    setActiveCardPopup(null);
  }, [shareId, ruling?.id]);

  useEffect(() => {
    if (!activeCardPopup) return;
    const name = activeCardPopup;
    if (Object.prototype.hasOwnProperty.call(imageUriCacheRef.current, name)) {
      return;
    }

    void fetchCardImageUri(name).then((uri) => {
      setImageUriCache((prev) => {
        if (Object.prototype.hasOwnProperty.call(prev, name)) return prev;
        return { ...prev, [name]: uri };
      });
    });
  }, [activeCardPopup, fetchCardImageUri]);

  const cardNames = ruling ? normalizeCardNames(ruling.cards) : [];
  const rulesCited = ruling ? normalizeRulesCited(ruling.rules_cited) : [];
  const categoryLabels = useMemo(
    () => (ruling ? parseSharedCategoryLabels(ruling.category) : []),
    [ruling?.category],
  );
  const crVersionLabel = useMemo(
    () => formatCrVersionLabel(ruling?.cr_version),
    [ruling?.cr_version],
  );

  const modalCardName = activeCardPopup;
  const modalCachedUri = modalCardName ? imageUriCache[modalCardName] : undefined;
  const modalShowLoading =
    !!modalCardName &&
    !Object.prototype.hasOwnProperty.call(imageUriCache, modalCardName);

  return (
    <View style={styles.root}>
      <ScrollView
        bounces={false}
        overScrollMode="never"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        directionalLockEnabled>
        <View style={styles.logoImageWrap}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Go to ManaJudge home"
            style={styles.logoPressable}
            onPress={() => router.push('/')}>
            <Image
              source={require('../../assets/images/manajudge_title.png')}
              style={styles.logoImage}
              resizeMode="contain"
            />
          </Pressable>
        </View>
        <Text style={styles.sharedTagline}>
          Pre-Stack Clarity for Magic: The Gathering
        </Text>

        {loading ? (
          <View style={styles.centeredBlock}>
            <ActivityIndicator color={COLOURS.rulingText} size="large" />
            <Text style={styles.loadingCaption}>Loading ruling…</Text>
          </View>
        ) : null}

        {!loading && notFound ? (
          <Text style={styles.errorText}>Ruling not found</Text>
        ) : null}

        {!loading && errorMessage && !notFound ? (
          <Text style={styles.errorText}>{errorMessage}</Text>
        ) : null}

        {!loading && ruling && !notFound && !errorMessage ? (
          <>
            <View style={styles.resultCard}>
              <Text style={[styles.sectionLabel, { marginTop: 0 }]}>Cards</Text>

              {cardNames.length > 0 ? (
                <View style={styles.chipsRow}>
                  {cardNames.map((name, i) => (
                    <Pressable
                      key={`${name}-${i}`}
                      accessibilityRole="button"
                      accessibilityLabel={`Show card image for ${name}`}
                      onPress={() => setActiveCardPopup(name)}
                      style={({ pressed }) => [
                        styles.readOnlyChip,
                        pressed && styles.chipPressed,
                        Platform.OS === 'web' && styles.readOnlyChipWeb,
                      ]}>
                      <Text style={styles.chipText} numberOfLines={1}>
                        {name}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}

              {ruling.situation?.trim() || categoryLabels.length > 0 ? (
                <View style={styles.situationBlock}>
                  <Text style={[styles.sectionLabel, { marginTop: 0 }]}>SITUATION</Text>
                  {ruling.situation?.trim() ? (
                    <Text style={styles.situationText}>
                      {ruling.situation.trim()}
                    </Text>
                  ) : null}
                  {categoryLabels.length > 0 ? (
                    <View style={styles.chipsRow}>
                      {categoryLabels.map((label, idx) => (
                        <View
                          key={`${label}-${idx}`}
                          style={[
                            styles.categoryChip,
                            styles.categoryChipSelected,
                          ]}>
                          <Text
                            style={[
                              styles.categoryChipText,
                              styles.categoryChipTextSelected,
                            ]}
                            numberOfLines={2}>
                            {label}
                          </Text>
                        </View>
                      ))}
                    </View>
                  ) : null}
                </View>
              ) : null}

              <Text style={styles.sectionLabel}>
                RULING
              </Text>
              <Text style={styles.rulingText}>{ruling.ruling}</Text>

              <Text style={styles.sectionLabel}>
                EXPLANATION
              </Text>
              {(() => {
                const explanationLines = ruling.explanation
                  .split('\n')
                  .map((line) => line.replace(/^[\s\*\-•]+/, '').trim())
                  .filter(Boolean);

                return explanationLines.map((line, index) => (
                  <View
                    key={index}
                    style={styles.explanationRow}>
                    <Text
                      style={[styles.explanationText, styles.explanationBullet]}
                      accessible={false}>
                      {'\u2022'}
                    </Text>
                    <Text style={[styles.explanationText, styles.explanationLine]}>
                      {line}
                    </Text>
                  </View>
                ));
              })()}

              <Text style={styles.sectionLabel}>
                RULES CITED
              </Text>
              <View style={styles.rulesRow}>
                {rulesCited.map((r, i) => (
                  <View key={`${r}-${i}`} style={styles.ruleTag}>
                    <Text style={styles.ruleTagText} numberOfLines={3}>
                      {r}
                    </Text>
                  </View>
                ))}
              </View>
              {crVersionLabel ? (
                <Text style={styles.crVersionText}>{crVersionLabel}</Text>
              ) : null}
            </View>

            <Pressable
              onPress={() => router.push('/')}
              style={({ pressed }) => [
                styles.primaryButton,
                pressed && styles.primaryButtonPressed,
              ]}>
              <Text style={styles.primaryButtonText}>Ask ManaJudge</Text>
            </Pressable>
          </>
        ) : null}
      </ScrollView>

      <Modal
        visible={modalCardName !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setActiveCardPopup(null)}>
        <View style={styles.cardImageModalRoot}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Dismiss card image"
            style={styles.cardImageModalBackdrop}
            onPress={() => setActiveCardPopup(null)}
          />
          <View
            style={styles.cardImageModalCenterLayer}
            pointerEvents="box-none">
            <View
              style={[styles.cardModalImageFrame, { width: cardPreviewWidth }]}>
              {modalShowLoading ? (
                <View style={styles.cardModalSpinnerWrap}>
                  <ActivityIndicator
                    color={COLOURS.titleAccent}
                    size="large"
                  />
                </View>
              ) : modalCachedUri ? (
                <Image
                  source={{ uri: modalCachedUri }}
                  style={styles.cardModalImage}
                  resizeMode="cover"
                />
              ) : (
                <View style={styles.cardModalSpinnerWrap}>
                  <Text style={styles.cardPopupFallback}>No image found</Text>
                </View>
              )}
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: COLOURS.background,
    overflow: 'visible',
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 16,
    paddingVertical: 24,
    paddingBottom: 40,
    maxWidth: 600,
    width: '100%',
    alignSelf: 'center',
    overflow: 'visible',
  },
  logoImageWrap: {
    width: '100%',
    alignItems: 'center',
  },
  logoPressable: {
    width: '100%',
  },
  logoImage: {
    width: '100%',
    height: 60,
    alignSelf: 'center',
    marginVertical: 10,
  },
  sharedTagline: {
    color: '#a0a0a0',
    fontSize: 14,
    fontFamily: 'serif',
    textAlign: 'center',
    marginBottom: 16,
  },
  centeredBlock: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 32,
    gap: 12,
  },
  loadingCaption: {
    color: COLOURS.textMuted,
    fontSize: 14,
    fontFamily: BODY_FONT,
    fontWeight: '600',
  },
  errorText: {
    marginTop: 10,
    color: COLOURS.primaryButton,
    fontWeight: '700',
    lineHeight: 20,
    fontFamily: BODY_FONT,
    fontSize: 14,
    textAlign: 'center',
  },
  chipPressed: {
    opacity: 0.85,
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
  cardModalSpinnerWrap: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 24,
  },
  cardModalImage: {
    width: '100%',
    height: '100%',
  },
  cardPopupFallback: {
    color: COLOURS.textMuted,
    fontSize: 14,
    fontFamily: BODY_FONT,
    paddingVertical: 20,
    textAlign: 'center',
  },
  resultCard: {
    marginTop: 12,
    padding: 18,
    borderRadius: 14,
    backgroundColor: COLOURS.surface,
    borderWidth: 1,
    borderColor: COLOURS.border,
    overflow: 'visible',
  },
  sectionLabel: {
    color: '#585858',
    fontSize: 10,
    fontWeight: '600',
    marginBottom: 8,
    marginTop: 14,
    textTransform: 'uppercase',
    letterSpacing: 3,
    fontFamily: BODY_FONT,
  },
  chipsRow: {
    marginTop: 4,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    overflow: 'visible',
  },
  readOnlyChip: {
    alignSelf: 'flex-start',
    minHeight: 30,
    paddingHorizontal: 14,
    paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#7C6F9B',
    backgroundColor: COLOURS.chipUnselected,
    justifyContent: 'center',
    maxWidth: '100%',
  },
  readOnlyChipWeb: {
    cursor: 'pointer',
  },
  chipText: {
    color: '#7C6F9B',
    fontWeight: '500',
    fontFamily: BODY_FONT,
    fontSize: 14,
  },
  categoryChip: {
    minHeight: 30,
    paddingHorizontal: 14,
    paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    backgroundColor: '#111111',
    justifyContent: 'center',
    maxWidth: '100%',
  },
  categoryChipSelected: {
    backgroundColor: '#c8a882',
    borderColor: '#c8a882',
  },
  categoryChipText: {
    fontFamily: BODY_FONT,
    fontSize: 14,
  },
  categoryChipTextSelected: {
    color: '#111111',
    fontWeight: '700',
  },
  situationBlock: {
    marginTop: 14,
  },
  situationText: {
    marginTop: 6,
    color: COLOURS.text,
    fontSize: 14,
    lineHeight: 22,
    fontFamily: BODY_FONT,
  },
  rulingText: {
    marginTop: 6,
    color: COLOURS.rulingText,
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 24,
    fontFamily: BODY_FONT,
  },
  explanationRow: {
    flexDirection: 'row',
    marginBottom: 6,
    paddingRight: 8,
  },
  explanationText: {
    color: '#f0f0f0',
    fontSize: 14,
    lineHeight: 22,
    fontFamily: Platform.OS === 'ios' ? 'Helvetica Neue' : 'sans-serif',
  },
  explanationBullet: {
    minWidth: 24,
    flexShrink: 0,
  },
  explanationLine: {
    flex: 1,
  },
  rulesRow: {
    marginTop: 10,
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
  crVersionText: {
    marginTop: 14,
    color: '#a0a0a0',
    fontSize: 12,
    fontFamily: BODY_FONT,
    textAlign: 'right',
  },
  primaryButton: {
    marginTop: 24,
    minHeight: 52,
    borderRadius: 10,
    backgroundColor: COLOURS.primaryButton,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  primaryButtonPressed: {
    opacity: 0.9,
  },
  primaryButtonText: {
    color: COLOURS.text,
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 1,
    fontFamily: BODY_FONT,
  },
});
