/**
 * Page-signal boundary — converts a sanitized page PROBE into an
 * `AccountSignalSnapshot`. This is the seam a FUTURE live Playwright boundary will
 * fill: the live code reads the logged-in seller-center page (url + a few scoped
 * structural reads) and populates `AccountSignalPageProbe`; this module then strips
 * the raw URL down to a coarse category and carries only the named candidate fields
 * onward. It does NOT import Playwright, does NOT click or select anything, does
 * NOT persist or upload, and never emits a raw URL, raw HTML, page text, or screenshot.
 *
 * Normalization (trim / drop-empty / reject URL-with-query|hash) is intentionally
 * NOT done here — it lives once in `captureAccountSignals` (the shared
 * `normalizeCandidateToken`). This boundary only shapes named fields + categorizes
 * the URL.
 */

import { urlCategory } from "./session-check";
import type { AccountSignalSnapshot } from "./account-signal-capture";

/**
 * Sanitized page-derived probe the future live boundary produces. `currentUrl` is
 * the only raw value it carries (categorized away here, never re-emitted); the
 * candidates are named structural reads, never full page-text blobs.
 */
export interface AccountSignalPageProbe {
  currentUrl: string;
  loggedInSignal: boolean;
  sellerShellSignal: boolean;
  commerceIdCandidate?: string | null;
  storeUrlPathCandidate?: string | null;
  accountScopeCandidate?: string | null;
}

/**
 * Pure: page probe → `AccountSignalSnapshot`. The raw URL is reduced to a coarse
 * `urlCategory` and never re-emitted; candidates are carried as named fields only
 * (downstream `captureAccountSignals` performs the actual sanitization).
 */
export function toAccountSignalSnapshot(probe: AccountSignalPageProbe): AccountSignalSnapshot {
  return {
    urlCategory: urlCategory(probe.currentUrl),
    loggedInSignal: probe.loggedInSignal,
    sellerShellSignal: probe.sellerShellSignal,
    commerceIdTextCandidate: probe.commerceIdCandidate ?? null,
    storeUrlPathCandidate: probe.storeUrlPathCandidate ?? null,
    accountScopeTextCandidate: probe.accountScopeCandidate ?? null,
  };
}
