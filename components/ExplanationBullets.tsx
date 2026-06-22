import { COLOURS } from '@/constants/theme';
import React from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';

export function parseExplanationLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.replace(/^[\s\*\-•]+/, '').trim())
    .filter(Boolean);
}

type ExplanationBulletsProps = {
  text: string;
};

export function ExplanationBullets({ text }: ExplanationBulletsProps) {
  const lines = parseExplanationLines(text);
  if (lines.length === 0) return null;

  return (
    <>
      {lines.map((line, index) => (
        <View key={index} style={styles.explanationRow}>
          <Text
            style={[styles.explanationText, styles.explanationBullet]}
            accessible={false}
          >
            {'\u2022'}
          </Text>
          <Text style={[styles.explanationText, styles.explanationLine]}>
            {line}
          </Text>
        </View>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  explanationRow: {
    flexDirection: 'row',
    marginTop: 8,
    marginBottom: 0,
    paddingRight: 8,
  },
  explanationText: {
    color: COLOURS.text,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 2,
    fontFamily: Platform.OS === 'ios' ? 'Helvetica Neue' : 'sans-serif',
  },
  explanationBullet: {
    minWidth: 24,
    flexShrink: 0,
  },
  explanationLine: {
    flex: 1,
  },
});
