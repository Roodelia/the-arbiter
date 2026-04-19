import { BODY_FONT, COLOURS, GENERIC_ERROR_MESSAGE, TITLE_FONT } from '@/constants/theme';
import { fetchCardImageUri } from '@/utils/scryfall';
import { type Href, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
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
  type ViewStyle,
} from 'react-native';

const BACKEND_BASE_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

/** List route. Do not use `/admin/golden_cases/index` — it is captured by `[id]` as id "index". */
const GOLDEN_CASES_LIST_HREF = '/admin/golden_cases' as unknown as Href;

type GoldenCaseRow = {
  id?: string;
  cards?: unknown;
  situation?: string | null;
  category?: string | null;
  interaction_type?: string | null;
  difficulty?: string | null;
  expected_verdict?: string | null;
  required_rules?: unknown;
  notes?: string | null;
  created_at?: string;
};

type GoldenCaseDetailResponse = {
  case?: GoldenCaseRow;
};

function normalizeCardNames(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((c) => (typeof c === 'string' ? c.trim() : String(c).trim()))
    .filter(Boolean);
}

function normalizeRequiredRules(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((r) => (typeof r === 'string' ? r.trim() : String(r).trim()))
    .filter(Boolean);
}

/** Same layout base as app/index.tsx primary CTAs. */
const primaryActionButton: ViewStyle = {
  width: '100%',
  minHeight: 52,
  borderRadius: 10,
  borderWidth: 1,
  justifyContent: 'center',
  alignItems: 'center',
  paddingHorizontal: 16,
  paddingVertical: 14,
};

export default function GoldenCaseDetailScreen() {
  const rawId = useLocalSearchParams<{ id: string | string[] }>().id;
  const caseId =
    typeof rawId === 'string'
      ? rawId
      : Array.isArray(rawId)
        ? rawId[0] ?? ''
        : '';

  const router = useRouter();
  const { width: windowWidth } = useWindowDimensions();
  const cardPreviewWidth =
    Platform.OS === 'web'
      ? Math.min(windowWidth - 32, 400)
      : windowWidth - 32;

  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [row, setRow] = useState<GoldenCaseRow | null>(null);

  const [imageUriCache, setImageUriCache] = useState<
    Record<string, string | null>
  >({});
  const imageUriCacheRef = useRef(imageUriCache);
  imageUriCacheRef.current = imageUriCache;
  const [activeCardPopup, setActiveCardPopup] = useState<string | null>(null);

  const rulesList = useMemo(
    () => (row ? normalizeRequiredRules(row.required_rules) : []),
    [row],
  );

  const cardNames = row ? normalizeCardNames(row.cards) : [];

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!caseId || !BACKEND_BASE_URL) {
        setNotFound(!caseId);
        setLoading(false);
        setErrorMessage(caseId ? GENERIC_ERROR_MESSAGE : null);
        return;
      }

      setLoading(true);
      setNotFound(false);
      setErrorMessage(null);
      setRow(null);

      try {
        const res = await fetch(
          `${BACKEND_BASE_URL}/admin/golden-cases/${encodeURIComponent(caseId)}`,
        );
        if (res.status === 404) {
          if (!cancelled) setNotFound(true);
          return;
        }
        if (!res.ok) throw new Error('fetch failed');
        const json = (await res.json()) as GoldenCaseDetailResponse;
        const c = json.case;
        if (cancelled) return;
        if (!c || typeof c !== 'object') {
          setErrorMessage(GENERIC_ERROR_MESSAGE);
          return;
        }
        setRow(c);
      } catch {
        if (!cancelled) setErrorMessage(GENERIC_ERROR_MESSAGE);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [caseId]);

  useEffect(() => {
    setActiveCardPopup(null);
  }, [caseId, row?.id]);

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
  }, [activeCardPopup]);

  const modalCardName = activeCardPopup;
  const modalCachedUri = modalCardName ? imageUriCache[modalCardName] : undefined;
  const modalShowLoading =
    !!modalCardName &&
    !Object.prototype.hasOwnProperty.call(imageUriCache, modalCardName);

  const hasInteractionOrDifficulty =
    !!row &&
    (!!(typeof row.interaction_type === 'string' && row.interaction_type.trim()) ||
      !!(typeof row.difficulty === 'string' && row.difficulty.trim()));

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
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to golden cases list"
          onPress={() => router.replace(GOLDEN_CASES_LIST_HREF)}
          style={({ pressed }) => [styles.adminBackLink, pressed && styles.pressed]}
        >
          <Text style={styles.adminBackLinkText}>← Golden cases</Text>
        </Pressable>

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

        {loading ? (
          <View style={styles.centeredBlock}>
            <ActivityIndicator color={COLOURS.brandSoft} size="large" />
            <Text style={styles.loadingCaption}>Loading case…</Text>
          </View>
        ) : null}

        {!loading && notFound ? (
          <Text style={styles.errorText}>Case not found</Text>
        ) : null}

        {!loading && errorMessage && !notFound ? (
          <Text style={styles.errorText}>{errorMessage}</Text>
        ) : null}

        {!loading && row && !notFound && !errorMessage ? (
          <>
            <View style={[styles.section, styles.contextSection]}>
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
                        pressed && styles.pressed,
                        Platform.OS === 'web' && styles.readOnlyChipWeb,
                      ]}
                    >
                      <Text style={styles.chipText} numberOfLines={1}>
                        {name}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
            </View>

            {hasInteractionOrDifficulty ? (
              <View style={[styles.section, styles.contextSection]}>
                <View style={styles.situationBlockFirst}>
                  <Text style={[styles.sectionLabel, { marginTop: 0 }]}>
                    INTERACTION TYPE
                  </Text>
                  <Text style={styles.situationText}>
                    {typeof row.interaction_type === 'string' &&
                    row.interaction_type.trim()
                      ? row.interaction_type.trim()
                      : '—'}
                  </Text>
                </View>
                <View style={styles.situationBlock}>
                  <Text style={[styles.sectionLabel, { marginTop: 6 }]}>
                    DIFFICULTY
                  </Text>
                  <Text style={styles.situationText}>
                    {typeof row.difficulty === 'string' && row.difficulty.trim()
                      ? row.difficulty.trim()
                      : '—'}
                  </Text>
                </View>
              </View>
            ) : null}

            {row.situation?.trim() || row.category?.trim() ? (
              <View style={[styles.section, styles.contextSection]}>
                {row.situation?.trim() ? (
                  <View style={styles.situationBlockFirst}>
                    <Text style={[styles.sectionLabel, { marginTop: 0 }]}>
                      SITUATION
                    </Text>
                    <Text style={styles.situationText}>{row.situation.trim()}</Text>
                  </View>
                ) : null}
                {row.category?.trim() ? (
                  <View
                    style={
                      row.situation?.trim()
                        ? styles.situationBlock
                        : styles.situationBlockFirst
                    }
                  >
                    <Text
                      style={[
                        styles.sectionLabel,
                        { marginTop: row.situation?.trim() ? 6 : 0 },
                      ]}
                    >
                      CATEGORY
                    </Text>
                    <Text style={styles.situationText}>{row.category.trim()}</Text>
                  </View>
                ) : null}
              </View>
            ) : null}

            <View style={[styles.section, styles.step3RulingSection]}>
              <View style={styles.rulingFocusStrip} />
              <Text style={styles.rulingSectionTitle}>EXPECTED VERDICT</Text>
              <Text style={styles.rulingText}>
                {typeof row.expected_verdict === 'string'
                  ? row.expected_verdict
                  : ''}
              </Text>
            </View>

            <View style={[styles.section, { paddingBottom: 0 }]}>
              <Text style={[styles.sectionLabel, { marginTop: 0, marginBottom: 6 }]}>
                REQUIRED RULES
              </Text>
              {rulesList.length > 0 ? (
                <View style={styles.rulesRow}>
                  {rulesList.map((r, i) => (
                    <View key={`${r}-${i}`} style={styles.ruleTag}>
                      <Text style={styles.ruleTagText} numberOfLines={3}>
                        {r}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : (
                <Text style={styles.situationText}>—</Text>
              )}

              {row.notes?.trim() ? (
                <View style={styles.situationBlock}>
                  <Text style={[styles.sectionLabel, { marginTop: 6 }]}>NOTES</Text>
                  <Text style={styles.situationText}>{row.notes.trim()}</Text>
                </View>
              ) : null}
            </View>

            <View style={styles.refineDivider} />

            <Pressable
              onPress={() => router.replace(GOLDEN_CASES_LIST_HREF)}
              style={({ pressed }) => [
                styles.primaryButton,
                pressed && styles.primaryButtonPressed,
              ]}
            >
              <Text style={styles.primaryButtonText}>Back to golden cases</Text>
            </Pressable>
          </>
        ) : null}
      </ScrollView>

      <Modal
        visible={modalCardName !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setActiveCardPopup(null)}
      >
        <View style={styles.cardImageModalRoot}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Dismiss card image"
            style={styles.cardImageModalBackdrop}
            onPress={() => setActiveCardPopup(null)}
          />
          <View
            style={styles.cardImageModalCenterLayer}
            pointerEvents="box-none"
          >
            <View
              style={[styles.cardModalImageFrame, { width: cardPreviewWidth }]}
            >
              <View style={styles.cardModalImageClip}>
                {modalShowLoading ? (
                  <View style={styles.cardModalSpinnerWrap}>
                    <ActivityIndicator color={COLOURS.brand} size="large" />
                  </View>
                ) : modalCachedUri ? (
                  <Image
                    source={{ uri: modalCachedUri }}
                    style={styles.cardModalImage}
                    resizeMode="cover"
                  />
                ) : (
                  <View style={styles.cardModalFallbackWrap}>
                    <Text style={styles.cardModalFallbackText}>
                      No image found
                    </Text>
                  </View>
                )}
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close card image"
                onPress={() => setActiveCardPopup(null)}
                style={styles.cardModalImagePressOverlay}
              />
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
    paddingTop: 12,
    paddingBottom: 24,
    maxWidth: 600,
    width: '100%',
    alignSelf: 'center',
    overflow: 'visible',
  },
  adminBackLink: {
    alignSelf: 'flex-start',
    marginBottom: 4,
    paddingVertical: 8,
    paddingRight: 12,
  },
  adminBackLinkText: {
    color: COLOURS.textSecondary,
    fontSize: 16,
    fontFamily: BODY_FONT,
    fontWeight: '600',
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
  pressed: {
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
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: COLOURS.surface,
    borderWidth: 1,
    borderColor: COLOURS.border,
    position: 'relative',
  },
  cardModalImageClip: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 16,
    overflow: 'hidden',
    ...(Platform.OS === 'web' ? { isolation: 'isolate' as const } : {}),
  },
  cardModalImagePressOverlay: {
    ...StyleSheet.absoluteFillObject,
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
    backgroundColor: 'transparent',
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
    fontSize: 14,
    fontFamily: BODY_FONT,
    textAlign: 'center',
  },
  section: {
    marginBottom: 16,
    paddingBottom: 16,
    borderBottomWidth: 0,
    borderBottomColor: COLOURS.border,
  },
  contextSection: {
    marginBottom: 12,
    paddingBottom: 12,
  },
  sectionLabel: {
    color: COLOURS.textSecondary,
    fontWeight: '600',
    letterSpacing: 3,
    fontSize: 10,
    fontFamily: BODY_FONT,
    textTransform: 'uppercase',
    marginTop: 14,
    marginBottom: 6,
  },
  chipsRow: {
    marginTop: 0,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  readOnlyChip: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLOURS.chipBorder,
    backgroundColor: COLOURS.surface,
    justifyContent: 'center',
    maxWidth: '100%',
  },
  readOnlyChipWeb: {
    cursor: 'pointer',
  },
  chipText: {
    color: COLOURS.textSecondary,
    fontWeight: '500',
    fontFamily: BODY_FONT,
    fontSize: 14,
  },
  situationBlockFirst: {
    marginTop: 0,
  },
  situationBlock: {
    marginTop: 14,
  },
  situationText: {
    color: COLOURS.textSecondary,
    fontSize: 14,
    lineHeight: 18,
    fontFamily: BODY_FONT,
  },
  rulingText: {
    color: COLOURS.textLight,
    fontSize: 18,
    fontWeight: '600',
    lineHeight: 28,
    fontFamily: BODY_FONT,
  },
  step3RulingSection: {
    backgroundColor: COLOURS.bgRuling,
    borderWidth: 2,
    borderBottomWidth: 2,
    borderColor: COLOURS.brandStrong,
    borderBottomColor: COLOURS.brandStrong,
    borderRadius: 4,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 16,
    marginBottom: 16,
  },
  rulingSectionTitle: {
    color: COLOURS.brandSoft,
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: 8,
    textTransform: 'uppercase',
    marginBottom: 8,
    textAlign: 'center',
    fontFamily: TITLE_FONT,
  },
  rulingFocusStrip: {
    alignSelf: 'stretch',
    height: 3,
    borderRadius: 999,
    backgroundColor: COLOURS.brand,
    marginBottom: 8,
  },
  rulesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 8,
  },
  ruleTag: {
    minHeight: 30,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: COLOURS.chipBorder,
    backgroundColor: COLOURS.surface,
    justifyContent: 'center',
    maxWidth: '100%',
  },
  ruleTagText: {
    color: COLOURS.textSecondary,
    fontWeight: '600',
    fontFamily: BODY_FONT,
    fontSize: 12,
  },
  primaryButton: {
    ...primaryActionButton,
    borderColor: COLOURS.action,
    backgroundColor: COLOURS.action,
  },
  primaryButtonPressed: {
    opacity: 0.9,
  },
  primaryButtonText: {
    color: COLOURS.text,
    fontSize: 16,
    fontWeight: '700',
    fontFamily: BODY_FONT,
  },
});
