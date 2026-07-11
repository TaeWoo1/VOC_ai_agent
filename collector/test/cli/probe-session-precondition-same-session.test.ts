import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = join(__dirname, "..", "..", "src", "cli", "probe-session-precondition-same-session.ts");

/** Remove block + line comments so the guard checks only executable source, not prose. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ") // /* block */
    .replace(/(^|[^:])\/\/.*$/gm, "$1"); // // line  (the [^:] guard spares "://" in URLs)
}

describe("probe-session-precondition-same-session — read-only, stops at the session check", () => {
  const code = stripComments(readFileSync(CLI_PATH, "utf8"));

  // This probe reports ONLY the session precondition. If any of these reappear, the
  // no-click / no-download / no-export / no-downstream guarantee is broken.
  const FORBIDDEN: ReadonlyArray<string> = [
    "review-export",
    "runExport",
    "saveAs",
    "upload",
    "quarantine",
    "ingest",
    "export-target-readiness",
    "evaluateExportTargetReadiness",
    "planExportAction",
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

  it("does not import export/capture, status, engine, session, quarantine, ingest, or driver modules", () => {
    const importLines = code
      .split("\n")
      .filter((l) => /^\s*import\b/.test(l) || /\bfrom\s+["']/.test(l));
    const imports = importLines.join("\n");
    expect(/review-export/.test(imports)).toBe(false);
    expect(/from\s+["'][^"']*upload[^"']*["']/.test(imports)).toBe(false);
    expect(/from\s+["']\.\.\/status["']/.test(imports)).toBe(false);
    expect(/from\s+["'][^"']*\/engine["']/.test(imports)).toBe(false);
    expect(/from\s+["'][^"']*action-window\/session["']/.test(imports)).toBe(false);
    expect(/from\s+["'][^"']*quarantine[^"']*["']/.test(imports)).toBe(false);
    expect(/from\s+["'][^"']*ingest-handoff[^"']*["']/.test(imports)).toBe(false);
    expect(/from\s+["'][^"']*naver-driver["']/.test(imports)).toBe(false);
    expect(/from\s+["'][^"']*export-classify["']/.test(imports)).toBe(false);
  });

  it("imports ONLY the read-only verdict seam + the pure precondition mapping", () => {
    expect(/from\s+["']\.\.\/naver\/session-check["']/.test(code)).toBe(true);
    expect(/checkLiveSessionVerdict/.test(code)).toBe(true);
    expect(/from\s+["']\.\.\/action-window\/naver-session-precondition["']/.test(code)).toBe(true);
    expect(/naverSessionPrecondition/.test(code)).toBe(true);
  });

  it("reads the page read-only — never clicks, fills, presses, or dispatches", () => {
    expect(/waitForEvent\s*\(\s*["']download["']\s*\)/.test(code)).toBe(false);
    expect(/\.(click|fill|press|selectOption|check|dispatchEvent)\s*\(/.test(code)).toBe(false);
  });

  it("prints only the sanitized precondition object, never the raw url/html", () => {
    expect(/console\.log\([^)]*page\.(url|content)/.test(code)).toBe(false);
    expect(/console\.log\(JSON\.stringify\(result/.test(code)).toBe(true);
  });

  it("is gated by the explicit per-run live-run approval flag", () => {
    expect(/hasLiveRunApproval\s*\(/.test(code)).toBe(true);
    expect(/from\s+["']\.\/live-run-approval["']/.test(code)).toBe(true);
  });
});

describe("probe-session-precondition-same-session — sentinel-file continuation (no terminal stdin)", () => {
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
