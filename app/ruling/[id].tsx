import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { SvgXml } from 'react-native-svg';
import { useLocalSearchParams, useRouter } from 'expo-router';

const BACKEND_BASE_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

const GENERIC_ERROR_MESSAGE = 'Something went wrong. Please try again.';

const COLOURS = {
  background: '#000000',
  surface: '#111111',
  titleAccent: '#c8a882',
  primaryButton: '#9b2335',
  chipUnselected: '#111111',
  cardName: '#c8a882',
  rulingText: '#93c572',
  text: '#f0f0f0',
  textMuted: '#a0a0a0',
  border: '#1e1e1e',
} as const;

const BODY_FONT = 'sans-serif';

const ARBITER_LOGO_XML = `
<svg width="800" height="200" viewBox="0 0 800 200" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="gold" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%"   stop-color="#c8a882"/>
      <stop offset="45%"  stop-color="#e8c9a0"/>
      <stop offset="65%"  stop-color="#c8a882"/>
      <stop offset="100%" stop-color="#9a7a58"/>
    </linearGradient>
  </defs>
  <rect width="800" height="200" fill="#000000"/>
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

type SharedRulingRow = {
  id: string;
  case_id?: string | null;
  cards?: unknown;
  category?: string | null;
  situation?: string | null;
  ruling: string;
  explanation: string;
  rules_cited?: unknown;
  created_at?: string;
};

type CarouselCard = {
  name: string;
  image_uri: string | null;
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

export default function SharedRulingScreen() {
  const rawId = useLocalSearchParams<{ id: string | string[] }>().id;
  const shareId =
    typeof rawId === 'string'
      ? rawId
      : Array.isArray(rawId)
        ? rawId[0] ?? ''
        : '';

  const router = useRouter();
  const { width } = useWindowDimensions();
  const cardWidth = Platform.OS === 'web' ? Math.min(width - 32, 400) : width - 32;

  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [ruling, setRuling] = useState<SharedRulingRow | null>(null);
  const [carouselCards, setCarouselCards] = useState<CarouselCard[]>([]);
  const [cardIndex, setCardIndex] = useState(0);
  const carouselLenRef = useRef(0);
  carouselLenRef.current = carouselCards.length;

  const swipeThreshold = 20;
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 10,
      onPanResponderRelease: (_, g) => {
        setCardIndex((prev) => {
          const len = carouselLenRef.current;
          if (len <= 1) return prev;
          if (g.dx < -swipeThreshold) {
            return prev < len - 1 ? prev + 1 : prev;
          }
          if (g.dx > swipeThreshold) {
            return prev > 0 ? prev - 1 : prev;
          }
          return prev;
        });
      },
    })
  ).current;

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
    if (!ruling) {
      setCarouselCards([]);
      setCardIndex(0);
      return;
    }
    const names = normalizeCardNames(ruling.cards);
    let cancelled = false;

    void (async () => {
      const uris = await Promise.all(names.map((n) => fetchCardImageUri(n)));
      if (cancelled) return;
      setCarouselCards(
        names.map((name, i) => ({ name, image_uri: uris[i] ?? null }))
      );
      setCardIndex(0);
    })();

    return () => {
      cancelled = true;
    };
  }, [ruling, fetchCardImageUri]);

  const cardNames = ruling ? normalizeCardNames(ruling.cards) : [];
  const rulesCited = ruling ? normalizeRulesCited(ruling.rules_cited) : [];

  return (
    <View style={styles.root}>
      <ScrollView
        bounces={false}
        overScrollMode="never"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        directionalLockEnabled>
        <SvgXml
          xml={ARBITER_LOGO_XML}
          width={280}
          height={70}
          style={styles.logo}
        />

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
            {carouselCards.length > 0 ? (
              <View style={styles.carouselOuter}>
                <View style={[styles.carouselFrame, { width: cardWidth }]}>
                  <View pointerEvents="box-only">
                    <View
                      {...panResponder.panHandlers}
                      style={styles.carouselAspect}>
                      {carouselCards[cardIndex]?.image_uri ? (
                        <Image
                          source={{
                            uri: carouselCards[cardIndex]!.image_uri as string,
                          }}
                          style={styles.carouselImage}
                          resizeMode="cover"
                        />
                      ) : (
                        <View style={styles.carouselPlaceholder} />
                      )}
                    </View>
                  </View>

                  {carouselCards.length > 1 && cardIndex > 0 ? (
                    <TouchableOpacity
                      onPress={() =>
                        setCardIndex((i) => Math.max(0, i - 1))
                      }
                      style={[
                        styles.carouselArrow,
                        { left: -18, opacity: Platform.OS === 'web' ? 1 : 0.5 },
                      ]}>
                      <Text style={styles.carouselArrowLabel}>‹</Text>
                    </TouchableOpacity>
                  ) : null}

                  {carouselCards.length > 1 &&
                  cardIndex < carouselCards.length - 1 ? (
                    <TouchableOpacity
                      onPress={() =>
                        setCardIndex((i) =>
                          Math.min(carouselCards.length - 1, i + 1)
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

                {carouselCards.length > 1 ? (
                  <View style={styles.carouselDotsRow}>
                    {carouselCards.map((_, index) => (
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
                  {carouselCards[cardIndex]?.name ?? ''}
                </Text>
              </View>
            ) : null}

            <View style={styles.resultCard}>
              <Text style={styles.sectionLabel}>Shared ruling</Text>

              {cardNames.length > 0 ? (
                <View style={styles.chipsRow}>
                  {cardNames.map((name, i) => (
                    <View key={`${name}-${i}`} style={styles.readOnlyChip}>
                      <Text style={styles.chipText} numberOfLines={1}>
                        {name}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : null}

              {ruling.category && ruling.category.trim() ? (
                <View style={[styles.chipsRow, styles.categoryChipsRow]}>
                  <View style={[styles.categoryChip, styles.categoryChipSelected]}>
                    <Text
                      style={[styles.categoryChipText, styles.categoryChipTextSelected]}
                      numberOfLines={2}>
                      {ruling.category.trim()}
                    </Text>
                  </View>
                </View>
              ) : null}

              {ruling.situation && ruling.situation.trim() ? (
                <View style={styles.situationBlock}>
                  <Text style={styles.resultHeading}>SITUATION</Text>
                  <Text style={styles.situationText}>{ruling.situation.trim()}</Text>
                </View>
              ) : null}

              <Text style={[styles.resultHeading, styles.rulingHeadingSpacing]}>
                RULING
              </Text>
              <Text style={styles.rulingText}>{ruling.ruling}</Text>

              <Text style={[styles.resultHeading, styles.resultHeadingSpacer]}>
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

              <Text style={[styles.resultHeading, styles.resultHeadingSpacer]}>
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
            </View>

            <Pressable
              onPress={() => router.push('/')}
              style={({ pressed }) => [
                styles.primaryButton,
                pressed && styles.primaryButtonPressed,
              ]}>
              <Text style={styles.primaryButtonText}>Get your own ruling</Text>
            </Pressable>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: COLOURS.background,
    overflow: 'hidden',
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 16,
    paddingVertical: 24,
    paddingBottom: 40,
    maxWidth: 600,
    width: '100%',
    alignSelf: 'center',
  },
  logo: {
    alignSelf: 'center',
    marginBottom: 8,
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
  carouselOuter: {
    width: '100%',
    alignItems: 'center',
    marginTop: 12,
    marginBottom: 8,
  },
  carouselFrame: {
    position: 'relative',
    overflow: 'visible',
  },
  carouselAspect: {
    width: '100%',
    aspectRatio: 63 / 88,
  },
  carouselImage: {
    width: '100%',
    height: '100%',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLOURS.border,
  },
  carouselPlaceholder: {
    width: '100%',
    height: '100%',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLOURS.border,
    backgroundColor: COLOURS.surface,
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
  resultCard: {
    marginTop: 12,
    padding: 18,
    borderRadius: 14,
    backgroundColor: COLOURS.surface,
    borderWidth: 1,
    borderColor: COLOURS.border,
  },
  sectionLabel: {
    color: '#585858',
    fontSize: 10,
    fontWeight: '600',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 3,
    fontFamily: BODY_FONT,
  },
  chipsRow: {
    marginTop: 4,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  categoryChipsRow: {
    marginTop: 12,
  },
  readOnlyChip: {
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
  resultHeading: {
    color: '#585858',
    fontWeight: '900',
    letterSpacing: 3,
    fontSize: 10,
    fontFamily: BODY_FONT,
    textTransform: 'uppercase',
  },
  rulingHeadingSpacing: {
    marginTop: 14,
  },
  resultHeadingSpacer: {
    marginTop: 14,
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
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 1,
    fontFamily: BODY_FONT,
  },
});
