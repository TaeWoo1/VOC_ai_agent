import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, "..", "..", "src", "esm", "esm-review-live-scan.ts");

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("esm-review-live-scan — shared no-click scan boundary", () => {
  const code = stripComments(readFileSync(SRC, "utf8"));

  it("exposes the shared classify entrypoint + the frame scan + the bounded settle", () => {
    expect(/export async function classifyOpenEsmReviewPage\s*\(/.test(code)).toBe(true);
    expect(/export async function scanEsmFramesForExport\s*\(/.test(code)).toBe(true);
    expect(/export async function settleEsmDom\s*\(/.test(code)).toBe(true);
  });

  it("uses the robust visibility cross-check (computed style + geometry), read-only", () => {
    expect(/getComputedStyle\s*\(/.test(code)).toBe(true);
    expect(/getBoundingClientRect\s*\(/.test(code)).toBe(true);
    expect(/querySelectorAll\(["']\*["']\)\.length/.test(code)).toBe(true);
  });

  it("reads cross-origin frames ONLY via the allowlist; categorizes frame URLs", () => {
    expect(/frameHostAllowed\s*\(\s*frame\.url\(\)\s*,\s*allowlist\s*\)/.test(code)).toBe(true);
    expect(/esmUrlCategory\s*\(\s*frame\.url\(\)\s*\)/.test(code)).toBe(true);
    expect(/skipped-cross-origin/.test(code)).toBe(true);
    expect(/summarizeFrameAwareExportScan\s*\(/.test(code)).toBe(true);
  });

  it("STRICT no-click: never clicks, waits for a download, saves, uploads, or writes status", () => {
    for (const token of [
      ".click(",
      ".fill(",
      ".press(",
      "dispatchEvent",
      'waitForEvent("download")',
      "waitForEvent('download')",
      "saveAs",
      "runExport",
      "writeStatus",
    ]) {
      expect(code.includes(token)).toBe(false);
    }
  });

  it("imports no capture / upload / status / fs modules", () => {
    const imports = code
      .split("\n")
      .filter((l) => /^\s*import\b/.test(l) || /\bfrom\s+["']/.test(l))
      .join("\n");
    expect(/review-export/.test(imports)).toBe(false);
    expect(/from\s+["'][^"']*upload[^"']*["']/.test(imports)).toBe(false);
    expect(/from\s+["']\.\.\/status["']/.test(imports)).toBe(false);
    expect(/from\s+["']node:fs["']/.test(imports)).toBe(false);
    // It never launches or closes a browser — that is the caller's lifecycle to own.
    expect(/launchPersistentBrowser/.test(code)).toBe(false);
    expect(/\.close\s*\(/.test(code)).toBe(false);
  });
});
