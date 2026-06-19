import { log } from "../log";
import type { PwPage } from "../profile";
import { detectSession, signalsFromHtml } from "../session";
import type { SessionState } from "../status";
import { extractProbeSignals } from "./session-probe";
import type { SessionVerdict } from "./session-verdict";

/**
 * Pure: page HTML + URL → session state, via the existing fail-safe detector.
 * Reuses `signalsFromHtml` + `detectSession` so the live layer adds no new
 * session logic — only the I/O of reading a live page.
 *
 * Retained for back-compat (`decideState`'s export/upload legs, `session.test.ts`); the
 * discovery HALT decision now runs on `sessionVerdictFromContent` instead.
 */
export function sessionStateFromContent(html: string, url: string): SessionState {
  return detectSession(signalsFromHtml(html, url));
}

/**
 * Pure: page HTML + URL → five-state `SessionVerdict`, via the probe's (tightened,
 * branding-demoted) markers — the SAME signal source the diagnostic probe uses, so
 * discovery no longer carries a second marker set. This is the seam the live discovery
 * halt decision runs on (paired with `haltForVerdict` in `session-halt.ts`).
 */
export function sessionVerdictFromContent(html: string, url: string): SessionVerdict {
  return extractProbeSignals({ url, html }).sessionVerdict;
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

/**
 * Live: read the current page and classify it into the five-state `SessionVerdict` — the
 * authority for the discovery halt decision. Logs only the coarse verdict + URL category,
 * never the raw URL, HTML, or any cookie. LIVE-ONLY (needs a launched browser). Thin I/O
 * wrapper over the offline-unit-tested `sessionVerdictFromContent`.
 */
export async function checkLiveSessionVerdict(page: PwPage): Promise<SessionVerdict> {
  const url = page.url();
  const html = await page.content();
  const verdict = sessionVerdictFromContent(html, url);
  log("session.check", { verdict, urlCategory: urlCategory(url) });
  return verdict;
}
