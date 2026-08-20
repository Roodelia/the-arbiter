import { Platform } from 'react-native';
import mixpanel from 'mixpanel-browser';

// Mixpanel is web-only for now (mixpanel-browser, DOM-based) — ManaJudge only
// ships as a web app today (see CLAUDE.md hosting notes). Native iOS/Android
// tracking would need the mixpanel-react-native SDK plus a dev-client build,
// neither of which exist in this project yet.
const IS_WEB = Platform.OS === 'web';

const MIXPANEL_TOKEN = process.env.EXPO_PUBLIC_MIXPANEL_TOKEN;
const CONSENT_STORAGE_KEY = 'manajudge_analytics_consent';

let initialized = false;

function getLocalStorage(): Storage | null {
  if (!IS_WEB || typeof window === 'undefined' || !window.localStorage) return null;
  return window.localStorage;
}

/** null = user hasn't been asked yet (show the consent banner). */
export function getStoredConsent(): boolean | null {
  const storage = getLocalStorage();
  const raw = storage?.getItem(CONSENT_STORAGE_KEY);
  if (raw === 'granted') return true;
  if (raw === 'denied') return false;
  return null;
}

export function setStoredConsent(granted: boolean): void {
  getLocalStorage()?.setItem(CONSENT_STORAGE_KEY, granted ? 'granted' : 'denied');
}

/** Whether it's safe to include analytics_consent: true on a backend request. */
export function hasAnalyticsConsent(): boolean {
  return getStoredConsent() === true;
}

/**
 * Initializes Mixpanel and sets distinct_id = sessionId (no login exists in
 * this app, so the session_id already used to group cases in Supabase is
 * the closest thing to a stable user id — keeps client and server events
 * correlated under the same Mixpanel user). No-ops without consent, a
 * configured token, or a web runtime.
 */
export function initAnalytics(sessionId: string): void {
  if (initialized || !IS_WEB || !MIXPANEL_TOKEN || !hasAnalyticsConsent()) return;

  mixpanel.init(MIXPANEL_TOKEN, { autocapture: false, ip: true });
  mixpanel.identify(sessionId);
  initialized = true;
}

export function track(eventName: string, properties: Record<string, unknown> = {}): void {
  if (!initialized) return;
  mixpanel.track(eventName, properties);
}
