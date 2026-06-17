import { log } from "../log";
import type { PwPage } from "../profile";
import { detectSession, signalsFromHtml } from "../session";
import type { SessionState } from "../status";

/**
 * Pure: page HTML + URL → session state, via the existing fail-safe detector.
 * Reuses `signalsFromHtml` + `detectSession` so the live layer adds no new
 * session logic — only the I/O of reading a live page.
 */
export function sessionStateFromContent(html: string, url: string): SessionState {
  return detectSession(signalsFromHtml(html, url));
}

/**
 * Coarse, secret-free category for logging. The raw URL can carry tokens/query
 * params, so only this category is ever logged — never the URL itself.
 */
export function urlCategory(url: string): "login" | "seller-center" | "other" {
  if (/\/login|nidlogin|nid\.naver|\bauth\b/i.test(url)) return "login";
  if (/sell\.smartstore|sell\.naver|commerce/i.test(url)) return "seller-center";
  return "other";
}

/**
 * Live: read the current page and decide whether the seller-center session is
 * usable. Logs only the resulting state + a coarse URL category — never the raw
 * URL, the HTML, or any cookie. LIVE-ONLY (needs a launched browser).
 */
export async function checkLiveSession(page: PwPage): Promise<SessionState> {
  const url = page.url();
  const html = await page.content();
  const state = sessionStateFromContent(html, url);
  log("session.check", { state, urlCategory: urlCategory(url) });
  return state;
}
