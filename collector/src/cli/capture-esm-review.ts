/**
 * Live ESM+ REVIEW — Gate 3 SUPERVISED APPROVED-INDEX SINGLE CAPTURE.
 *
 *   set -a && . ./.env && set +a   # ESM_REVIEW_URL + ESM_FRAME_ORIGIN_ALLOWLIST + channel
 *   npm run capture-esm-review -- --i-understand-this-opens-live-esm --approved-index 0
 *
 * Adapts the NAVER supervised approved-index precedent to the cross-origin **allowlisted
 * vendor frame** that Gate 2 (run #4) located. The human logs in and reaches the review
 * surface; the tool gates on the Gate-2 frame-aware result (exactly one actionable export
 * control in the `allowlisted-frame` scope), scans that frame for indexed candidates,
 * validates the operator's `--approved-index`, binds the single stamped element
 * (`count() === 1`), clicks it **exactly once**, observes **exactly one** download, then
 * saves → structurally validates → **deletes** it (observe-and-discard). It emits a
 * sanitized capture summary only.
 *
 * HARD INVARIANTS (source-guarded by a test):
 *   - Exactly ONE `.click(` and ONE `waitForEvent("download")`. No auto-repeat, no fallback,
 *     no broad/loop selector clicking. The approved index is REQUIRED.
 *   - NO upload, NO DB write, NO status / `LAST_SUCCESS` write, NO scheduler / manualSync.
 *   - `saveAs`/fs is confined to `review-download-save.ts`; this CLI never names it.
 *   - No credential typing; no CAPTCHA/2FA bypass — the human authenticates.
 *   - Cross-origin frames are entered ONLY when on the operator-configured allowlist, and
 *     the target frame is re-confirmed allowlisted + readable immediately before acting.
 *   - Sanitized output only — booleans / categories / buckets / an index. Never a raw URL /
 *     frame URL / origin / host, selector, DOM text, filename, or identifier.
 *
 * NON-GOALS: no row parsing, no column-schema inference, no dedup-key claim, no `CONFIRMED`
 * capability, no scheduled collection. Those are Gate 4 / a later product decision.
 *
 * LIVE-ONLY — refuses to act without the explicit per-run ESM approval flag.
 */
import { existsSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { Frame, Page } from "playwright";
import { loadConfig } from "../config";
import { resolveCaptureConnectionProfile } from "./esm-capture-connection";
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
} from "../esm/esm-capture-gate";
import { summarizeExportCandidateVisibility } from "../esm/esm-export-visibility";
import { frameHostAllowed, summarizeFrameAwareExportScan } from "../esm/esm-frame-scan";
import { esmApprovalRequiredMessage, hasEsmLiveApproval } from "../esm/esm-live-approval";
import {
  buildCaptureInspectFn,
  deriveCaptureStop,
  parseRowSampleRowsArg,
  type CaptureInspection,
} from "../esm/esm-capture-inspect";
import { headerLabelArtifactPath } from "../esm/esm-review-header-quarantine";
import { esmUrlCategory, extractEsmReviewProbeSignals } from "../esm/esm-review-probe";
import { esmSentinelPathFor } from "../esm/esm-sentinel";
import { log } from "../log";
import { saveAndInspectDownload, type SavedDownloadInspection } from "../naver/review-download-save";
import { launchPersistentBrowser } from "../profile";

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
  "The collector verifies the Gate-2 preconditions and, ONLY for the single approved",
  "actionable export control inside the allowlisted vendor frame, clicks it ONCE,",
  "observes one download, structurally validates it, and DELETES it. No upload, no DB,",
  "no status write. Anything ambiguous HALTS without clicking. (Ctrl-C to abort.)",
].join("\n");

function banner(): void {
  const line = "─".repeat(64);
  console.error(line);
  console.error(" LIVE ESM+ Gate 3 supervised single capture — explicit per-run approval required.");
  console.error(" A human logs in; the collector clicks at most ONE approved export control,");
  console.error(" observes one download, validates it structurally, then DELETES it. No upload.");
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

/** Read a `--flag <value>` option; undefined when absent or immediately followed by another flag. */
function valueArg(args: readonly string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  if (i < 0) return undefined;
  const v = args[i + 1];
  return v !== undefined && !v.startsWith("--") ? v : undefined;
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
  const summary = { mode: "capture", result: "STOPPED", stop, clicked: 0, ...extra };
  console.log(JSON.stringify(summary, null, 2));
  log("esm.review.capture", { result: "STOPPED", stop, clicked: 0 });
}

async function main(): Promise<void> {
  banner();
  const args = process.argv.slice(2);
  if (!hasEsmLiveApproval(args)) {
    console.error(esmApprovalRequiredMessage());
    process.exit(3);
    return;
  }
  const approvedIndex = parseApprovedIndexArg(args);
  if (approvedIndex === null) {
    console.error("Gate 3 requires an explicit approved index: --approved-index <N>.");
    process.exit(4);
    return;
  }
  // Gate 4 opt-in: when set, the validated xlsx is structurally inspected (schema-SHAPE only)
  // before the delete-after-validate. Absent → unchanged Gate 3 observe-and-discard.
  const inspectSchemaShape = args.includes("--inspect-schema-shape");
  // Gate 5 opt-in (dormant by default): when set, the validated xlsx's first N data rows are
  // reduced to SANITIZED row-shape (presence / value-class / distinctness / salted hashes — never
  // raw values) before the delete. `--row-sample-rows=N` (default 3, clamped 1–5) caps N. Absent →
  // no row-shape probe; combined with --inspect-schema-shape, both inspections run on the one file.
  const probeRowShape = args.includes("--probe-row-shape");
  const rowSampleRows = parseRowSampleRowsArg(args);
  // Gate 5 / Slice 5A opt-in (dormant by default): when set, the same sampled rows are reduced to
  // per-row SANITIZED composite dedup keys (L1/L2/L3 + context, salted hashes — never raw values)
  // so two overlapping exports can be compared offline (`compare-esm-overlap`). Absent → no keys.
  const emitCompositeKey = args.includes("--emit-composite-key");
  // Slice 2b opt-in (dormant by default): when set, the validated xlsx's HEADER ROW labels are
  // written to a gitignored LOCAL artifact for operator review (the adopted header-label-only
  // Policy-A carve-out), and a SANITIZED summary (category / NFC-NFD form / count bucket / booleans —
  // never a literal label) is returned. Reads the header row only (no data cells). Absent → no capture.
  const captureReviewHeaders = args.includes("--capture-review-headers");

  const cfg = loadConfig();
  if (!cfg.esmReviewUrl) {
    console.error("Set ESM_REVIEW_URL to the ESM+ review-management/export page URL first.");
    process.exit(2);
    return;
  }
  const allowlist = cfg.esmFrameOriginAllowlist;
  if (allowlist.length === 0) {
    console.error("Gate 3 targets the allowlisted vendor frame; set ESM_FRAME_ORIGIN_ALLOWLIST first.");
    process.exit(2);
    return;
  }

  // Connection-explicit profile: a live capture MUST name an ESM connection id and resolve its dedicated
  // profile through the SAME resolver the local-agent reconnect path uses (so a G0-verified session is
  // reused, never copied). No implicit `.profile/esm` fallback — every failure fails closed.
  const connectionId = valueArg(args, "--connection-id");
  if (connectionId === undefined) {
    console.error("Live capture requires an explicit ESM connection: --connection-id <id>.");
    process.exit(5);
    return;
  }
  const connectionsPath = valueArg(args, "--connections");
  if (connectionsPath === undefined) {
    console.error("Live capture requires the local connections descriptor: --connections <path.json>.");
    process.exit(5);
    return;
  }
  let connectionsRaw: string;
  try {
    connectionsRaw = readFileSync(resolve(process.cwd(), connectionsPath), "utf8");
  } catch {
    console.error("Could not read the connections descriptor (fail closed).");
    process.exit(5);
    return;
  }
  const resolution = resolveCaptureConnectionProfile({ connectionsRaw, connectionId, profileBaseDir: cfg.profileBaseDir });
  if (!resolution.ok) {
    console.error(`Connection did not resolve to a runnable ESM browser profile (fail closed): ${resolution.reason}.`);
    process.exit(6);
    return;
  }

  const sentinelPath = esmSentinelPathFor(cfg.statusFile);
  mkdirSync(dirname(sentinelPath), { recursive: true });
  removeSentinel(sentinelPath);

  const ctx = await launchPersistentBrowser(resolution.profileDir, cfg.browserChannel);
  const page = (ctx.pages()[0] ?? (await ctx.newPage())) as Page;
  try {
    await page.goto(cfg.esmReviewUrl, { waitUntil: "domcontentloaded" });
    console.error(CONFIRM_PROMPT);
    console.error("");
    console.error(`  Sentinel file (create this when ready):`);
    console.error(`    ${sentinelPath}`);
    console.error("");
    const ready = await waitForSentinel(sentinelPath, CONFIRM_TIMEOUT_MS, SENTINEL_POLL_INTERVAL_MS);
    if (!ready) {
      console.error("No sentinel within the timeout; aborting without reading the page.");
      log("esm.review.capture", { result: "STOPPED", stop: "sentinel-timeout", clicked: 0 });
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

    // 2) Gate-2 frame-aware precondition — one actionable control in the allowlisted-frame scope.
    //    Re-derive the same sanitized frame-aware scan the classifier produces: count the
    //    export-like candidates' visible/enabled in the top document and each allowlisted frame.
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

    // 8) Observe-and-discard: save → structural validate → (Gate 4/5 opt-in: schema-shape +/or
    //    row-shape inspect) → delete (the save module owns fs; the inspect hook runs on the
    //    still-present xlsx BEFORE the delete, and ONLY when the structural sniff passed). Both
    //    inspectors read SHAPE only, never raw cells; the hook is undefined when no flag is set.
    // Slice 2b: the header-label artifact lives in the collector's gitignored `findings/` dir
    // (a sibling of the download dir). The literal labels are written there by the quarantine
    // module; this CLI only names the path and never holds a label.
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
    const inspection: SavedDownloadInspection<CaptureInspection> = await saveAndInspectDownload<CaptureInspection>(
      download,
      {
        dir: join(cfg.downloadDir, "esm-diagnostic"),
        salt: cfg.storageProbeSalt,
        ...(inspectFn ? { inspectFn } : {}),
      },
    );
    const fileStructure = classifyFileStructure(inspection.savedExtensionCategory, inspection.xlsxReadable);
    const schemaShape = inspection.inspection?.schemaShape ?? null;
    const rowShape = inspection.inspection?.rowShape ?? null;
    const compositeKeys = inspection.inspection?.compositeKeys ?? null;
    const headerLabels = inspection.inspection?.headerLabels ?? null;

    // Stop precedence: bad file → (Gate 4) schema inspect failed-closed → (Gate 5) row-shape
    // inspect failed-closed → cleanup could not delete. Encoded in the pure helper.
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
          mode: "capture",
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
          // Gate 4 (opt-in) schema-SHAPE result — sanitized; null when the flag is absent. It never
          // confirms a mapping or dedup key (schemaMappingConfirmed/dedupKeyConfirmed stay false).
          schemaShapeInspected: inspectSchemaShape,
          schemaShape,
          // Gate 5 (opt-in) minimal ROW-SHAPE result — sanitized; null when --probe-row-shape is
          // absent. Carries its own honest markers (rawCellLeak:false, minimalRowsInspected,
          // schemaMappingConfirmed/dedupKeyConfirmed:false). No raw cell/header value is emitted.
          rowShapeProbed: probeRowShape,
          rowShape,
          // Gate 5 / Slice 5A (opt-in, dormant) composite dedup KEYS — sanitized per-row L1/L2/L3 +
          // context (salted hashes only); null when --emit-composite-key is absent. Feeds the offline
          // two-export overlap comparator. Confirms nothing (dedupKeyConfirmed stays false).
          compositeKeyEmitted: emitCompositeKey,
          compositeKeys,
          // Slice 2b (opt-in) header-LABEL capture result — sanitized (category / NFC-NFD form /
          // count bucket / booleans); null when --capture-review-headers is absent. The literal
          // labels went ONLY to the gitignored local artifact; this summary never carries one.
          // schemaMappingConfirmed/dedupKeyConfirmed stay false.
          headerLabelsCaptureRequested: captureReviewHeaders,
          headerLabels,
          // Honest non-goal markers — this CLI never uploads, parses rows into records, infers a
          // schema mapping, or claims a dedup key. (`rowShape.minimalRowsInspected` separately
          // reports that cells were shape-read; that is not record parsing.)
          uploaded: false,
          rowsParsed: false,
          schemaInferred: false,
          dedupKeyClaimed: false,
          frameAware,
        },
        null,
        2,
      ),
    );
    log("esm.review.capture", {
      result,
      clicked: 1,
      postClickOutcome: outcome,
      fileStructure,
      downloadSaved: inspection.downloadSaved,
      fileRetained: inspection.fileRetained,
      deleteFailed: inspection.deleteFailed,
      schemaShapeInspected: inspectSchemaShape,
      schemaWorkbookReadable: schemaShape?.workbookReadable ?? false,
      rowShapeProbed: probeRowShape,
      rowShapeWorkbookReadable: rowShape?.workbookReadable ?? false,
      compositeKeyEmitted: emitCompositeKey,
      compositeKeyWorkbookReadable: compositeKeys?.workbookReadable ?? false,
      headerLabelsCaptureRequested: captureReviewHeaders,
      headerLabelsCaptured: headerLabels?.labelsCapturedToLocalArtifact ?? false,
    });
  } finally {
    removeSentinel(sentinelPath);
    await ctx.close();
  }
}

void main();
