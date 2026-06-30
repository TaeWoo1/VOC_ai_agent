import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = join(__dirname, "..", "..", "src", "cli", "capture-esm-review.ts");

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("capture-esm-review — exactly-one-click / observe-and-discard boundary", () => {
  const code = stripComments(readFileSync(CLI_PATH, "utf8"));

  it("requires the ESM live-approval flag", () => {
    expect(/hasEsmLiveApproval\s*\(/.test(code)).toBe(true);
    expect(/esmApprovalRequiredMessage\s*\(/.test(code)).toBe(true);
  });

  it("REQUIRES an explicit approved index (refuses when absent)", () => {
    expect(/parseApprovedIndexArg\s*\(/.test(code)).toBe(true);
    expect(/approvedIndex\s*===\s*null/.test(code)).toBe(true);
    expect(/--approved-index/.test(code)).toBe(true);
  });

  it("clicks EXACTLY once (no auto-repeat, no fallback, no loop click)", () => {
    const clicks = code.match(/\.click\s*\(/g) ?? [];
    expect(clicks.length).toBe(1);
    // The one click is bound to the single stamped approved-index locator.
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

  it("delegates save+validate+DELETE to review-download-save (never names saveAs itself)", () => {
    expect(/from\s+["']\.\.\/naver\/review-download-save["']/.test(code)).toBe(true);
    expect(/saveAndInspectDownload(?:<[^>]*>)?\s*\(/.test(code)).toBe(true);
    expect(code.includes("saveAs")).toBe(false);
  });

  it("uses the pure capture-gate decisions + structural validation", () => {
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

  it("NO upload / NO DB / NO status write / NO scheduler", () => {
    for (const token of [
      "uploadReviewFile",
      "uploadSavedReviewDownload",
      "writeStatus",
      "runExport",
      "manualSync",
      "scheduler",
      "setInterval",
      "cron",
    ]) {
      expect(code.includes(token)).toBe(false);
    }
    // No import of the backend-upload or run-status modules.
    expect(/from\s+["']\.\.\/upload["']/.test(code)).toBe(false);
    expect(/from\s+["']\.\.\/status["']/.test(code)).toBe(false);
    expect(/from\s+["'][^"']*review-upload[^"']*["']/.test(code)).toBe(false);
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

  it("emits a sanitized capture summary and honest non-goal markers", () => {
    expect(/console\.log\(JSON\.stringify\(/.test(code)).toBe(true);
    expect(/uploaded:\s*false/.test(code)).toBe(true);
    expect(/rowsParsed:\s*false/.test(code)).toBe(true);
    expect(/schemaInferred:\s*false/.test(code)).toBe(true);
    expect(/dedupKeyClaimed:\s*false/.test(code)).toBe(true);
    // Never prints raw page/frame url or html.
    expect(/console\.log\([^)]*\.(url|content)\s*\(/.test(code)).toBe(false);
  });
});

describe("capture-esm-review — Gate 4 opt-in schema-shape inspection (--inspect-schema-shape)", () => {
  const code = stripComments(readFileSync(CLI_PATH, "utf8"));

  it("is opt-in: gated on the --inspect-schema-shape flag", () => {
    expect(/--inspect-schema-shape/.test(code)).toBe(true);
    expect(/inspectSchemaShape\s*=\s*args\.includes\(/.test(code)).toBe(true);
  });

  it("wires the offline Gate-4 inspector (readWorkbookShape → summarizeSchemaShape) as the pre-delete hook", () => {
    expect(/from\s+["']\.\.\/esm\/esm-review-xlsx-reader["']/.test(code)).toBe(true);
    expect(/from\s+["']\.\.\/esm\/esm-review-schema-shape["']/.test(code)).toBe(true);
    expect(/summarizeSchemaShape\s*\(\s*readWorkbookShape\s*\(/.test(code)).toBe(true);
    // The inspector is passed to the SAME save module (so it runs after structural validation, before delete).
    expect(/saveAndInspectDownload<SanitizedSchemaShape>\s*\(/.test(code)).toBe(true);
    expect(/inspectFn/.test(code)).toBe(true);
  });

  it("inspection runs ONLY after structural xlsx validation, and fails closed", () => {
    // Structural sniff still gates the result, and a non-readable workbook under the flag stops.
    expect(/classifyFileStructure\s*\(/.test(code)).toBe(true);
    expect(/"schema-inspect-failed"/.test(code)).toBe(true);
    expect(/!schemaShape\.workbookReadable/.test(code)).toBe(true);
    // A failed cleanup is surfaced (observable, not silent).
    expect(/"delete-failed"/.test(code)).toBe(true);
    expect(/inspection\.deleteFailed/.test(code)).toBe(true);
  });

  it("surfaces the sanitized schema-shape and keeps confirmation markers false", () => {
    expect(/schemaShapeInspected/.test(code)).toBe(true);
    expect(/schemaShape\b/.test(code)).toBe(true);
    // The schema-shape object is the summariser's output, which hard-codes
    // schemaMappingConfirmed:false / dedupKeyConfirmed:false — and the CLI keeps its own honest markers.
    expect(/schemaInferred:\s*false/.test(code)).toBe(true);
    expect(/dedupKeyClaimed:\s*false/.test(code)).toBe(true);
  });

  it("still has EXACTLY one click + one download wait (Gate 3 invariants preserved)", () => {
    expect((code.match(/\.click\s*\(/g) ?? []).length).toBe(1);
    expect((code.match(/waitForEvent\s*\(\s*["']download["']/g) ?? []).length).toBe(1);
  });

  it("adds NO upload / DB / status / scheduler with the new path", () => {
    for (const token of ["uploadReviewFile", "writeStatus", "runExport", "manualSync", "scheduler", "setInterval", "cron"]) {
      expect(code.includes(token)).toBe(false);
    }
    expect(/from\s+["']\.\.\/upload["']/.test(code)).toBe(false);
    expect(/from\s+["']\.\.\/status["']/.test(code)).toBe(false);
  });
});
