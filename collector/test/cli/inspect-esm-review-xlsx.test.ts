import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, "..", "..", "instruments", "calibration", "inspect-esm-review-xlsx.ts");

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("inspect-esm-review-xlsx — offline, read-only, no-leak boundary", () => {
  const code = stripComments(readFileSync(CLI, "utf8"));

  it("REQUIRES an explicit local xlsx path", () => {
    expect(/parseXlsxPathArg\s*\(/.test(code)).toBe(true);
    expect(/--xlsx/.test(code)).toBe(true);
    expect(/xlsxPath\s*===\s*null/.test(code)).toBe(true);
  });

  it("uses the dependency-free reader + the pure sanitised summariser", () => {
    expect(/from\s+["']\.\.\/\.\.\/src\/esm\/esm-review-xlsx-reader["']/.test(code)).toBe(true);
    expect(/readWorkbookShape\s*\(/.test(code)).toBe(true);
    expect(/from\s+["']\.\.\/\.\.\/src\/esm\/esm-review-schema-shape["']/.test(code)).toBe(true);
    expect(/summarizeSchemaShape\s*\(/.test(code)).toBe(true);
    expect(/console\.log\(JSON\.stringify\(/.test(code)).toBe(true);
  });

  it("launches NO browser and imports NO live/Playwright/profile machinery", () => {
    for (const token of ["playwright", "launchPersistentBrowser", "chromium", "page.goto", ".click(", "waitForEvent", "saveAs"]) {
      expect(code.includes(token)).toBe(false);
    }
    expect(/from\s+["']\.\.\/\.\.\/src\/profile["']/.test(code)).toBe(false);
  });

  it("performs NO upload / DB / status / scheduler / manualSync", () => {
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
    expect(/from\s+["']\.\.\/\.\.\/src\/upload["']/.test(code)).toBe(false);
    expect(/from\s+["']\.\.\/\.\.\/src\/status["']/.test(code)).toBe(false);
    expect(/from\s+["'][^"']*review-upload[^"']*["']/.test(code)).toBe(false);
  });

  it("never echoes the raw file path or filename (path is read, never logged)", () => {
    // The path variable is never passed to console.log/console.error.
    expect(/console\.(log|error)\([^)]*xlsxPath/.test(code)).toBe(false);
    // No basename/dirname printing of the input path either.
    expect(/console\.(log|error)\([^)]*basename/.test(code)).toBe(false);
  });
});
