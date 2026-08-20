import { Platform } from 'react-native';
import mixpanel from 'mixpanel-browser';

// Mixpanel is web-only for now (mixpanel-browser, DOM-based) — ManaJudge only
// ships as a web app today (see CLAUDE.md hosting notes). Native iOS/Android
// tracking would need the mixpanel-react-native SDK plus a dev-client build,
// neither of which exist in this project yet.
const IS_WEB = Platform.OS === 'web';

const MIXPANEL_TOKEN = process.env.EXPO_PUBLIC_MIXPANEL_TOKEN;
const CONSENT_STORAGE_KEY = 'manajudge_analytics_consent';
const DISTINCT_ID_STORAGE_KEY = 'manajudge_analytics_distinct_id';

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

function generateDistinctId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * The persistent Mixpanel distinct_id — deliberately separate from the
 * app's own session_id, which stays ephemeral (regenerated every page
 * load) and keeps grouping/owning Supabase `cases` rows exactly as before;
 * changing that would've altered case-ownership semantics no one asked to
 * change. This id is persisted in localStorage instead, so the same
 * browser is recognised as one Mixpanel user across visits, not just
 * within a single page load — created only once consent is granted, and
 * never before. Returns null without consent; callers should omit
 * distinct_id fields entirely rather than send null.
 */
export function getAnalyticsDistinctId(): string | null {
  if (!hasAnalyticsConsent()) return null;
  const storage = getLocalStorage();
  if (!storage) return null;

  const existing = storage.getItem(DISTINCT_ID_STORAGE_KEY);
  if (existing) return existing;

  const id = generateDistinctId();
  storage.setItem(DISTINCT_ID_STORAGE_KEY, id);
  return id;
}

/**
 * Initializes Mixpanel and identifies the browser under its persistent
 * distinct_id (see getAnalyticsDistinctId). No-ops without consent, a
 * configured token, or a web runtime.
 */
export function initAnalytics(): void {
  if (initialized || !IS_WEB || !MIXPANEL_TOKEN) return;

  const distinctId = getAnalyticsDistinctId();
  if (!distinctId) return;

  mixpanel.init(MIXPANEL_TOKEN, { autocapture: false, ip: true });
  mixpanel.identify(distinctId);
  initialized = true;
}

export function track(eventName: string, properties: Record<string, unknown> = {}): void {
  if (!initialized) return;
  mixpanel.track(eventName, properties);
}
