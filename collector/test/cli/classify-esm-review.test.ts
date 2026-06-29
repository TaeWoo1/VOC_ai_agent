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

  it("imports ONLY the pure probe for classification (no capture/upload/status module)", () => {
    const importLines = code
      .split("\n")
      .filter((l) => /^\s*import\b/.test(l) || /\bfrom\s+["']/.test(l));
    const imports = importLines.join("\n");
    expect(/from\s+["']\.\.\/esm\/esm-review-probe["']/.test(imports)).toBe(true);
    expect(/extractEsmReviewProbeSignals/.test(code)).toBe(true);
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

  it("uses the pure visibility cross-check (robust beyond offsetParent), no-click", () => {
    expect(/from\s+["']\.\.\/esm\/esm-export-visibility["']/.test(code)).toBe(true);
    expect(/summarizeExportCandidateVisibility\s*\(/.test(code)).toBe(true);
    // The robust cross-check reads computed style + geometry (never clicks).
    expect(/getComputedStyle\s*\(/.test(code)).toBe(true);
    expect(/getBoundingClientRect\s*\(/.test(code)).toBe(true);
    // Still derives actionability — and feeds it to the probe as a count, not by acting.
    expect(/exportCandidateActionable/.test(code)).toBe(true);
  });

  it("uses a BOUNDED DOM-settle (no unbounded wait), reading only an element count", () => {
    expect(/settleDom\s*\(/.test(code)).toBe(true);
    expect(/STABILITY_MAX_CHECKS/.test(code)).toBe(true);
    // The stability poll reads a numeric element count, never DOM text/content.
    expect(/querySelectorAll\(["']\*["']\)\.length/.test(code)).toBe(true);
  });

  it("scans SAME-ORIGIN child frames read-only and keeps top/frame scopes separate", () => {
    expect(/from\s+["']\.\.\/esm\/esm-frame-scan["']/.test(code)).toBe(true);
    expect(/summarizeFrameAwareExportScan\s*\(/.test(code)).toBe(true);
    expect(/scanFramesForExport\s*\(/.test(code)).toBe(true);
    // Frame reads go through frame.evaluate (read-only) — never a click/fill/dispatch.
    expect(/\.evaluate\s*\(\s*candidateScanInFrame\s*\)/.test(code)).toBe(true);
    // Same-origin policy is enforced; cross-origin frames are skipped, not entered.
    expect(/sameOrigin\s*\(/.test(code)).toBe(true);
    expect(/skipped-cross-origin/.test(code)).toBe(true);
    // Frame URLs are categorized, never echoed raw.
    expect(/esmUrlCategory\s*\(\s*frame\.url\(\)\s*\)/.test(code)).toBe(true);
  });

  it("reads cross-origin frames ONLY via the operator-configured ESM-family allowlist", () => {
    // The allowlist comes from config (fail-closed when unset) and is checked per frame.
    expect(/frameHostAllowed\s*\(/.test(code)).toBe(true);
    expect(/cfg\.esmFrameOriginAllowlist/.test(code)).toBe(true);
    // It never reaches a cross-origin frame except through the allowlist gate.
    expect(/frameHostAllowed\s*\(\s*frame\.url\(\)\s*,\s*allowlist\s*\)/.test(code)).toBe(true);
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
