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
    expect(/writeStatus/.test(branch)).toBe(false);
    expect(/uploadReviewFile/.test(branch)).toBe(false);
    expect(/captureAndUpload\(/.test(branch)).toBe(false);
    // Output is a sanitized stdout report (mode tag), not a status record.
    expect(/diagnose-export-click/.test(branch)).toBe(true);
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
    // The diagnostic readiness guard lives inside the MAIN diagnose block, before the dispatch,
    // and is fed by the bounded poll (it reports checks/stableCount, never writeStatus).
    const dispatchIdx = mainFn.indexOf("diagnoseExportClickOnce(");
    const diagIdx = mainFn.lastIndexOf("if (diagnoseClick)", dispatchIdx);
    const branch = mainFn.slice(diagIdx, dispatchIdx);
    expect(/waitForExportTargetReadinessStable\(/.test(branch)).toBe(true);
    expect(/readiness\.decision\s*!==\s*"READY"\s*&&\s*!allowEmptyTarget/.test(branch)).toBe(true);
    expect(/writeStatus/.test(branch)).toBe(false); // diagnostic mode never persists status
    expect(/wouldClick/.test(branch)).toBe(true); // sanitized stdout report instead
    expect(/checks/.test(branch)).toBe(true); // reports the number of stabilization checks
  });
});