import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = join(__dirname, "..", "..", "src", "cli", "capture-esm-review-upload.ts");

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("capture-esm-review-upload — supervised single capture → backend upload boundary", () => {
  const code = stripComments(readFileSync(CLI_PATH, "utf8"));

  it("REQUIRES BOTH the live-session flag AND the upload-consent flag", () => {
    expect(/hasEsmLiveApproval\s*\(/.test(code)).toBe(true);
    expect(/esmApprovalRequiredMessage\s*\(/.test(code)).toBe(true);
    expect(/hasEsmUploadApproval\s*\(/.test(code)).toBe(true);
    expect(/esmUploadApprovalRequiredMessage\s*\(/.test(code)).toBe(true);
    expect(/from\s+["']\.\.\/esm\/esm-upload-approval["']/.test(code)).toBe(true);
  });

  it("REQUIRES an explicit approved index (refuses when absent)", () => {
    expect(/parseApprovedIndexArg\s*\(/.test(code)).toBe(true);
    expect(/approvedIndex\s*===\s*null/.test(code)).toBe(true);
    expect(/--approved-index/.test(code)).toBe(true);
  });

  it("clicks EXACTLY once (no auto-repeat, no fallback, no loop click)", () => {
    const clicks = code.match(/\.click\s*\(/g) ?? [];
    expect(clicks.length).toBe(1);
    expect(/\[data-sellerops-esm-cap-index="\$\{approvedIndex\}"\]/.test(code)).toBe(true);
  });

  it("waits for EXACTLY one download event", () => {
    const waits = code.match(/waitForEvent\s*\(\s*["']download["']/g) ?? [];
    expect(waits.length).toBe(1);
  });

  it("binds the approved index with a count() === 1 guard before clicking", () => {
    expect(/\.count\s*\(\s*\)/.test(code)).toBe(true);
    expect(/bound\s*!==\s*1/.test(code)).toBe(true);
  });

  it("uses the pure capture-gate decisions + structural validation (reused, unchanged)", () => {
    expect(/from\s+["']\.\.\/esm\/esm-capture-gate["']/.test(code)).toBe(true);
    expect(/capturePreconditionMet\s*\(/.test(code)).toBe(true);
    expect(/decideApprovedCapture\s*\(/.test(code)).toBe(true);
    expect(/classifyPostClickOutcome\s*\(/.test(code)).toBe(true);
    expect(/classifyFileStructure\s*\(/.test(code)).toBe(true);
  });

  it("enters cross-origin frames ONLY via the allowlist, re-confirmed before acting", () => {
    expect(/frameHostAllowed\s*\(/.test(code)).toBe(true);
    expect(/findAllowlistedFrame\s*\(/.test(code)).toBe(true);
    expect(/cfg\.esmFrameOriginAllowlist/.test(code)).toBe(true);
  });

  it("delegates the save→UPLOAD-BEFORE-DELETE→delete leg to the extracted, offline-tested helper", () => {
    // The save/validate/upload/delete cycle lives in esm-review-upload.ts (hermetically tested in
    // test/esm/esm-review-upload.test.ts); the CLI never names saveAs / uploadReviewFile itself.
    expect(/from\s+["']\.\.\/esm\/esm-review-upload["']/.test(code)).toBe(true);
    expect(/saveValidateUploadDeleteEsmReview\s*\(/.test(code)).toBe(true);
    expect(/buildEsmReviewUploadReport\s*\(/.test(code)).toBe(true);
    expect(code.includes("saveAs")).toBe(false);
    expect(code.includes("uploadReviewFile")).toBe(false);
  });

  it("reports the upload HONESTLY: uploaded/backendIngested, and NEVER claims dbMutated:false", () => {
    expect(/backendIngested/.test(code)).toBe(true);
    // The upload path ingests rows — it must never assert non-mutation.
    expect(code.includes("dbMutated")).toBe(false);
    // `uploaded` is a computed value, not a hard-coded false like the observe-only CLI.
    expect(/uploaded:\s*false/.test(code)).toBe(false);
  });

  it("writes NO collector status / LAST_SUCCESS, runs NO scheduler / manualSync / export", () => {
    for (const token of [
      "writeStatus",
      "runExport",
      "manualSync",
      "scheduler",
      "setInterval",
      "cron",
      "LAST_SUCCESS",
    ]) {
      expect(code.includes(token)).toBe(false);
    }
    expect(/from\s+["']\.\.\/status["']/.test(code)).toBe(false);
  });

  it("keeps the honest non-goal markers (no row parse / schema infer / dedup-key claim)", () => {
    expect(/rowsParsed:\s*false/.test(code)).toBe(true);
    expect(/schemaInferred:\s*false/.test(code)).toBe(true);
    expect(/dedupKeyClaimed:\s*false/.test(code)).toBe(true);
    expect(/statusWritten:\s*false/.test(code)).toBe(true);
  });

  it("uses the separate ESM profile + ESM sentinel (not NAVER's)", () => {
    expect(/cfg\.esmProfileDir/.test(code)).toBe(true);
    expect(/esmSentinelPathFor\s*\(/.test(code)).toBe(true);
    expect(/cfg\.profileDir\b/.test(code)).toBe(false);
    expect(/probe-sentinel/.test(code)).toBe(false);
  });

  it("does not depend on terminal stdin / an Enter keypress", () => {
    expect(code.includes("process.stdin")).toBe(false);
    expect(/waitForEnter/.test(code)).toBe(false);
  });

  it("emits a sanitized summary and never prints raw page/frame url or html", () => {
    expect(/console\.log\(JSON\.stringify\(/.test(code)).toBe(true);
    expect(/console\.log\([^)]*\.(url|content)\s*\(/.test(code)).toBe(false);
  });
});
