import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExecutionProviderKind } from "./action-window/initial-import/execution-provider";
import { EXECUTION_PROVIDER_ENV, parseExecutionProvider } from "./action-window/initial-import/execution-provider-selection";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");


/**
 * **The helper's state root** (Local Helper Pilot Packaging v1, 2026-09-05).
 *
 * Everything the helper keeps between runs — the persistent NAVER profile, the pairings, the status
 * file, downloads, run records — lived under the git checkout, because the checkout WAS the helper. A
 * packaged helper is a bundle the installer replaces on update, so its state has to live somewhere
 * the update does not touch. `REVIEWNARY_HELPER_HOME` names that place (the installer sets it in the
 * launchd environment; it is a path, never a secret). Unset — the developer checkout — everything is
 * exactly where it always was: this module's own tree.
 */
export const HELPER_HOME_ENV = "REVIEWNARY_HELPER_HOME";

export function helperHome(env: NodeJS.ProcessEnv = process.env): string {
  const home = env[HELPER_HOME_ENV];
  return home && home.trim() !== "" ? resolve(home.trim()) : root;
}

/**
 * Non-secret settings the installer leaves for the helper in `<home>/helper.env`, loaded by the helper
 * itself. **No credential lives here any more** (Helper Device Authentication v1, 2026-09-05): the helper's
 * backend credential is the device token the seller grants from a browser session, kept by
 * `auth/helper-session.ts` in `<home>/.auth/`; `SELLEROPS_EMAIL` / `SELLEROPS_PASSWORD` are no longer keys
 * this file can carry, so an installer or a person cannot put a password back here.
 *
 * Closed key list: a line the helper did not ask for is ignored, so the file cannot become a way to
 * reconfigure the process. Process env wins over the file, so an operator's explicit override still holds.
 */
export const HELPER_ENV_FILE = "helper.env";
export const HELPER_ENV_KEYS = [
  "SELLEROPS_BASE_URL",
  "SELLEROPS_APP_URL",
  "NAVER_REVIEW_URL",
  "BRIDGE_ALLOWED_ORIGINS",
  // Which executor carries a screen read on THIS machine (`execution-provider-selection.ts`). It was
  // reachable only as a process env var, which a developer sets and an installed helper never sees —
  // so the BYO lane the product documents was, on a packaged install, unreachable by configuration.
  // A declared key rather than a new mechanism: the list is still closed, the default is still
  // LOCAL_HELPER, an unknown value still refuses to boot, and process env still wins over the file.
  EXECUTION_PROVIDER_ENV,
] as const;

export function parseHelperEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!(HELPER_ENV_KEYS as readonly string[]).includes(key)) continue;
    let value = line.slice(eq + 1).trim();
    if (value.length >= 2 && ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"')))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/** `env` plus whatever `<home>/helper.env` fills in for keys the env does not set. Pure given the file text. */
export function withHelperEnvFile(
  env: NodeJS.ProcessEnv,
  readFile: (path: string) => string | null = (path) => (existsSync(path) ? readFileSync(path, "utf8") : null),
): NodeJS.ProcessEnv {
  const home = env[HELPER_HOME_ENV];
  if (!home || home.trim() === "") return env;
  const text = readFile(resolve(home.trim(), HELPER_ENV_FILE));
  if (text === null) return env;
  const merged: NodeJS.ProcessEnv = { ...env };
  for (const [key, value] of Object.entries(parseHelperEnv(text))) {
    if (merged[key] === undefined || merged[key] === "") merged[key] = value;
  }
  return merged;
}

/**
 * The helper's own version — the package version, so it moves when the package does, instead of the
 * literal `"0.0.1-poc"` the bridge used to announce forever. Reported in `/bridge/health`, compared by the
 * frontend against its minimum, and shown to the seller as 「도우미 업데이트가 필요합니다」 when short.
 *
 * `REVIEWNARY_HELPER_VERSION_OVERRIDE` exists so the update path can be REPRODUCED (a helper announcing
 * an old version) and is honored only outside production — an installed helper cannot lie about itself.
 */
export function helperVersion(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.REVIEWNARY_HELPER_VERSION_OVERRIDE;
  if (override && override.trim() !== "" && env.NODE_ENV !== "production") return override.trim();
  // Beside the bundle first (dist: app/package.json next to app/helper.mjs), then the package root (checkout).
  for (const candidate of [resolve(here, "package.json"), resolve(root, "package.json")]) {
    try {
      const pkg = JSON.parse(readFileSync(candidate, "utf8")) as { version?: unknown };
      if (typeof pkg.version === "string" && pkg.version.trim() !== "") return pkg.version;
    } catch {
      // try the next
    }
  }
  return "0.0.0";
}

export interface CollectorConfig {
  /** SellerOps backend base URL (the collector uploads here). */
  baseUrl: string;
  /**
   * Developer-checkout login (env only, never a file). The packaged helper (NODE_ENV=production) never reads
   * these: its backend credential is the linked device token (`auth/helper-session.ts`).
   */
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
   * `connectionProfileDirFor`. Fixed at `<helperHome>/.profile` — the ONE root moves with
   * `REVIEWNARY_HELPER_HOME` (packaged helper) and is otherwise the collector tree; it is not
   * separately overridable, so every profile stays under the same guarded root.
   */
  profileBaseDir: string;
  /** Where captured exports land (live layer). */
  downloadDir: string;
  /**
   * **Execution provider (Aside Acquisition Track, experiment switch).** Which executor carries a guided
   * review-import segment: `LOCAL_HELPER` (the default — the seller clicks, the helper observes) or `ASIDE`
   * (deterministic Aside execution on the seller's PC). The default is never changed by this switch being
   * absent; `ASIDE` is refused at boot by any build that binds no export workflow for the channel.
   */
  executionProvider: ExecutionProviderKind;
  /** The Aside CLI executable (default `aside` on PATH). A path, never a secret. */
  asideCli: string;
  /** `--account <id>` for the Aside CLI when the seller's Aside holds several accounts. Opaque; optional. */
  asideAccount: string | undefined;
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

export function loadConfig(rawEnv: NodeJS.ProcessEnv = process.env): CollectorConfig {
  const env = withHelperEnvFile(rawEnv);
  const home = helperHome(env);
  return {
    baseUrl: env.SELLEROPS_BASE_URL ?? "http://localhost:8080",
    email: env.SELLEROPS_EMAIL ?? "demo@sellerops.ai",
    password: env.SELLEROPS_PASSWORD ?? "demo1234",
    naverChannelCode: env.NAVER_CHANNEL_CODE ?? "NAVER",
    naverExpectedChannelCode: env.NAVER_EXPECTED_CHANNEL_CODE ?? env.NAVER_CHANNEL_CODE ?? "NAVER",
    naverExpectedStoreFingerprint: env.NAVER_EXPECTED_STORE_FINGERPRINT,
    naverExpectedContinueCardFingerprint: env.NAVER_EXPECTED_CONTINUE_CARD_FINGERPRINT,
    profileDir: env.COLLECTOR_PROFILE_DIR ?? resolve(home, ".profile/naver"),
    profileBaseDir: resolve(home, ".profile"),
    esmProfileDir: env.COLLECTOR_ESM_PROFILE_DIR ?? resolve(home, ".profile/esm"),
    esmFrameOriginAllowlist: parseHostAllowlist(env.ESM_FRAME_ORIGIN_ALLOWLIST),
    downloadDir: env.COLLECTOR_DOWNLOAD_DIR ?? resolve(home, "downloads"),
    executionProvider: parseExecutionProvider(env[EXECUTION_PROVIDER_ENV]),
    asideCli: env.ASIDE_CLI && env.ASIDE_CLI.trim() !== "" ? env.ASIDE_CLI.trim() : "aside",
    asideAccount: env.ASIDE_ACCOUNT && env.ASIDE_ACCOUNT.trim() !== "" ? env.ASIDE_ACCOUNT.trim() : undefined,
    statusFile: env.COLLECTOR_STATUS_FILE ?? resolve(home, ".status/naver.json"),
    naverReviewUrl: env.NAVER_REVIEW_URL,
    appUrl: env.SELLEROPS_APP_URL ?? "http://localhost:5173",
    esmReviewUrl: env.ESM_REVIEW_URL,
    browserChannel: env.COLLECTOR_BROWSER_CHANNEL,
    storageProbeSalt: env.STORAGE_PROBE_SALT,
    esmStoreFingerprint: env.ESM_STORE_FINGERPRINT,
  };
}
