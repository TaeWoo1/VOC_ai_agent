import { describe, expect, it } from "vitest";
import type { FrameAwareExportScan } from "../../src/esm/esm-frame-scan";
import type { SanitizedEsmReviewClassification } from "../../src/esm/esm-review-live-scan";
import type { SanitizedEsmReviewProbeSignals } from "../../src/esm/esm-review-probe";
import {
  checkpointLabel,
  DEFAULT_LOGIN_TIMEOUT_MIN,
  DEFAULT_OFFSETS_MIN,
  ESM_TTL_RESULTS_FILENAME,
  esmTtlResultsPath,
  MAX_LOGIN_TIMEOUT_MIN,
  parseCheckpointOffsets,
  parseLoginTimeoutMin,
  runTtlCheckpoints,
  toCheckpointRow,
  TTL_CHECKPOINT_ROW_KEYS,
  type TtlCheckpointRow,
} from "../../src/esm/esm-ttl-schedule";
import { SessionVerdict } from "../../src/naver/session-verdict";

// ---- fixtures ------------------------------------------------------------

function classification(verdict: SessionVerdict): SanitizedEsmReviewClassification {
  const frameAware: FrameAwareExportScan = {
    frameCount: "few",
    frameUrlCategories: ["seller-center"],
    skippedFrameCount: "none",
    allowlistedFrameCount: "one",
    topDocument: { total: "few", visible: "none", enabled: "few", actionable: "none" },
    frames: [],
    hasActionableExportCandidate: verdict === "LOGGED_IN",
    actionableScope: verdict === "LOGGED_IN" ? "allowlisted-frame" : "none",
  };
  const signals = {
    sessionVerdict: verdict,
    manageFeedbackRouteLike: true,
    asyncMarkerPresent: false,
    exportLayoutHint: "SYNC_LIKELY",
  } as unknown as SanitizedEsmReviewProbeSignals;
  return { domSettle: "stable-no-networkidle", allowlistConfigured: true, signals, frameAware };
}

const row = (label: string, verdict: SessionVerdict): TtlCheckpointRow =>
  toCheckpointRow(label, classification(verdict));

// ---- parseCheckpointOffsets ---------------------------------------------

describe("parseCheckpointOffsets", () => {
  it("defaults to T+120m / T+190m", () => {
    expect(parseCheckpointOffsets(["--i-understand-this-opens-live-esm"])).toEqual([...DEFAULT_OFFSETS_MIN]);
  });
  it("--after-minutes overrides (DEV dry-run)", () => {
    expect(parseCheckpointOffsets(["--after-minutes", "1,2"])).toEqual([1, 2]);
    expect(parseCheckpointOffsets(["--after-minutes=2,1,2"])).toEqual([1, 2]); // dedup + sort
  });
  it("--t4h appends 240", () => {
    expect(parseCheckpointOffsets(["--t4h"])).toEqual([120, 190, 240]);
  });
  it("malformed --after-minutes falls back to default", () => {
    expect(parseCheckpointOffsets(["--after-minutes", "abc"])).toEqual([...DEFAULT_OFFSETS_MIN]);
    expect(parseCheckpointOffsets(["--after-minutes", "0,-3"])).toEqual([...DEFAULT_OFFSETS_MIN]);
  });
});

// ---- parseLoginTimeoutMin (pre-T0 handoff window only) ------------------

describe("parseLoginTimeoutMin", () => {
  it("defaults to 30 minutes when not provided", () => {
    expect(parseLoginTimeoutMin(["--i-understand-this-opens-live-esm"])).toBe(DEFAULT_LOGIN_TIMEOUT_MIN);
    expect(DEFAULT_LOGIN_TIMEOUT_MIN).toBe(30);
  });
  it("parses --login-timeout-min N and =N", () => {
    expect(parseLoginTimeoutMin(["--login-timeout-min", "45"])).toBe(45);
    expect(parseLoginTimeoutMin(["--login-timeout-min=5"])).toBe(5);
  });
  it("rejects invalid values → default (non-numeric, zero, negative, missing arg)", () => {
    expect(parseLoginTimeoutMin(["--login-timeout-min", "abc"])).toBe(DEFAULT_LOGIN_TIMEOUT_MIN);
    expect(parseLoginTimeoutMin(["--login-timeout-min", "0"])).toBe(DEFAULT_LOGIN_TIMEOUT_MIN);
    expect(parseLoginTimeoutMin(["--login-timeout-min", "-3"])).toBe(DEFAULT_LOGIN_TIMEOUT_MIN);
    expect(parseLoginTimeoutMin(["--login-timeout-min"])).toBe(DEFAULT_LOGIN_TIMEOUT_MIN);
  });
  it("clamps to MAX so it never waits forever", () => {
    expect(parseLoginTimeoutMin(["--login-timeout-min", "100000"])).toBe(MAX_LOGIN_TIMEOUT_MIN);
  });
  it("is independent of the checkpoint offsets", () => {
    const args = ["--login-timeout-min", "30", "--after-minutes", "120,190", "--t4h"];
    expect(parseLoginTimeoutMin(args)).toBe(30);
    expect(parseCheckpointOffsets(args)).toEqual([120, 190, 240]); // unchanged
  });
});

// ---- toCheckpointRow -----------------------------------------------------

describe("toCheckpointRow", () => {
  it("projects only the sanitized allow-listed keys", () => {
    const r = row("T0", "LOGGED_IN");
    expect(Object.keys(r).sort()).toEqual([...TTL_CHECKPOINT_ROW_KEYS].sort());
  });
  it("LOGGED_IN → stop null", () => {
    expect(row("T0", "LOGGED_IN").stop).toBeNull();
  });
  it("a non-LOGGED_IN verdict sets a sanitized stop reason", () => {
    expect(row("T+190m", "ACCOUNT_LOGIN_REQUIRED").stop).toBe("session-not-logged-in");
    expect(row("T+190m", "AUTH_CHALLENGE_REQUIRED").stop).toBe("session-not-logged-in");
  });
  it("carries no DOM text / URL", () => {
    const serialized = JSON.stringify(row("T0", "LOGGED_IN"));
    expect(/[가-힣]/.test(serialized)).toBe(false);
    expect(serialized).not.toContain("http");
  });
});

// ---- runTtlCheckpoints (injected sleep + classify) ----------------------

describe("runTtlCheckpoints — schedule order, deltas, early-stop", () => {
  it("runs T0 → T+120m → T+190m in order with DELTA sleeps (no real timers)", async () => {
    const calls: string[] = [];
    const sleeps: number[] = [];
    const rows = await runTtlCheckpoints({
      offsetsMin: [120, 190],
      classifyAt: async (label) => {
        calls.push(label);
        return row(label, "LOGGED_IN");
      },
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    expect(calls).toEqual(["T0", "T+120m", "T+190m"]);
    expect(sleeps).toEqual([120 * 60_000, 70 * 60_000]); // delta from previous offset
    expect(rows.map((r) => r.label)).toEqual(["T0", "T+120m", "T+190m"]);
  });

  it("stops immediately when T0 is not logged in (no sleeps, no further reads)", async () => {
    const sleeps: number[] = [];
    const rows = await runTtlCheckpoints({
      offsetsMin: [120, 190],
      classifyAt: async (label) => row(label, "ACCOUNT_LOGIN_REQUIRED"),
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.label).toBe("T0");
    expect(sleeps).toEqual([]);
  });

  it("stops at the first expired checkpoint and does not sleep past it", async () => {
    const sleeps: number[] = [];
    const rows = await runTtlCheckpoints({
      offsetsMin: [120, 190],
      classifyAt: async (label) => row(label, label === "T+120m" ? "ACCOUNT_LOGIN_REQUIRED" : "LOGGED_IN"),
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    expect(rows.map((r) => r.label)).toEqual(["T0", "T+120m"]);
    expect(rows[1]!.stop).toBe("session-not-logged-in");
    expect(sleeps).toEqual([120 * 60_000]); // only the T0→T+120m delta; never the T+190m delta
  });

  it("checkpointLabel formats minutes", () => {
    expect(checkpointLabel(190)).toBe("T+190m");
  });
});

// ---- incremental persistence (onCheckpoint) -----------------------------

describe("esmTtlResultsPath", () => {
  it("resolves the fixed JSONL filename under the status (.status) directory", () => {
    const p = esmTtlResultsPath("/x/y/.status/naver.json");
    expect(p).toBe("/x/y/.status/esm-session-ttl-probe.jsonl");
    expect(p.endsWith(`/${ESM_TTL_RESULTS_FILENAME}`)).toBe(true);
    expect(/\/\.status\//.test(p)).toBe(true);
  });
});

describe("runTtlCheckpoints — onCheckpoint incremental persistence", () => {
  it("awaits onCheckpoint after EACH row, BEFORE the next sleep", async () => {
    const events: string[] = [];
    await runTtlCheckpoints({
      offsetsMin: [120, 190],
      classifyAt: async (label) => {
        events.push(`classify:${label}`);
        return row(label, "LOGGED_IN");
      },
      sleep: async (ms) => {
        events.push(`sleep:${ms}`);
      },
      onCheckpoint: (r) => {
        events.push(`persist:${r.label}`);
      },
    });
    expect(events).toEqual([
      "classify:T0",
      "persist:T0",
      "sleep:7200000",
      "classify:T+120m",
      "persist:T+120m",
      "sleep:4200000",
      "classify:T+190m",
      "persist:T+190m",
    ]);
  });

  it("partial recovery: completed checkpoints are persisted BEFORE a later one throws", async () => {
    const persisted: string[] = [];
    await expect(
      runTtlCheckpoints({
        offsetsMin: [120, 190],
        classifyAt: async (label) => {
          if (label === "T+120m") throw new Error("context died");
          return row(label, "LOGGED_IN");
        },
        sleep: async () => {},
        onCheckpoint: (r) => {
          persisted.push(r.label);
        },
      }),
    ).rejects.toThrow();
    expect(persisted).toEqual(["T0"]); // T0 was durably handed off before T+120m failed
  });

  it("persists the stop row before halting on an expired session", async () => {
    const persisted: string[] = [];
    const rows = await runTtlCheckpoints({
      offsetsMin: [120, 190],
      classifyAt: async (label) => row(label, "ACCOUNT_LOGIN_REQUIRED"),
      sleep: async () => {},
      onCheckpoint: (r) => {
        persisted.push(r.label);
      },
    });
    expect(rows.map((r) => r.label)).toEqual(["T0"]);
    expect(persisted).toEqual(["T0"]);
  });

  it("each persisted row is sanitized (no URL/host/DOM text)", async () => {
    const lines: string[] = [];
    await runTtlCheckpoints({
      offsetsMin: [1],
      classifyAt: async (label) => row(label, "LOGGED_IN"),
      sleep: async () => {},
      onCheckpoint: (r) => {
        lines.push(JSON.stringify(r));
      },
    });
    for (const line of lines) {
      expect(line).not.toContain("http");
      expect(/[가-힣]/.test(line)).toBe(false);
      expect(Object.keys(JSON.parse(line)).sort()).toEqual([...TTL_CHECKPOINT_ROW_KEYS].sort());
    }
  });
});
