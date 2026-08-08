/**
 * The reveal CLI's **orchestration**, tested without a browser.
 *
 * Everything between the approval gate and the printed record used to live inside `main()` — unexported, wired
 * directly to `launchNaverContext`, `existsSync` and a 20-minute wall clock. So the paths that decide whether
 * SellerOps touches a live marketplace page at all (both sentinel waits, both aborts, the timeout, four
 * fail-closed refusals, and the unexpected-outcome stop) had no test: the only way to reach them was to open
 * Chrome on the seller's WING account. That is precisely backwards for the code that guards a real WING press.
 *
 * `runRevealWalk` + `waitForSignal` are now the seam. Both take their surroundings as dependencies, so every
 * branch below runs offline against fakes, and `main()` is left as wiring: launch, hand over, tear down.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  REVEAL_WALK_STOPS,
  runRevealWalk,
  waitForSignal,
  type RevealWalkDriverLike,
  type RevealWalkIo,
  type RevealWalkStop,
  type SignalWaitDeps,
} from "../../src/cli/run-coupang-wing-reveal-live";
import { WING_REVEAL_CHECKPOINT_LABEL } from "../../src/action-window/coupang-wing-reveal-driver";
import type { WingRevealOutcome, WingRevealResult } from "../../src/action-window/coupang-wing-reveal-driver";
import { observeFrom, type WingObservation, type WingStructuralCensus } from "../../src/cli/coupang-wing-classifier";

const SRC = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../src/cli/run-coupang-wing-reveal-live.ts",
);

/* ────────────────────────────── fixtures ────────────────────────────── */

const BASE_CENSUS: WingStructuralCensus = {
  passwordFieldPresent: false,
  submitAffordancePresent: false,
  formCount: 2,
  editableTextInputCount: 6,
  readonlyFieldCount: 0,
  listLikeContainerCount: 5,
  markerScanTruncated: false,
  openApiMarkerPresent: true,
  credentialAnchorPresent: true,
};

function observation(over: Partial<WingStructuralCensus> = {}): WingObservation {
  return observeFrom("wing_host", { ...BASE_CENSUS, ...over });
}

const OPEN_API = observation();
const AFTER_FORM = observation({ submitAffordancePresent: true });

function result(over: Partial<WingRevealResult> = {}): WingRevealResult {
  return {
    outcome: "CONFIGURATION_SURFACE_SUSPECTED",
    before: OPEN_API,
    after: AFTER_FORM,
    changedSignals: ["submitAffordancePresent"],
    keyCreationRuledOut: false,
    keyCreationReason: "NO_DISCRIMINATING_SIGNAL",
    overlayClearedBeforeObservation: true,
    ...over,
  };
}

interface FakeOpts {
  signals?: ("ready" | "pressed" | "abort" | "timeout")[];
  classifyOk?: boolean;
  classifyObservation?: WingObservation;
  matchCount?: number;
  highlightCount?: number;
  result?: WingRevealResult;
  observeThrows?: boolean;
  cleanupThrows?: boolean;
}

/**
 * A driver + IO pair that records the ORDER of every interaction. Order is the point: "cleared before observed"
 * and "checkpoint copy before the press wait" are not properties of any single return value.
 */
function harness(o: FakeOpts = {}) {
  const order: string[] = [];
  const notes: string[] = [];
  const emitted: Record<string, unknown>[] = [];
  let signalIdx = 0;

  const driver: RevealWalkDriverLike = {
    async classifyInitialSurface() {
      order.push("classify");
      const obs = o.classifyObservation ?? OPEN_API;
      return { ok: o.classifyOk ?? true, observation: obs };
    },
    async probeIssueMatch() {
      order.push("probe");
      const matchCount = o.matchCount ?? 1;
      return { matchCount, canHighlight: matchCount === 1 };
    },
    async highlightIssueCheckpoint() {
      order.push("highlight");
      return { count: o.highlightCount ?? 1 };
    },
    async observeRevealOutcome() {
      order.push("observe");
      if (o.observeThrows) throw new Error("census failed");
      return o.result ?? result();
    },
    async cleanup() {
      order.push("cleanup");
      if (o.cleanupThrows) throw new Error("clear failed");
    },
  };

  const io: RevealWalkIo = {
    async waitFor(kind) {
      order.push(`wait:${kind}`);
      const next = o.signals?.[signalIdx];
      signalIdx += 1;
      return next ?? kind;
    },
    note(line) {
      // The checkpoint copy is tagged in the order log: its POSITION is a property under test, and a bare
      // "note" marker would make that assertion depend on counting anonymous entries.
      order.push(line.includes(WING_REVEAL_CHECKPOINT_LABEL) ? "note:checkpoint" : "note");
      notes.push(line);
    },
    emit(record) {
      order.push("emit");
      emitted.push(record);
    },
  };

  return { driver, io, order, notes, emitted };
}

const noteText = (notes: string[]): string => notes.join("\n");

/* ────────────────────────────── the sentinel wait ────────────────────────────── */

describe("waitForSignal — the operator's three sentinels", () => {
  function deps(over: Partial<SignalWaitDeps> & { present?: string[] } = {}): SignalWaitDeps & { sleeps: number } {
    const present = new Set(over.present ?? []);
    const state = {
      sleeps: 0,
      exists: (p: string) => present.has(p),
      sleep: async () => {
        state.sleeps += 1;
      },
      aborted: () => false,
      maxTicks: 3,
      pollMs: 0,
      ...over,
    };
    return state as SignalWaitDeps & { sleeps: number };
  }

  it("returns `ready` when the readiness sentinel is there", async () => {
    expect(await waitForSignal("/r", "ready", "/a", deps({ present: ["/r"] }))).toBe("ready");
  });

  it("returns `pressed` for the completion sentinel — the SAME function, a different meaning", async () => {
    // The kind is passed in rather than inferred by comparing the target to `readyPath`. That comparison was the
    // original shape, and it means any path that is not the ready path reports as a completed press.
    expect(await waitForSignal("/d", "pressed", "/a", deps({ present: ["/d"] }))).toBe("pressed");
  });

  it("returns `abort` for the abort sentinel", async () => {
    expect(await waitForSignal("/r", "ready", "/a", deps({ present: ["/a"] }))).toBe("abort");
  });

  it("returns `abort` for the SIGINT flag even with no abort file", async () => {
    expect(await waitForSignal("/r", "ready", "/a", deps({ aborted: () => true }))).toBe("abort");
  });

  it("abort WINS when both land on the same tick — Ctrl-C is not overridden by a late sentinel", async () => {
    expect(await waitForSignal("/r", "ready", "/a", deps({ present: ["/r", "/a"] }))).toBe("abort");
    expect(await waitForSignal("/d", "pressed", "/a", deps({ present: ["/d"], aborted: () => true }))).toBe("abort");
  });

  it("returns `timeout` when nothing ever appears, and stops at the tick budget", async () => {
    const d = deps({ maxTicks: 4 });
    expect(await waitForSignal("/r", "ready", "/a", d)).toBe("timeout");
    expect(d.sleeps).toBe(4);
  });

  it("does not sleep at all when the sentinel is already present", async () => {
    const d = deps({ present: ["/r"] });
    await waitForSignal("/r", "ready", "/a", d);
    expect(d.sleeps).toBe(0);
  });

  it("a sentinel appearing mid-wait is picked up", async () => {
    let tick = 0;
    const d = deps({
      exists: (p: string) => p === "/d" && tick >= 2,
      sleep: async () => {
        tick += 1;
      },
      maxTicks: 6,
    });
    expect(await waitForSignal("/d", "pressed", "/a", d)).toBe("pressed");
  });
});

/* ────────────────────────────── the walk ────────────────────────────── */

describe("runRevealWalk — the happy path is the ONLY path that observes", () => {
  it("waits for readiness, classifies, probes, highlights, waits for the press, then observes ONCE", async () => {
    const { driver, io, order } = harness();
    const report = await runRevealWalk(driver, io, "wing_host");
    expect(report.stop).toBe("OBSERVED");
    expect(report.outcomeAsExpected).toBe(true);
    expect(order.filter((s) => !s.startsWith("note"))).toEqual([
      "wait:ready",
      "classify",
      "probe",
      "highlight",
      "wait:pressed",
      "observe",
      "emit",
      "cleanup",
    ]);
  });

  it("emits exactly one sanitized record, carrying both key-creation fields", async () => {
    const { driver, io, emitted } = harness();
    await runRevealWalk(driver, io, "wing_host");
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({
      urlCategory: "wing_host",
      phase: "COUPANG_WING_ISSUANCE_FORM_REVEAL",
      operatorAction: "REVEAL_WING_ISSUANCE_CONFIGURATION",
      outcome: "CONFIGURATION_SURFACE_SUSPECTED",
      keyCreationRuledOut: false,
      keyCreationReason: "NO_DISCRIMINATING_SIGNAL",
    });
  });

  it("the record carries no raw URL, selector, DOM or value", async () => {
    const { driver, io, emitted } = harness();
    await runRevealWalk(driver, io, "wing_host");
    const json = JSON.stringify(emitted[0]);
    for (const forbidden of ["http", "querySelector", "data-aw-target", "<", "발급", "업체"]) {
      expect(json, `the record must not contain ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("shows the checkpoint copy BEFORE waiting for the press, not after", async () => {
    const { driver, io, order, notes } = harness();
    await runRevealWalk(driver, io, "wing_host");
    expect(noteText(notes)).toContain(WING_REVEAL_CHECKPOINT_LABEL);
    // The copy is what the operator acts on. Printed after the wait it would arrive once the press already
    // happened — the checkpoint would exist in the log and nowhere else.
    const copyAt = order.indexOf("note:checkpoint");
    expect(copyAt, "the checkpoint copy must be shown").toBeGreaterThan(-1);
    expect(copyAt).toBeLessThan(order.indexOf("wait:pressed"));
    // …and after the highlight, so the copy never describes a control that was never marked.
    expect(copyAt).toBeGreaterThan(order.indexOf("highlight"));
  });
});

describe("runRevealWalk — every refusal stops before the next step", () => {
  const cases: { name: string; opts: FakeOpts; stop: RevealWalkStop; absent: string[] }[] = [
    {
      name: "abort before the checkpoint",
      opts: { signals: ["abort"] },
      stop: "ABORTED_BEFORE_CHECKPOINT",
      absent: ["classify", "probe", "highlight", "observe", "emit"],
    },
    {
      name: "timeout before the checkpoint",
      opts: { signals: ["timeout"] },
      stop: "ABORTED_BEFORE_CHECKPOINT",
      absent: ["classify", "probe", "highlight", "observe", "emit"],
    },
    {
      name: "not the open-API surface",
      opts: { classifyOk: false, classifyObservation: observation({ passwordFieldPresent: true }) },
      stop: "NOT_OPEN_API_SURFACE",
      absent: ["probe", "highlight", "observe", "emit"],
    },
    {
      name: "발급 matched 0",
      opts: { matchCount: 0 },
      stop: "ISSUE_NOT_UNIQUE",
      absent: ["highlight", "observe", "emit"],
    },
    {
      name: "발급 matched many",
      opts: { matchCount: 4 },
      stop: "ISSUE_NOT_UNIQUE",
      absent: ["highlight", "observe", "emit"],
    },
    {
      name: "the checkpoint could not be painted",
      opts: { highlightCount: 0 },
      stop: "CHECKPOINT_NOT_PAINTED",
      absent: ["observe", "emit"],
    },
    {
      name: "abort at the checkpoint",
      opts: { signals: ["ready", "abort"] },
      stop: "ABORTED_AT_CHECKPOINT",
      absent: ["observe", "emit"],
    },
    {
      name: "timeout at the checkpoint",
      opts: { signals: ["ready", "timeout"] },
      stop: "ABORTED_AT_CHECKPOINT",
      absent: ["observe", "emit"],
    },
  ];

  it.each(cases)("$name → $stop, and nothing downstream runs", async ({ opts, stop, absent }) => {
    const { driver, io, order, emitted } = harness(opts);
    const report = await runRevealWalk(driver, io, "wing_host");
    expect(report.stop).toBe(stop);
    expect(report.result).toBeNull();
    expect(report.outcomeAsExpected).toBe(false);
    for (const step of absent) expect(order, `${step} must not run`).not.toContain(step);
    expect(emitted).toHaveLength(0);
  });

  it("EVERY stop clears the overlay — including the ones that never painted one", async () => {
    for (const { opts } of cases) {
      const { driver, io, order } = harness(opts);
      await runRevealWalk(driver, io, "wing_host");
      expect(order.at(-1), "cleanup must be the last thing the walk does").toBe("cleanup");
    }
  });

  it("clears the overlay even when the observation THROWS, and lets the error out", async () => {
    // A thrown census must not leave SellerOps' panel and its `data-aw-target` annotation on the seller's live
    // marketplace DOM — and must not be swallowed into something that reads like a completed run.
    const { driver, io, order } = harness({ observeThrows: true });
    await expect(runRevealWalk(driver, io, "wing_host")).rejects.toThrow();
    expect(order).toContain("cleanup");
    expect(order).not.toContain("emit");
  });

  it("a cleanup that itself fails does not mask the walk's own result", async () => {
    const { driver, io, emitted } = harness({ cleanupThrows: true });
    const report = await runRevealWalk(driver, io, "wing_host");
    expect(report.stop).toBe("OBSERVED");
    expect(emitted).toHaveLength(1);
  });
});

describe("runRevealWalk — an unexpected outcome is a STOP, never a success", () => {
  it("credential_shown is reported LOUDLY and is not `as expected`", async () => {
    const { driver, io, notes, emitted, order } = harness({
      result: result({ outcome: "CREDENTIAL_SURFACE_APPEARED", after: observation({ readonlyFieldCount: 4 }) }),
    });
    const report = await runRevealWalk(driver, io, "wing_host");
    expect(report.stop).toBe("OBSERVED");
    expect(report.outcomeAsExpected).toBe(false);
    const text = noteText(notes);
    expect(text).toContain("UNEXPECTED OUTCOME");
    expect(text).toContain("CREDENTIAL_SURFACE_APPEARED");
    // The warning must not over-claim in either direction: it is not proof a key was created, and it is not an
    // all-clear either.
    expect(text).toContain("NOT proof a key was created");
    expect(text).toContain("WING에서 더 진행하지 마세요");
    expect(emitted[0]).toMatchObject({ outcome: "CREDENTIAL_SURFACE_APPEARED", keyCreationRuledOut: false });
    // Observed once. No re-probe, no second observation, no advance.
    expect(order.filter((s) => s === "observe")).toHaveLength(1);
    expect(order.filter((s) => s === "highlight")).toHaveLength(1);
  });

  it("ONLY CONFIGURATION_SURFACE_SUSPECTED is `as expected` — every other outcome is not", async () => {
    const outcomes: WingRevealOutcome[] = [
      "CONFIGURATION_SURFACE_SUSPECTED",
      "SURFACE_UNCHANGED",
      "SURFACE_CHANGED_UNRECOGNIZED",
      "CREDENTIAL_SURFACE_APPEARED",
      "OFF_OPEN_API_SURFACE",
      "OVERLAY_NOT_CLEARED",
      "NOT_OBSERVED",
    ];
    for (const outcome of outcomes) {
      const { driver, io } = harness({ result: result({ outcome }) });
      const report = await runRevealWalk(driver, io, "wing_host");
      expect(report.outcomeAsExpected, outcome).toBe(outcome === "CONFIGURATION_SURFACE_SUSPECTED");
      // Whatever the outcome, the walk observed once and returned. It never advances.
      expect(report.stop).toBe("OBSERVED");
    }
  });

  it("the loud warning fires for credential_shown and for NOTHING else", async () => {
    for (const outcome of ["SURFACE_UNCHANGED", "OFF_OPEN_API_SURFACE", "CONFIGURATION_SURFACE_SUSPECTED"] as const) {
      const { driver, io, notes } = harness({ result: result({ outcome }) });
      await runRevealWalk(driver, io, "wing_host");
      expect(noteText(notes), outcome).not.toContain("UNEXPECTED OUTCOME");
    }
  });

  it("a FAILED overlay clear is passed through to the record, not rounded up", async () => {
    // Clear-before-observe is enforced inside the driver; what the walk owes is honesty about its verdict. A
    // record printing `true` here while the driver reported `false` would describe a reading taken through
    // SellerOps' own panel as a clean one.
    const { driver, io, emitted } = harness({
      result: result({ outcome: "OVERLAY_NOT_CLEARED", overlayClearedBeforeObservation: false }),
    });
    const report = await runRevealWalk(driver, io, "wing_host");
    expect(emitted[0]).toMatchObject({
      overlayClearedBeforeObservation: false,
      outcome: "OVERLAY_NOT_CLEARED",
    });
    expect(report.outcomeAsExpected).toBe(false);
  });

  it("has no outcome or stop name that could be read as an all-clear", () => {
    for (const stop of REVEAL_WALK_STOPS) {
      expect(stop).not.toMatch(/NO_KEY|NOT_ISSUED|SAFE|CLEAN|SUCCESS/);
    }
  });
});

/* ────────────────────────────── inert on import ────────────────────────────── */

describe("the walk cannot reach a browser, and importing the module runs nothing", () => {
  const src = readFileSync(SRC, "utf8");
  const walk = src.slice(src.indexOf("export async function runRevealWalk("), src.indexOf("/* ────────────────────────────── sentinels"));

  it("the walk takes a DRIVER, so a test never needs Playwright", () => {
    // The proof is the signature: `RevealWalkDriverLike` has five methods, none of which can navigate, click,
    // type, or read a value. A walk given a `BrowserContext` could grow any of those without a test noticing.
    expect(src).toContain("export interface RevealWalkDriverLike");
    expect(src).toContain("driver: RevealWalkDriverLike");
  });

  it("the walk body launches nothing and navigates nowhere", () => {
    const body = src.slice(src.indexOf("export async function runRevealWalk("));
    const fn = body.slice(0, body.indexOf("\n}\n"));
    for (const forbidden of ["launchNaverContext", "newPage", "goto(", "loadConfig", "existsSync", "process.argv"]) {
      expect(fn, `runRevealWalk must not reference ${forbidden}`).not.toContain(forbidden);
    }
    expect(walk.length + fn.length).toBeGreaterThan(0);
  });

  it("main() is NOT exported — the only way to launch Chrome is to invoke the file", () => {
    expect(src).toContain("async function main(): Promise<void>");
    expect(src).not.toContain("export async function main");
  });

  it("importing this module launches nothing (the direct-invocation guard)", async () => {
    // vitest imports the module at the top of this file; if the guard were wrong, a browser would already have
    // been launched by the time this runs. Asserted on the guard too, so the reason stays visible.
    const mod = await import("../../src/cli/run-coupang-wing-reveal-live");
    expect(typeof mod.runRevealWalk).toBe("function");
    expect(src).toContain("import.meta.url === pathToFileURL(process.argv[1]).href");
  });

  it("main() is wiring only — it hands the walk its dependencies rather than re-implementing them", () => {
    const body = src.slice(src.indexOf("async function main(): Promise<void>"));
    expect(body).toContain("await runRevealWalk(driver, io,");
    expect(body).toContain("waitForSignal(");
    // The refusal/observation decisions must live in the tested walk, not be duplicated back into main().
    for (const decision of ["classifyInitialSurface", "probeIssueMatch", "observeRevealOutcome"]) {
      expect(body, `${decision} must not be re-implemented in main()`).not.toContain(decision);
    }
  });
});
