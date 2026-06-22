import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = join(__dirname, "..", "..", "src", "cli", "capture-export-same-session.ts");

/** Remove block + line comments so the guards check executable source, not prose. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ") // /* block */ and /** jsdoc */
    .replace(/(^|[^:])\/\/.*$/gm, "$1"); // // line  (the [^:] guard spares "://" in URLs)
}

/**
 * Slice the (comment-stripped) source into its top-level `async function` bodies,
 * keyed by name. Each chunk runs from one `async function NAME(` up to the next.
 */
function functionBodies(src: string): Record<string, string> {
  const parts = src.split(/\nasync function /);
  const bodies: Record<string, string> = {};
  for (let i = 1; i < parts.length; i += 1) {
    const name = parts[i]?.match(/^([A-Za-z0-9_]+)/)?.[1];
    if (name) bodies[name] = parts[i] as string;
  }
  return bodies;
}

const code = stripComments(readFileSync(CLI_PATH, "utf8"));
const bodies = functionBodies(code);
const captureFn = bodies.captureAndUpload ?? "";
const mainFn = bodies.main ?? "";

/**
 * Honest source guard for PR B: every `writeStatus(` in the supervised-fast branch must sit INSIDE
 * the `--diagnose-write-status-after-upload` gate (never hidden behind a wrapper). With no gate
 * present, the branch must contain NO `writeStatus(` at all. So a status write is reachable only via
 * the explicit flag — confirming the confirm/candidate/index/save/upload-only modes write none.
 */
function writeStatusOnlyGated(branch: string): boolean {
  const calls = [...branch.matchAll(/writeStatus\s*\(/g)];
  const gate = branch.indexOf("if (diagnoseWriteStatus)");
  if (gate < 0) return calls.length === 0;
  return calls.length === 1 && (calls[0]?.index ?? -1) > gate;
}

describe("capture-export-same-session — capture is confined behind the gate", () => {
  it("exposes the split functions (gate in main, click/upload in captureAndUpload)", () => {
    expect(bodies.captureAndUpload, "captureAndUpload must exist").toBeTruthy();
    expect(bodies.main, "main must exist").toBeTruthy();
  });

  it("the single click/capture lives ONLY in captureAndUpload via strict runExport", () => {
    expect(/runExport\s*\(/.test(captureFn)).toBe(true);
    expect(/strictSingleCandidate\s*:\s*true/.test(captureFn)).toBe(true);
    // runExport must appear in NO other function body — never in main.
    for (const [name, body] of Object.entries(bodies)) {
      if (name === "captureAndUpload") continue;
      expect(body.includes("runExport"), `runExport must not appear in ${name}`).toBe(false);
    }
  });

  it("main consults decideCaptureGate and only proceeds to capture when it permits", () => {
    expect(/decideCaptureGate\s*\(/.test(mainFn)).toBe(true);
    expect(/gate\.proceed/.test(mainFn)).toBe(true);
    // The capture call sits after the gate check, and the gate's halt writes status + returns.
    expect(/if\s*\(\s*!gate\.proceed\s*\)/.test(mainFn)).toBe(true);
    const haltIdx = mainFn.indexOf("!gate.proceed");
    const captureIdx = mainFn.indexOf("captureAndUpload(");
    expect(haltIdx).toBeGreaterThanOrEqual(0);
    expect(captureIdx).toBeGreaterThan(haltIdx); // capture is dispatched only past the gate
  });

  it("upload is reached only AFTER a real CAPTURED file", () => {
    expect(/uploadReviewFile\s*\(/.test(captureFn)).toBe(true);
    // An early return guards the upload leg on a non-CAPTURED outcome.
    expect(/outcome\s*!==\s*"CAPTURED"\s*\|\|\s*!filePath/.test(captureFn)).toBe(true);
    const guardIdx = captureFn.indexOf('outcome !== "CAPTURED"');
    const uploadIdx = captureFn.indexOf("uploadReviewFile(");
    expect(guardIdx).toBeGreaterThanOrEqual(0);
    expect(uploadIdx).toBeGreaterThan(guardIdx);
    // uploadReviewFile/login confined to the capture function (never in main).
    expect(mainFn.includes("uploadReviewFile")).toBe(false);
  });

  it("the status detail reports row counts, never the captured filename", () => {
    expect(/successRows/.test(captureFn)).toBe(true);
    expect(code.includes("suggestedFilename")).toBe(false); // filename never echoed by the CLI
  });
});

describe("capture-export-same-session — the CLI itself performs no DOM action", () => {
  // The only click/download lives inside runExport; the CLI orchestrates, it never
  // drives the page directly. (page.goto/content are read-navigation, not actions.)
  it("never calls click/fill/press/dispatch/waitForEvent directly", () => {
    expect(/\.(click|fill|press|selectOption|check|dispatchEvent)\s*\(/.test(code)).toBe(false);
    expect(/waitForEvent\s*\(/.test(code)).toBe(false);
    expect(/saveAs/.test(code)).toBe(false); // saveAs is runExport's, never the CLI's
  });
});

describe("capture-export-same-session — gated + sentinel-file continuation", () => {
  it("refuses to act without the explicit per-run approval flag", () => {
    expect(/hasLiveRunApproval\s*\(/.test(code)).toBe(true);
    expect(/approvalRequiredMessage\s*\(/.test(code)).toBe(true);
  });

  it("does not depend on terminal stdin / an Enter keypress", () => {
    expect(code.includes("process.stdin")).toBe(false);
    expect(/waitForEnter/.test(code)).toBe(false);
  });

  it("derives the sentinel path from the shared helper (single source of truth)", () => {
    expect(/from\s+["']\.\/probe-sentinel["']/.test(code)).toBe(true);
    expect(/sentinelPathFor\s*\(/.test(code)).toBe(true);
  });

  it("polls for the sentinel file rather than blocking on input", () => {
    expect(/existsSync/.test(code)).toBe(true);
    expect(/waitForSentinel\s*\(/.test(code)).toBe(true);
  });

  it("clears any stale sentinel before waiting and cleans up afterwards", () => {
    expect(/removeSentinel\s*\(/.test(code)).toBe(true);
    expect(/unlinkSync/.test(code)).toBe(true);
  });

  it("aborts WITHOUT reading or clicking the page when the sentinel never appears", () => {
    expect(/sentinel-timeout/.test(code)).toBe(true);
    // The abort path returns before the verdict/plan/capture — runExport is only in captureAndUpload.
    const abortIdx = mainFn.indexOf("sentinel-timeout");
    const captureIdx = mainFn.indexOf("captureAndUpload(");
    expect(abortIdx).toBeGreaterThanOrEqual(0);
    expect(abortIdx).toBeLessThan(captureIdx); // the timeout return precedes any capture dispatch
  });

  it("waits for the sentinel BEFORE reading the verdict/plan and dispatching capture", () => {
    const sentinelIdx = mainFn.indexOf("waitForSentinel(");
    const verdictIdx = mainFn.indexOf("checkLiveSessionVerdict(");
    const captureIdx = mainFn.indexOf("captureAndUpload(");
    expect(sentinelIdx).toBeGreaterThanOrEqual(0);
    expect(verdictIdx).toBeGreaterThan(sentinelIdx); // no read before the human signals readiness
    expect(captureIdx).toBeGreaterThan(verdictIdx);
  });
});

describe("capture-export-same-session — reconnect pre-step is delegated, not driven here", () => {
  it("runs resolveReconnectIfNeeded AFTER the verdict read and BEFORE the export gate", () => {
    const verdictIdx = mainFn.indexOf("checkLiveSessionVerdict(");
    const resolveIdx = mainFn.indexOf("resolveReconnectIfNeeded(");
    const gateIdx = mainFn.indexOf("decideCaptureGate(");
    expect(resolveIdx).toBeGreaterThan(verdictIdx); // pre-step keys off the pre-click verdict
    expect(gateIdx).toBeGreaterThan(resolveIdx); // the export gate still runs after resolution
  });

  it("imports the resolver helper and never calls the continue boundary directly", () => {
    expect(/from\s+["']\.\.\/naver\/reconnect-resolve["']/.test(code)).toBe(true);
    // The single guarded continue click lives inside the boundary, reached only via the helper.
    expect(code.includes("continueAtCardOnce")).toBe(false);
  });

  it("a pre-step HALT records the honest state (real run) and never reaches capture", () => {
    expect(/resolution\.decision\s*===\s*"HALT"/.test(mainFn)).toBe(true);
    const haltIdx = mainFn.indexOf('resolution.decision === "HALT"');
    const captureIdx = mainFn.indexOf("captureAndUpload(");
    expect(haltIdx).toBeGreaterThanOrEqual(0);
    expect(haltIdx).toBeLessThan(captureIdx); // the halt returns before any capture dispatch
  });
});

describe("capture-export-same-session — auto-read by default, sentinel opt-in", () => {
  it("defaults to auto-read: polls for the start verdict, no ready-file hand-off", () => {
    expect(/const\s+sentinelMode\s*=/.test(code)).toBe(true);
    expect(/waitForCaptureStartState\s*\(/.test(mainFn)).toBe(true);
    expect(code.includes("auto-read mode: complete manual login if prompted")).toBe(true);
  });

  it("enables sentinel mode ONLY via --require-sentinel or --sentinel", () => {
    expect(/--require-sentinel/.test(code)).toBe(true);
    expect(
      /sentinelMode\s*=\s*\(?\s*args\.includes\("--require-sentinel"\)\s*\|\|\s*args\.includes\("--sentinel"\)/.test(
        code,
      ),
    ).toBe(true);
  });

  it("accepts --no-sentinel / --auto-read-after-hydration as auto-read aliases (override sentinel)", () => {
    expect(/--no-sentinel/.test(code)).toBe(true);
    expect(/--auto-read-after-hydration/.test(code)).toBe(true);
    expect(/!args\.includes\("--no-sentinel"\)/.test(code)).toBe(true);
  });

  it("reaches resolveReconnectIfNeeded only AFTER a resolvable start verdict (auto-read or sentinel)", () => {
    const autoIdx = mainFn.indexOf("waitForCaptureStartState(");
    const sentinelIdx = mainFn.indexOf("waitForSentinel(");
    const resolveIdx = mainFn.indexOf("resolveReconnectIfNeeded(");
    expect(autoIdx).toBeGreaterThanOrEqual(0);
    expect(sentinelIdx).toBeGreaterThanOrEqual(0);
    expect(resolveIdx).toBeGreaterThan(autoIdx); // after the auto-read poll
    expect(resolveIdx).toBeGreaterThan(sentinelIdx); // and after the sentinel wait
  });

  it("an auto-read timeout halts without click/capture/status write", () => {
    expect(/auto-read-timeout/.test(mainFn)).toBe(true);
    const timeoutIdx = mainFn.indexOf("auto-read-timeout");
    const captureIdx = mainFn.indexOf("captureAndUpload(");
    expect(timeoutIdx).toBeLessThan(captureIdx); // the timeout returns before any capture
    // The timeout branch is log + return only — no status record is written.
    const seg = mainFn.slice(timeoutIdx, mainFn.indexOf("return", timeoutIdx) + "return".length);
    expect(/writeStatus/.test(seg)).toBe(false);
  });
});

describe("capture-export-same-session — classify-only dry-run stops before capture", () => {
  it("consults isClassifyOnly and reports via the sanitized builder", () => {
    expect(/isClassifyOnly\s*\(/.test(mainFn)).toBe(true);
    expect(/classifyOnlyReport\s*\(/.test(mainFn)).toBe(true);
  });

  it("the dry-run report path precedes captureAndUpload (it returns before capture)", () => {
    const reportIdx = mainFn.indexOf("classifyOnlyReport(");
    const captureIdx = mainFn.indexOf("captureAndUpload(");
    expect(reportIdx).toBeGreaterThanOrEqual(0);
    expect(reportIdx).toBeLessThan(captureIdx);
  });

  it("the classify-only branch writes no status and triggers no upload (report-only)", () => {
    // captureAndUpload (the only capture/upload/status-writing leg) is dispatched once, past
    // the gate — the classify-only branch returns before reaching it.
    expect((mainFn.match(/captureAndUpload\(/g) ?? []).length).toBe(1);
    // The dry-run emits a sanitized report on stdout, not a status record.
    expect(/console\.log\(\s*classifyOnlyReport/.test(mainFn)).toBe(true);
  });

  it("the report carries only sanitized fields (enums/booleans), never raw page content", () => {
    const start = code.indexOf("function classifyOnlyReport");
    const after = code.indexOf("\nfunction ", start + 1);
    const reportBody = code.slice(start, after === -1 ? undefined : after);
    expect(/wouldCapture/.test(reportBody)).toBe(true);
    expect(/\.content\s*\(/.test(reportBody)).toBe(false);
    expect(/successRows|filePath|suggestedFilename/.test(reportBody)).toBe(false);
  });
});

describe("capture-export-same-session — diagnose-export-click clicks once but never collects", () => {
  it("parses --diagnose-export-click and yields to classify-only (no click) if both are set", () => {
    expect(/--diagnose-export-click/.test(code)).toBe(true);
    // classify-only (no click) wins: diagnoseClick is gated on !classifyOnly.
    expect(/const\s+diagnoseClick\s*=\s*!classifyOnly\s*&&\s*args\.includes\("--diagnose-export-click"\)/.test(mainFn)).toBe(
      true,
    );
  });

  it("delegates the single observed click to the diagnostic boundary (not the capture leg)", () => {
    expect(/diagnoseExportClickOnce\s*\(/.test(mainFn)).toBe(true);
    // The diagnose dispatch sits after the gate and before the real-capture write.
    const diagIdx = mainFn.indexOf("diagnoseExportClickOnce(");
    const gateIdx = mainFn.indexOf("decideCaptureGate(");
    const captureIdx = mainFn.indexOf("captureAndUpload(");
    expect(diagIdx).toBeGreaterThan(gateIdx);
    expect(diagIdx).toBeLessThan(captureIdx);
  });

  it("clicks only past the SAME gate — its halt branch reports, never captures", () => {
    const diagIdx = mainFn.indexOf("if (diagnoseClick)");
    expect(diagIdx).toBeGreaterThanOrEqual(0);
    const captureIdx = mainFn.indexOf("captureAndUpload(");
    // The whole diagnose branch precedes the capture dispatch and returns within itself.
    const branch = mainFn.slice(diagIdx, captureIdx);
    expect(/gate\.proceed/.test(branch)).toBe(true);
    expect(/diagnoseExportClickOnce\(/.test(branch)).toBe(true);
  });

  it("the diagnose branch writes NO status and triggers NO upload/capture", () => {
    // Bound the slice to the MAIN diagnose branch ONLY: from the `if (diagnoseClick)` that
    // precedes the dispatch (not the earlier HALT-branch `else if (diagnoseClick)`) up to the
    // real-capture path's own `!gate.proceed`, so the real path's writeStatus is not caught.
    const dispatchIdx = mainFn.indexOf("diagnoseExportClickOnce(");
    const diagIdx = mainFn.lastIndexOf("if (diagnoseClick)", dispatchIdx);
    const realGate = mainFn.indexOf("!gate.proceed", dispatchIdx); // the real-capture path halt
    const branch = mainFn.slice(diagIdx, realGate);
    expect(diagIdx).toBeGreaterThanOrEqual(0);
    expect(realGate).toBeGreaterThan(dispatchIdx);
    // PR B: the diagnose branch's ONLY writeStatus is gated behind --diagnose-write-status-after-upload
    // (never the plain diagnose path); upload/capture are still never named here.
    expect(writeStatusOnlyGated(branch)).toBe(true);
    expect(/uploadReviewFile/.test(branch)).toBe(false);
    expect(/captureAndUpload\(/.test(branch)).toBe(false);
    // Output is a sanitized stdout report (mode tag), not a status record.
    expect(/diagnose-export-click/.test(branch)).toBe(true);
  });
});

describe("capture-export-same-session — supervised-fast override skips the false-empty stable wait", () => {
  it("gates the override branch on the light readiness settle, not the full stabilization window", () => {
    // The fast branch runs ONLY under --diagnose-allow-empty-target and is anchored BEFORE the
    // stable stabilization. It settles via the read-only helper, never the full readiness poll.
    const fastDispatchIdx = mainFn.indexOf("diagnoseExportClickOnce(");
    const fastBranchStart = mainFn.lastIndexOf("if (allowEmptyTarget)", fastDispatchIdx);
    const fastBranch = mainFn.slice(fastBranchStart, fastDispatchIdx);
    expect(fastBranchStart).toBeGreaterThanOrEqual(0);
    expect(/waitForSupervisedExportReady\(/.test(fastBranch)).toBe(true);
    // It does NOT consume the stable readiness poll in this branch.
    expect(/waitForExportTargetReadinessStable\(/.test(fastBranch)).toBe(false);
    // The fast dispatch precedes the stable stabilization in source order.
    expect(fastDispatchIdx).toBeLessThan(mainFn.indexOf("waitForExportTargetReadinessStable("));
  });

  it("tags the fast report readinessMode and writes NO status / capture / upload", () => {
    const fastBranchStart = mainFn.indexOf("if (allowEmptyTarget)");
    const stableStart = mainFn.indexOf("waitForExportTargetReadinessStable(");
    const fastBranch = mainFn.slice(fastBranchStart, stableStart);
    expect(/readinessMode:\s*["']supervised-fast["']/.test(fastBranch)).toBe(true);
    expect(writeStatusOnlyGated(fastBranch)).toBe(true); // status write reachable only via the gate
    expect(/uploadReviewFile/.test(fastBranch)).toBe(false);
    expect(/captureAndUpload\(/.test(fastBranch)).toBe(false);
    // It reuses the SAME single diagnostic click boundary — no new click mechanism is added.
    expect(/diagnoseExportClickOnce\(/.test(fastBranch)).toBe(true);
  });

  it("the supervised settle helper is read-only (no click/export/download/status)", () => {
    const helperStart = code.indexOf("async function waitForSupervisedExportReady");
    const helperEnd = code.indexOf("function emptyPreClick");
    const helper = code.slice(helperStart, helperEnd);
    expect(helperStart).toBeGreaterThanOrEqual(0);
    expect(helperEnd).toBeGreaterThan(helperStart);
    expect(/\.click\(/.test(helper)).toBe(false);
    expect(/waitForEvent\(/.test(helper)).toBe(false);
    expect(/saveAs|uploadReviewFile|writeStatus|runExport/.test(helper)).toBe(false);
    // Reads only: SPA settle + page.content() folded through the pure pre-click signals.
    expect(/page\.content\(\)/.test(helper)).toBe(true);
    expect(/decideSupervisedExportReady\(/.test(helper)).toBe(true);
  });

  it("HALTS without clicking when the supervised readiness is NOT satisfied", () => {
    // The not-ready guard sits between the settle and the fast dispatch; it emits a sanitized
    // halt (clicked:false / clickedCount:0 / wouldClick:false) and returns BEFORE any click.
    const guardIdx = mainFn.indexOf("if (!supervised.ready)");
    const haltReturnIdx = mainFn.indexOf("return;", guardIdx);
    const haltBlock = mainFn.slice(guardIdx, haltReturnIdx);
    expect(guardIdx).toBeGreaterThanOrEqual(0);
    expect(haltReturnIdx).toBeGreaterThan(guardIdx);
    // the not-ready halt precedes the fast dispatch and performs NO diagnostic click
    expect(guardIdx).toBeLessThan(mainFn.indexOf("diagnoseExportClickOnce("));
    expect(/diagnoseExportClickOnce\(/.test(haltBlock)).toBe(false);
    // sanitized halt fields
    expect(/readinessMode:\s*["']supervised-fast["']/.test(haltBlock)).toBe(true);
    expect(/supervisedReady:\s*false/.test(haltBlock)).toBe(true);
    expect(/clicked:\s*false/.test(haltBlock)).toBe(true);
    expect(/clickedCount:\s*0/.test(haltBlock)).toBe(true);
    expect(/wouldClick:\s*false/.test(haltBlock)).toBe(true);
    // diagnostic mode never persists status / capture / upload, even on the not-ready halt
    expect(/writeStatus/.test(haltBlock)).toBe(false);
    expect(/uploadReviewFile/.test(haltBlock)).toBe(false);
    expect(/captureAndUpload\(/.test(haltBlock)).toBe(false);
  });

  it("clicks the existing diagnostic boundary EXACTLY ONCE, only when readiness is satisfied", () => {
    const fastBranchStart = mainFn.indexOf("if (allowEmptyTarget)");
    const stableStart = mainFn.indexOf("waitForExportTargetReadinessStable(");
    const fastBranch = mainFn.slice(fastBranchStart, stableStart);
    const guardIdx = fastBranch.indexOf("if (!supervised.ready)");
    const dispatchIdx = fastBranch.indexOf("diagnoseExportClickOnce(");
    expect(guardIdx).toBeGreaterThanOrEqual(0);
    // the single diagnostic click is GATED behind the ready guard (appears after it)…
    expect(dispatchIdx).toBeGreaterThan(guardIdx);
    // …and is dispatched exactly once in the fast branch (no fallback / retry).
    expect((fastBranch.match(/diagnoseExportClickOnce\(/g) ?? []).length).toBe(1);
  });
});

describe("capture-export-same-session — supervised review-usage 확인 confirm (PR B), flag-gated", () => {
  const fastBranchStart = mainFn.indexOf("if (allowEmptyTarget)");
  const stableStart = mainFn.indexOf("waitForExportTargetReadinessStable(");
  const fastBranch = mainFn.slice(fastBranchStart, stableStart);

  it("imports the confirm adapter and the pure ATTEMPT decision", () => {
    expect(/from\s+["']\.\.\/naver\/review-usage-confirm["']/.test(code)).toBe(true);
    expect(/confirmReviewUsageOnce/.test(code)).toBe(true);
    expect(/decideReviewUsageConfirm/.test(code)).toBe(true);
  });

  it("parses --diagnose-confirm-review-usage and gates it on diagnoseClick", () => {
    expect(/--diagnose-confirm-review-usage/.test(code)).toBe(true);
    expect(
      /const\s+diagnoseConfirm\s*=\s*diagnoseClick\s*&&\s*args\.includes\("--diagnose-confirm-review-usage"\)/.test(
        mainFn,
      ),
    ).toBe(true);
  });

  it("runs the confirm step ONLY in the supervised-fast branch, ONLY on an ATTEMPT decision", () => {
    expect(/decideReviewUsageConfirm\(/.test(fastBranch)).toBe(true);
    expect(/confirmReviewUsageOnce\(/.test(fastBranch)).toBe(true);
    // gated: the adapter is invoked under `confirmDecision === "ATTEMPT"`.
    expect(/confirmDecision\s*===\s*["']ATTEMPT["']/.test(fastBranch)).toBe(true);
    // the decision is fed the diagnostic outcome + the flag (never auto-confirmed).
    expect(/outcome:\s*diagnosis\.outcome/.test(fastBranch)).toBe(true);
    expect(/confirmFlag:\s*diagnoseConfirm/.test(fastBranch)).toBe(true);
  });

  it("invokes the confirm adapter exactly once in main, and NEVER in the stable / real-capture path", () => {
    expect((mainFn.match(/confirmReviewUsageOnce\(/g) ?? []).length).toBe(1);
    const stableAndAfter = mainFn.slice(stableStart);
    expect(/confirmReviewUsageOnce\(/.test(stableAndAfter)).toBe(false);
  });

  it("the confirm path writes NO status, performs NO upload / capture / saveAs", () => {
    expect(writeStatusOnlyGated(fastBranch)).toBe(true); // status write reachable only via the gate
    expect(/uploadReviewFile/.test(fastBranch)).toBe(false);
    expect(/captureAndUpload\(/.test(fastBranch)).toBe(false);
    expect(/saveAs/.test(fastBranch)).toBe(false);
  });
});

describe("capture-export-same-session — NO-CLICK review-usage candidate-index diagnostic, flag-gated", () => {
  const fastBranchStart = mainFn.indexOf("if (allowEmptyTarget)");
  const stableStart = mainFn.indexOf("waitForExportTargetReadinessStable(");
  const fastBranch = mainFn.slice(fastBranchStart, stableStart);

  it("imports the candidate scanner", () => {
    expect(/scanReviewUsageConfirmCandidates/.test(code)).toBe(true);
  });

  it("parses --diagnose-review-usage-confirm-candidates and gates it on diagnoseClick", () => {
    expect(/--diagnose-review-usage-confirm-candidates/.test(code)).toBe(true);
    expect(
      /const\s+diagnoseConfirmCandidates\s*=\s*diagnoseClick\s*&&\s*args\.includes\("--diagnose-review-usage-confirm-candidates"\)/.test(
        mainFn,
      ),
    ).toBe(true);
  });

  it("runs the candidate scan ONLY in the supervised-fast branch, ONLY on the consent outcome", () => {
    expect(/scanReviewUsageConfirmCandidates\(/.test(fastBranch)).toBe(true);
    expect(
      /diagnoseConfirmCandidates\s*&&\s*diagnosis\.outcome\s*===\s*["']REVIEW_USAGE_CONFIRMATION["']/.test(fastBranch),
    ).toBe(true);
    // appears exactly once in main, never in the stable / real-capture path
    expect((mainFn.match(/scanReviewUsageConfirmCandidates\(/g) ?? []).length).toBe(1);
    expect(/scanReviewUsageConfirmCandidates\(/.test(mainFn.slice(stableStart))).toBe(false);
  });

  it("candidate mode SUPPRESSES the confirm click (never clicks in candidate mode)", () => {
    // The confirm gate excludes candidate mode: confirmFlag = diagnoseConfirm && !diagnoseConfirmCandidates.
    expect(/confirmFlag:\s*diagnoseConfirm\s*&&\s*!diagnoseConfirmCandidates/.test(fastBranch)).toBe(true);
  });

  it("the candidate path writes NO status, performs NO upload / capture / saveAs", () => {
    // (the whole fast branch is already asserted status/upload/capture/saveAs-free by the confirm suite;
    // re-assert here for the candidate-specific lens)
    expect(writeStatusOnlyGated(fastBranch)).toBe(true); // status write reachable only via the gate
    expect(/saveAs/.test(fastBranch)).toBe(false);
  });
});

describe("capture-export-same-session — export-target readiness gate stops empty-target captures", () => {
  it("STABILIZES readiness (bounded read-only poll) AFTER the capture gate and BEFORE any capture", () => {
    expect(/waitForExportTargetReadinessStable\s*\(/.test(mainFn)).toBe(true);
    const gateIdx = mainFn.indexOf("decideCaptureGate(");
    const stableIdx = mainFn.indexOf("waitForExportTargetReadinessStable(");
    const captureIdx = mainFn.indexOf("captureAndUpload(");
    expect(stableIdx).toBeGreaterThan(gateIdx);
    expect(stableIdx).toBeLessThan(captureIdx);
  });

  it("wires the existing evaluator into the poll, reading content read-only (no extra page read in main)", () => {
    // main still reads page content exactly once (for planExportAction); the poll reads via its
    // injected readHtmlFn, not a second `await page.content()` in main.
    expect((mainFn.match(/await page\.content\(\)/g) ?? []).length).toBe(1);
    expect(/planExportAction\(html\)/.test(mainFn)).toBe(true);
    expect(/evaluateReadinessFn:\s*evaluateExportTargetReadiness/.test(mainFn)).toBe(true);
    expect(/readHtmlFn:\s*\(p\)\s*=>\s*p\.content\(\)/.test(mainFn)).toBe(true);
  });

  it("real capture HALTS with the honest readiness state before captureAndUpload when not READY", () => {
    // The real-path readiness halt is the stabilized check AFTER the diagnose dispatch.
    const dispatchIdx = mainFn.indexOf("diagnoseExportClickOnce(");
    const stableIdx = mainFn.indexOf("waitForExportTargetReadinessStable(", dispatchIdx);
    const haltIdx = mainFn.indexOf('readiness.decision !== "READY"', dispatchIdx);
    const captureIdx = mainFn.indexOf("captureAndUpload(");
    expect(stableIdx).toBeGreaterThan(dispatchIdx); // a second poll guards the real capture
    expect(haltIdx).toBeGreaterThan(stableIdx);
    expect(haltIdx).toBeLessThan(captureIdx); // the halt guards the capture
    const branch = mainFn.slice(haltIdx, captureIdx);
    expect(/writeStatus/.test(branch)).toBe(true); // records the readiness state
    expect(/readiness\.state/.test(branch)).toBe(true);
    // captureAndUpload is dispatched exactly once, only past this gate.
    expect((mainFn.match(/captureAndUpload\(/g) ?? []).length).toBe(1);
  });

  it("the diagnostic readiness halt REPORTS only (no status, no capture) unless overridden", () => {
    expect(/--diagnose-allow-empty-target/.test(code)).toBe(true);
    expect(/allowEmptyTarget/.test(mainFn)).toBe(true);
    // The STABLE (non-override) diagnose branch stabilizes readiness and, when not READY, REPORTS
    // the sanitized halt (checks/stableCount/wouldClick) — it never writes status. Anchor the slice
    // between the stable stabilization and the stable-branch dispatch (the SECOND diagnostic click).
    const stableIdx = mainFn.indexOf("waitForExportTargetReadinessStable(");
    const fastDispatchIdx = mainFn.indexOf("diagnoseExportClickOnce(");
    const stableDispatchIdx = mainFn.indexOf("diagnoseExportClickOnce(", fastDispatchIdx + 1);
    const branch = mainFn.slice(stableIdx, stableDispatchIdx);
    expect(stableDispatchIdx).toBeGreaterThan(stableIdx);
    expect(/readiness\.decision\s*!==\s*"READY"\s*&&\s*!allowEmptyTarget/.test(branch)).toBe(true);
    expect(/writeStatus/.test(branch)).toBe(false); // diagnostic mode never persists status
    expect(/wouldClick/.test(branch)).toBe(true); // sanitized stdout report instead
    expect(/checks/.test(branch)).toBe(true); // reports the number of stabilization checks
  });
});

describe("capture-export-same-session — read-only live-DOM probe enriches the diagnostic halt ONLY", () => {
  it("imports the pure probe core AND the live read adapter (decision pure, reads live)", () => {
    expect(/from\s+["']\.\.\/naver\/live-export-target-probe["']/.test(code)).toBe(true);
    expect(/from\s+["']\.\.\/naver\/live-export-target-probe-reads["']/.test(code)).toBe(true);
    expect(/probeLiveExportTargetReadiness/.test(code)).toBe(true);
    expect(/readLiveProbeSignals/.test(code)).toBe(true);
  });

  it("runs the live probe inside the diagnostic not-READY block and reports its sanitized fields", () => {
    // The live probe lives in the STABLE branch's not-READY block: between the stable stabilization
    // and the stable-branch dispatch (the SECOND diagnostic click). The fast override branch precedes
    // the stable stabilization and never runs the probe.
    const stableIdx = mainFn.indexOf("waitForExportTargetReadinessStable(");
    const fastDispatchIdx = mainFn.indexOf("diagnoseExportClickOnce(");
    const stableDispatchIdx = mainFn.indexOf("diagnoseExportClickOnce(", fastDispatchIdx + 1);
    const branch = mainFn.slice(stableIdx, stableDispatchIdx);
    expect(/probeLiveExportTargetReadiness\(/.test(branch)).toBe(true);
    expect(/readSignalsFn:\s*readLiveProbeSignals/.test(branch)).toBe(true);
    expect(/liveProbe:\s*live\.decision/.test(branch)).toBe(true);
    expect(/visibleRowCountBucket/.test(branch)).toBe(true);
    // The probe runs read-only past the existing readiness gate; it still writes no status here.
    expect(/writeStatus/.test(branch)).toBe(false);
    expect(/wouldClick:\s*false/.test(branch)).toBe(true); // never proposes a click
  });

  it("the live probe NEVER runs in the real capture path (diagnostic-only this slice)", () => {
    // Everything from the real-capture readiness stabilization onward carries no live-probe call,
    // and capture is still dispatched exactly once, gated only by the HTML readiness decision. The
    // real stabilization is the one AFTER the stable-branch dispatch (the SECOND diagnostic click).
    const fastDispatchIdx = mainFn.indexOf("diagnoseExportClickOnce(");
    const stableDispatchIdx = mainFn.indexOf("diagnoseExportClickOnce(", fastDispatchIdx + 1);
    const realStableIdx = mainFn.indexOf("waitForExportTargetReadinessStable(", stableDispatchIdx);
    const realBranch = mainFn.slice(realStableIdx);
    expect(realStableIdx).toBeGreaterThan(stableDispatchIdx);
    expect(/probeLiveExportTargetReadiness\(/.test(realBranch)).toBe(false);
    expect((mainFn.match(/captureAndUpload\(/g) ?? []).length).toBe(1);
    // The probe call appears exactly once in main — only in the diagnostic block.
    expect((mainFn.match(/probeLiveExportTargetReadiness\(/g) ?? []).length).toBe(1);
  });

  it("the CLI itself drives no frame/evaluate read directly (those live in the adapter)", () => {
    expect(/\.evaluate\s*\(/.test(code)).toBe(false);
    expect(/\.frames\s*\(/.test(code)).toBe(false);
  });
});

describe("capture-export-same-session — approved-index review-usage confirm, flag-gated, highest precedence", () => {
  const fastBranchStart = mainFn.indexOf("if (allowEmptyTarget)");
  const stableStart = mainFn.indexOf("waitForExportTargetReadinessStable(");
  const fastBranch = mainFn.slice(fastBranchStart, stableStart);

  it("imports the index adapter and the pure parse + decision", () => {
    expect(/confirmReviewUsageByIndexOnce/.test(code)).toBe(true);
    expect(/decideApprovedIndexConfirm/.test(code)).toBe(true);
    expect(/parseApprovedIndexArg/.test(code)).toBe(true);
  });

  it("parses --diagnose-confirm-review-usage-index and gates it on diagnoseClick", () => {
    expect(/--diagnose-confirm-review-usage-index/.test(code)).toBe(true);
    expect(
      /const\s+approvedIndexRequested\s*=\s*diagnoseClick\s*&&\s*args\.includes\("--diagnose-confirm-review-usage-index"\)/.test(
        mainFn,
      ),
    ).toBe(true);
    expect(/const\s+approvedIndex\s*=\s*parseApprovedIndexArg\(args\)/.test(mainFn)).toBe(true);
  });

  it("runs the index adapter ONLY in the supervised-fast branch, ONLY on an ATTEMPT decision", () => {
    expect(/confirmReviewUsageByIndexOnce\(/.test(fastBranch)).toBe(true);
    expect(/decideApprovedIndexConfirm\(/.test(fastBranch)).toBe(true);
    expect(/approvedIndexDecision\s*===\s*["']ATTEMPT["']/.test(fastBranch)).toBe(true);
    // the decision is fed the diagnostic outcome + the flag + the parsed index (never auto-confirmed).
    expect(/outcome:\s*diagnosis\.outcome/.test(fastBranch)).toBe(true);
    expect(/indexRequested:\s*approvedIndexRequested/.test(fastBranch)).toBe(true);
    expect(/parsedIndex:\s*approvedIndex/.test(fastBranch)).toBe(true);
  });

  it("invokes the index adapter exactly once in main, and NEVER in the stable / real-capture path", () => {
    expect((mainFn.match(/confirmReviewUsageByIndexOnce\(/g) ?? []).length).toBe(1);
    expect(/confirmReviewUsageByIndexOnce\(/.test(mainFn.slice(stableStart))).toBe(false);
  });

  it("index mode SUPPRESSES the candidate scan and the plain confirm click (precedence)", () => {
    // the candidate flag is forced off in index mode…
    expect(
      /const\s+diagnoseConfirmCandidates\s*=\s*diagnoseClick\s*&&\s*args\.includes\("--diagnose-review-usage-confirm-candidates"\)\s*&&\s*!approvedIndexRequested/.test(
        mainFn,
      ),
    ).toBe(true);
    // …and the plain confirm flag excludes index mode too.
    expect(/confirmFlag:\s*diagnoseConfirm\s*&&\s*!diagnoseConfirmCandidates\s*&&\s*!approvedIndexRequested/.test(fastBranch)).toBe(
      true,
    );
  });

  it("the index path writes NO status, performs NO upload / capture / saveAs", () => {
    expect(writeStatusOnlyGated(fastBranch)).toBe(true); // status write reachable only via the gate
    expect(/uploadReviewFile/.test(fastBranch)).toBe(false);
    expect(/captureAndUpload\(/.test(fastBranch)).toBe(false);
    expect(/\.saveAs\s*\(/.test(fastBranch)).toBe(false);
  });
});

describe("capture-export-same-session — controlled diagnostic download save, flag-gated", () => {
  const fastBranchStart = mainFn.indexOf("if (allowEmptyTarget)");
  const stableStart = mainFn.indexOf("waitForExportTargetReadinessStable(");
  const fastBranch = mainFn.slice(fastBranchStart, stableStart);

  it("imports the save module fn and the pure save decision", () => {
    expect(/from\s+["']\.\.\/naver\/review-download-save["']/.test(code)).toBe(true);
    expect(/saveAndInspectDownload/.test(code)).toBe(true);
    expect(/decideSaveReviewDownload/.test(code)).toBe(true);
  });

  it("parses --diagnose-save-review-download and gates it on diagnoseClick", () => {
    expect(/--diagnose-save-review-download/.test(code)).toBe(true);
    expect(
      /const\s+diagnoseSaveDownload\s*=\s*diagnoseClick\s*&&\s*args\.includes\("--diagnose-save-review-download"\)/.test(
        mainFn,
      ),
    ).toBe(true);
  });

  it("wires the save hook ONLY in the approved-index dispatch and ONLY when the flag is set", () => {
    expect(/saveDownloadFn:/.test(fastBranch)).toBe(true);
    expect(/diagnoseSaveDownload\s*\?/.test(fastBranch)).toBe(true); // conditional, never unconditional
    // the save hook is wired inside the approved-index ATTEMPT block (after the adapter call opens)
    const idxIdx = fastBranch.indexOf("confirmReviewUsageByIndexOnce(");
    const saveIdx = fastBranch.indexOf("saveDownloadFn:");
    expect(idxIdx).toBeGreaterThanOrEqual(0);
    expect(saveIdx).toBeGreaterThan(idxIdx);
    // wired to saveAndInspectDownload into the gitignored diagnostic quarantine dir
    expect(/saveAndInspectDownload\(/.test(fastBranch)).toBe(true);
    expect(/join\(cfg\.downloadDir,\s*["']diagnostic["']\)/.test(fastBranch)).toBe(true);
  });

  it("emits the save reason + the invariant assertions (save mode only)", () => {
    expect(/downloadSaveRequested:\s*diagnoseSaveDownload/.test(fastBranch)).toBe(true);
    expect(/downloadSaveReason/.test(fastBranch)).toBe(true);
    expect(/upload:\s*false/.test(fastBranch)).toBe(true);
    expect(/statusWritten:\s*false/.test(fastBranch)).toBe(true);
    expect(/dbMutated:\s*false/.test(fastBranch)).toBe(true);
    expect(/lastSuccessWritten:\s*false/.test(fastBranch)).toBe(true);
  });

  it("the save path writes NO status / upload / capture, and the CLI itself never calls saveAs", () => {
    expect(writeStatusOnlyGated(fastBranch)).toBe(true); // status write reachable only via the gate
    expect(/uploadReviewFile/.test(fastBranch)).toBe(false);
    expect(/captureAndUpload\(/.test(fastBranch)).toBe(false);
    expect(/\.saveAs\s*\(/.test(code)).toBe(false); // saveAs is confined to review-download-save.ts
  });
});

describe("capture-export-same-session — controlled backend upload diagnostic, flag-gated, higher-consequence", () => {
  const fastBranchStart = mainFn.indexOf("if (allowEmptyTarget)");
  const stableStart = mainFn.indexOf("waitForExportTargetReadinessStable(");
  const fastBranch = mainFn.slice(fastBranchStart, stableStart);

  it("imports the upload-diagnostic module fn and the pure upload decision", () => {
    expect(/from\s+["']\.\.\/naver\/review-upload-diagnostic["']/.test(code)).toBe(true);
    expect(/uploadSavedReviewDownload/.test(code)).toBe(true);
    expect(/decideUploadSavedReviewDownload/.test(code)).toBe(true);
  });

  it("parses --diagnose-upload-saved-review-download and is INERT without the save flag", () => {
    expect(/--diagnose-upload-saved-review-download/.test(code)).toBe(true);
    // gated on diagnoseSaveDownload (not diagnoseClick) — you can only upload what was saved.
    expect(
      /const\s+diagnoseUpload\s*=\s*diagnoseSaveDownload\s*&&\s*args\.includes\("--diagnose-upload-saved-review-download"\)/.test(
        mainFn,
      ),
    ).toBe(true);
  });

  it("wires the uploadFn ONLY when diagnoseUpload, NESTED inside the save hook (upload-before-delete)", () => {
    expect(/uploadFn:/.test(fastBranch)).toBe(true);
    expect(/uploadSavedReviewDownload\(/.test(fastBranch)).toBe(true);
    // conditional spread, never unconditional, and inside the save closure (after saveDownloadFn opens).
    const saveIdx = fastBranch.indexOf("saveDownloadFn:");
    const upWireIdx = fastBranch.indexOf("uploadFn:");
    expect(saveIdx).toBeGreaterThanOrEqual(0);
    expect(upWireIdx).toBeGreaterThan(saveIdx);
    expect(/\.\.\.\(diagnoseUpload\s*\?/.test(fastBranch)).toBe(true);
  });

  it("emits the HONEST upload invariants — backendIngested, NOT dbMutated:false, honest status fields", () => {
    expect(/uploadRequested:\s*diagnoseUpload/.test(fastBranch)).toBe(true);
    expect(/uploadReason/.test(fastBranch)).toBe(true);
    // isolate the upload REPORT arm (the spread after `uploadRequested: diagnoseUpload`).
    const reqIdx = fastBranch.indexOf("uploadRequested: diagnoseUpload");
    const armStart = fastBranch.indexOf("...(diagnoseUpload", reqIdx);
    const armEnd = fastBranch.indexOf(": diagnoseSaveDownload", armStart);
    expect(armStart).toBeGreaterThan(reqIdx);
    expect(armEnd).toBeGreaterThan(armStart);
    const uploadReportArm = fastBranch.slice(armStart, armEnd);
    expect(/backendIngested/.test(uploadReportArm)).toBe(true);
    // PR B: collectorStatusWritten / lastSuccessWritten are now HONEST (the computed values, not
    // hard-coded false) — true only when a status was actually written / the written state is LAST_SUCCESS.
    expect(/collectorStatusWritten,/.test(uploadReportArm)).toBe(true);
    expect(/lastSuccessWritten:\s*writtenState === "LAST_SUCCESS"/.test(uploadReportArm)).toBe(true);
    expect(/collectorStatusWritten:\s*false/.test(uploadReportArm)).toBe(false); // no longer hard-coded
    // HONESTY: the upload path must never claim dbMutated:false (the backend DB IS ingested).
    expect(/dbMutated/.test(uploadReportArm)).toBe(false);
  });

  it("the CLI itself never names uploadReviewFile or calls saveAs (confined to the wrapper/module)", () => {
    expect(writeStatusOnlyGated(fastBranch)).toBe(true); // status write reachable only via the gate
    expect(/uploadReviewFile/.test(fastBranch)).toBe(false);
    expect(/captureAndUpload\(/.test(fastBranch)).toBe(false);
    expect(/\.saveAs\s*\(/.test(code)).toBe(false);
  });
});

describe("capture-export-same-session — diagnostic status progression after upload (PR B), flag-gated", () => {
  const fastBranchStart = mainFn.indexOf("if (allowEmptyTarget)");
  const stableStart = mainFn.indexOf("waitForExportTargetReadinessStable(");
  const fastBranch = mainFn.slice(fastBranchStart, stableStart);
  const gate = fastBranch.indexOf("if (diagnoseWriteStatus)");
  const gatedBlock = fastBranch.slice(gate, fastBranch.indexOf("\n        }", gate));

  it("imports the pure status mapping and REUSES the existing decideState/writeStatus", () => {
    expect(/decideStatusSignalsAfterUpload/.test(code)).toBe(true);
    expect(/statusDetailAfterUpload/.test(code)).toBe(true);
    expect(/import \{ decideState, writeStatus,.*\} from "\.\.\/status"/.test(code)).toBe(true);
  });

  it("parses --diagnose-write-status-after-upload and is INERT without the upload flag", () => {
    expect(/--diagnose-write-status-after-upload/.test(code)).toBe(true);
    // gated on diagnoseUpload (which itself requires the save flag) — you can only write an upload outcome.
    expect(
      /const\s+diagnoseWriteStatus\s*=\s*diagnoseUpload\s*&&\s*args\.includes\("--diagnose-write-status-after-upload"\)/.test(
        mainFn,
      ),
    ).toBe(true);
  });

  it("writes status ONLY inside the gate (honest guard — not hidden behind a wrapper)", () => {
    expect(gate).toBeGreaterThanOrEqual(0);
    expect(writeStatusOnlyGated(fastBranch)).toBe(true);
    // the mapping + write all live inside the gated block
    expect(/decideStatusSignalsAfterUpload\(/.test(gatedBlock)).toBe(true);
    expect(/decideState\(/.test(gatedBlock)).toBe(true);
    expect(/writeStatus\(cfg\.statusFile/.test(gatedBlock)).toBe(true);
    expect(/statusDetailAfterUpload\(/.test(gatedBlock)).toBe(true);
  });

  it("sets lastCollectedAt ONLY on LAST_SUCCESS, updatedAt always", () => {
    expect(/lastCollectedAt:\s*writtenState === "LAST_SUCCESS"\s*\?\s*now\(\)\s*:\s*undefined/.test(gatedBlock)).toBe(true);
    expect(/updatedAt:\s*now\(\)/.test(gatedBlock)).toBe(true);
  });

  it("feeds decideState the LOGGED_IN run signals from the diagnostic upload", () => {
    expect(/paired:\s*true/.test(gatedBlock)).toBe(true);
    expect(/session:\s*"LOGGED_IN"/.test(gatedBlock)).toBe(true);
    expect(/exportOutcome:\s*statusSignals\.exportOutcome/.test(gatedBlock)).toBe(true);
    expect(/uploadOutcome:\s*statusSignals\.uploadOutcome/.test(gatedBlock)).toBe(true);
  });

  it("emits the honest status report fields (collectorStatusWritten / writtenState / lastSuccessWritten)", () => {
    expect(/diagnoseWriteStatusAfterUpload:\s*diagnoseWriteStatus/.test(fastBranch)).toBe(true);
    expect(/collectorStatusWritten,/.test(fastBranch)).toBe(true);
    expect(/writtenState, statusDetail/.test(fastBranch)).toBe(true);
    expect(/lastSuccessWritten:\s*writtenState === "LAST_SUCCESS"/.test(fastBranch)).toBe(true);
  });

  it("does NOT mutate status.ts and introduces no new CollectorState", () => {
    // decideState/writeStatus are reused as-is; no new state literal is added in the CLI status block.
    expect(/state:\s*writtenState/.test(gatedBlock)).toBe(true);
    expect(/new (?:state|CollectorState)/.test(gatedBlock)).toBe(false);
  });
});