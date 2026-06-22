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

type UsageCaseRow = {
  id?: string | number;
  cards?: unknown;
  selected_category?: string | null;
  situation?: string | null;
  ruling?: string | null;
  source?: string | null;
  flagged?: boolean | null;
  created_at?: string;
};

type UsageCasesResponse = {
  cases?: UsageCaseRow[];
};

function normalizeCardNames(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((c) => (typeof c === 'string' ? c.trim() : String(c).trim()))
    .filter(Boolean);
}

function formatCardsLine(raw: unknown): string {
  const names = normalizeCardNames(raw);
  return names.length > 0 ? names.join(' + ') : '—';
}

function formatCreatedAt(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) return '';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString();
}

export default function UsageCasesListScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cases, setCases] = useState<UsageCaseRow[]>([]);

  const load = useCallback(async (signal: AbortSignal) => {
    if (!BACKEND_BASE_URL) {
      setError(GENERIC_ERROR_MESSAGE);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${BACKEND_BASE_URL}/admin/cases`, {
        signal,
      });
      if (!res.ok) throw new Error('fetch failed');
      const json = (await res.json()) as UsageCasesResponse;
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
          Recent cases — internal reference
        </Text>
        <View style={styles.refineDivider} />

        <View style={styles.listHeaderRow}>
          <Text style={styles.listTitle}>Cases</Text>
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
          <Text style={styles.emptyHint}>No cases yet.</Text>
        ) : null}

        {!loading && !error
          ? cases.map((row, index) => {
              const rowId =
                row.id !== undefined && row.id !== null
                  ? String(row.id)
                  : null;
              const key = rowId ?? `usage-case-${index}`;
              const createdLabel = formatCreatedAt(row.created_at);
              return (
                <Pressable
                  key={key}
                  accessibilityRole="button"
                  accessibilityLabel="Open case"
                  disabled={!rowId}
                  onPress={() => {
                    if (!rowId) return;
                    router.push({
                      pathname: '/admin/cases/[id]',
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
                  {createdLabel ? (
                    <Text style={styles.createdAtText}>{createdLabel}</Text>
                  ) : null}
                  <Text style={styles.cardsHeadline} numberOfLines={2}>
                    {formatCardsLine(row.cards)}
                  </Text>
                  <View style={styles.chipsRow}>
                    {typeof row.source === 'string' &&
                    row.source.trim().length > 0 ? (
                      <View style={styles.categoryChip}>
                        <Text style={styles.categoryChipText} numberOfLines={1}>
                          {row.source.trim()}
                        </Text>
                      </View>
                    ) : null}
                    {typeof row.selected_category === 'string' &&
                    row.selected_category.trim().length > 0 ? (
                      <View style={styles.categoryChip}>
                        <Text style={styles.categoryChipText} numberOfLines={1}>
                          {row.selected_category.trim()}
                        </Text>
                      </View>
                    ) : null}
                    {row.flagged ? (
                      <View style={[styles.categoryChip, styles.flaggedChip]}>
                        <Text
                          style={[styles.categoryChipText, styles.flaggedChipText]}
                          numberOfLines={1}
                        >
                          flagged
                        </Text>
                      </View>
                    ) : null}
                  </View>
                  <Text
                    style={styles.verdictPreview}
                    numberOfLines={2}
                    ellipsizeMode="tail"
                  >
                    {typeof row.ruling === 'string' ? row.ruling : '—'}
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
  createdAtText: {
    color: COLOURS.textMuted,
    fontSize: 12,
    fontFamily: BODY_FONT,
    marginBottom: 6,
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
  flaggedChip: {
    borderColor: COLOURS.error,
    backgroundColor: COLOURS.surface,
  },
  flaggedChipText: {
    color: COLOURS.error,
  },
  verdictPreview: {
    color: COLOURS.text,
    fontSize: 14,
    lineHeight: 20,
    fontFamily: BODY_FONT,
  },
});
