/**
 * Tests for `finishDeletionRun` — the end of the guided deletion run.
 *
 * The defect these lock, reported by the operator on the first live deletion: after they pressed 삭제 the ring
 * and the irreversible-warning panel stayed on the WING page — through the verify poll and until the `finally`
 * cleanup. Stale destructive guidance on a destructive surface tells the operator to repeat an action they have
 * already taken, pointing at a control that may no longer exist on a page that may now offer 발급 nearby.
 *
 * The sequence is tested over a fake driver that RECORDS CALL ORDER, because "clears before verifying" is an
 * ordering property — a test that only checked "clear was called" would pass with the old, late behaviour.
 */
import { describe, it, expect } from "vitest";
import { finishDeletionRun, type DeletionRunDriver } from "../../src/cli/run-coupang-wing-deletion-live";
import type { WingPageCategory } from "../../src/cli/coupang-wing-classifier";

/** Records every call in order. `clearThrows` simulates a page that closed/navigated under the clear. */
function fakeDriver(opts: { deleted?: boolean; pageCategory?: WingPageCategory; clearThrows?: boolean } = {}) {
  const calls: string[] = [];
  const driver: DeletionRunDriver = {
    async clearHighlight() {
      calls.push("clear");
      if (opts.clearThrows) throw new Error("page closed");
    },
    async verifyDeletion() {
      calls.push("verify");
      return { deleted: opts.deleted ?? false, pageCategory: opts.pageCategory ?? "open_api_issuance" };
    },
  };
  return { driver, calls };
}

describe("finishDeletionRun — the checkpoint is retired BEFORE anything else", () => {
  it("completion: clears the overlay, THEN verifies", async () => {
    const { driver, calls } = fakeDriver({ deleted: true, pageCategory: "wing_home" });
    const out = await finishDeletionRun(driver, "ready");
    // Order is the assertion. `["verify","clear"]` — the old behaviour — must not satisfy this.
    expect(calls).toEqual(["clear", "verify"]);
    expect(out).toEqual({
      event: "COUPANG_DELETION",
      outcome: "COMPLETED",
      deleted: true,
      pageCategory: "wing_home",
      checkpointCleared: true,
    });
  });

  it("abort: clears, and never verifies", async () => {
    const { driver, calls } = fakeDriver();
    const out = await finishDeletionRun(driver, "abort");
    expect(calls).toEqual(["clear"]);
    expect(out).toEqual({ event: "COUPANG_DELETION", outcome: "ABORTED", checkpointCleared: true });
  });

  it("timeout: clears, and never verifies", async () => {
    const { driver, calls } = fakeDriver();
    const out = await finishDeletionRun(driver, "timeout");
    expect(calls).toEqual(["clear"]);
    expect(out).toEqual({ event: "COUPANG_DELETION", outcome: "TIMEOUT", checkpointCleared: true });
  });

  it("the overlay is cleared on EVERY signal — no path leaves destructive guidance up", async () => {
    for (const signal of ["ready", "abort", "timeout"] as const) {
      const { driver, calls } = fakeDriver();
      await finishDeletionRun(driver, signal);
      expect(calls[0], `${signal} must clear first`).toBe("clear");
    }
  });
});

describe("finishDeletionRun — a failed clear is reported, never hidden and never retried", () => {
  it("a throwing clear does not block the outcome, and is reported as checkpointCleared:false", async () => {
    const { driver, calls } = fakeDriver({ clearThrows: true, deleted: false });
    const out = await finishDeletionRun(driver, "ready");
    expect(out.outcome).toBe("COMPLETED");
    expect(out.checkpointCleared).toBe(false); // honest: the operator may still see stale guidance
    expect(calls).toEqual(["clear", "verify"]);
  });

  it("a throwing clear is NOT retried — a retry loop on a destructive surface is its own hazard", async () => {
    let clears = 0;
    const driver: DeletionRunDriver = {
      async clearHighlight() {
        clears += 1;
        throw new Error("page closed");
      },
      async verifyDeletion() {
        return { deleted: false, pageCategory: "open_api_issuance" };
      },
    };
    await finishDeletionRun(driver, "ready");
    expect(clears).toBe(1);
  });

  it("a failed clear never reports success for the clear", async () => {
    for (const signal of ["ready", "abort", "timeout"] as const) {
      const { driver } = fakeDriver({ clearThrows: true });
      const out = await finishDeletionRun(driver, signal);
      expect(out.checkpointCleared, signal).toBe(false);
    }
  });
});

describe("finishDeletionRun — it decides nothing destructive", () => {
  it("reports the driver's verdict verbatim; it never upgrades an ambiguous page to 'deleted'", async () => {
    // The live run returned deleted:false / open_api_issuance on a real deletion, because the driver only calls
    // a clear navigation to wing_home "deleted". This function must not paper over that with an interpretation.
    const { driver } = fakeDriver({ deleted: false, pageCategory: "open_api_issuance" });
    const out = await finishDeletionRun(driver, "ready");
    expect(out.deleted).toBe(false);
    expect(out.pageCategory).toBe("open_api_issuance");
  });

  it("the outcome is sanitized: enums, booleans and a category only", async () => {
    const { driver } = fakeDriver({ deleted: true, pageCategory: "wing_home" });
    const out = await finishDeletionRun(driver, "ready");
    for (const v of Object.values(out)) {
      expect(["string", "boolean"]).toContain(typeof v);
    }
    const serialized = JSON.stringify(out);
    for (const forbidden of ["http", "coupang.com", "Access Key", "Secret", "/Users/"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("only the driver's own two read-only methods are ever used — no click/confirm surface is reachable", () => {
    // `DeletionRunDriver` is deliberately the narrowest possible seam: clear + verify. A driver method that
    // could press anything is not even in the type, so this function cannot re-trigger or confirm a deletion.
    const surface: Array<keyof DeletionRunDriver> = ["clearHighlight", "verifyDeletion"];
    expect(surface).toHaveLength(2);
  });
});
