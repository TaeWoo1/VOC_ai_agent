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
  /** Where captured exports land (live layer). */
  downloadDir: string;
  /** Local status file the collector writes after each run. */
  statusFile: string;
  /** Review-management/export URL (live layer; unknown until milestone 1). */
  naverReviewUrl: string | undefined;
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
    downloadDir: env.COLLECTOR_DOWNLOAD_DIR ?? resolve(root, "downloads"),
    statusFile: env.COLLECTOR_STATUS_FILE ?? resolve(root, ".status/naver.json"),
    naverReviewUrl: env.NAVER_REVIEW_URL,
    browserChannel: env.COLLECTOR_BROWSER_CHANNEL,
    storageProbeSalt: env.STORAGE_PROBE_SALT,
  };
}
