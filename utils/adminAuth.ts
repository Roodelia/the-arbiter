const STORAGE_KEY = 'manajudge_admin_token';

let memoryToken: string | null = null;
let onUnauthorized: (() => void) | null = null;

export function setAdminUnauthorizedHandler(handler: (() => void) | null) {
  onUnauthorized = handler;
}

export function getAdminToken(): string | null {
  if (typeof sessionStorage !== 'undefined') {
    return sessionStorage.getItem(STORAGE_KEY);
  }
  return memoryToken;
}

export function setAdminToken(token: string): void {
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.setItem(STORAGE_KEY, token);
  }
  memoryToken = token;
}

export function clearAdminToken(): void {
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.removeItem(STORAGE_KEY);
  }
  memoryToken = null;
}

export async function adminLogin(password: string): Promise<boolean> {
  const base = process.env.EXPO_PUBLIC_BACKEND_URL;
  if (!base) return false;

  const res = await fetch(`${base}/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });

  if (!res.ok) return false;

  const json = (await res.json()) as { token?: string };
  if (typeof json.token !== 'string' || !json.token.trim()) return false;

  setAdminToken(json.token.trim());
  return true;
}

export async function adminFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const base = process.env.EXPO_PUBLIC_BACKEND_URL;
  if (!base) {
    throw new Error('Backend URL not configured');
  }

  const headers = new Headers(init?.headers);
  const token = getAdminToken();
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const res = await fetch(`${base}${path}`, { ...init, headers });

  if (res.status === 401) {
    clearAdminToken();
    onUnauthorized?.();
  }

  return res;
}
