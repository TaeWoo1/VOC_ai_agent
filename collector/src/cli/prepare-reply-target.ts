/**
 * **Reply-target preparation** — authenticated (JWT), loopback backend call that mints a single-use
 * submissionRef and writes an owner-only, one-shot reply-target result bundle. OFFLINE-safe to build/verify:
 * `main()` launches nothing on import, and it NEVER touches NAVER or a live page.
 *
 *   npx tsx src/cli/prepare-reply-target.ts -- --i-understand-this-mints-a-submission-ref
 *
 * Inputs and outputs are permission-restricted files under `.reply-target/`, never argv/stdout, so the
 * account id, action ref, and submissionRef never land in shell history or a process listing:
 *  - reads the request bundle `.reply-target/request.json` = `{accountId, actionRef}` (consumed on read);
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
export function requestBundleRefusal(code: Exclude<BundleErrorCode, "EXPIRED">, path: string): string {
  const why: Record<Exclude<BundleErrorCode, "EXPIRED">, string> = {
    PERMS: "the file is group/world-readable — re-create it owner-only (chmod 600)",
    MALFORMED: "the file is not valid JSON",
    SCHEMA: "the file fails schema validation (accountId, actionRef)",
  };
  return `Refusing: the request bundle at ${path} is unusable — ${why[code]}.`;
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

  let request: ReplyTargetRequestBundle | null;
  try {
    request = loadRequestBundle(requestPath, { existsSync, statSync, readFileSync });
  } catch (e) {
    if (e instanceof ReplyTargetBundleError && e.code !== "EXPIRED") {
      console.error(requestBundleRefusal(e.code, requestPath));
      process.exit(REQUEST_BUNDLE_REFUSAL_EXIT_CODE);
      return;
    }
    throw e;
  }
  if (!request) {
    console.error(
      `No request bundle at ${requestPath}. Create it owner-only (chmod 600) as {"accountId","actionRef"}.`,
    );
    process.exit(2);
    return;
  }
  // Consume the request bundle immediately (single-use) — the ids never linger on disk past the read.
  consumeBundleFile(requestPath);

  const token = await login(cfg.baseUrl, cfg.email, cfg.password);
  const response = await startReplySubmissionRun(cfg.baseUrl, token, request.accountId, request.actionRef, {
    requireTargetHint: true,
  });
  const bundle = resultBundleFrom(response);
  writeResultBundle(resultPath, bundle, { existsSync, mkdirSync, writeFileSync, chmodSync, renameSync });

  // Print ONLY a non-sensitive confirmation — never the ids, the ref, the hint, or the review body.
  console.error(`Wrote an owner-only, single-use reply-target bundle to ${resultPath}.`);
  console.error("Run the reply CLI to consume it (it reads the submissionRef and hint from the bundle).");
  log("reply.target.prepared", {});
}

// Run ONLY when invoked directly (never on import) so hermetic tests launch nothing.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
