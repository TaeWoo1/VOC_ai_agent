import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = join(__dirname, "..", "..", "src", "cli", "diagnose-selection-state-same-session.ts");

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

  it("derives the sentinel path from the shared helper and polls (no terminal stdin)", () => {
    expect(/from\s+["']\.\/probe-sentinel["']/.test(code)).toBe(true);
    expect(/sentinelPathFor\s*\(/.test(code)).toBe(true);
    expect(/waitForSentinel\s*\(/.test(code)).toBe(true);
    expect(code.includes("process.stdin")).toBe(false);
    expect(/waitForEnter/.test(code)).toBe(false);
  });

  it("clears any stale sentinel before waiting and cleans up afterwards", () => {
    expect(/removeSentinel\s*\(/.test(code)).toBe(true);
    expect(/unlinkSync/.test(code)).toBe(true);
  });

  it("aborts WITHOUT reading storage when the sentinel never appears", () => {
    expect(/sentinel-timeout/.test(code)).toBe(true);
    const abortIdx = code.indexOf("sentinel-timeout");
    const collectIdx = code.indexOf("collectSanitizedStorage(", code.indexOf("async function main"));
    expect(abortIdx).toBeGreaterThanOrEqual(0);
    expect(abortIdx).toBeLessThan(collectIdx); // the timeout return precedes any storage read
  });

  it("emits only the sanitized signals via the pure collector/extractor", () => {
    expect(/collectSanitizedStorage\s*\(/.test(code)).toBe(true);
    expect(/contextLabel:\s*"A_same_session"/.test(code)).toBe(true);
  });
});
