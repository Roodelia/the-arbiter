import { COLOURS, BODY_FONT } from '@/constants/theme';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

type ConsentBannerProps = {
  onAccept: () => void;
  onDecline: () => void;
};

export function ConsentBanner({ onAccept, onDecline }: ConsentBannerProps) {
  return (
    <View style={styles.banner} accessibilityRole="alert">
      <Text style={styles.text}>
        ManaJudge uses analytics to understand how the app is used, so we can fix
        bugs and improve ruling accuracy. This data is never sold or used for
        advertising. Declining won't limit any app features.
      </Text>
      <View style={styles.actions}>
        <Pressable
          onPress={onDecline}
          style={({ pressed }) => [styles.declineButton, pressed && styles.pressed]}
        >
          <Text style={styles.declineText}>Decline</Text>
        </Pressable>
        <Pressable
          onPress={onAccept}
          style={({ pressed }) => [styles.acceptButton, pressed && styles.pressed]}
        >
          <Text style={styles.acceptText}>Accept</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: COLOURS.surface,
    borderTopWidth: 1,
    borderTopColor: COLOURS.border,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 12,
    zIndex: 1000,
  },
  text: {
    flex: 1,
    minWidth: 220,
    color: COLOURS.textSecondary,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: BODY_FONT,
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
  },
  declineButton: {
    minHeight: 44,
    paddingHorizontal: 14,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 8,
  },
  declineText: {
    color: COLOURS.textSecondary,
    fontSize: 14,
    fontWeight: '600',
    fontFamily: BODY_FONT,
  },
  acceptButton: {
    minHeight: 44,
    paddingHorizontal: 16,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 8,
    backgroundColor: COLOURS.confirm,
  },
  acceptText: {
    color: COLOURS.text,
    fontSize: 14,
    fontWeight: '700',
    fontFamily: BODY_FONT,
  },
  pressed: {
    opacity: 0.8,
  },
});
