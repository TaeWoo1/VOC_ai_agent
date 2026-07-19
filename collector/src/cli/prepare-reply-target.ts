/**
 * **Reply-target preparation** — authenticated (JWT), loopback backend call that mints a single-use
 * submissionRef and writes an owner-only, one-shot reply-target result bundle. OFFLINE-safe to build/verify:
 * `main()` launches nothing on import, and it NEVER touches NAVER or a live page.
 *
 *   npx tsx src/cli/prepare-reply-target.ts -- --i-understand-this-mints-a-submission-ref
 *
 * Inputs and outputs are permission-restricted files under `.reply-target/`, never argv/stdout, so the
 * account id, action ref, and submissionRef never land in shell history or a process listing:
 *  - reads the request bundle `.reply-target/request.json` = `{accountId, actionRef}` (consumed on SUCCESS;
 *    left in place on a failed run so a retry is easy);
 *  - POSTs `reply/submission-run` with `requireTargetHint: true` (the backend derives AND validates the hint
 *    BEFORE minting — an invalid hint 409s and mints nothing);
 *  - writes the result bundle `.reply-target/hint.json` = `{submissionRef, rating, recencyBucket,
 *    bodyFingerprint, asOfDate}` at 0600 for the reply CLI to consume.
 *
 * It prints only a non-sensitive confirmation — never the ids, the ref, or the hint. This is NOT a live reply
 * run and carries no NAVER/G6 gate: it only talks to the SellerOps backend.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadConfig } from "../config";
import { log } from "../log";
import { login, startReplySubmissionRun, type SubmissionRunResponse } from "../upload";
import type { RecencyBucket } from "../action-window/reply-submission/reply-surface";
import {
  loadRequestBundle,
  ReplyTargetBundleError,
  reserveResultBundle,
  writeResultBundle,
  type BundleErrorCode,
  type ReplyTargetRequestBundle,
  type ReplyTargetResultBundle,
} from "../action-window/reply-submission/reply-target-bundle";

const CONFIRM_FLAG = "--i-understand-this-mints-a-submission-ref";
const REQUEST_BUNDLE_REL_PATH = ".reply-target/request.json";
const RESULT_BUNDLE_REL_PATH = ".reply-target/hint.json";

/** Exit code: the request bundle is present but invalid / mis-permissioned. */
export const REQUEST_BUNDLE_REFUSAL_EXIT_CODE = 5;
/** Exit code: a result bundle already exists (unconsumed) — refuse BEFORE minting; leave it untouched. */
export const RESULT_BUNDLE_EXISTS_EXIT_CODE = 6;
/** Exit code: preparation failed after reserving the slot (login/mint/finalize error); reservation released. */
export const PREPARE_FAILED_EXIT_CODE = 1;

/**
 * Map a successful (guided) submission-run response into the result bundle to persist. Throws if the backend
 * returned no hint — which cannot happen for a 2xx `requireTargetHint` response (it 409s instead), but is
 * guarded so a malformed response never writes a partial bundle.
 */
export function resultBundleFrom(response: SubmissionRunResponse): ReplyTargetResultBundle {
  if (!response.targetHint || !response.asOfDate) {
    throw new Error("guided submission-run returned no target hint");
  }
  return {
    submissionRef: response.submissionRef,
    rating: response.targetHint.rating,
    recencyBucket: response.targetHint.recencyBucket as RecencyBucket,
    bodyFingerprint: response.targetHint.bodyFingerprint,
    asOfDate: response.asOfDate,
  };
}

/** Refusal for a present-but-unusable request bundle (no field value is ever printed). */
export function requestBundleRefusal(code: Exclude<BundleErrorCode, "EXPIRED" | "EXISTS">, path: string): string {
  const why: Record<Exclude<BundleErrorCode, "EXPIRED" | "EXISTS">, string> = {
    PERMS: "the file is group/world-readable — re-create it owner-only (chmod 600)",
    MALFORMED: "the file is not valid JSON",
    SCHEMA: "the file fails schema validation (accountId, actionRef)",
  };
  return `Refusing: the request bundle at ${path} is unusable — ${why[code]}.`;
}

/** Refusal for an existing unconsumed result bundle — no mint happens, the existing file is left untouched. */
export function resultBundleExistsRefusal(path: string): string {
  return [
    `Refusing: a reply-target bundle already exists at ${path} — NOT minting a new submissionRef.`,
    "  - An unconsumed bundle holds a live single-use submissionRef; overwriting it would orphan that ref.",
    "  - Consume it (run the reply CLI) or remove it, then re-run prepare-reply-target.",
  ].join("\n");
}

/** Consume a bundle file (best-effort) so ids/refs never linger on disk after use. */
function consumeBundleFile(path: string): void {
  try {
    if (existsSync(path)) unlinkSync(path);
  } catch {
    /* best-effort */
  }
}

function banner(): void {
  const line = "─".repeat(64);
  console.error(line);
  console.error(" PREPARE REPLY TARGET — authenticated backend call (no NAVER, no live page). Mints a");
  console.error(" single-use submissionRef and writes an owner-only, one-shot reply-target bundle. Reads");
  console.error(" account/action ids from an owner-only request bundle — never argv. Prints no secrets.");
  console.error(line);
}

/* ─────────────── Orchestration (reserve-before-mint, testable offline) ─────────────── */

export type PrepareStatus = "OK" | "NO_REQUEST" | "BAD_REQUEST" | "RESULT_EXISTS" | "PREPARE_FAILED";

export interface PrepareOutcome {
  status: PrepareStatus;
  exitCode: number;
}

export interface PrepareConfig {
  requestPath: string;
  resultPath: string;
  baseUrl: string;
  email: string;
  password: string;
}

/** Injected effects so the reserve-before-mint ordering is unit-testable offline (no disk, no backend). */
export interface PrepareDeps {
  loadRequest: (path: string) => ReplyTargetRequestBundle | null;
  reserve: (path: string) => void; // throws ReplyTargetBundleError("EXISTS") when the slot is taken
  consume: (path: string) => void;
  finalize: (path: string, bundle: ReplyTargetResultBundle) => void;
  discardReservation: (path: string) => void;
  login: (baseUrl: string, email: string, password: string) => Promise<string>;
  startRun: (
    baseUrl: string,
    token: string,
    accountId: string,
    actionRef: string,
    opts: { requireTargetHint: boolean },
  ) => Promise<SubmissionRunResponse>;
  onError: (message: string) => void;
}

/**
 * Reserve-before-mint preparation. The exclusive reservation happens BEFORE any login/mint, so:
 *  - an existing unconsumed result bundle (or a concurrent prepare that reserved first) fails with
 *    `RESULT_EXISTS` — no mint, request untouched, existing bundle untouched;
 *  - only the reservation winner mints, then finalizes over its OWN reservation;
 *  - any failure after reserving releases the reservation so a retry can proceed.
 * The request bundle is consumed only on full success, so a failed mint leaves it for an easy retry.
 */
export async function prepareReplyTarget(cfg: PrepareConfig, deps: PrepareDeps): Promise<PrepareOutcome> {
  let request: ReplyTargetRequestBundle | null;
  try {
    request = deps.loadRequest(cfg.requestPath);
  } catch (e) {
    if (e instanceof ReplyTargetBundleError && e.code !== "EXPIRED" && e.code !== "EXISTS") {
      deps.onError(requestBundleRefusal(e.code, cfg.requestPath));
      return { status: "BAD_REQUEST", exitCode: REQUEST_BUNDLE_REFUSAL_EXIT_CODE };
    }
    throw e;
  }
  if (!request) {
    deps.onError(
      `No request bundle at ${cfg.requestPath}. Create it owner-only (chmod 600) as {"accountId","actionRef"}.`,
    );
    return { status: "NO_REQUEST", exitCode: 2 };
  }

  // Reserve the result slot atomically BEFORE minting; fail closed (no mint) if it is already taken.
  try {
    deps.reserve(cfg.resultPath);
  } catch (e) {
    if (e instanceof ReplyTargetBundleError && e.code === "EXISTS") {
      deps.onError(resultBundleExistsRefusal(cfg.resultPath));
      return { status: "RESULT_EXISTS", exitCode: RESULT_BUNDLE_EXISTS_EXIT_CODE };
    }
    throw e;
  }

  // We own the slot. A failure from here releases the reservation so the operator can retry.
  try {
    const token = await deps.login(cfg.baseUrl, cfg.email, cfg.password);
    const response = await deps.startRun(cfg.baseUrl, token, request.accountId, request.actionRef, {
      requireTargetHint: true,
    });
    deps.finalize(cfg.resultPath, resultBundleFrom(response));
  } catch (e) {
    deps.discardReservation(cfg.resultPath);
    deps.onError(
      `Preparation failed after reserving the slot (reservation released): ${e instanceof Error ? e.message : String(e)}. `
        + "If a submissionRef was minted it is now orphaned; re-run to mint a fresh one.",
    );
    return { status: "PREPARE_FAILED", exitCode: PREPARE_FAILED_EXIT_CODE };
  }

  // Single-use: consume the request only on success, so a failed run above leaves it for retry.
  deps.consume(cfg.requestPath);
  return { status: "OK", exitCode: 0 };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  banner();
  if (!args.includes(CONFIRM_FLAG)) {
    console.error(`Refusing: pass ${CONFIRM_FLAG} — this mints a single-use submissionRef on the backend.`);
    process.exit(3);
    return;
  }

  const cfg = loadConfig();
  const collectorRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const requestPath = resolve(collectorRoot, REQUEST_BUNDLE_REL_PATH);
  const resultPath = resolve(collectorRoot, RESULT_BUNDLE_REL_PATH);

  const outcome = await prepareReplyTarget(
    { requestPath, resultPath, baseUrl: cfg.baseUrl, email: cfg.email, password: cfg.password },
    {
      loadRequest: (p) => loadRequestBundle(p, { existsSync, statSync, readFileSync }),
      reserve: (p) => reserveResultBundle(p, { existsSync, mkdirSync, writeFileSync }),
      consume: consumeBundleFile,
      finalize: (p, b) => writeResultBundle(p, b, { existsSync, mkdirSync, writeFileSync, chmodSync, renameSync }),
      // Release the reserved slot AND any partial temp from a failed finalize, so a retry starts clean.
      discardReservation: (p) => { consumeBundleFile(p); consumeBundleFile(`${p}.tmp`); },
      login,
      startRun: startReplySubmissionRun,
      onError: (m) => console.error(m),
    },
  );

  if (outcome.status === "OK") {
    // Print ONLY a non-sensitive confirmation — never the ids, the ref, the hint, or the review body.
    console.error(`Wrote an owner-only, single-use reply-target bundle to ${resultPath}.`);
    console.error("Run the reply CLI to consume it (it reads the submissionRef and hint from the bundle).");
    log("reply.target.prepared", {});
    return;
  }
  process.exit(outcome.exitCode);
}

// Run ONLY when invoked directly (never on import) so hermetic tests launch nothing.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
