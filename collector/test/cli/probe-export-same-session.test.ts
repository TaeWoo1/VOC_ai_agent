import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = join(__dirname, "..", "..", "src", "cli", "probe-export-same-session.ts");

/** Remove block + line comments so the guard checks only executable source, not prose. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ") // /* block */
    .replace(/(^|[^:])\/\/.*$/gm, "$1"); // // line  (the [^:] guard spares "://" in URLs)
}

describe("probe-export-same-session — structurally cannot reach export / download / upload / status", () => {
  const code = stripComments(readFileSync(CLI_PATH, "utf8"));

  // The whole point of this CLI: it observes the export AREA (top document + child frames) but is
  // separate from the classify-only discovery flow — it never imports or reaches the export/capture
  // path. If any of these reappear, the no-click / no-download / no-write guarantee is broken.
  const FORBIDDEN: ReadonlyArray<string> = [
    "review-export",
    "runExport",
    "saveAs",
    "upload",
    'waitForEvent("download")',
    "waitForEvent('download')",
    "writeStatus",
  ];

  for (const token of FORBIDDEN) {
    it(`source contains no \`${token}\``, () => {
      expect(code.includes(token)).toBe(false);
    });
  }

  it("does not import the export-capture or status modules", () => {
    const importLines = code
      .split("\n")
      .filter((l) => /^\s*import\b/.test(l) || /\bfrom\s+["']/.test(l));
    const imports = importLines.join("\n");
    expect(/review-export/.test(imports)).toBe(false);
    expect(/from\s+["'][^"']*upload[^"']*["']/.test(imports)).toBe(false);
    expect(/from\s+["']\.\.\/status["']/.test(imports)).toBe(false);
  });

  it("reuses the sanitized export-area sanitizer (allowed — it is not review-export)", () => {
    // extractExportProbeSignals lives in export-probe.ts (pure, sanitized), NOT review-export.ts.
    expect(/from\s+["']\.\.\/naver\/export-probe["']/.test(code)).toBe(true);
    expect(/extractExportProbeSignals/.test(code)).toBe(true);
    expect(/summarizeFrameExportProbes/.test(code)).toBe(true);
  });

  it("reads frames read-only — enumerates frames but never clicks/downloads", () => {
    expect(/page\.frames\(\)/.test(code)).toBe(true);
    expect(/waitForEvent\s*\(\s*["']download["']\s*\)/.test(code)).toBe(false);
    // No interaction primitives at all (no click/fill/press/submit/dispatch).
    expect(/\.(click|fill|press|selectOption|check|dispatchEvent)\s*\(/.test(code)).toBe(false);
  });

  it("prints only the sanitized summary object, never the raw url/html", () => {
    expect(/console\.log\([^)]*page\.(url|content)/.test(code)).toBe(false);
    expect(/console\.log\(JSON\.stringify\(summary/.test(code)).toBe(true);
  });
});

describe("probe-export-same-session — sentinel-file continuation (no terminal stdin)", () => {
  const code = stripComments(readFileSync(CLI_PATH, "utf8"));

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

  it("aborts without reading the page when the sentinel never appears", () => {
    expect(/sentinel-timeout/.test(code)).toBe(true);
  });
});
