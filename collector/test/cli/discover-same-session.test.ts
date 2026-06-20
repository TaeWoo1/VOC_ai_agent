import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = join(__dirname, "..", "..", "src", "cli", "discover-same-session.ts");

/** Remove block + line comments so the guard checks only executable source, not prose. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ") // /* block */
    .replace(/(^|[^:])\/\/.*$/gm, "$1"); // // line  (the [^:] guard spares "://" in URLs)
}

describe("discover-same-session — classify-only is strictly NO-CLICK (cannot trigger/capture)", () => {
  const code = stripComments(readFileSync(CLI_PATH, "utf8"));

  // The default same-session discovery path now classifies the export LAYOUT from the
  // rendered structure ALONE (planExportAction). It must never reach the trigger/capture
  // path: if any of these reappear, a real export could be triggered on the live store.
  const FORBIDDEN: ReadonlyArray<string> = [
    "runExport",
    "review-export",
    "saveAs",
    'waitForEvent("download")',
    "waitForEvent('download')",
    "download.path",
    ".click(",
    ".fill(",
    ".press(",
    "dispatchEvent",
    "upload",
  ];

  for (const token of FORBIDDEN) {
    it(`source contains no \`${token}\``, () => {
      expect(code.includes(token)).toBe(false);
    });
  }

  it("does not import the export-capture (review-export) module", () => {
    const importLines = code
      .split("\n")
      .filter((l) => /^\s*import\b/.test(l) || /\bfrom\s+["']/.test(l));
    const imports = importLines.join("\n");
    expect(/from\s+["']\.\.\/naver\/review-export["']/.test(imports)).toBe(false);
    expect(/from\s+["'][^"']*upload[^"']*["']/.test(imports)).toBe(false);
  });

  it("classifies via the PURE no-click planner", () => {
    expect(/from\s+["']\.\.\/naver\/export-classify["']/.test(code)).toBe(true);
    expect(/planExportAction/.test(code)).toBe(true);
    expect(/classifyOnlyStatusFromPlan/.test(code)).toBe(true);
  });

  it("never clicks, fills, dispatches, or waits for a download", () => {
    expect(/waitForEvent\s*\(\s*["']download["']\s*\)/.test(code)).toBe(false);
    expect(/\.(click|fill|press|selectOption|check|dispatchEvent)\s*\(/.test(code)).toBe(false);
  });
});
