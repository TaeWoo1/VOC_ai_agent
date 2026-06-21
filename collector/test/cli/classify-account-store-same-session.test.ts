import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = join(__dirname, "..", "..", "src", "cli", "classify-account-store-same-session.ts");

/** Remove block + line comments so the guards check executable source, not prose. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ") // /* block */ and /** jsdoc */
    .replace(/(^|[^:])\/\/.*$/gm, "$1"); // // line  (the [^:] guard spares "://" in URLs)
}

const code = stripComments(readFileSync(CLI_PATH, "utf8"));

describe("classify-account-store-same-session — strictly NO-CLICK, report-only", () => {
  it("never drives the page (no click/fill/press/select/check/dispatch/download)", () => {
    expect(/\.(click|fill|press|selectOption|check|dispatchEvent|tap)\s*\(/.test(code)).toBe(false);
    expect(/waitForEvent\s*\(/.test(code)).toBe(false);
    expect(/saveAs/.test(code)).toBe(false);
  });

  it("never triggers/captures an export, uploads, or mutates a DB", () => {
    expect(code.includes("runExport")).toBe(false);
    expect(code.includes("uploadReviewFile")).toBe(false);
    expect(/\bupload\w*\s*\(/.test(code)).toBe(false);
  });

  it("writes NO status record", () => {
    expect(code.includes("writeStatus")).toBe(false);
  });

  it("never dumps raw HTML and does the single navigation only before the handoff", () => {
    expect(/\.content\s*\(/.test(code)).toBe(false); // the boundary reads content, not the CLI
    // Exactly one goto, and it is the initial route open (before the sentinel wait).
    expect((code.match(/\.goto\s*\(/g) ?? []).length).toBe(1);
    const gotoIdx = code.indexOf(".goto(");
    const waitIdx = code.indexOf("waitForSentinel(", code.indexOf("async function main"));
    expect(gotoIdx).toBeLessThan(waitIdx);
  });
});

describe("classify-account-store-same-session — auto-read (--no-sentinel) mode stays report-only", () => {
  it("supports a no-sentinel / auto-read-after-hydration mode", () => {
    expect(/--no-sentinel/.test(code)).toBe(true);
    expect(/--auto-read-after-hydration/.test(code)).toBe(true);
    expect(/const\s+noSentinel\s*=/.test(code)).toBe(true);
  });

  it("auto-read still settles the SPA before reading and still never clicks/captures/uploads/writes status", () => {
    // The mode only changes the READ TRIGGER; the no-click/no-status guards are global to the file.
    expect(/settleSpa\s*\(/.test(code)).toBe(true);
    expect(/\.(click|fill|press|selectOption|check|dispatchEvent)\s*\(/.test(code)).toBe(false);
    expect(code.includes("runExport")).toBe(false);
    expect(/\bupload\w*\s*\(/.test(code)).toBe(false);
    expect(code.includes("writeStatus")).toBe(false);
  });

  it("still requires the explicit live-approval flag in auto-read mode (approval is independent of the sentinel)", () => {
    // hasLiveRunApproval is checked at the top of main, before the noSentinel branch.
    const approvalIdx = code.indexOf("hasLiveRunApproval(");
    const noSentinelIdx = code.indexOf("noSentinel");
    expect(approvalIdx).toBeGreaterThanOrEqual(0);
    expect(approvalIdx).toBeLessThan(noSentinelIdx);
  });

  it("keeps the manual sentinel path available as a fallback (waitForSentinel still present)", () => {
    expect(/waitForSentinel\s*\(/.test(code)).toBe(true);
    expect(/sentinelPathFor\s*\(/.test(code)).toBe(true);
  });
});

describe("classify-account-store-same-session — gated + salted + sentinel continuation", () => {
  it("refuses to act without the explicit per-run approval flag", () => {
    expect(/hasLiveRunApproval\s*\(/.test(code)).toBe(true);
    expect(/approvalRequiredMessage\s*\(/.test(code)).toBe(true);
  });

  it("fails closed without the shared STORAGE_PROBE_SALT, before reading the surface", () => {
    expect(code.includes("storageProbeSalt")).toBe(true);
    const saltIdx = code.indexOf("storageProbeSalt");
    const collectIdx = code.indexOf("collectSelectionSurface(", code.indexOf("async function main"));
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

  it("aborts WITHOUT reading the surface when the sentinel never appears", () => {
    expect(/sentinel-timeout/.test(code)).toBe(true);
    const abortIdx = code.indexOf("sentinel-timeout");
    const collectIdx = code.indexOf("collectSelectionSurface(", code.indexOf("async function main"));
    expect(abortIdx).toBeGreaterThanOrEqual(0);
    expect(abortIdx).toBeLessThan(collectIdx); // the timeout return precedes any surface read
  });

  it("reports only the sanitized decision + shapes via the pure boundary (wouldClick, never a click)", () => {
    expect(/collectSelectionSurface\s*\(/.test(code)).toBe(true);
    expect(/wouldClick\s*=\s*decision\.kind\s*===\s*"RESOLVED"/.test(code)).toBe(true);
    // The reported payload carries all report-only diagnostics including the continue controls.
    expect(
      /JSON\.stringify\(\s*\{[\s\S]*decisionKind:[\s\S]*wouldClick[\s\S]*signals[\s\S]*candidateShapes[\s\S]*hrefStructures[\s\S]*continuationCard[\s\S]*continueControls[\s\S]*\}/.test(
        code,
      ),
    ).toBe(true);
  });
});
