import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

export interface CollectorConfig {
  /** SellerOps backend base URL (the collector uploads here). */
  baseUrl: string;
  /** SellerOps login (local dev). NOT a NAVER credential. */
  email: string;
  password: string;
  /** Channel code to resolve to a channel id for uploads. */
  naverChannelCode: string;
  /** Persistent browser profile dir (live layer); holds the NAVER session locally only. */
  profileDir: string;
  /**
   * In-tree base dir under which every connection-owned dedicated ESM profile lives
   * (`${profileBaseDir}/esm-agent-<hash>`). The SINGLE base shared by the local-agent reconnect
   * path and the review-capture path, so both resolve a connection to the identical profile via
   * `connectionProfileDirFor`. Fixed at `<collectorRoot>/.profile` — deliberately NOT env-overridable
   * (the profile root is not externalized in this slice).
   */
  profileBaseDir: string;
  /** Where captured exports land (live layer). */
  downloadDir: string;
  /** Local status file the collector writes after each run. */
  statusFile: string;
  /** Review-management/export URL (live layer; unknown until milestone 1). */
  naverReviewUrl: string | undefined;
  /**
   * The SellerOps web app's own origin — the page the seated import agent opens FIRST.
   *
   * The guided import journey is "open SellerOps, ask to connect, then the seller center appears" (product-owner
   * decision, 2026-07-26), and all of it happens in ONE browser profile: two profiles means two sessions and an
   * account picker the seller has to get right twice. So the agent's browser starts on SellerOps and the
   * marketplace tab is opened later, next to it.
   *
   * Dev default because import mode is seated and gated (`import-mode-gate.ts`) — it never runs in production.
   */
  appUrl: string;
  /**
   * ESM+ (Gmarket / Auction) review-management/export URL (live layer; the model-C
   * REVIEW discovery track). Gate-1 observed a `/Home/v2/manage-feedback`-like route
   * on an esmplus host; the exact URL is supplied out-of-band, never committed.
   * Unset until an operator provides it for a Gate-2 no-click classifier run.
   */
  esmReviewUrl: string | undefined;
  /**
   * Persistent browser profile dir for the ESM+ live layer — SEPARATE from the NAVER
   * profile so the two platforms' sessions never share storage. Holds the ESM+
   * session locally only; gitignored under `.profile/`.
   */
  esmProfileDir: string;
  /**
   * ESM-family cross-origin frame allowlist (HOSTNAMES, e.g. `esmplus.com`,
   * `gmarket.co.kr`) for the no-click classifier. A cross-origin child frame is read
   * read-only ONLY when its host equals or is a subdomain of an entry here; everything
   * else is skipped. Operator-supplied via `ESM_FRAME_ORIGIN_ALLOWLIST` (comma/space
   * separated), never hardcoded. Empty (default) → **fail-closed**: no cross-origin
   * frame is read. Raw hosts are never logged or emitted.
   */
  esmFrameOriginAllowlist: string[];
  /**
   * Optional Playwright browser channel (live layer). When set (e.g. `chrome`),
   * the launcher drives the installed browser of that channel instead of the
   * bundled Chromium — recommended for NAVER (a mainstream Chrome fingerprint is
   * less likely to trip account security). Undefined → bundled Chromium. The
   * dedicated profile dir is unchanged either way; the user's normal Chrome
   * profile is never used.
   */
  browserChannel: string | undefined;
  /**
   * Shared salt for the storage diagnostic's one-way key-name hashing (live
   * diagnostic only). The SAME value must be set for both the same-session (State
   * A) and the cold (State B) legs so their hashed key names are comparable for
   * the A/B diff; an absent salt makes the diagnostic fail closed. Never printed,
   * never written to status/docs. Undefined → diagnostic refuses to run.
   */
  storageProbeSalt: string | undefined;
  /**
   * Optional one-way store fingerprint that namespaces the ESM+ REVIEW composite dedup keys
   * (Gate 5, Slice 5A) per store — a precomputed salted hash, NEVER a raw store id/label. Its
   * only job is to be CONSTANT across the two overlapping-export captures (so same-store keys
   * compare) and to separate different stores' keys. Undefined → keys namespaced by channel
   * only (fine for a single-store overlap run). Never printed to output/status/docs.
   */
  esmStoreFingerprint: string | undefined;
  /**
   * Expected Commerce channel code the account/store resolver matches candidates
   * against (live layer). Defaults to `naverChannelCode` (the user's "use existing
   * channel code if possible") so no extra config is required for the common case.
   * The resolver clicks at most one candidate, and only when exactly one candidate
   * structurally matches this code (or `naverExpectedStoreFingerprint`).
   */
  naverExpectedChannelCode: string;
  /**
   * Optional stronger account/store match: a precomputed salted hash
   * (`sha256(STORAGE_PROBE_SALT + " " + token).slice(0,16)`) of the expected store's
   * stable identity token. Never a raw store label. Undefined → channel-code match
   * only. When set, the salt (`storageProbeSalt`) must also be set for it to apply.
   */
  naverExpectedStoreFingerprint: string | undefined;
  /**
   * Optional salted fingerprint of the expected NAVER Commerce "continue with this
   * account" reconnect-CARD display text (`sha256(STORAGE_PROBE_SALT + " " +
   * normalizedCardText).slice(0,16)`). This is NOT a store-id fingerprint — it is the
   * display-text fingerprint of the single-account continuation surface. Absent → the
   * diagnostic still reports the observed card hash but a future guarded continue is
   * never allowed. Never a raw account/Commerce-ID label.
   */
  naverExpectedContinueCardFingerprint: string | undefined;
}

/**
 * Parse a comma/whitespace-separated host allowlist into a normalized, deduped,
 * lower-cased list. Undefined/blank → empty list (fail-closed). Never throws.
 */
function parseHostAllowlist(raw: string | undefined): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  for (const part of raw.split(/[\s,]+/)) {
    const host = part.trim().toLowerCase();
    if (host.length > 0) seen.add(host);
  }
  return [...seen];
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): CollectorConfig {
  return {
    baseUrl: env.SELLEROPS_BASE_URL ?? "http://localhost:8080",
    email: env.SELLEROPS_EMAIL ?? "demo@sellerops.ai",
    password: env.SELLEROPS_PASSWORD ?? "demo1234",
    naverChannelCode: env.NAVER_CHANNEL_CODE ?? "NAVER",
    naverExpectedChannelCode: env.NAVER_EXPECTED_CHANNEL_CODE ?? env.NAVER_CHANNEL_CODE ?? "NAVER",
    naverExpectedStoreFingerprint: env.NAVER_EXPECTED_STORE_FINGERPRINT,
    naverExpectedContinueCardFingerprint: env.NAVER_EXPECTED_CONTINUE_CARD_FINGERPRINT,
    profileDir: env.COLLECTOR_PROFILE_DIR ?? resolve(root, ".profile/naver"),
    // The account-scoped profile base. Fixed to the in-tree `.profile` for dev, but relocatable via
    // `COLLECTOR_PROFILE_BASE_DIR` so the PILOT runtime can place profiles under the per-user data root
    // (`%LOCALAPPDATA%\SellerOps\Agent\profiles`) — where an in-place update does not erase the NAVER login.
    // The profile path guard (`resolveProfileDir`) permits this relocated base too, so the isolation guarantee
    // is unchanged: profiles still live under exactly one controlled base, just a durable one.
    profileBaseDir: env.COLLECTOR_PROFILE_BASE_DIR
      ? resolve(env.COLLECTOR_PROFILE_BASE_DIR)
      : resolve(root, ".profile"),
    esmProfileDir: env.COLLECTOR_ESM_PROFILE_DIR ?? resolve(root, ".profile/esm"),
    esmFrameOriginAllowlist: parseHostAllowlist(env.ESM_FRAME_ORIGIN_ALLOWLIST),
    downloadDir: env.COLLECTOR_DOWNLOAD_DIR ?? resolve(root, "downloads"),
    statusFile: env.COLLECTOR_STATUS_FILE ?? resolve(root, ".status/naver.json"),
    naverReviewUrl: env.NAVER_REVIEW_URL,
    appUrl: env.SELLEROPS_APP_URL ?? "http://localhost:5173",
    esmReviewUrl: env.ESM_REVIEW_URL,
    browserChannel: env.COLLECTOR_BROWSER_CHANNEL,
    storageProbeSalt: env.STORAGE_PROBE_SALT,
    esmStoreFingerprint: env.ESM_STORE_FINGERPRINT,
  };
}
