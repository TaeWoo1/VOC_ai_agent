import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = join(__dirname, "..", "..", "src", "cli", "continue-account-store-same-session.ts");

/** Remove block + line comments so the guards check executable source, not prose. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const code = stripComments(readFileSync(CLI_PATH, "utf8"));

describe("continue-account-store-same-session — the CLI orchestrates; it never clicks itself", () => {
  it("delegates the single click to the boundary (the CLI drives nothing)", () => {
    expect(code.includes("continueAtCardOnce(")).toBe(true);
    expect(/\.(click|fill|press|selectOption|check|dispatchEvent|tap)\s*\(/.test(code)).toBe(false);
  });

  it("never triggers/captures an export, uploads, downloads, or writes status", () => {
    expect(code.includes("runExport")).toBe(false);
    expect(code.includes("uploadReviewFile")).toBe(false);
    expect(/\bupload\w*\s*\(/.test(code)).toBe(false);
    expect(/waitForEvent\s*\(/.test(code)).toBe(false);
    expect(/saveAs/.test(code)).toBe(false);
    expect(code.includes("writeStatus")).toBe(false);
    expect(code.includes("LAST_SUCCESS")).toBe(false);
  });

  it("never dumps raw HTML; the single goto is the initial route open", () => {
    expect(/\.content\s*\(/.test(code)).toBe(false);
    expect((code.match(/\.goto\s*\(/g) ?? []).length).toBe(1);
  });
});

describe("continue-account-store-same-session — fail-closed gates BEFORE any action", () => {
  it("refuses to act without the explicit per-run approval flag, checked first", () => {
    expect(/hasLiveRunApproval\s*\(/.test(code)).toBe(true);
    expect(/approvalRequiredMessage\s*\(/.test(code)).toBe(true);
    const approvalIdx = code.indexOf("hasLiveRunApproval(");
    const actIdx = code.indexOf("continueAtCardOnce(");
    expect(approvalIdx).toBeGreaterThanOrEqual(0);
    expect(approvalIdx).toBeLessThan(actIdx);
  });

  it("fails closed without STORAGE_PROBE_SALT, before any surface read/click", () => {
    expect(code.includes("storageProbeSalt")).toBe(true);
    const saltIdx = code.indexOf("storageProbeSalt");
    const actIdx = code.indexOf("continueAtCardOnce(");
    expect(saltIdx).toBeLessThan(actIdx);
  });

  it("REQUIRES NAVER_EXPECTED_CONTINUE_CARD_FINGERPRINT — without it nothing is clicked", () => {
    expect(/if\s*\(\s*!cfg\.naverExpectedContinueCardFingerprint\s*\)/.test(code)).toBe(true);
    const fpIdx = code.indexOf("naverExpectedContinueCardFingerprint");
    const actIdx = code.indexOf("continueAtCardOnce(");
    expect(fpIdx).toBeGreaterThanOrEqual(0);
    expect(fpIdx).toBeLessThan(actIdx);
  });
});

describe("continue-account-store-same-session — auto-read default, sentinel opt-in", () => {
  it("defaults to auto-read (no human 'ready' prompt in the default path)", () => {
    expect(/const\s+sentinelMode\s*=/.test(code)).toBe(true);
    expect(code.includes("auto-read mode: will click only if READY_TO_CONTINUE and all guards pass")).toBe(true);
    // The default path settles the SPA, then the guarded boundary decides; no `noSentinel` gate.
    expect(/const\s+noSentinel\s*=/.test(code)).toBe(false);
    expect(/settleSpa\s*\(/.test(code)).toBe(true);
  });

  it("enables sentinel mode ONLY via --require-sentinel or --sentinel", () => {
    expect(/--require-sentinel/.test(code)).toBe(true);
    expect(
      /sentinelMode\s*=\s*\(?\s*args\.includes\("--require-sentinel"\)\s*\|\|\s*args\.includes\("--sentinel"\)/.test(
        code,
      ),
    ).toBe(true);
  });

  it("keeps --no-sentinel / --auto-read-after-hydration as backward-compatible auto-read aliases", () => {
    // Present in source AND they force auto-read (override sentinel mode if both are passed).
    expect(/--no-sentinel/.test(code)).toBe(true);
    expect(/--auto-read-after-hydration/.test(code)).toBe(true);
    expect(/!args\.includes\("--no-sentinel"\)/.test(code)).toBe(true);
  });

  it("**confirmation mode waits on a verified press, never on a file**", () => {
    // This CLI performs ONE real click when the state is unambiguous, so what stands in front of that click has
    // to be something a model cannot produce. It used to be a `.ready` file whose own prompt told the operator
    // that in Claude Code they could "just say ready and Claude creates it".
    expect(/attachOperatorConfirmTab\s*\(/.test(code)).toBe(true);
    expect(code.includes("confirmHost.confirm(CONFIRM_ASK)")).toBe(true);
    expect(/sentinelPathFor\s*\(/.test(code)).toBe(false);
    expect(/waitForSentinel\s*\(/.test(code)).toBe(false);
    expect(/probe-sentinel/.test(code)).toBe(false);
    expect(code.includes("process.stdin")).toBe(false);
  });
});

describe("continue-account-store-same-session — sanitized report only", () => {
  it("prints the boundary's sanitized outcome + state (no raw values)", () => {
    expect(
      /JSON\.stringify\(\s*\{[\s\S]*outcome:[\s\S]*clicked[\s\S]*signals[\s\S]*continuationCard[\s\S]*continueControls[\s\S]*postClick[\s\S]*\}/.test(
        code,
      ),
    ).toBe(true);
  });
});
