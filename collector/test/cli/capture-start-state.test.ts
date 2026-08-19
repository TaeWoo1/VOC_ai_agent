import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { waitForCaptureStartState } from "../../instruments/calibration/capture-start-state";
import type { SessionVerdict } from "../../src/naver/session-verdict";
import type { PwPage } from "../../src/profile";

const PAGE = {} as unknown as PwPage;
const noSleep = (): Promise<void> => Promise.resolve();

/** A verdict reader that yields the given sequence (last value repeats once exhausted). */
function verdictSequence(seq: SessionVerdict[]): () => Promise<SessionVerdict> {
  let i = 0;
  return () => {
    const v = seq[Math.min(i, seq.length - 1)] as SessionVerdict;
    i += 1;
    return Promise.resolve(v);
  };
}

const opts = (over: Partial<Parameters<typeof waitForCaptureStartState>[1]> = {}) => ({
  timeoutMs: 10_000,
  intervalMs: 1_000,
  settleFn: vi.fn().mockResolvedValue(undefined),
  checkVerdictFn: verdictSequence(["UNKNOWN"]),
  sleepFn: noSleep,
  ...over,
});

describe("waitForCaptureStartState — stops on a resolvable start verdict", () => {
  it("returns RESOLVABLE immediately on LOGGED_IN (checks=1)", async () => {
    const settleFn = vi.fn().mockResolvedValue(undefined);
    const res = await waitForCaptureStartState(PAGE, opts({ settleFn, checkVerdictFn: verdictSequence(["LOGGED_IN"]) }));
    expect(res.kind).toBe("RESOLVABLE");
    expect(res.verdict).toBe("LOGGED_IN");
    expect(res.checks).toBe(1);
    expect(settleFn).toHaveBeenCalledTimes(1);
  });

  it("returns RESOLVABLE immediately on RECONNECT_REQUIRED", async () => {
    const res = await waitForCaptureStartState(
      PAGE,
      opts({ checkVerdictFn: verdictSequence(["RECONNECT_REQUIRED"]) }),
    );
    expect(res.kind).toBe("RESOLVABLE");
    expect(res.verdict).toBe("RECONNECT_REQUIRED");
  });
});

describe("waitForCaptureStartState — waits through transient human-clearable states", () => {
  it("waits through login/auth/unknown, then resolves on RECONNECT_REQUIRED", async () => {
    const res = await waitForCaptureStartState(
      PAGE,
      opts({
        checkVerdictFn: verdictSequence([
          "ACCOUNT_LOGIN_REQUIRED",
          "AUTH_CHALLENGE_REQUIRED",
          "UNKNOWN",
          "RECONNECT_REQUIRED",
        ]),
      }),
    );
    expect(res.kind).toBe("RESOLVABLE");
    expect(res.verdict).toBe("RECONNECT_REQUIRED");
    expect(res.checks).toBe(4);
  });

  it("waits through login/auth/unknown, then resolves on LOGGED_IN", async () => {
    const res = await waitForCaptureStartState(
      PAGE,
      opts({
        checkVerdictFn: verdictSequence(["ACCOUNT_LOGIN_REQUIRED", "UNKNOWN", "LOGGED_IN"]),
      }),
    );
    expect(res.kind).toBe("RESOLVABLE");
    expect(res.verdict).toBe("LOGGED_IN");
    expect(res.checks).toBe(3);
  });

  it("treats a transient mid-navigation throw as 'keep waiting', then resolves", async () => {
    let i = 0;
    const checkVerdictFn = (): Promise<SessionVerdict> => {
      i += 1;
      if (i === 1) return Promise.reject(new Error("navigating"));
      return Promise.resolve("LOGGED_IN");
    };
    const res = await waitForCaptureStartState(PAGE, opts({ checkVerdictFn }));
    expect(res.kind).toBe("RESOLVABLE");
    expect(res.verdict).toBe("LOGGED_IN");
    expect(res.checks).toBe(2);
  });
});

describe("waitForCaptureStartState — bounded timeout halts honestly", () => {
  it("returns TIMEOUT when no resolvable state ever appears (no infinite wait)", async () => {
    const checkVerdictFn = vi.fn(() => Promise.resolve<SessionVerdict>("UNKNOWN"));
    const res = await waitForCaptureStartState(
      PAGE,
      opts({ timeoutMs: 5_000, intervalMs: 1_000, checkVerdictFn }),
    );
    expect(res.kind).toBe("TIMEOUT");
    expect(res.verdict).toBe("UNKNOWN");
    expect(res.checks).toBe(5);
  });

  it("keeps waiting on ACCOUNT_LOGIN_REQUIRED/AUTH_CHALLENGE_REQUIRED until timeout (never resolvable)", async () => {
    const res = await waitForCaptureStartState(
      PAGE,
      opts({
        timeoutMs: 3_000,
        intervalMs: 1_000,
        checkVerdictFn: verdictSequence(["ACCOUNT_LOGIN_REQUIRED", "AUTH_CHALLENGE_REQUIRED"]),
      }),
    );
    expect(res.kind).toBe("TIMEOUT");
    expect(res.checks).toBe(3);
  });
});

describe("capture-start-state.ts — source guard: read-only", () => {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const SRC = join(__dirname, "..", "..", "instruments", "calibration", "capture-start-state.ts");
  const code = readFileSync(SRC, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("never clicks, navigates, exports, downloads, uploads, or writes status", () => {
    expect(/\.(click|fill|press|selectOption|check|dispatchEvent|tap)\s*\(/.test(code)).toBe(false);
    expect(/\.goto\s*\(/.test(code)).toBe(false);
    expect(/runExport|uploadReviewFile|writeStatus|saveAs|waitForEvent/.test(code)).toBe(false);
  });
});
