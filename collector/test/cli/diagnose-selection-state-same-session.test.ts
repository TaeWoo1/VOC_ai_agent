import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = join(__dirname, "..", "..", "instruments", "calibration", "diagnose-selection-state-same-session.ts");

/** Remove block + line comments so the guards check executable source, not prose. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ") // /* block */ and /** jsdoc */
    .replace(/(^|[^:])\/\/.*$/gm, "$1"); // // line  (the [^:] guard spares "://" in URLs)
}

const code = stripComments(readFileSync(CLI_PATH, "utf8"));

describe("diagnose-selection-state-same-session — strictly NO-CLICK, no capture, no status", () => {
  it("never drives the page (no click/fill/press/select/check/dispatch/download)", () => {
    expect(/\.(click|fill|press|selectOption|check|dispatchEvent)\s*\(/.test(code)).toBe(false);
    expect(/waitForEvent\s*\(/.test(code)).toBe(false);
    expect(/saveAs/.test(code)).toBe(false);
  });

  it("never triggers/captures an export or uploads", () => {
    expect(code.includes("runExport")).toBe(false);
    expect(code.includes("uploadReviewFile")).toBe(false);
    expect(/\bupload\w*\s*\(/.test(code)).toBe(false);
  });

  it("writes NO status record", () => {
    expect(code.includes("writeStatus")).toBe(false);
  });

  it("never dumps raw HTML", () => {
    expect(/\.content\s*\(/.test(code)).toBe(false);
  });
});

describe("diagnose-selection-state-same-session — gated + salted + sentinel continuation", () => {
  it("refuses to act without the explicit per-run approval flag", () => {
    expect(/hasLiveRunApproval\s*\(/.test(code)).toBe(true);
    expect(/approvalRequiredMessage\s*\(/.test(code)).toBe(true);
  });

  it("fails closed without the shared STORAGE_PROBE_SALT", () => {
    expect(code.includes("storageProbeSalt")).toBe(true);
    // The salt is consulted before the storage read; an absent salt exits non-zero.
    const saltIdx = code.indexOf("storageProbeSalt");
    const collectIdx = code.indexOf("collectSanitizedStorage(", code.indexOf("async function main"));
    expect(saltIdx).toBeGreaterThanOrEqual(0);
    expect(collectIdx).toBeGreaterThan(saltIdx);
  });

  it("**takes no readiness signal from the filesystem, and none from stdin**", () => {
    // It used to wait on a `.ready` file, and its own printed prompt told the operator that in Claude Code they
    // could "just say ready and Claude creates it". That is the channel that failed on 2026-08-13.
    expect(/sentinelPathFor\s*\(/.test(code)).toBe(false);
    expect(/probe-sentinel/.test(code)).toBe(false);
    expect(/waitForSentinel\s*\(/.test(code)).toBe(false);
    expect(/existsSync/.test(code)).toBe(false);
    expect(code.includes("process.stdin")).toBe(false);
    expect(/waitForEnter/.test(code)).toBe(false);
  });

  it("waits on the shared confirmation surface instead", () => {
    expect(/attachOperatorConfirmTab\s*\(/.test(code)).toBe(true);
    expect(code.includes("confirmHost.confirm(CONFIRM_ASK)")).toBe(true);
  });

  it("aborts WITHOUT reading storage unless a press confirmed the screen", () => {
    const guard = code.indexOf('confirmation.signal !== "ready"');
    const collectIdx = code.indexOf("collectSanitizedStorage(", code.indexOf("async function main"));
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(collectIdx); // the refusal returns before any storage read
  });

  it("emits only the sanitized signals via the pure collector/extractor", () => {
    expect(/collectSanitizedStorage\s*\(/.test(code)).toBe(true);
    expect(/contextLabel:\s*"A_same_session"/.test(code)).toBe(true);
  });
});
