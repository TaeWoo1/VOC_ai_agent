// Rich mall-id input normalization for the first-connection tutorial. Accepts a bare mall id,
// a `{mallId}.cafe24.com` host, or a full HTTPS store URL, and returns the bare mall id the
// backend expects. Deliberately fail-closed: a non-Cafe24 host, an extra-labeled host, or an
// empty/malformed value never becomes a guessed mall id. The final label is validated by the
// shared `normalizeMallId` (single source of the hostname-label shape), so this module only
// handles the extraction, never a second shape definition.

import { normalizeMallId } from "../cafe24Connect";

const CAFE24_SUFFIX = ".cafe24.com";

export type MallInputResult =
  | { ok: true; mallId: string }
  | { ok: false; reason: "empty" | "bad_host" | "malformed" };

/** Extract the single label before `.cafe24.com`, or null if the host is not a Cafe24 host. */
function labelFromHost(host: string): string | null {
  const lower = host.trim().toLowerCase();
  if (!lower.endsWith(CAFE24_SUFFIX)) {
    return null;
  }
  // Everything before the suffix. A multi-label host (e.g. `a.b.cafe24.com`) yields `a.b`,
  // which `normalizeMallId` rejects (it forbids dots) — fail-closed, never a guessed label.
  return lower.slice(0, -CAFE24_SUFFIX.length);
}

/**
 * Normalize seller-entered mall input to the bare mall id, or a fail-closed reason.
 *
 * - `mystore` → `mystore`
 * - `mystore.cafe24.com` → `mystore`
 * - `https://mystore.cafe24.com/admin` → `mystore`
 * - `https://evil.com/mystore` → bad_host
 * - `mystore.myshop.com` → bad_host
 * - `` / whitespace → empty
 * - `--bad--` / `a.b.cafe24.com` → malformed
 */
export function normalizeMallInput(raw: string | null | undefined): MallInputResult {
  if (raw == null || raw.trim().length === 0) {
    return { ok: false, reason: "empty" };
  }
  const value = raw.trim();

  // URL form (has a scheme or a path separator) → parse and require a Cafe24 host.
  if (value.includes("://") || value.includes("/")) {
    let host: string;
    try {
      const url = new URL(value.includes("://") ? value : `https://${value}`);
      host = url.hostname;
    } catch {
      return { ok: false, reason: "malformed" };
    }
    const label = labelFromHost(host);
    if (label == null) {
      return { ok: false, reason: "bad_host" };
    }
    const mallId = normalizeMallId(label);
    return mallId ? { ok: true, mallId } : { ok: false, reason: "malformed" };
  }

  // Host form without a scheme (`mystore.cafe24.com`) — any dot must be a Cafe24 host.
  if (value.includes(".")) {
    const label = labelFromHost(value);
    if (label == null) {
      return { ok: false, reason: "bad_host" };
    }
    const mallId = normalizeMallId(label);
    return mallId ? { ok: true, mallId } : { ok: false, reason: "malformed" };
  }

  // Bare label.
  const mallId = normalizeMallId(value);
  return mallId ? { ok: true, mallId } : { ok: false, reason: "malformed" };
}
