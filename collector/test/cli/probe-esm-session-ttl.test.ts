import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, "..", "..", "instruments", "calibration", "probe-esm-session-ttl.ts");

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("probe-esm-session-ttl — keep-open, no-click, no-scheduler boundary", () => {
  const code = stripComments(readFileSync(CLI, "utf8"));

  it("requires the ESM live-approval flag", () => {
    expect(/hasEsmLiveApproval\s*\(/.test(code)).toBe(true);
    expect(/esmApprovalRequiredMessage\s*\(/.test(code)).toBe(true);
  });

  it("reuses the SHARED no-click classification + pure schedule (no duplicated scan logic)", () => {
    expect(/from\s+["']\.\.\/\.\.\/src\/esm\/esm-review-live-scan["']/.test(code)).toBe(true);
    expect(/classifyOpenEsmReviewPage\s*\(/.test(code)).toBe(true);
    expect(/from\s+["']\.\.\/\.\.\/src\/esm\/esm-ttl-schedule["']/.test(code)).toBe(true);
    expect(/runTtlCheckpoints\s*\(/.test(code)).toBe(true);
    expect(/parseCheckpointOffsets\s*\(/.test(code)).toBe(true);
    // No re-implemented scan mechanics in the CLI.
    expect(/getComputedStyle\s*\(/.test(code)).toBe(false);
    expect(/\.evaluate\s*\(/.test(code)).toBe(false);
  });

  it("uses a CONFIGURABLE login handoff timeout for the sentinel wait ONLY", () => {
    expect(/parseLoginTimeoutMin\s*\(/.test(code)).toBe(true);
    // The parsed minutes feed the sentinel wait, not the checkpoint offsets.
    expect(/waitForSentinel\s*\(\s*sentinelPath\s*,\s*loginTimeoutMs/.test(code)).toBe(true);
    // The old hardcoded 10-minute constant is gone.
    expect(/CONFIRM_TIMEOUT_MS/.test(code)).toBe(false);
    expect(/10\s*\*\s*60_000/.test(code)).toBe(false);
    // Checkpoint offsets still come from their own parser, untouched.
    expect(/parseCheckpointOffsets\s*\(/.test(code)).toBe(true);
  });

  it("a pre-T0 login timeout aborts BEFORE any checkpoint runs (JSONL stays empty)", () => {
    // The sentinel-timeout abort returns before the checkpoint loop, so onCheckpoint never
    // fires and the (truncated) results file remains empty.
    const abortIdx = code.indexOf("ttl-probe.aborted");
    const loopIdx = code.indexOf("runTtlCheckpoints(");
    expect(abortIdx).toBeGreaterThan(0);
    expect(loopIdx).toBeGreaterThan(abortIdx);
  });

  it("persists each checkpoint incrementally to a gitignored .status JSONL (partial-safe)", () => {
    expect(/from\s+["']\.\.\/\.\.\/src\/esm\/esm-ttl-schedule["']/.test(code)).toBe(true);
    expect(/esmTtlResultsPath\s*\(/.test(code)).toBe(true);
    // Fresh file at startup, then append each row the moment it completes (onCheckpoint).
    expect(/writeFileSync\s*\(/.test(code)).toBe(true);
    expect(/appendFileSync\s*\(\s*resultsPath/.test(code)).toBe(true);
    expect(/onCheckpoint/.test(code)).toBe(true);
    expect(/runTtlCheckpoints\s*\(\s*\{[^}]*onCheckpoint/.test(code)).toBe(true);
    // The appended line is the SANITIZED row, never raw page data.
    expect(/const line = JSON\.stringify\(row\)/.test(code)).toBe(true);
    expect(/appendFileSync\([^)]*page\.(url|content)/.test(code)).toBe(false);
  });

  it("keeps the SAME context open: closes exactly ONCE, in the final cleanup", () => {
    const closes = code.match(/ctx\.close\s*\(/g) ?? [];
    expect(closes.length).toBe(1);
    // The single close is in a finally block (the keep-open invariant).
    expect(/finally\s*\{[\s\S]*ctx\.close\s*\(/.test(code)).toBe(true);
  });

  it("NEVER clicks, waits for a download, saves, uploads, or writes status", () => {
    for (const token of [
      ".click(",
      ".fill(",
      ".press(",
      "dispatchEvent",
      'waitForEvent("download")',
      "waitForEvent('download')",
      "saveAs",
      "uploadReviewFile",
      "writeStatus",
      "runExport",
    ]) {
      expect(code.includes(token)).toBe(false);
    }
    expect(/from\s+["']\.\.\/\.\.\/src\/upload["']/.test(code)).toBe(false);
    expect(/from\s+["']\.\.\/\.\.\/src\/status["']/.test(code)).toBe(false);
  });

  it("uses NO production scheduler (no cron / setInterval / manualSync)", () => {
    for (const token of ["setInterval", "cron", "manualSync", "scheduler"]) {
      expect(code.includes(token)).toBe(false);
    }
    // The local timer line is a one-shot injected sleep (setTimeout), not a scheduler.
    expect(/setTimeout/.test(code)).toBe(true);
  });

  it("uses the separate ESM profile + ESM sentinel (not NAVER's)", () => {
    expect(/cfg\.esmProfileDir/.test(code)).toBe(true);
    expect(/esmSentinelPathFor\s*\(/.test(code)).toBe(true);
    expect(/cfg\.profileDir\b/.test(code)).toBe(false);
    expect(/probe-sentinel/.test(code)).toBe(false);
  });

  it("never prints env values; surfaces only presence/count + the sanitized table", () => {
    // allowlist is reported as a boolean + a count, never its entries.
    expect(/allowlistConfigured/.test(code)).toBe(true);
    expect(/allowlist\.length/.test(code)).toBe(true);
    expect(/console\.log\(JSON\.stringify\(/.test(code)).toBe(true);
    // Never logs the raw review URL or env values to stdout.
    expect(/console\.log\([^)]*esmReviewUrl/.test(code)).toBe(false);
    expect(/console\.log\([^)]*process\.env/.test(code)).toBe(false);
  });
});
