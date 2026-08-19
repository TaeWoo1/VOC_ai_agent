import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = join(__dirname, "..", "..", "instruments", "calibration", "probe-session-precondition-same-session.ts");

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
    expect(/from\s+["']\.\.\/\.\.\/src\/status["']/.test(imports)).toBe(false);
    expect(/from\s+["'][^"']*\/engine["']/.test(imports)).toBe(false);
    expect(/from\s+["'][^"']*action-window\/session["']/.test(imports)).toBe(false);
    expect(/from\s+["'][^"']*quarantine[^"']*["']/.test(imports)).toBe(false);
    expect(/from\s+["'][^"']*ingest-handoff[^"']*["']/.test(imports)).toBe(false);
    expect(/from\s+["'][^"']*naver-driver["']/.test(imports)).toBe(false);
    expect(/from\s+["'][^"']*export-classify["']/.test(imports)).toBe(false);
  });

  it("imports ONLY the read-only verdict seam + the pure precondition mapping", () => {
    expect(/from\s+["']\.\.\/\.\.\/src\/naver\/session-check["']/.test(code)).toBe(true);
    expect(/checkLiveSessionVerdict/.test(code)).toBe(true);
    expect(/from\s+["']\.\.\/\.\.\/src\/action-window\/naver-session-precondition["']/.test(code)).toBe(true);
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
    expect(/from\s+["']\.\.\/\.\.\/src\/cli\/live-run-approval["']/.test(code)).toBe(true);
  });
});

describe("probe-session-precondition-same-session — the continuation is a verified press, not a file", () => {
  const code = stripComments(readFileSync(CLI_PATH, "utf8"));

  it("does not depend on terminal stdin / an Enter keypress", () => {
    expect(code.includes("process.stdin")).toBe(false);
    expect(/waitForEnter/.test(code)).toBe(false);
  });

  it("**takes no readiness signal from the filesystem at all**", () => {
    // It used to wait on a `.ready` file, and its own printed prompt told the operator that in Claude Code they
    // could "just say ready and Claude creates it". That is the channel that failed on 2026-08-13 — the
    // assistant created the file on the strength of a chat line nobody wrote.
    expect(/sentinelPathFor\s*\(/.test(code)).toBe(false);
    expect(/probe-sentinel/.test(code)).toBe(false);
    expect(/waitForSentinel\s*\(/.test(code)).toBe(false);
    expect(/existsSync/.test(code)).toBe(false);
    expect(/unlinkSync/.test(code)).toBe(false);
  });

  it("waits on the shared confirmation surface instead", () => {
    expect(/attachOperatorConfirmTab\s*\(/.test(code)).toBe(true);
    expect(code.includes("confirmHost.confirm(PROBE_ASK)")).toBe(true);
  });

  it("**reads nothing without a `ready` confirmation** — an abort or a timeout reads nothing at all", () => {
    const guard = code.indexOf('confirmation.signal !== "ready"');
    expect(guard).toBeGreaterThan(-1);
    expect(code.indexOf("checkLiveSessionVerdict(", guard)).toBeGreaterThan(guard);
  });

  it("the operator instruction no longer tells anyone to say `ready`", () => {
    const src = readFileSync(CLI_PATH, "utf8");
    expect(src).not.toContain('just say "ready"');
    expect(src).not.toContain("Sentinel file");
  });
});
