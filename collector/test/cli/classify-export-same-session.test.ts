import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = join(__dirname, "..", "..", "src", "cli", "classify-export-same-session.ts");

/** Remove block + line comments so the guard checks only executable source, not prose. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ") // /* block */
    .replace(/(^|[^:])\/\/.*$/gm, "$1"); // // line  (the [^:] guard spares "://" in URLs)
}

describe("classify-export-same-session — strict no-click boundary (cannot trigger/capture/upload)", () => {
  const code = stripComments(readFileSync(CLI_PATH, "utf8"));

  // This CLI proves the export LAYOUT without ever acting on the page. If any of these
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

  it("does not import the export-capture or status modules", () => {
    const importLines = code
      .split("\n")
      .filter((l) => /^\s*import\b/.test(l) || /\bfrom\s+["']/.test(l));
    const imports = importLines.join("\n");
    expect(/review-export/.test(imports)).toBe(false);
    expect(/from\s+["'][^"']*upload[^"']*["']/.test(imports)).toBe(false);
    expect(/from\s+["']\.\.\/status["']/.test(imports)).toBe(false);
  });

  it("imports only the PURE no-click planner for classification", () => {
    expect(/from\s+["']\.\.\/naver\/export-classify["']/.test(code)).toBe(true);
    expect(/planExportAction/.test(code)).toBe(true);
  });

  it("reads frames/DOM read-only — never clicks, fills, or dispatches", () => {
    expect(/waitForEvent\s*\(\s*["']download["']\s*\)/.test(code)).toBe(false);
    expect(/\.(click|fill|press|selectOption|check|dispatchEvent)\s*\(/.test(code)).toBe(false);
  });

  it("prints only the sanitized summary object, never the raw url/html", () => {
    expect(/console\.log\([^)]*page\.(url|content)/.test(code)).toBe(false);
    expect(/console\.log\(JSON\.stringify\(summary/.test(code)).toBe(true);
  });
});

describe("classify-export-same-session — the continuation is a verified press, not a file", () => {
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
    expect(code.includes("confirmHost.confirm(CONFIRM_ASK)")).toBe(true);
  });

  it("**reads nothing without a `ready` confirmation** — an abort or a timeout reads nothing at all", () => {
    const guard = code.indexOf('confirmation.signal !== "ready"');
    expect(guard).toBeGreaterThan(-1);
    expect(code.indexOf("planExportAction(", guard)).toBeGreaterThan(guard);
  });

  it("the operator instruction no longer tells anyone to say `ready`", () => {
    const src = readFileSync(CLI_PATH, "utf8");
    expect(src).not.toContain('just say "ready"');
    expect(src).not.toContain("Sentinel file");
  });
});
