import { BODY_FONT, COLOURS, GENERIC_ERROR_MESSAGE, TITLE_FONT } from '@/constants/theme';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

const BACKEND_BASE_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

type GoldenCaseRow = {
  id?: string;
  cards?: unknown;
  interaction_type?: string | null;
  difficulty?: string | null;
  expected_verdict?: string | null;
  created_at?: string;
};

type GoldenCasesResponse = {
  cases?: GoldenCaseRow[];
};

function normalizeCardNames(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((c) => (typeof c === 'string' ? c.trim() : String(c).trim()))
    .filter(Boolean);
}

function formatCardsLine(raw: unknown): string {
  const names = normalizeCardNames(raw);
  return names.join(' + ');
}

export default function GoldenCasesListScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cases, setCases] = useState<GoldenCaseRow[]>([]);

  const load = useCallback(async (signal: AbortSignal) => {
    if (!BACKEND_BASE_URL) {
      setError(GENERIC_ERROR_MESSAGE);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${BACKEND_BASE_URL}/admin/golden-cases`, {
        signal,
      });
      if (!res.ok) throw new Error('fetch failed');
      const json = (await res.json()) as GoldenCasesResponse;
      const list = Array.isArray(json.cases) ? json.cases : [];
      if (!signal.aborted) setCases(list);
    } catch (e) {
      if ((e as { name?: string } | null)?.name === 'AbortError') return;
      if (!signal.aborted) setError(GENERIC_ERROR_MESSAGE);
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    void load(ac.signal);
    return () => ac.abort();
  }, [load]);

  return (
    <View style={styles.root}>
      <ScrollView
        bounces={false}
        overScrollMode="never"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        directionalLockEnabled
      >
        <View style={styles.logoImageWrap}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Go to ManaJudge home"
            style={styles.logoPressable}
            onPress={() => router.push('/')}
          >
            <Image
              source={require('../../../assets/images/manajudge_title.png')}
              style={styles.logoImage}
              resizeMode="contain"
            />
          </Pressable>
        </View>
        <Text style={styles.sharedTagline}>
          Golden test cases — internal reference
        </Text>
        <View style={styles.refineDivider} />

        <View style={styles.listHeaderRow}>
          <Text style={styles.listTitle}>Cases</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add golden case"
            onPress={() => router.push('/admin/golden_cases/new')}
            style={({ pressed }) => [
              styles.addCompactButton,
              pressed && styles.addCompactButtonPressed,
            ]}
          >
            <Text style={styles.addCompactButtonText}>+</Text>
          </Pressable>
        </View>

        {loading ? (
          <View style={styles.centeredBlock}>
            <ActivityIndicator size="large" color={COLOURS.brandSoft} />
            <Text style={styles.loadingCaption}>Loading cases…</Text>
          </View>
        ) : null}

        {error ? (
          <Text style={styles.errorText}>{error}</Text>
        ) : null}

        {!loading && !error && cases.length === 0 ? (
          <Text style={styles.emptyHint}>No golden cases yet.</Text>
        ) : null}

        {!loading && !error
          ? cases.map((row, index) => {
              const key =
                typeof row.id === 'string' && row.id.length > 0
                  ? row.id
                  : `golden-case-${index}`;
              const rowId =
                typeof row.id === 'string' && row.id.length > 0 ? row.id : null;
              return (
                <Pressable
                  key={key}
                  accessibilityRole="button"
                  accessibilityLabel="Open golden case"
                  disabled={!rowId}
                  onPress={() => {
                    if (!rowId) return;
                    router.push({
                      pathname: '/admin/golden_cases/[id]',
                      params: { id: rowId },
                    });
                  }}
                  style={({ pressed }) => [
                    styles.caseCard,
                    rowId && pressed && styles.pressed,
                    !rowId && styles.caseCardDisabled,
                  ]}
                >
                  <View style={styles.rulingFocusStrip} />
                  <Text style={styles.cardsHeadline} numberOfLines={2}>
                    {formatCardsLine(row.cards)}
                  </Text>
                  <View style={styles.chipsRow}>
                    {typeof row.interaction_type === 'string' &&
                    row.interaction_type.trim().length > 0 ? (
                      <View style={styles.categoryChip}>
                        <Text style={styles.categoryChipText} numberOfLines={1}>
                          {row.interaction_type.trim()}
                        </Text>
                      </View>
                    ) : null}
                    {typeof row.difficulty === 'string' &&
                    row.difficulty.trim().length > 0 ? (
                      <View style={styles.categoryChip}>
                        <Text style={styles.categoryChipText} numberOfLines={1}>
                          {row.difficulty.trim()}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                  <Text
                    style={styles.verdictPreview}
                    numberOfLines={2}
                    ellipsizeMode="tail"
                  >
                    {typeof row.expected_verdict === 'string'
                      ? row.expected_verdict
                      : ''}
                  </Text>
                </Pressable>
              );
            })
          : null}
      </ScrollView>
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
    paddingTop: 12,
    paddingBottom: 24,
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
    color: COLOURS.textSecondary,
    fontSize: 14,
    fontFamily: 'serif',
    textAlign: 'center',
    marginBottom: 16,
  },
  refineDivider: {
    height: 1,
    backgroundColor: COLOURS.border,
    width: '100%',
    marginVertical: 12,
  },
  listHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  listTitle: {
    fontFamily: TITLE_FONT,
    fontSize: 22,
    color: COLOURS.brandSoft,
    fontWeight: '800',
  },
  addCompactButton: {
    width: 52,
    minHeight: 52,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLOURS.action,
    backgroundColor: COLOURS.action,
    justifyContent: 'center',
    alignItems: 'center',
  },
  addCompactButtonPressed: {
    opacity: 0.9,
  },
  addCompactButtonText: {
    color: COLOURS.text,
    fontSize: 28,
    lineHeight: 32,
    fontWeight: '700',
    fontFamily: BODY_FONT,
  },
  centeredBlock: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 32,
    gap: 12,
  },
  loadingCaption: {
    color: COLOURS.textMuted,
    fontWeight: '700',
    fontFamily: BODY_FONT,
    fontSize: 14,
  },
  errorText: {
    marginTop: 10,
    color: COLOURS.error,
    fontWeight: '700',
    lineHeight: 20,
    fontFamily: BODY_FONT,
    fontSize: 14,
  },
  emptyHint: {
    color: COLOURS.textMuted,
    fontFamily: BODY_FONT,
    fontSize: 14,
    marginBottom: 12,
  },
  pressed: {
    opacity: 0.9,
  },
  caseCard: {
    backgroundColor: COLOURS.bgRuling,
    borderWidth: 2,
    borderColor: COLOURS.brandStrong,
    borderRadius: 4,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 14,
    marginBottom: 16,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' as const } : {}),
  },
  caseCardDisabled: {
    opacity: 0.5,
  },
  rulingFocusStrip: {
    alignSelf: 'stretch',
    height: 3,
    borderRadius: 999,
    backgroundColor: COLOURS.brand,
    marginBottom: 10,
  },
  cardsHeadline: {
    color: COLOURS.textLight,
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 22,
    fontFamily: BODY_FONT,
    marginBottom: 10,
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 10,
  },
  categoryChip: {
    minHeight: 30,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLOURS.chipBorder,
    backgroundColor: COLOURS.surface,
    justifyContent: 'center',
  },
  categoryChipText: {
    fontFamily: BODY_FONT,
    fontSize: 14,
    color: COLOURS.textSecondary,
    fontWeight: '500',
  },
  verdictPreview: {
    color: COLOURS.text,
    fontSize: 14,
    lineHeight: 20,
    fontFamily: BODY_FONT,
  },
});
