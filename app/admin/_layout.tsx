import {
  BODY_FONT,
  COLOURS,
  GENERIC_ERROR_MESSAGE,
  TITLE_FONT,
} from '@/constants/theme';
import {
  adminLogin,
  getAdminToken,
  setAdminUnauthorizedHandler,
} from '@/utils/adminAuth';
import { Stack } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

export default function AdminLayout() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);

  useEffect(() => {
    setAuthed(!!getAdminToken());
    setAdminUnauthorizedHandler(() => setAuthed(false));
    return () => setAdminUnauthorizedHandler(null);
  }, []);

  const handleLogin = useCallback(async () => {
    const trimmed = password.trim();
    if (!trimmed || loggingIn) return;

    setLoggingIn(true);
    setLoginError(null);
    try {
      const ok = await adminLogin(trimmed);
      if (ok) {
        setPassword('');
        setAuthed(true);
      } else {
        setLoginError('Invalid password');
      }
    } catch {
      setLoginError(GENERIC_ERROR_MESSAGE);
    } finally {
      setLoggingIn(false);
    }
  }, [loggingIn, password]);

  if (authed === null) {
    return (
      <View style={styles.gateRoot}>
        <ActivityIndicator size="large" color={COLOURS.brandSoft} />
      </View>
    );
  }

  if (!authed) {
    return (
      <View style={styles.gateRoot}>
        <View style={styles.gateCard}>
          <Image
            source={require('../../assets/images/manajudge_title.png')}
            style={styles.gateLogo}
            resizeMode="contain"
          />
          <Text style={styles.gateTitle}>Admin</Text>
          <Text style={styles.gateSubtitle}>Enter the admin password to continue.</Text>

          <TextInput
            value={password}
            onChangeText={setPassword}
            placeholder="Password"
            placeholderTextColor={COLOURS.textMuted}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
            onSubmitEditing={() => void handleLogin()}
          />

          {loginError ? (
            <Text style={styles.errorText}>{loginError}</Text>
          ) : null}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Sign in to admin"
            disabled={loggingIn || password.trim().length === 0}
            onPress={() => void handleLogin()}
            style={({ pressed }) => [
              styles.primaryButton,
              (loggingIn || password.trim().length === 0) &&
                styles.primaryButtonDisabled,
              pressed && !loggingIn && styles.primaryButtonPressed,
            ]}
          >
            {loggingIn ? (
              <ActivityIndicator color={COLOURS.text} />
            ) : (
              <Text style={styles.primaryButtonText}>Continue</Text>
            )}
          </Pressable>
        </View>
      </View>
    );
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}

const styles = StyleSheet.create({
  gateRoot: {
    flex: 1,
    backgroundColor: COLOURS.background,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  gateCard: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: COLOURS.surface,
    borderWidth: 1,
    borderColor: COLOURS.border,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 20,
  },
  gateLogo: {
    width: '100%',
    height: 52,
    marginBottom: 12,
  },
  gateTitle: {
    fontFamily: TITLE_FONT,
    fontSize: 22,
    color: COLOURS.brandSoft,
    fontWeight: '800',
    marginBottom: 6,
  },
  gateSubtitle: {
    fontFamily: BODY_FONT,
    fontSize: 14,
    color: COLOURS.textSecondary,
    marginBottom: 16,
    lineHeight: 20,
  },
  input: {
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 6,
    fontSize: 16,
    fontFamily: BODY_FONT,
    color: COLOURS.text,
    backgroundColor: COLOURS.background,
    borderWidth: 1,
    borderColor: COLOURS.border,
    borderRadius: 8,
    marginBottom: 12,
  },
  errorText: {
    color: COLOURS.error,
    fontWeight: '700',
    fontFamily: BODY_FONT,
    fontSize: 14,
    marginBottom: 12,
  },
  primaryButton: {
    minHeight: 52,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLOURS.action,
    backgroundColor: COLOURS.action,
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
    fontSize: 16,
    fontWeight: '700',
    fontFamily: BODY_FONT,
  },
});
