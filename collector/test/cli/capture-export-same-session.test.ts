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