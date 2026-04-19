import { BODY_FONT, COLOURS, GENERIC_ERROR_MESSAGE } from '@/constants/theme';
import { type Href, useRouter } from 'expo-router';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ViewStyle,
} from 'react-native';

const BACKEND_BASE_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

/** List route. Do not use `/admin/golden_cases/index` — it is captured by `[id]` as id "index". */
const GOLDEN_CASES_LIST_HREF = '/admin/golden_cases' as unknown as Href;

function splitCommaList(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Same layout base as app/ruling/[id].tsx primary CTAs. */
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

export default function GoldenCaseNewScreen() {
  const router = useRouter();
  const [cards, setCards] = useState('');
  const [situation, setSituation] = useState('');
  const [category, setCategory] = useState('');
  const [interactionType, setInteractionType] = useState('');
  const [difficulty, setDifficulty] = useState('');
  const [expectedVerdict, setExpectedVerdict] = useState('');
  const [requiredRules, setRequiredRules] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSave = async () => {
    setError(null);
    if (!BACKEND_BASE_URL) {
      setError(GENERIC_ERROR_MESSAGE);
      return;
    }
    const cardsArr = splitCommaList(cards);
    if (cardsArr.length === 0) {
      setError('Add at least one card name.');
      return;
    }
    if (!interactionType.trim()) {
      setError('Interaction type is required.');
      return;
    }
    if (!difficulty.trim()) {
      setError('Difficulty is required.');
      return;
    }
    if (!expectedVerdict.trim()) {
      setError('Expected verdict is required.');
      return;
    }

    const body: Record<string, unknown> = {
      cards: cardsArr,
      interaction_type: interactionType.trim(),
      difficulty: difficulty.trim(),
      expected_verdict: expectedVerdict.trim(),
    };
    if (situation.trim()) body.situation = situation.trim();
    if (category.trim()) body.category = category.trim();
    const rulesArr = splitCommaList(requiredRules);
    if (rulesArr.length > 0) body.required_rules = rulesArr;
    if (notes.trim()) body.notes = notes.trim();

    setSaving(true);
    try {
      const res = await fetch(`${BACKEND_BASE_URL}/admin/golden-cases`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        error?: string;
      };
      if (!res.ok) {
        const msg =
          typeof json.error === 'string' && json.error.trim()
            ? json.error
            : GENERIC_ERROR_MESSAGE;
        setError(msg);
        return;
      }
      if (json.success !== true) {
        setError(GENERIC_ERROR_MESSAGE);
        return;
      }
      router.replace(GOLDEN_CASES_LIST_HREF);
    } catch {
      setError(GENERIC_ERROR_MESSAGE);
    } finally {
      setSaving(false);
    }
  };

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
          New golden test case — internal reference
        </Text>
        <View style={styles.refineDivider} />

        <Text style={[styles.sectionLabel, { marginTop: 0 }]}>Cards (comma-separated)</Text>
        <TextInput
          style={styles.input}
          value={cards}
          onChangeText={setCards}
          placeholder="Lightning Bolt, Counterspell"
          placeholderTextColor={COLOURS.placeholder}
          autoCapitalize="none"
          autoCorrect={false}
        />

        <Text style={styles.sectionLabel}>Situation (optional)</Text>
        <TextInput
          style={[styles.input, styles.multilineInput]}
          value={situation}
          onChangeText={setSituation}
          placeholder="Describe the scenario"
          placeholderTextColor={COLOURS.placeholder}
          multiline
        />

        <Text style={styles.sectionLabel}>Category (optional)</Text>
        <TextInput
          style={styles.input}
          value={category}
          onChangeText={setCategory}
          placeholder="e.g. stack / combat"
          placeholderTextColor={COLOURS.placeholder}
        />

        <Text style={styles.sectionLabel}>Interaction type</Text>
        <TextInput
          style={styles.input}
          value={interactionType}
          onChangeText={setInteractionType}
          placeholder="Required"
          placeholderTextColor={COLOURS.placeholder}
        />

        <Text style={styles.sectionLabel}>Difficulty</Text>
        <TextInput
          style={styles.input}
          value={difficulty}
          onChangeText={setDifficulty}
          placeholder="basic, intermediate, or complex"
          placeholderTextColor={COLOURS.placeholder}
          autoCapitalize="none"
        />

        <Text style={styles.sectionLabel}>Expected verdict</Text>
        <TextInput
          style={[styles.input, styles.multilineInput]}
          value={expectedVerdict}
          onChangeText={setExpectedVerdict}
          placeholder="Required"
          placeholderTextColor={COLOURS.placeholder}
          multiline
        />

        <Text style={styles.sectionLabel}>Required rules (optional, comma-separated)</Text>
        <TextInput
          style={styles.input}
          value={requiredRules}
          onChangeText={setRequiredRules}
          placeholder="601.2, 704.5"
          placeholderTextColor={COLOURS.placeholder}
          autoCapitalize="none"
        />

        <Text style={styles.sectionLabel}>Notes (optional)</Text>
        <TextInput
          style={[styles.input, styles.multilineInput]}
          value={notes}
          onChangeText={setNotes}
          placeholder="Internal notes"
          placeholderTextColor={COLOURS.placeholder}
          multiline
        />

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        <Pressable
          accessibilityRole="button"
          onPress={() => void onSave()}
          disabled={saving}
          style={({ pressed }) => [
            styles.primaryButton,
            pressed && !saving && styles.primaryButtonPressed,
            saving && styles.primaryButtonDisabled,
          ]}
        >
          {saving ? (
            <ActivityIndicator color={COLOURS.text} />
          ) : (
            <Text style={styles.primaryButtonText}>Save</Text>
          )}
        </Pressable>
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
  pressed: {
    opacity: 0.85,
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
  input: {
    flex: 0,
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
    marginBottom: 4,
  },
  multilineInput: {
    minHeight: 100,
    paddingTop: 10,
    textAlignVertical: 'top',
  },
  errorText: {
    marginTop: 10,
    color: COLOURS.error,
    fontWeight: '700',
    lineHeight: 20,
    fontFamily: BODY_FONT,
    fontSize: 14,
    marginBottom: 8,
  },
  primaryButton: {
    ...primaryActionButton,
    borderColor: COLOURS.action,
    backgroundColor: COLOURS.action,
    marginTop: 12,
  },
  primaryButtonPressed: {
    opacity: 0.9,
  },
  primaryButtonDisabled: {
    opacity: 0.7,
  },
  primaryButtonText: {
    color: COLOURS.text,
    fontSize: 16,
    fontWeight: '700',
    fontFamily: BODY_FONT,
  },
});
