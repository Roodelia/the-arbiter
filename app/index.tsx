import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SvgXml } from 'react-native-svg';

type ScryfallAutocompleteResponse = {
  data: string[];
};

type CategoriesResponse = {
  categories: string[];
};

type RulingResponse = {
  ruling: string;
  explanation: string;
  rules_cited: string[];
  oracle_referenced: string;
};

function CardName({ name }: { name: string }) {
  return <Text style={styles.cardNameText}>{name}</Text>;
}

const MAX_CARDS = 6;
const BACKEND_BASE_URL = 'https://the-arbiter-production.up.railway.app';

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
<svg width="800" height="200" viewBox="0 0 800 200" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="gold" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%"   stop-color="#c8a882"/>
      <stop offset="45%"  stop-color="#e8c9a0"/>
      <stop offset="65%"  stop-color="#c8a882"/>
      <stop offset="100%" stop-color="#9a7a58"/>
    </linearGradient>
  </defs>
  <!-- Background -->
  <rect width="800" height="200" fill="#000000"/>
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

export default function Index() {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [selectedCards, setSelectedCards] = useState<string[]>([]);

  const [categories, setCategories] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [isCategoriesLoading, setIsCategoriesLoading] = useState(false);

  const [situation, setSituation] = useState('');
  const [isRulingLoading, setIsRulingLoading] = useState(false);

  const [rulingResult, setRulingResult] = useState<RulingResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [flagged, setFlagged] = useState(false);
  const [flagging, setFlagging] = useState(false);
  const [flagReasonText, setFlagReasonText] = useState('');
  const [flagError, setFlagError] = useState<string | null>(null);

  const [refineText, setRefineText] = useState('');
  const [refining, setRefining] = useState(false);
  const [refineError, setRefineError] = useState('');

  const scrollViewRef = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const rulingCardScrollYRef = useRef(0);

  const autocompleteAbortRef = useRef<AbortController | null>(null);
  const categoriesAbortRef = useRef<AbortController | null>(null);
  const rulingAbortRef = useRef<AbortController | null>(null);

  const canRequestCategories = selectedCards.length >= 1;
  const canRequestRuling = selectedCards.length >= 1 && !isRulingLoading;
  const canGoToStep2 = selectedCards.length >= 1;

  const selectedCardsCountLabel = useMemo(
    () => `${selectedCards.length}/${MAX_CARDS}`,
    [selectedCards.length]
  );

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

      setSelectedCards((prev) => {
        if (prev.length >= MAX_CARDS) return prev;
        const next = uniqCaseInsensitive([...prev, cardName]);
        return next.slice(0, MAX_CARDS);
      });

      setQuery('');
      setSuggestions([]);
      setRulingResult(null);
      setStep((prev) => (prev === 3 ? 2 : prev));
    },
    [setSelectedCards]
  );

  const removeCard = useCallback((cardName: string) => {
    setSelectedCards((prev) => prev.filter((c) => c !== cardName));
    setRulingResult(null);
    setStep((prev) => (prev === 3 ? 2 : prev));
  }, []);

  const toggleCategory = useCallback((category: string) => {
    setSelectedCategory((prev) => (prev === category ? null : category));
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

      if (!res.ok) throw new Error('Failed to fetch categories');
      const json = (await res.json()) as CategoriesResponse;
      const next = Array.isArray(json.categories) ? json.categories : [];
      setCategories(next);
      setSelectedCategory((prev) => (prev && next.includes(prev) ? prev : null));
    } catch (err) {
      if ((err as { name?: string } | null)?.name === 'AbortError') return;
      setCategories([]);
      setSelectedCategory(null);
      setErrorMessage(
        "Couldn't load interaction categories. Make sure the backend is running on port 3000."
      );
    } finally {
      setIsCategoriesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (step !== 2 || !canRequestCategories) {
      categoriesAbortRef.current?.abort();
      if (step < 2) {
        setCategories([]);
        setSelectedCategory(null);
      }
      return;
    }

    void fetchCategories(selectedCards);
  }, [canRequestCategories, fetchCategories, selectedCards, step]);

  useEffect(() => {
    if (step > 1 && selectedCards.length < 1) {
      setStep(1);
    }
  }, [selectedCards.length, step]);

  const requestRuling = useCallback(async () => {
    setErrorMessage(null);
    setRulingResult(null);

    rulingAbortRef.current?.abort();
    const controller = new AbortController();
    rulingAbortRef.current = controller;

    setIsRulingLoading(true);
    try {
      const payload: { cards: string[]; situation?: string; category?: string } = {
        cards: selectedCards,
      };
      if (selectedCategory) payload.category = selectedCategory;
      if (situation.trim()) payload.situation = situation.trim();

      const res = await fetch(`${BACKEND_BASE_URL}/ruling`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!res.ok) throw new Error('Failed to fetch ruling');
      const json = (await res.json()) as RulingResponse;
      setRulingResult(json);
      setStep(3);
    } catch (err) {
      if ((err as { name?: string } | null)?.name === 'AbortError') return;
      setErrorMessage(
        "Couldn't get a ruling. Check that the backend is running and your API keys are set."
      );
    } finally {
      setIsRulingLoading(false);
    }
  }, [selectedCards, selectedCategory, situation]);

  const onPressRuleTag = useCallback((ruleLine: string) => {
    Alert.alert('Rule cited', ruleLine);
  }, []);

  const onFlag = useCallback(async () => {
    if (!rulingResult || flagging || flagged) return;
    setFlagError(null);
    setFlagging(true);
    try {
      const res = await fetch(`${BACKEND_BASE_URL}/flag`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cards: selectedCards,
          category: selectedCategory ?? undefined,
          situation: situation.trim() || undefined,
          ruling: rulingResult.ruling,
          explanation: rulingResult.explanation,
          rules_cited: rulingResult.rules_cited,
          reason: flagReasonText.trim() || undefined,
        }),
      });
      if (!res.ok) throw new Error('Flag request failed');
      setFlagged(true);
    } catch {
      setFlagError('Could not flag the ruling. Please try again.');
    } finally {
      setFlagging(false);
    }
  }, [rulingResult, selectedCards, selectedCategory, situation, flagReasonText, flagging, flagged]);

  const onRefineRuling = useCallback(async () => {
    const detail = refineText.trim();
    if (!detail || refining) return;
    setRefineError('');
    setRefining(true);
    try {
      const res = await fetch(`${BACKEND_BASE_URL}/ruling`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cards: selectedCards,
          category: selectedCategory ?? undefined,
          situation: detail,
        }),
      });
      if (!res.ok) throw new Error('Failed to refine ruling');
      const json = (await res.json()) as RulingResponse;
      setRulingResult(json);
      setRefineText('');
      requestAnimationFrame(() => {
        scrollViewRef.current?.scrollTo({
          y: Math.max(0, rulingCardScrollYRef.current - 8),
          animated: true,
        });
      });
    } catch {
      setRefineError('Could not refine ruling. Try again.');
    } finally {
      setRefining(false);
    }
  }, [refineText, refining, selectedCards, selectedCategory]);

  const goToStep1 = useCallback(() => {
    setErrorMessage(null);
    setRulingResult(null);
    setSelectedCategory(null);
    setSituation('');
    setFlagged(false);
    setFlagging(false);
    setFlagReasonText('');
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

  return (
    <ScrollView
      ref={scrollViewRef}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled">
      <SvgXml
        xml={ARBITER_LOGO_XML}
        width={280}
        height={70}
        style={{ alignSelf: 'center', marginBottom: 8 }}
      />

      {step === 1 ? (
        <>
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Step 1: Specify cards</Text>
            <View style={styles.searchRow}>
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search for a card..."
              placeholderTextColor={COLOURS.textMuted}
                style={styles.input}
                autoCorrect={false}
                autoCapitalize="none"
              />
              <View style={styles.counterPill}>
                <Text style={styles.counterText}>{selectedCardsCountLabel}</Text>
              </View>
            </View>

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

            <View style={styles.chipsRow}>
              {selectedCards.map((c) => (
                <Pressable
                  key={c}
                  onPress={() => removeCard(c)}
                  style={({ pressed }) => [styles.chip, pressed && styles.pressed]}>
                  <Text style={styles.chipText} numberOfLines={1}>
                    <CardName name={c} /> {'  '}
                    <Text style={styles.removeMark}>×</Text>
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          {!canGoToStep2 ? (
            <View style={styles.helperBox}>
              <Text style={styles.helperText}>
                Add at least 1 card to continue.
              </Text>
            </View>
          ) : null}

          <View style={styles.section}>
            <Pressable
              onPress={goToStep2}
              disabled={!canGoToStep2}
              style={({ pressed }) => [
                styles.primaryButton,
                !canGoToStep2 && styles.primaryButtonDisabled,
                pressed && canGoToStep2 && styles.primaryButtonPressed,
              ]}>
              <Text style={styles.primaryButtonText}>Next: Describe the situation</Text>
            </Pressable>
          </View>
        </>
      ) : null}

      {step === 2 ? (
        <>
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Selected cards</Text>
            <View style={styles.chipsRow}>
              {selectedCards.map((c) => (
                <Pressable
                  key={c}
                  onPress={() => removeCard(c)}
                  style={({ pressed }) => [styles.chip, pressed && styles.pressed]}>
                  <Text style={styles.chipText} numberOfLines={1}>
                    <CardName name={c} /> {'  '}
                    <Text style={styles.removeMark}>×</Text>
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Step 2: Select category and/or describe situation</Text>
            {isCategoriesLoading ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator color={COLOURS.chipSelected} />
                <Text style={styles.loadingText}>Finding likely interactions…</Text>
              </View>
            ) : null}

            <View style={styles.chipsRow}>
              {categories.map((cat) => {
                const selected = cat === selectedCategory;
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
            <Text style={styles.sectionLabel}>Situation (optional)</Text>
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
            <View style={styles.buttonRow}>
              <Pressable
                onPress={goToStep1}
                style={({ pressed }) => [
                  styles.tertiaryButton,
                  pressed && styles.pressed,
                ]}>
                <Text style={styles.tertiaryButtonText}>Back</Text>
              </Pressable>

              <Pressable
                onPress={requestRuling}
                disabled={!canRequestRuling}
                style={({ pressed }) => [
                  styles.primaryButton,
                  (!canRequestRuling || isRulingLoading) && styles.primaryButtonDisabled,
                  pressed && canRequestRuling && styles.primaryButtonPressed,
                ]}>
                {isRulingLoading ? (
                  <View style={styles.loadingRow}>
                    <ActivityIndicator color={COLOURS.text} />
                    <Text style={styles.primaryButtonText}>Getting ruling…</Text>
                  </View>
                ) : (
                  <Text style={styles.primaryButtonText}>Judge!!!</Text>
                )}
              </Pressable>
            </View>

            {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}
          </View>
        </>
      ) : null}

      {step === 3 ? (
        <>
          {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}

          {rulingResult ? (
            <View
              style={styles.resultCard}
              onLayout={(e) => {
                rulingCardScrollYRef.current = e.nativeEvent.layout.y;
              }}>
              <Text style={styles.sectionLabel}>Step 3: View ruling</Text>

              <Text style={styles.resultHeading}>RULING</Text>
              <Text style={styles.rulingText}>{rulingResult.ruling}</Text>

              <Text style={[styles.resultHeading, styles.resultHeadingSpacer]}>
                EXPLANATION
              </Text>
              <Text style={styles.explanationText}>{rulingResult.explanation}</Text>

              <Text style={[styles.resultHeading, styles.resultHeadingSpacer]}>
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

              <View style={styles.refineDivider} />
              <Text style={styles.refineSectionLabel}>Incorrect scenario?</Text>
              <TextInput
                value={refineText}
                onChangeText={setRefineText}
                placeholder="Describe your board state in more detail..."
                placeholderTextColor="#3a3a3a"
                style={styles.refineInput}
                multiline
                textAlignVertical="top"
              />
              <Pressable
                onPress={onRefineRuling}
                disabled={refineText.trim().length === 0 || refining}
                style={({ pressed }) => [
                  styles.refineButtonBase,
                  refineText.trim().length > 0 && !refining
                    ? styles.refineButtonEnabled
                    : styles.refineButtonDisabled,
                  pressed &&
                    refineText.trim().length > 0 &&
                    !refining &&
                    styles.pressed,
                ]}>
                <Text
                  style={
                    refineText.trim().length > 0 && !refining
                      ? styles.refineButtonTextEnabled
                      : styles.refineButtonTextDisabled
                  }>
                  {refining ? 'Arbitering...' : 'Judge, again!!!'}
                </Text>
              </Pressable>
              {refineError ? (
                <Text style={styles.refineErrorText}>{refineError}</Text>
              ) : null}

              <View style={styles.buttonRow}>
                <Pressable
                  onPress={goToStep2}
                  style={({ pressed }) => [
                    styles.tertiaryButton,
                    pressed && styles.pressed,
                  ]}>
                  <Text style={styles.tertiaryButtonText}>Back</Text>
                </Pressable>

                <Pressable
                  onPress={goToStep1}
                  style={({ pressed }) => [
                    styles.tertiaryButton,
                    styles.startOverButton,
                    pressed && styles.pressed,
                  ]}>
                  <Text style={[styles.tertiaryButtonText, styles.startOverButtonText]}>Start over</Text>
                </Pressable>
              </View>

              {flagged ? (
                <Text style={styles.flagConfirmText}>✓ Ruling flagged for review. Thank you.</Text>
              ) : (
                <View style={styles.flagSection}>
                  <TextInput
                    value={flagReasonText}
                    onChangeText={setFlagReasonText}
                    placeholder="What was wrong with this ruling? (optional)"
                    placeholderTextColor="#3a3a3a"
                    style={[styles.input, styles.flagReasonInput]}
                    multiline
                    textAlignVertical="top"
                  />
                  <Pressable
                    onPress={onFlag}
                    disabled={flagging}
                    style={({ pressed }) => [
                      styles.secondaryButton,
                      flagging && styles.primaryButtonDisabled,
                      pressed && !flagging && styles.pressed,
                    ]}>
                    {flagging ? (
                      <View style={styles.loadingRow}>
                        <ActivityIndicator color="#9b2335" />
                        <Text style={styles.secondaryButtonText}>Flagging…</Text>
                      </View>
                    ) : (
                      <Text style={styles.secondaryButtonText}>Flag This Ruling</Text>
                    )}
                  </Pressable>
                  {flagError ? <Text style={styles.flagErrorText}>{flagError}</Text> : null}
                </View>
              )}
            </View>
          ) : (
            <View style={styles.helperBox}>
              <Text style={styles.helperText}>No ruling yet. Go back and request one.</Text>
            </View>
          )}
        </>
      ) : null}
    </ScrollView>
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
    borderBottomWidth: 1,
    borderBottomColor: COLOURS.border,
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
    fontSize: 14,
    fontFamily: BODY_FONT,
  },
  multilineInput: {
    minHeight: 100,
    padding: 14,
  },
  flagSection: {
    marginTop: 20,
    width: '100%',
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
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLOURS.border,
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
    marginTop: 12,
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
    minHeight: 44,
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
    fontSize: 16,
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
    borderWidth: 1,
    borderColor: COLOURS.border,
    backgroundColor: COLOURS.surface,
    marginBottom: 16,
  },
  helperText: {
    color: COLOURS.textMuted,
    lineHeight: 20,
    fontWeight: '600',
    fontFamily: BODY_FONT,
    fontSize: 14,
  },
  resultCard: {
    marginTop: 6,
    padding: 18,
    borderRadius: 14,
    backgroundColor: COLOURS.surface,
    borderWidth: 1,
    borderColor: COLOURS.border,
  },
  resultHeading: {
    color: '#585858',
    fontWeight: '900',
    letterSpacing: 3,
    fontSize: 10,
    fontFamily: BODY_FONT,
    textTransform: 'uppercase',
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
  explanationText: {
    marginTop: 6,
    color: COLOURS.text,
    fontSize: 14,
    lineHeight: 24,
    fontFamily: BODY_FONT,
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
  refineDivider: {
    height: 1,
    backgroundColor: '#1e1e1e',
    width: '100%',
    marginTop: 14,
  },
  refineSectionLabel: {
    fontSize: 10,
    letterSpacing: 3,
    color: '#585858',
    textTransform: 'uppercase',
    marginBottom: 8,
    marginTop: 8,
    fontFamily: BODY_FONT,
    fontWeight: '600',
  },
  refineInput: {
    backgroundColor: '#111111',
    borderWidth: 1,
    borderColor: '#1e1e1e',
    borderRadius: 12,
    padding: 14,
    color: '#f0f0f0',
    fontSize: 14,
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
    minHeight: 48,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#9b2335',
    backgroundColor: 'transparent',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  secondaryButtonText: {
    color: '#9b2335',
    fontSize: 13,
    fontWeight: '400',
    fontFamily: BODY_FONT,
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.85,
  },
});

