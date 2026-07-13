/**
 * Hermetic unit tests for the read-only EXPORT-SURFACE SETTLE primitive
 * (`src/naver/export-surface-settle.ts`). NO browser, NO network, NO live NAVER — the poll loop is
 * driven over an injected `readHtml` queue and an instant injected `sleepFn`, so hydration timing is
 * modelled deterministically. Covers the §8-11 render-timing fix: a surface that reads empty first and
 * then renders rows settles to READY; an explicit empty/range marker settles (halts) immediately; a
 * BARE empty container / ambiguous surface stays pending and only fails closed at timeout — the Run-1
 * false-positive-empty trap it deliberately avoids.
 */
import { describe, it, expect } from "vitest";
import {
  settleExportSurface,
  classifyExportSurfaceSettle,
  type ExportSurfaceSettleDeps,
} from "../../src/naver/export-surface-settle";
import { evaluateExportTargetReadiness, type ExportTargetReadiness } from "../../src/naver/export-target-readiness";

// --- surface fixtures (TEST inputs only) ---------------------------------------------------------
const ROWS = `<table><tbody><tr><td>합성 행 A</td></tr><tr><td>합성 행 B</td></tr></tbody></table>`;
const POSITIVE_COUNT = `<div>총 128건</div>`;
const EMPTY_CONTAINER = `<table><tbody></tbody></table>`; // zero_rows → PENDING (hydration trap)
const EMPTY_MARKER = `<div>검색 결과가 없습니다</div>`; // empty_state → trusted HALT
const NO_EXPORT_TARGET = `<div>엑셀다운로드 대상인 리뷰가 없습니다</div>`; // no_export_target → trusted HALT
const RANGE_REQUIRED = `<div>조회 기간을 선택해 주세요</div>`; // date_range_missing → trusted HALT
const AMBIGUOUS = `<div>지연 렌더 (로딩중)</div>`; // ambiguous → PENDING

/** An injected read-only content reader that yields each item in turn (last repeats); Errors reject. */
function queuedReader(items: Array<string | Error>) {
  let i = 0;
  const read = (): Promise<string> => {
    const item = items[Math.min(i, items.length - 1)];
    i += 1;
    return item instanceof Error ? Promise.reject(item) : Promise.resolve(item ?? "");
  };
  return { read, reads: () => i };
}

/** An instant sleep that records each requested delay, so the poll cadence can be asserted. */
function sleepSpy() {
  const delays: number[] = [];
  const fn = (ms: number): Promise<void> => {
    delays.push(ms);
    return Promise.resolve();
  };
  return { fn, delays };
}

/** Build settle deps with the real classifier, an instant sleep, and a queued reader by default. */
function deps(
  items: Array<string | Error>,
  over: Partial<ExportSurfaceSettleDeps> & { sleep?: ReturnType<typeof sleepSpy> } = {},
): ExportSurfaceSettleDeps {
  const reader = queuedReader(items);
  const sleep = over.sleep ?? sleepSpy();
  return {
    timeoutMs: over.timeoutMs ?? 100,
    intervalMs: over.intervalMs ?? 20,
    readHtml: over.readHtml ?? reader.read,
    sleepFn: over.sleepFn ?? sleep.fn,
    ...(over.evaluateReadinessFn ? { evaluateReadinessFn: over.evaluateReadinessFn } : {}),
  };
}

describe("classifyExportSurfaceSettle — decided vs still-hydrating", () => {
  const cases: Array<[string, ExportTargetReadiness, "ready" | "halt" | "pending"]> = [
    ["READY positive_rows", { decision: "READY", rowCountBucket: "few", reason: "positive_rows" }, "ready"],
    ["READY positive_count", { decision: "READY", rowCountBucket: "some", reason: "positive_count" }, "ready"],
    ["empty_state marker", { decision: "HALT", state: "EXPORT_TARGET_EMPTY", reason: "empty_state" }, "halt"],
    ["no_export_target marker", { decision: "HALT", state: "EXPORT_TARGET_EMPTY", reason: "no_export_target" }, "halt"],
    ["date_range_required", { decision: "HALT", state: "EXPORT_DATE_RANGE_REQUIRED", reason: "date_range_missing" }, "halt"],
    ["zero_rows bare container", { decision: "HALT", state: "EXPORT_TARGET_EMPTY", reason: "zero_rows" }, "pending"],
    ["ambiguous", { decision: "HALT", state: "EXPORT_TARGET_UNKNOWN", reason: "ambiguous" }, "pending"],
  ];
  for (const [name, readiness, expected] of cases) {
    it(`${name} → ${expected}`, () => {
      expect(classifyExportSurfaceSettle(readiness)).toBe(expected);
    });
  }

  it("the bare-empty-container (zero_rows) trap stays pending — NOT trusted as empty", () => {
    // This is the Run-1 false-positive-empty: a rendered <tbody> shell with no rows yet.
    expect(classifyExportSurfaceSettle(evaluateExportTargetReadiness(EMPTY_CONTAINER))).toBe("pending");
  });
});

describe("settleExportSurface — settles to READY as soon as rows render", () => {
  it("rows already present on the first read → ready immediately, no sleeps", async () => {
    const sleep = sleepSpy();
    const r = await settleExportSurface(deps([ROWS], { sleep }));
    expect(r.state).toBe("ready");
    expect(r.readiness.decision).toBe("READY");
    expect(r.checks).toBe(1);
    expect(r.elapsedMs).toBe(0);
    expect(r.timedOut).toBe(false);
    expect(sleep.delays).toEqual([]); // decided on check 1 — never waited
  });

  it("EMPTY first then rows hydrate → settles READY mid-window (the §8-11 fix)", async () => {
    const sleep = sleepSpy();
    const r = await settleExportSurface(deps([EMPTY_CONTAINER, EMPTY_CONTAINER, ROWS], { timeoutMs: 400, intervalMs: 20, sleep }));
    expect(r.state).toBe("ready");
    expect(r.readiness.decision).toBe("READY");
    expect(r.checks).toBe(3);
    expect(r.elapsedMs).toBe(40); // (3-1) × 20ms
    expect(r.timedOut).toBe(false);
    expect(sleep.delays).toEqual([20, 20]); // polled twice before rows appeared
  });

  it("a positive labeled count also settles READY", async () => {
    const r = await settleExportSurface(deps([POSITIVE_COUNT]));
    expect(r.state).toBe("ready");
    expect(r.readiness).toMatchObject({ decision: "READY", reason: "positive_count" });
  });
});

describe("settleExportSurface — an EXPLICIT empty/range marker settles (halts) immediately", () => {
  it("an empty-state marker halts on check 1 without polling the window", async () => {
    const sleep = sleepSpy();
    const r = await settleExportSurface(deps([EMPTY_MARKER], { sleep }));
    expect(r.state).toBe("halt");
    expect(r.readiness).toMatchObject({ decision: "HALT", state: "EXPORT_TARGET_EMPTY", reason: "empty_state" });
    expect(r.checks).toBe(1);
    expect(r.timedOut).toBe(false);
    expect(sleep.delays).toEqual([]); // a trusted empty is answered at once — the legacy poller would wait
  });

  it("a no-export-target marker halts immediately", async () => {
    const r = await settleExportSurface(deps([NO_EXPORT_TARGET]));
    expect(r.state).toBe("halt");
    expect(r.readiness).toMatchObject({ state: "EXPORT_TARGET_EMPTY", reason: "no_export_target" });
    expect(r.checks).toBe(1);
  });

  it("a required-date-range instruction halts immediately", async () => {
    const r = await settleExportSurface(deps([RANGE_REQUIRED]));
    expect(r.state).toBe("halt");
    expect(r.readiness).toMatchObject({ state: "EXPORT_DATE_RANGE_REQUIRED", reason: "date_range_missing" });
    expect(r.checks).toBe(1);
  });
});

describe("settleExportSurface — still-hydrating surfaces fail closed only at timeout", () => {
  it("a bare empty container that never renders rows → pending to timeout, halts on zero_rows", async () => {
    const sleep = sleepSpy();
    const r = await settleExportSurface(deps([EMPTY_CONTAINER], { timeoutMs: 100, intervalMs: 20, sleep }));
    expect(r.state).toBe("pending");
    expect(r.timedOut).toBe(true);
    expect(r.checks).toBe(5); // ceil(100 / 20)
    expect(r.elapsedMs).toBe(80); // (5-1) × 20ms
    expect(r.readiness).toMatchObject({ state: "EXPORT_TARGET_EMPTY", reason: "zero_rows" });
    expect(sleep.delays).toEqual([20, 20, 20, 20]); // waited the FULL window before believing empty
  });

  it("a fully ambiguous surface → pending to timeout, conservative UNKNOWN", async () => {
    const r = await settleExportSurface(deps([AMBIGUOUS], { timeoutMs: 60, intervalMs: 20 }));
    expect(r.state).toBe("pending");
    expect(r.timedOut).toBe(true);
    expect(r.readiness).toMatchObject({ state: "EXPORT_TARGET_UNKNOWN", reason: "ambiguous" });
  });
});

describe("settleExportSurface — read errors never crash the poll", () => {
  it("a transient read error is skipped; a later rows read still settles READY", async () => {
    const r = await settleExportSurface(deps([new Error("detached"), ROWS], { timeoutMs: 200, intervalMs: 20 }));
    expect(r.state).toBe("ready");
    expect(r.checks).toBe(2);
    expect(r.readiness.decision).toBe("READY");
  });

  it("if EVERY read fails, halt on the conservative UNKNOWN fallback (never proceed)", async () => {
    const r = await settleExportSurface(deps([new Error("boom")], { timeoutMs: 60, intervalMs: 20 }));
    expect(r.state).toBe("pending");
    expect(r.timedOut).toBe(true);
    expect(r.html).toBe("");
    expect(r.readiness).toEqual({ decision: "HALT", state: "EXPORT_TARGET_UNKNOWN", reason: "ambiguous" });
  });
});

describe("settleExportSurface — dependency injection", () => {
  it("uses the injected evaluateReadinessFn instead of the default classifier", async () => {
    // Prove injection: a stub that only ever returns READY makes ANY html settle immediately.
    const alwaysReady = (): ExportTargetReadiness => ({ decision: "READY", rowCountBucket: "many", reason: "positive_rows" });
    const r = await settleExportSurface(deps([AMBIGUOUS], { evaluateReadinessFn: alwaysReady }));
    expect(r.state).toBe("ready");
    expect(r.checks).toBe(1);
  });

  it("maxChecks is derived from timeout / interval (at least one check even for a zero window)", async () => {
    const r = await settleExportSurface(deps([EMPTY_CONTAINER], { timeoutMs: 0, intervalMs: 20 }));
    expect(r.checks).toBe(1); // Math.max(1, ceil(0/20))
    expect(r.timedOut).toBe(true);
  });
});
