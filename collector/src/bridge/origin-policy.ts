/**
 * **Origin allow-policy (pure).** The bridge must reject unexpected origins and MUST NOT accept a wildcard
 * (slice §5.1 "ambient localhost 신뢰 금지", §12 criterion 3). A same-PC browser page from any other site
 * can reach loopback, so a valid, explicitly-allowed `Origin` header is required on every WS handshake and
 * on every state-bearing HTTP request.
 *
 * The allow-list is the set of SellerOps frontend origins configured for this agent (dev localhost and/or
 * the deployed app origin). No I/O here — the caller supplies the configured list.
 */

/**
 * Is `origin` explicitly allowed? Empty/missing origin is rejected (never treated as same-origin trust).
 * A `"*"` entry in the list is ignored on purpose — wildcard acceptance is a policy error, not a shortcut.
 */
export function isOriginAllowed(origin: string | undefined | null, allowed: readonly string[]): boolean {
  if (!origin) return false;
  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;
  for (const entry of allowed) {
    if (entry === "*") continue; // wildcard is never honored
    if (normalizeOrigin(entry) === normalized) return true;
  }
  return false;
}

/** Parse to a strict scheme://host[:port] origin; return null for anything malformed. */
export function normalizeOrigin(value: string): string | null {
  try {
    const u = new URL(value);
    if (u.username || u.password) return null;
    // URL.origin is already scheme://host[:port] with the default port elided.
    if (u.origin === "null" || !u.origin) return null;
    return u.origin;
  } catch {
    return null;
  }
}

/** Split a comma/space-separated allow-list env value into normalized origins (drops blanks + wildcards). */
export function parseAllowedOrigins(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s !== "*")
    .map((s) => normalizeOrigin(s))
    .filter((s): s is string => s !== null);
}
