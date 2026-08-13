/**
 * **Where the three plaintext secrets are allowed to go.** Pure, zero-import, and the only screen on that path.
 *
 * Every other boundary in this workstream is screened — `screenWingUrl` for the marketplace, the profile-path
 * guard for the browser profile, `screenSellerOpsReturnUrl` for the OS handoff, `CoupangLiveCallGuard` for the
 * outbound Coupang call. The one place all three of the seller's key values leave the process was not, and review
 * found it: `SELLEROPS_BASE_URL` was passed through unscreened to the POST, and to `login()` beside it, so a
 * stale or hostile value in the environment would send a WING Secret Key — and the SellerOps password — to an
 * arbitrary host in cleartext.
 *
 * The rule is the one the rest of this codebase already uses for "this machine": loopback, or a hostname the
 * DNS root cannot resolve to anyone (`.localhost` / `.test` / `.local`). It is deliberately NOT "https is fine
 * too": a SellerOps deployment on a real domain receiving a credential from a local agent is a product decision,
 * and it should arrive as one rather than through an environment variable.
 */

/** Why a configured backend origin was refused. Sanitized: a reason, never the value. */
export const BACKEND_ORIGIN_REFUSALS = ["EMPTY", "UNPARSEABLE", "NOT_HTTP", "NOT_LOCAL"] as const;
export type BackendOriginRefusal = (typeof BACKEND_ORIGIN_REFUSALS)[number];

export type BackendOriginScreen =
  | { readonly ok: true; readonly origin: string }
  | { readonly ok: false; readonly reason: BackendOriginRefusal };

/** The hosts that ARE this machine. Mirrors `CoupangLiveCallGuard.isOfflineHost` on the backend side. */
const LOOPBACK_HOSTS: readonly string[] = ["localhost", "127.0.0.1", "[::1]", "::1"];

function isLocalHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (LOOPBACK_HOSTS.includes(h)) return true;
  return h.endsWith(".localhost") || h.endsWith(".test") || h.endsWith(".local");
}

/**
 * Screen the configured SellerOps backend origin for a run that will put credentials on it. Returns the ORIGIN
 * only — path, query and fragment are dropped rather than carried forward, so a configured value with a path
 * cannot redirect the POST somewhere the screening never looked at.
 */
export function screenCredentialBackendOrigin(baseUrl: string | undefined): BackendOriginScreen {
  const raw = (baseUrl ?? "").trim();
  if (raw === "") return { ok: false, reason: "EMPTY" };
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, reason: "UNPARSEABLE" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return { ok: false, reason: "NOT_HTTP" };
  if (!isLocalHost(parsed.hostname)) return { ok: false, reason: "NOT_LOCAL" };
  return { ok: true, origin: parsed.origin };
}

/** The operator-facing refusal. Names the reason and never the configured value. */
export function backendOriginRefusalMessage(reason: BackendOriginRefusal): string {
  return (
    `Refusing to start: SELLEROPS_BASE_URL failed screening (${reason}). This run puts the seller's Access Key ` +
    "and Secret Key on that origin, so it must be this machine (loopback / .localhost / .test / .local). " +
    "Nothing was read and no browser was launched."
  );
}
