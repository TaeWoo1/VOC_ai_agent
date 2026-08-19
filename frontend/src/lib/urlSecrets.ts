/**
 * One-time secrets that arrive in a URL — the social one-time code (`/auth/callback?code=`) and the mailed
 * password-reset token (`/reset-password?token=`) — are lifted out of the address bar BEFORE anything else runs
 * (`main.tsx`, ahead of Sentry and analytics), so no vendor `page_view`, breadcrumb, referrer or history entry
 * ever sees them (docs/service_readiness_v1.md §2-1, review B1). The page reads the value back once via
 * {@link takeUrlSecret}; sessionStorage keeps it across React StrictMode's double render but not across tabs.
 */
export const URL_SECRET_KEYS = ["code", "token"] as const;
export type UrlSecretKey = (typeof URL_SECRET_KEYS)[number];

const STORAGE_KEY = "sellerops_url_secret";

interface WindowLike {
  location: { pathname: string; search: string; hash: string };
  history: { replaceState(data: unknown, unused: string, url?: string): void };
  sessionStorage?: { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void };
}

/** Move any `code` / `token` query param into sessionStorage and rewrite the URL without it. Returns true if it did. */
export function captureUrlSecrets(win: WindowLike = window): boolean {
  const params = new URLSearchParams(win.location.search);
  const found: Record<string, string> = {};
  for (const key of URL_SECRET_KEYS) {
    const value = params.get(key);
    if (value) {
      found[key] = value;
      params.delete(key);
    }
  }
  if (Object.keys(found).length === 0) return false;
  try {
    win.sessionStorage?.setItem(STORAGE_KEY, JSON.stringify({ path: win.location.pathname, ...found }));
  } catch {
    // storage unavailable: the page falls back to the URL (which we then leave intact)
    return false;
  }
  const rest = params.toString();
  win.history.replaceState(null, "", `${win.location.pathname}${rest ? `?${rest}` : ""}${win.location.hash}`);
  return true;
}

/** Read (and forget) a captured secret for the current path. */
export function takeUrlSecret(key: UrlSecretKey, win: WindowLike = window): string | null {
  try {
    const raw = win.sessionStorage?.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, string>;
    if (parsed.path !== win.location.pathname) return null;
    const value = parsed[key];
    if (!value) return null;
    win.sessionStorage?.removeItem(STORAGE_KEY);
    return value;
  } catch {
    return null;
  }
}
