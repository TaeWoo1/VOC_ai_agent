// Coupang first-connection tutorial engine — pure-logic unit tests (no DOM).
import { describe, it, expect } from "vitest";
import type { SyncRunView } from "./types";
import {
  INITIAL_COUPANG_STATE,
  coupangTutorialReducer,
  syncStatusFromRun,
  latestOrderRun,
  resolvePhase,
  activeStep,
  stepModel,
  recoveryCopy,
  COUPANG_STEP_LABELS,
  type CoupangState,
} from "./coupangTutorial";

function run(overrides: Partial<SyncRunView>): SyncRunView {
  return {
    id: "run-1",
    sellerAccountId: "acc-1",
    channelId: "coupang-ch",
    dataType: "ORDER_SUMMARY",
    trigger: "MANUAL",
    attempt: 1,
    rateLimited: false,
    nextRetryAt: null,
    jobType: "SYNC",
    uploadType: null,
    status: "SUCCESS",
    totalRows: 10,
    successRows: 10,
    skippedRows: 0,
    failedRows: 0,
    errorMessage: null,
    startedAt: "2026-08-06T00:00:00Z",
    finishedAt: "2026-08-06T00:01:00Z",
    ...overrides,
  };
}

describe("coupangTutorialReducer", () => {
  it("resolves the initial phase only from resolving, then ignores further RESOLVED", () => {
    const s1 = coupangTutorialReducer(INITIAL_COUPANG_STATE, { type: "RESOLVED", phase: "connect" });
    expect(s1.phase).toBe("connect");
    const s2 = coupangTutorialReducer(s1, { type: "RESOLVED", phase: "connected" });
    expect(s2.phase).toBe("connect"); // no downgrade/upgrade after the live flow owns it
  });

  it("submit → test SUCCESS lands on PREPARING and does NOT auto-start the sync", () => {
    let s: CoupangState = { phase: "connect", reasonCode: null };
    s = coupangTutorialReducer(s, { type: "SUBMIT" });
    expect(s.phase).toBe("submitting");
    s = coupangTutorialReducer(s, { type: "TEST_RESULT", status: "SUCCESS", reasonCode: null });
    expect(s.phase).toBe("preparing"); // explicit CTA, never "syncing" here
  });

  it("submit → test FAILED carries the reason code into connect_error", () => {
    let s: CoupangState = { phase: "submitting", reasonCode: null };
    s = coupangTutorialReducer(s, {
      type: "TEST_RESULT",
      status: "FAILED",
      reasonCode: "CALL_ENVIRONMENT_MISMATCH",
    });
    expect(s).toEqual({ phase: "connect_error", reasonCode: "CALL_ENVIRONMENT_MISMATCH" });
  });

  it("a store/transport failure lands on connect_error with a null (generic) reason", () => {
    const s = coupangTutorialReducer({ phase: "submitting", reasonCode: null }, { type: "SUBMIT_FAILED" });
    expect(s).toEqual({ phase: "connect_error", reasonCode: null });
  });

  it("RETEST re-verifies from connect_error; REENTER re-opens the form", () => {
    const err: CoupangState = { phase: "connect_error", reasonCode: "INVALID_CREDENTIAL" };
    expect(coupangTutorialReducer(err, { type: "RETEST" }).phase).toBe("submitting");
    expect(coupangTutorialReducer(err, { type: "REENTER" })).toEqual({
      phase: "connect",
      reasonCode: null,
    });
  });

  it("RUN_SYNC starts the sync from preparing and from sync_error (retry)", () => {
    expect(coupangTutorialReducer({ phase: "preparing", reasonCode: null }, { type: "RUN_SYNC" }).phase).toBe(
      "syncing",
    );
    expect(
      coupangTutorialReducer({ phase: "sync_error", reasonCode: null }, { type: "RUN_SYNC" }).phase,
    ).toBe("syncing");
  });

  it("SYNC_RESULT: RUNNING keeps observing; SUCCESS/PARTIAL complete; FAILED → sync_error", () => {
    const syncing: CoupangState = { phase: "syncing", reasonCode: null };
    expect(coupangTutorialReducer(syncing, { type: "SYNC_RESULT", status: "RUNNING" })).toBe(syncing);
    expect(coupangTutorialReducer(syncing, { type: "SYNC_RESULT", status: "SUCCESS" }).phase).toBe("connected");
    expect(coupangTutorialReducer(syncing, { type: "SYNC_RESULT", status: "PARTIAL" }).phase).toBe("connected");
    expect(coupangTutorialReducer(syncing, { type: "SYNC_RESULT", status: "FAILED" }).phase).toBe("sync_error");
  });

  it("ignores out-of-phase events (fail-safe, no throw)", () => {
    const connected: CoupangState = { phase: "connected", reasonCode: null };
    expect(coupangTutorialReducer(connected, { type: "SUBMIT" })).toBe(connected);
    expect(coupangTutorialReducer(connected, { type: "RUN_SYNC" })).toBe(connected);
    // A double-click SUBMIT while already submitting is a no-op (guard the second fire).
    const submitting: CoupangState = { phase: "submitting", reasonCode: null };
    expect(coupangTutorialReducer(submitting, { type: "SUBMIT" })).toBe(submitting);
  });
});

describe("syncStatusFromRun", () => {
  it("maps known statuses through and fails closed to RUNNING", () => {
    expect(syncStatusFromRun(run({ status: "SUCCESS" }))).toBe("SUCCESS");
    expect(syncStatusFromRun(run({ status: "PARTIAL" }))).toBe("PARTIAL");
    expect(syncStatusFromRun(run({ status: "FAILED" }))).toBe("FAILED");
    expect(syncStatusFromRun(run({ status: "RUNNING" }))).toBe("RUNNING");
    expect(syncStatusFromRun(run({ status: "QUEUED" }))).toBe("RUNNING"); // unknown → non-advancing
    expect(syncStatusFromRun(null)).toBe("RUNNING");
  });
});

describe("latestOrderRun", () => {
  it("picks the newest ORDER_SUMMARY run for the account, ignoring others", () => {
    const runs: SyncRunView[] = [
      run({ id: "old", finishedAt: "2026-08-05T00:00:00Z" }),
      run({ id: "new", finishedAt: "2026-08-06T12:00:00Z", status: "RUNNING", startedAt: "2026-08-06T11:59:00Z" }),
      run({ id: "other-acct", sellerAccountId: "acc-2" }),
      run({ id: "other-type", dataType: "REVIEW" }),
    ];
    expect(latestOrderRun(runs, "acc-1")?.id).toBe("new");
  });

  it("returns null when the account has no ORDER_SUMMARY run", () => {
    expect(latestOrderRun([run({ dataType: "REVIEW" })], "acc-1")).toBeNull();
    expect(latestOrderRun([], "acc-1")).toBeNull();
  });

  it("falls back to startedAt when finishedAt is absent (a running job)", () => {
    const runs: SyncRunView[] = [
      run({ id: "done", finishedAt: "2026-08-06T00:00:00Z", startedAt: "2026-08-05T23:00:00Z" }),
      run({ id: "running", status: "RUNNING", finishedAt: null, startedAt: "2026-08-06T09:00:00Z" }),
    ];
    expect(latestOrderRun(runs, "acc-1")?.id).toBe("running");
  });
});

describe("resolvePhase (refresh / leave recovery)", () => {
  const base = { ready: true, credentialPresent: false, latestSyncStatus: null as null };

  it("no account → connect", () => {
    expect(resolvePhase({ ...base, connectionStatus: null })).toBe("connect");
  });

  it("credential on file but not PREPARING → connect_error (unverified, no invented reason)", () => {
    expect(resolvePhase({ ...base, connectionStatus: "PENDING", credentialPresent: true })).toBe("connect_error");
    expect(resolvePhase({ ...base, connectionStatus: "RECONNECT_REQUIRED", credentialPresent: true })).toBe(
      "connect_error",
    );
  });

  it("PREPARING with no run → preparing (the first-sync CTA)", () => {
    expect(resolvePhase({ ...base, connectionStatus: "PREPARING", credentialPresent: true })).toBe("preparing");
  });

  it("PREPARING with a RUNNING run → syncing (resume observing, never re-trigger)", () => {
    expect(
      resolvePhase({ ...base, connectionStatus: "PREPARING", credentialPresent: true, latestSyncStatus: "RUNNING" }),
    ).toBe("syncing");
  });

  it("PREPARING with a FAILED run → sync_error (offer retry)", () => {
    expect(
      resolvePhase({ ...base, connectionStatus: "PREPARING", credentialPresent: true, latestSyncStatus: "FAILED" }),
    ).toBe("sync_error");
  });

  it("CONNECTED → connected regardless of run detail", () => {
    expect(resolvePhase({ ...base, connectionStatus: "CONNECTED", credentialPresent: true })).toBe("connected");
  });

  it("channel/template not ready → unavailable", () => {
    expect(resolvePhase({ ...base, ready: false, connectionStatus: null })).toBe("unavailable");
  });
});

describe("stepModel / activeStep", () => {
  it("advances the active step across the journey", () => {
    expect(activeStep("connect")).toBe(3);
    expect(activeStep("submitting")).toBe(3);
    expect(activeStep("connect_error")).toBe(3);
    expect(activeStep("preparing")).toBe(4);
    expect(activeStep("syncing")).toBe(5);
    expect(activeStep("sync_error")).toBe(5);
    expect(activeStep("connected")).toBe(6);
  });

  it("marks steps before the active one done, the active current, the rest upcoming", () => {
    const m = stepModel("preparing"); // active 4
    expect(m).toHaveLength(COUPANG_STEP_LABELS.length);
    expect(m[2].state).toBe("done"); // step 3
    expect(m[3].state).toBe("current"); // step 4
    expect(m[4].state).toBe("upcoming"); // step 5
  });

  it("connected marks every step done", () => {
    expect(stepModel("connected").every((s) => s.state === "done")).toBe(true);
  });
});

describe("recoveryCopy", () => {
  it("maps each known reason code to distinct, actionable guidance", () => {
    expect(recoveryCopy("INVALID_CREDENTIAL").allowReenter).toBe(true);
    expect(recoveryCopy("INVALID_CREDENTIAL").showIpPanel).toBe(false);
    expect(recoveryCopy("CALL_ENVIRONMENT_MISMATCH").showIpPanel).toBe(true);
    expect(recoveryCopy("ORDER_ACCESS_DENIED").showIpPanel).toBe(true);
    expect(recoveryCopy("PROVIDER_UNAVAILABLE").showIpPanel).toBe(false);
  });

  it("falls back to the generic recovery for null/unknown codes", () => {
    const generic = recoveryCopy(null);
    expect(generic.title).toBe("연결을 확인하지 못했어요");
    expect(recoveryCopy("SOMETHING_NEW")).toEqual(generic);
  });

  it("never surfaces the internal returnShippingCenters/ordersheets fallback in any recovery copy", () => {
    for (const code of [
      "INVALID_CREDENTIAL",
      "CALL_ENVIRONMENT_MISMATCH",
      "ORDER_ACCESS_DENIED",
      "PROVIDER_UNAVAILABLE",
      null,
    ]) {
      const c = recoveryCopy(code);
      const blob = `${c.title} ${c.body} ${c.retestLabel}`;
      expect(blob).not.toMatch(/returnShippingCenter|ordersheet|400/i);
    }
  });
});
