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
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): CollectorConfig {
  return {
    baseUrl: env.SELLEROPS_BASE_URL ?? "http://localhost:8080",
    email: env.SELLEROPS_EMAIL ?? "demo@sellerops.ai",
    password: env.SELLEROPS_PASSWORD ?? "demo1234",
    naverChannelCode: env.NAVER_CHANNEL_CODE ?? "NAVER",
    profileDir: env.COLLECTOR_PROFILE_DIR ?? resolve(root, ".profile/naver"),
    downloadDir: env.COLLECTOR_DOWNLOAD_DIR ?? resolve(root, "downloads"),
    statusFile: env.COLLECTOR_STATUS_FILE ?? resolve(root, ".status/naver.json"),
    naverReviewUrl: env.NAVER_REVIEW_URL,
    browserChannel: env.COLLECTOR_BROWSER_CHANNEL,
  };
}
