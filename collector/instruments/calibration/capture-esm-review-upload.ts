/**
 * Live ESM+ REVIEW — SUPERVISED APPROVED-INDEX SINGLE CAPTURE → CONTROLLED BACKEND UPLOAD.
 *
 *   set -a && . ./.env && set +a   # ESM_REVIEW_URL + ESM_FRAME_ORIGIN_ALLOWLIST + channel
 *   npx tsx instruments/calibration/capture-esm-review-upload.ts \
 *     --i-understand-this-opens-live-esm \
 *     --i-understand-this-uploads-esm-review-to-backend \
 *     --approved-index 0
 *
 * This is the ESM+ analog of the NAVER supervised capture→diagnostic-upload flow
 * (`capture-export-same-session.ts` → `uploadSavedReviewDownload` → `upload.ts`). It reuses the
 * EXACT Gate-3 supervised capture chain of `capture-esm-review.ts` (LOGGED_IN gate → one actionable
 * control in the allowlisted vendor frame → single approved-index click → single download → structural
 * `.xlsx` validation), then adds the ONE new leg that CLI deliberately omits: it UPLOADS the validated
 * export to the backend `POST /api/uploads` (channel `GMARKET`, `uploadType=REVIEW`,
 * `method=SELLER_CENTER_EXPORT`) BEFORE the quarantine file is deleted (upload-before-delete). The
 * backend applies its shipped `ReviewRowMapper → IngestionService → v2 content-hash dedup` — a real,
 * idempotent DB ingest.
 *
 * The observe-only `capture-esm-review.ts` keeps its hard `uploaded:false` invariant; the upload lives
 * ONLY here, gated behind a SECOND, distinct consent flag on top of the live-session flag.
 *
 * HARD INVARIANTS (source-guarded by a test):
 *   - Exactly ONE `.click(` and ONE `waitForEvent("download")`. No auto-repeat, no fallback, no loop.
 *     The approved index is REQUIRED.
 *   - BOTH the live-session flag AND the upload-consent flag are required; either missing → refuse.
 *   - The upload is UPLOAD-BEFORE-DELETE and fires ONLY when the file validated as a real `.xlsx`
 *     (enforced inside `saveAndInspectDownload`). The backend call is owned by `uploadSavedReviewDownload`;
 *     this CLI never names `uploadReviewFile` or `saveAs`.
 *   - NO collector status / `LAST_SUCCESS` write, NO scheduler / manualSync. (`ChannelConnectionStatus`
 *     is untouched — upload runs carry no sellerAccountId.)
 *   - Honest reporting: `uploaded` / `backendIngested` reflect the real ingest; this path NEVER claims
 *     `dbMutated:false`. It never confirms a mapping or dedup key (schemaMappingConfirmed /
 *     dedupKeyConfirmed / dedupKeyClaimed stay false).
 *   - No credential typing; no CAPTCHA/2FA bypass — the human authenticates.
 *   - Cross-origin frames entered ONLY via the allowlist, re-confirmed before acting. Sanitized output
 *     only — booleans / categories / buckets / a salted hash / an index. Never a raw URL / frame URL /
 *     origin / selector / DOM text / filename / identifier.
 *
 * LIVE-ONLY — refuses to act without BOTH explicit per-run approval flags.
 */
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Frame, Page } from "playwright";
import { loadConfig } from "../../src/config";
import {
  capturePreconditionMet,
  captureSessionGate,
  classifyFileStructure,
  classifyPostClickOutcome,
  decideApprovedCapture,
  parseApprovedIndexArg,
  postClickStop,
  type CaptureStop,
  type PostClickObservation,
  type SanitizedFrameCandidate,
} from "../../src/esm/esm-capture-gate";
import { summarizeExportCandidateVisibility } from "../../src/esm/esm-export-visibility";
import { frameHostAllowed, summarizeFrameAwareExportScan } from "../../src/esm/esm-frame-scan";
import { esmApprovalRequiredMessage, hasEsmLiveApproval } from "../../src/esm/esm-live-approval";
import { esmUploadApprovalRequiredMessage, hasEsmUploadApproval } from "../../src/esm/esm-upload-approval";
import {
  buildCaptureInspectFn,
  deriveCaptureStop,
  parseRowSampleRowsArg,
  type CaptureInspection,
} from "../../src/esm/esm-capture-inspect";
import { headerLabelArtifactPath } from "../../src/esm/esm-review-header-quarantine";
import { esmUrlCategory, extractEsmReviewProbeSignals } from "../../src/esm/esm-review-probe";
import { esmSentinelPathFor } from "../../src/esm/esm-sentinel";
import { log } from "../../src/log";
import type { SavedDownloadInspection } from "../../src/naver/review-download-save";
import { buildEsmReviewUploadReport, saveValidateUploadDeleteEsmReview } from "../../src/esm/esm-review-upload";
import { launchPersistentBrowser } from "../../src/profile";
import { attachOperatorConfirmTab, type ConfirmHostContext } from "../../src/cli/operator-confirm-host";
import { actionBarrierRefusedMessage, barrierRefusedRecord, confirmActionBarrier } from "../../src/cli/operator-action-barrier";
import { pathToFileURL } from "node:url";

const NETWORKIDLE_BUDGET_MS = 8_000;
const STABILITY_INTERVAL_MS = 500;
const STABILITY_STABLE_READS = 3;
const STABILITY_MAX_CHECKS = 24;
const CONFIRM_TIMEOUT_MS = 10 * 60_000;
const SENTINEL_POLL_INTERVAL_MS = 750;
const CLICK_TIMEOUT_MS = 8_000;
const DOWNLOAD_WAIT_MS = 30_000;

const CONFIRM_PROMPT = [
  "",
  "A browser window is open on ESM+ (Gmarket / Auction). In that SAME window:",
  "  1) Complete the ESM+ login (and any 2FA/CAPTCHA) yourself.",
  "  2) Navigate to the review-management / feedback page; let the embedded panel load.",
  "  3) Leave the browser OPEN.",
  "",
  'Then signal readiness (in Claude Code, say "ready" and Claude creates the sentinel).',
  "The collector verifies the preconditions and, ONLY for the single approved actionable",
  "export control inside the allowlisted vendor frame, clicks it ONCE, observes one",
  "download, structurally validates it, UPLOADS it to the backend (a real DB ingest),",
  "then DELETES the local file. Anything ambiguous HALTS without clicking. (Ctrl-C to abort.)",
].join("\n");

function banner(): void {
  const line = "─".repeat(64);
  console.error(line);
  console.error(" LIVE ESM+ supervised capture → backend upload — TWO explicit approvals required.");
  console.error(" A human logs in; the collector clicks at most ONE approved export control,");
  console.error(" observes one download, validates it, UPLOADS it to the backend, then DELETES it.");
  console.error(line);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function removeSentinel(path: string): void {
  try {
    if (existsSync(path)) unlinkSync(path);
  } catch {
    /* best-effort */
  }
}

async function waitForSentinel(path: string, timeoutMs: number, intervalMs: number): Promise<boolean> {
  const maxChecks = Math.max(1, Math.ceil(timeoutMs / intervalMs));
  for (let i = 0; i < maxChecks; i += 1) {
    if (existsSync(path)) return true;
    await sleep(intervalMs);
  }
  return existsSync(path);
}

async function settleDom(page: Page): Promise<void> {
  try {
    await page.waitForLoadState("networkidle", { timeout: NETWORKIDLE_BUDGET_MS });
  } catch {
    /* SPA keeps connections open; fall through to the stability poll */
  }
  let previous = -1;
  let stable = 0;
  for (let i = 0; i < STABILITY_MAX_CHECKS; i += 1) {
    let count = -1;
    try {
      count = await page.evaluate(() => document.querySelectorAll("*").length);
    } catch {
      /* transient */
    }
    if (count === previous) {
      stable += 1;
      if (stable >= STABILITY_STABLE_READS) return;
    } else {
      stable = 0;
      previous = count;
    }
    await sleep(STABILITY_INTERVAL_MS);
  }
}

/** Self-contained in-frame export/consent candidate descriptor extractor (runs in the page). */
function candidateDescriptorsInFrame(): {
  candidates: Array<{ index: number; category: "export-like" | "consent-like"; visible: boolean; enabled: boolean }>;
} {
  const EXPORT = /엑셀|excel|다운로드|download|내려받기|내보내기|export|추출|csv|xlsx/i;
  const CONSENT = /동의|약관|개인정보\s*수집|이용\s*동의|consent|agree|terms/i;
  const SEL = "button, a, [role='button'], input[type='button'], input[type='submit']";
  const ATTR = "data-sellerops-esm-cap-index";
  for (const stale of Array.from(document.querySelectorAll("[" + ATTR + "]"))) stale.removeAttribute(ATTR);
  const out: Array<{ index: number; category: "export-like" | "consent-like"; visible: boolean; enabled: boolean }> = [];
  let idx = 0;
  for (const el of Array.from(document.querySelectorAll(SEL))) {
    const label = `${el.textContent ?? ""} ${el.getAttribute("aria-label") ?? ""} ${el.getAttribute("title") ?? ""} ${
      (el as HTMLInputElement).value ?? ""
    }`;
    const isExport = EXPORT.test(label);
    const isConsent = CONSENT.test(label);
    if (!isExport && !isConsent) continue;
    const he = el as HTMLElement;
    const cs = getComputedStyle(he);
    const rect = he.getBoundingClientRect();
    const laidOut = he.offsetParent !== null || he.getClientRects().length > 0 || (rect.width > 0 && rect.height > 0);
    const visible = laidOut && cs.display !== "none" && cs.visibility !== "hidden" && cs.visibility !== "collapse";
    const enabled = !(el as HTMLButtonElement).disabled && el.getAttribute("aria-disabled") !== "true";
    el.setAttribute(ATTR, String(idx));
    out.push({ index: idx, category: isExport ? "export-like" : "consent-like", visible, enabled });
    idx += 1;
  }
  return { candidates: out };
}

/** Read-only post-click marker check inside the frame (consent / async only — never text). */
function postClickMarkersInFrame(): { consent: boolean; async: boolean } {
  const html = document.documentElement.outerHTML;
  const CONSENT = /동의|약관|개인정보\s*수집|이용\s*동의|consent|agree|terms/i;
  const ASYNC = /다운로드\s*센터|download\s*center|다운로드\s*요청|요청\s*내역|대기열|export[-\s]?(queue|job|center)/i;
  return { consent: CONSENT.test(html), async: ASYNC.test(html) };
}

/** Locate the single allowlisted, readable child frame; null when none qualifies right now. */
async function findAllowlistedFrame(page: Page, allowlist: readonly string[]): Promise<Frame | null> {
  const main = page.mainFrame();
  for (const frame of page.frames()) {
    if (frame === main) continue;
    if (!frameHostAllowed(frame.url(), allowlist)) continue;
    try {
      await frame.evaluate(() => document.readyState);
      return frame;
    } catch {
      /* not readable right now — keep looking */
    }
  }
  return null;
}

/** One sanitized stop emission — no click happened. */
function emitStop(stop: CaptureStop, extra: Record<string, unknown>): void {
  const summary = { mode: "capture-upload", result: "STOPPED", stop, clicked: 0, ...extra };
  console.log(JSON.stringify(summary, null, 2));
  log("esm.review.capture-upload", { result: "STOPPED", stop, clicked: 0 });
}

async function main(): Promise<void> {
  banner();
  const args = process.argv.slice(2);
  // TWO explicit approvals — opening a live session AND consenting to the backend upload.
  if (!hasEsmLiveApproval(args)) {
    console.error(esmApprovalRequiredMessage());
    process.exit(3);
    return;
  }
  if (!hasEsmUploadApproval(args)) {
    console.error(esmUploadApprovalRequiredMessage());
    process.exit(3);
    return;
  }
  const approvedIndex = parseApprovedIndexArg(args);
  if (approvedIndex === null) {
    console.error("Supervised capture requires an explicit approved index: --approved-index <N>.");
    process.exit(4);
    return;
  }
  // Opt-in pre-delete inspectors (same as the observe-only CLI): schema-SHAPE, minimal ROW-SHAPE,
  // composite dedup KEYS, and header-LABEL quarantine. All read SHAPE only and confirm nothing —
  // they compose through the one inspect hook alongside the upload. Absent → no extra inspection.
  const inspectSchemaShape = args.includes("--inspect-schema-shape");
  const probeRowShape = args.includes("--probe-row-shape");
  const rowSampleRows = parseRowSampleRowsArg(args);
  const emitCompositeKey = args.includes("--emit-composite-key");
  const captureReviewHeaders = args.includes("--capture-review-headers");

  const cfg = loadConfig();
  if (!cfg.esmReviewUrl) {
    console.error("Set ESM_REVIEW_URL to the ESM+ review-management/export page URL first.");
    process.exit(2);
    return;
  }
  const allowlist = cfg.esmFrameOriginAllowlist;
  if (allowlist.length === 0) {
    console.error("Supervised capture targets the allowlisted vendor frame; set ESM_FRAME_ORIGIN_ALLOWLIST first.");
    process.exit(2);
    return;
  }

  const sentinelPath = esmSentinelPathFor(cfg.statusFile);
  mkdirSync(dirname(sentinelPath), { recursive: true });
  removeSentinel(sentinelPath);

  const ctx = await launchPersistentBrowser(cfg.esmProfileDir, cfg.browserChannel);
  const confirmHost = await attachOperatorConfirmTab(ctx as unknown as ConfirmHostContext, {
    aborted: () => false,
    timeoutMs: CONFIRM_TIMEOUT_MS,
  });
  const page = confirmHost.entryPage as unknown as Page;
  try {
    await page.goto(cfg.esmReviewUrl, { waitUntil: "domcontentloaded" });
    // **THE ACTION BARRIER**, and this run is the reason the policy exists: it clicks the marketplace's own
    // export control, waits for a real download, and — with the upload flag — POSTs the seller's reviews into
    // the backend database. Its readiness prompt used to say, in as many words, that in Claude Code the
    // operator could say "ready" and the assistant would create the file that started all of it.
    const allowed = await confirmActionBarrier(confirmHost, {
      kind: "EXPORT_TRIGGER",
      title: "ESM+ 리뷰 내보내기",
      headline: "지금 화면의 내보내기 컨트롤을 SellerOps가 한 번 눌러도 될까요?",
      allows: [
        "허용된 프레임 안에서 하나로 확인된 내보내기 컨트롤을 정확히 한 번 누릅니다.",
        "그 결과로 내려받아진 파일 하나를 이 컴퓨터에 저장하고 검사합니다.",
        // Unconditional: this entrypoint refuses without the upload approval flag, so a run that reaches
        // this ask is always a run that will upload. A conditional line here would imply otherwise.
        "검사를 통과한 파일을 SellerOps 백엔드로 업로드합니다 (리뷰 데이터가 DB에 적재됩니다).",
        "검사가 끝난 파일은 삭제합니다.",
      ],
      stillWillNot: "다른 컨트롤을 누르거나, 화면의 값을 읽거나, 다른 곳으로 무엇도 보내지 않습니다.",
    });
    if (!allowed) {
      console.error(actionBarrierRefusedMessage("EXPORT_TRIGGER"));
    console.log(barrierRefusedRecord("EXPORT_TRIGGER"));
      log("esm.review.capture-upload", { result: "STOPPED", stop: "no-operator-confirmation", clicked: 0 });
      process.exitCode = 7;
      return;
    }

    await settleDom(page);

    // 1) Session gate (top document) — LOGGED_IN only.
    const html = await page.content();
    const signals = extractEsmReviewProbeSignals({ url: page.url(), html });
    const sessionGate = captureSessionGate(signals.sessionVerdict);
    if (!sessionGate.proceed) {
      emitStop(sessionGate.stop!, { sessionVerdict: signals.sessionVerdict });
      return;
    }

    // 2) Frame-aware precondition — one actionable control in the allowlisted-frame scope.
    const main = page.mainFrame();
    const countExportVisibility = (
      raw: Array<{ category: "export-like" | "consent-like"; visible: boolean; enabled: boolean }>,
    ): ReturnType<typeof summarizeExportCandidateVisibility> =>
      summarizeExportCandidateVisibility(
        raw
          .filter((c) => c.category === "export-like")
          .map((c) => ({
            offsetParentPresent: c.visible,
            clientRectsPresent: c.visible,
            boundingBoxNonZero: c.visible,
            displayNotNone: true,
            visibilityNotHidden: true,
            notDisabled: c.enabled,
            notAriaDisabled: true,
          })),
      );

    const frames: Array<{
      frameUrlCategory: ReturnType<typeof esmUrlCategory>;
      readResult: "read" | "skipped-cross-origin" | "blocked";
      allowlisted: boolean;
      summary: ReturnType<typeof summarizeExportCandidateVisibility> | null;
    }> = [];
    let topActionable = summarizeExportCandidateVisibility([]);
    for (const frame of page.frames()) {
      const isMain = frame === main;
      const isAllowed = !isMain && frameHostAllowed(frame.url(), allowlist);
      if (!isMain && !isAllowed) {
        frames.push({ frameUrlCategory: esmUrlCategory(frame.url()), readResult: "skipped-cross-origin", allowlisted: false, summary: null });
        continue;
      }
      try {
        const raw = await frame.evaluate(candidateDescriptorsInFrame);
        const vis = countExportVisibility(raw.candidates);
        if (isMain) topActionable = vis;
        else frames.push({ frameUrlCategory: esmUrlCategory(frame.url()), readResult: "read", allowlisted: true, summary: vis });
      } catch {
        if (!isMain) {
          frames.push({ frameUrlCategory: esmUrlCategory(frame.url()), readResult: "blocked", allowlisted: isAllowed, summary: null });
        }
      }
    }
    const frameAware = summarizeFrameAwareExportScan({ topDocument: topActionable, frames });
    const precondition = capturePreconditionMet(frameAware);
    if (!precondition.proceed) {
      emitStop(precondition.stop!, { sessionVerdict: signals.sessionVerdict, frameAware });
      return;
    }

    // 3) Re-confirm the allowlisted frame is still readable RIGHT NOW.
    const frame = await findAllowlistedFrame(page, allowlist);
    if (!frame) {
      emitStop("frame-unavailable", { frameAware });
      return;
    }

    // 4) Tag + scan the candidates inside the allowlisted frame; decide the approved index.
    const scan = await frame.evaluate(candidateDescriptorsInFrame);
    const candidates: SanitizedFrameCandidate[] = scan.candidates.map((c) => ({
      ...c,
      actionable: c.visible && c.enabled,
    }));
    const decision = decideApprovedCapture(candidates, approvedIndex);
    if (!decision.proceed) {
      emitStop(decision.stop!, { approvedIndex, candidateCount: candidates.length, frameAware });
      return;
    }

    // 5) Bind the single stamped element for the approved index — require exactly one.
    const locator = frame.locator(`[data-sellerops-esm-cap-index="${approvedIndex}"]`);
    let bound = 0;
    try {
      bound = await locator.count();
    } catch {
      bound = 0;
    }
    if (bound !== 1) {
      emitStop("bind-not-unique", { approvedIndex, frameAware });
      return;
    }

    // 6) The single supervised click + exactly one download wait (observers set up first).
    const downloadPromise = page.waitForEvent("download", { timeout: DOWNLOAD_WAIT_MS }).catch(() => undefined);
    let clicked = false;
    try {
      await locator.click({ timeout: CLICK_TIMEOUT_MS });
      clicked = true;
    } catch {
      /* the bound control did not resolve to an actionable click; observe below */
    }
    const download = await downloadPromise;

    // 7) Classify the post-click outcome (sanitized).
    let markers = { consent: false, async: false };
    if (!download) {
      try {
        markers = await frame.evaluate(postClickMarkersInFrame);
      } catch {
        /* frame detached/closed — leave markers false */
      }
    }
    const observation: PostClickObservation = {
      downloadFired: download !== undefined,
      consentOrDialogAppeared: markers.consent,
      asyncJobAppeared: markers.async,
      timedOut: clicked && download === undefined,
    };
    const outcome = classifyPostClickOutcome(observation);

    if (outcome !== "download-fired" || !download) {
      emitStop(postClickStop(outcome as Exclude<typeof outcome, "download-fired">), {
        approvedIndex,
        clicked: clicked ? 1 : 0,
        postClickOutcome: outcome,
        frameAware,
      });
      return;
    }

    // 8) Save → structural validate → UPLOAD-BEFORE-DELETE → delete, via the extracted, offline-tested
    //    helper. The helper composes the save module (which owns fs + the delete) with the single
    //    backend upload call (GMARKET / REVIEW / SELLER_CENTER_EXPORT); the optional inspect hook reads
    //    SHAPE only on the still-present xlsx BEFORE the delete. The upload fires ONLY when the file
    //    validates as a real .xlsx. This CLI never names saveAs / uploadReviewFile.
    const headerArtifactPath = headerLabelArtifactPath(join(dirname(cfg.downloadDir), "findings"));
    const inspectFn = buildCaptureInspectFn({
      inspectSchemaShape,
      probeRowShape,
      rowSampleRows,
      salt: cfg.storageProbeSalt,
      emitCompositeKey,
      channel: "esmplus",
      storeFingerprint: cfg.esmStoreFingerprint,
      captureHeaderLabels: captureReviewHeaders,
      headerLabelArtifactPath: headerArtifactPath,
    });
    const inspection: SavedDownloadInspection<CaptureInspection> = await saveValidateUploadDeleteEsmReview(
      download,
      {
        dir: join(cfg.downloadDir, "esm-diagnostic"),
        salt: cfg.storageProbeSalt,
        baseUrl: cfg.baseUrl,
        email: cfg.email,
        password: cfg.password,
        ...(inspectFn ? { inspectFn } : {}),
      },
    );
    const fileStructure = classifyFileStructure(inspection.savedExtensionCategory, inspection.xlsxReadable);
    const schemaShape = inspection.inspection?.schemaShape ?? null;
    const rowShape = inspection.inspection?.rowShape ?? null;
    const compositeKeys = inspection.inspection?.compositeKeys ?? null;
    const headerLabels = inspection.inspection?.headerLabels ?? null;

    // The sanitized backend-ingest inspection rides inside `inspection.uploaded` (present only when the
    // file validated as a real .xlsx AND the upload fn ran). `uploaded`/`backendIngested` are HONEST:
    // the upload leg INGESTS rows into the backend DB, so this path NEVER claims dbMutated:false.
    const uploadInspection = inspection.uploaded;
    const { uploaded, backendIngested } = buildEsmReviewUploadReport(inspection);

    const stop = deriveCaptureStop({
      fileStructure,
      inspectSchemaShape,
      schemaShape,
      probeRowShape,
      rowShape,
      captureHeaderLabels: captureReviewHeaders,
      headerLabels,
      deleteFailed: inspection.deleteFailed,
    });
    const result = stop === null ? "CAPTURED_VALID" : "STOPPED";

    console.log(
      JSON.stringify(
        {
          mode: "capture-upload",
          result,
          stop,
          approvedIndex,
          clicked: 1,
          clickedCount: 1,
          sessionVerdict: signals.sessionVerdict,
          allowlistConfigured: true,
          postClickOutcome: outcome,
          fileStructure,
          savedDownload: inspection,
          deleteFailed: inspection.deleteFailed,
          // The controlled backend upload — HONEST about the real DB ingest. `uploaded`/`backendIngested`
          // are true only when the backend accepted the ingest; the nested `savedDownload.uploaded`
          // carries the sanitized ingest inspection (ingestStatusCategory / row buckets / salted job hash).
          uploadRequested: true,
          uploaded,
          backendIngested,
          // Opt-in shape inspectors — sanitized; null when their flag is absent. None confirm a mapping
          // or dedup key (schemaMappingConfirmed / dedupKeyConfirmed stay false).
          schemaShapeInspected: inspectSchemaShape,
          schemaShape,
          rowShapeProbed: probeRowShape,
          rowShape,
          compositeKeyEmitted: emitCompositeKey,
          compositeKeys,
          headerLabelsCaptureRequested: captureReviewHeaders,
          headerLabels,
          // Honest collector-local non-goal markers: the COLLECTOR does not parse rows into records,
          // infer a schema mapping, or claim a dedup key — the backend applies its own v2 dedup on ingest.
          // No collector status / LAST_SUCCESS is written and no scheduler runs.
          rowsParsed: false,
          schemaInferred: false,
          dedupKeyClaimed: false,
          statusWritten: false,
          frameAware,
        },
        null,
        2,
      ),
    );
    log("esm.review.capture-upload", {
      result,
      clicked: 1,
      postClickOutcome: outcome,
      fileStructure,
      downloadSaved: inspection.downloadSaved,
      fileRetained: inspection.fileRetained,
      deleteFailed: inspection.deleteFailed,
      uploaded,
      backendIngested,
      ingestStatusCategory: uploadInspection?.ingestStatusCategory ?? "UNKNOWN",
      schemaShapeInspected: inspectSchemaShape,
      rowShapeProbed: probeRowShape,
      compositeKeyEmitted: emitCompositeKey,
      headerLabelsCaptureRequested: captureReviewHeaders,
    });
  } finally {
    removeSentinel(sentinelPath);
    await ctx.close();
  }
}

// Run only when executed directly, NEVER on import — importing must have no side effects.
// Before R2 this called `main()` at module top level, so merely importing the file (a test, a tooling
// script, an editor's auto-import) ran the whole entrypoint, argv parse and all.
const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  void main();
}