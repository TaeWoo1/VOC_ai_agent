import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = join(__dirname, "..", "..", "src", "cli", "classify-esm-review.ts");

/** Remove block + line comments so the guard checks only executable source, not prose. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ") // /* block */
    .replace(/(^|[^:])\/\/.*$/gm, "$1"); // // line  (the [^:] guard spares "://" in URLs)
}

describe("classify-esm-review — strict no-click boundary (cannot trigger/capture/upload)", () => {
  const code = stripComments(readFileSync(CLI_PATH, "utf8"));

  // This CLI proves the export surface without ever acting on the page. If any of these
  // reappear, the no-click / no-download / no-capture / no-write guarantee is broken.
  const FORBIDDEN: ReadonlyArray<string> = [
    "review-export",
    "runExport",
    "saveAs",
    "upload",
    'waitForEvent("download")',
    "waitForEvent('download')",
    "writeStatus",
    ".click(",
    ".fill(",
    ".press(",
    "dispatchEvent",
    "process.stdin",
    "waitForEnter",
  ];

  for (const token of FORBIDDEN) {
    it(`source contains no \`${token}\``, () => {
      expect(code.includes(token)).toBe(false);
    });
  }

  it("requires the ESM live-approval flag before any browser action", () => {
    expect(/hasEsmLiveApproval\s*\(/.test(code)).toBe(true);
    expect(/esmApprovalRequiredMessage\s*\(/.test(code)).toBe(true);
  });

  it("delegates classification to the SHARED no-click scan (no capture/upload/status module)", () => {
    const importLines = code
      .split("\n")
      .filter((l) => /^\s*import\b/.test(l) || /\bfrom\s+["']/.test(l));
    const imports = importLines.join("\n");
    expect(/from\s+["']\.\.\/esm\/esm-review-live-scan["']/.test(imports)).toBe(true);
    expect(/classifyOpenEsmReviewPage\s*\(/.test(code)).toBe(true);
    expect(/review-export/.test(imports)).toBe(false);
    expect(/from\s+["'][^"']*upload[^"']*["']/.test(imports)).toBe(false);
    expect(/from\s+["']\.\.\/status["']/.test(imports)).toBe(false);
  });

  it("uses the SEPARATE ESM profile dir, not the NAVER one", () => {
    expect(/cfg\.esmProfileDir/.test(code)).toBe(true);
    expect(/cfg\.profileDir\b/.test(code)).toBe(false);
    expect(/launchPersistentBrowser\s*\(/.test(code)).toBe(true);
  });

  it("reads frames/DOM read-only — never clicks, fills, or dispatches", () => {
    expect(/waitForEvent\s*\(\s*["']download["']\s*\)/.test(code)).toBe(false);
    expect(/\.(click|fill|press|selectOption|check|dispatchEvent)\s*\(/.test(code)).toBe(false);
  });

  it("delegates the cross-check / bounded settle / frame-aware scan to the shared module", () => {
    // The scan mechanics (getComputedStyle / frame.evaluate / bounded settle / allowlist
    // gate) live in esm-review-live-scan.ts; this CLI must not re-implement them.
    expect(/classifyOpenEsmReviewPage\s*\(\s*page\s*,\s*cfg\.esmFrameOriginAllowlist\s*\)/.test(code)).toBe(true);
    expect(/getComputedStyle\s*\(/.test(code)).toBe(false);
    expect(/\.evaluate\s*\(/.test(code)).toBe(false);
    expect(/scanFramesForExport\s*\(/.test(code)).toBe(false);
  });

  it("passes the operator-configured ESM-family allowlist to the shared scan (fail-closed)", () => {
    expect(/cfg\.esmFrameOriginAllowlist/.test(code)).toBe(true);
    // Only a sanitized boolean about the allowlist is surfaced — never the hosts.
    expect(/allowlistConfigured/.test(code)).toBe(true);
  });

  it("prints only the sanitized summary object, never the raw url/html", () => {
    expect(/console\.log\([^)]*page\.(url|content)/.test(code)).toBe(false);
    expect(/console\.log\(JSON\.stringify\(summary/.test(code)).toBe(true);
  });
});

describe("classify-esm-review — ESM sentinel continuation (no terminal stdin, distinct from NAVER)", () => {
  const code = stripComments(readFileSync(CLI_PATH, "utf8"));

  it("does not depend on terminal stdin / an Enter keypress", () => {
    expect(code.includes("process.stdin")).toBe(false);
    expect(/waitForEnter/.test(code)).toBe(false);
  });

  it("derives the sentinel path from the dedicated ESM helper (distinct from NAVER)", () => {
    expect(/from\s+["']\.\.\/esm\/esm-sentinel["']/.test(code)).toBe(true);
    expect(/esmSentinelPathFor\s*\(/.test(code)).toBe(true);
    expect(/probe-sentinel/.test(code)).toBe(false);
  });

  it("polls for the sentinel file and clears it before/after", () => {
    expect(/existsSync/.test(code)).toBe(true);
    expect(/waitForSentinel\s*\(/.test(code)).toBe(true);
    expect(/removeSentinel\s*\(/.test(code)).toBe(true);
    expect(/unlinkSync/.test(code)).toBe(true);
  });

  it("aborts without reading the page when the sentinel never appears", () => {
    expect(/sentinel-timeout/.test(code)).toBe(true);
  });
});
