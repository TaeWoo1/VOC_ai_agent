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
  makeRevealIo,
  REVEAL_WALK_STOPS,
  revealExitCode,
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
  /** cleanup() REJECTS. Possible in principle; the real driver cannot do it. */
  cleanupThrows?: boolean;
  /** cleanup() returns false — the shape the REAL driver uses to report a panel still on the live page. */
  cleanupReportsStuck?: boolean;
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
      return !o.cleanupReportsStuck;
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
      order.push(
        line.includes(WING_REVEAL_CHECKPOINT_LABEL)
          ? "note:checkpoint"
          : line.includes("/status/run-coupang-wing-reveal-live.pressed")
            ? "note:presshint"
            : "note",
      );
      notes.push(line);
    },
    emit(record) {
      order.push("emit");
      emitted.push(record);
    },
    pressSignalHint: "/status/run-coupang-wing-reveal-live.pressed",
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

  it("the completion sentinel is disclosed AT the checkpoint — never before the readiness wait", async () => {
    // Mutation M13 survived the first battery: moving this line to AFTER the press wait changed nothing any
    // test could see. It is the whole point of review finding #2 — announcing the pressed sentinel early
    // invites the operator to create it in advance, and a sentinel that already exists makes the checkpoint
    // wait return on tick 0, skipping the human checkpoint in silence.
    const { driver, io, order, notes } = harness();
    await runRevealWalk(driver, io, "wing_host");
    const hintAt = order.indexOf("note:presshint");
    expect(hintAt, "the press hint must be shown").toBeGreaterThan(-1);
    expect(hintAt, "it must come AFTER the readiness wait, never before").toBeGreaterThan(order.indexOf("wait:ready"));
    expect(hintAt, "…and after the checkpoint copy").toBeGreaterThan(order.indexOf("note:checkpoint"));
    expect(hintAt, "…and BEFORE the press wait it explains").toBeLessThan(order.indexOf("wait:pressed"));
    expect(noteText(notes)).toContain("Press 발급 YOURSELF");
  });

  it("no sentinel path is disclosed before the readiness wait resolves", async () => {
    // The stronger form: not just "the hint is late" but "nothing names the completion sentinel early".
    const { driver, io, order } = harness({ signals: ["abort"] });
    await runRevealWalk(driver, io, "wing_host");
    expect(order, "an aborted run must never have disclosed the press sentinel").not.toContain("note:presshint");
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

  it("EVERY unexpected outcome gets a STOP block — not only the keys-displayed one", async () => {
    // Review's point: five of the six unexpected outcomes printed the same "observation complete" line a good
    // run prints, while the docstring promised an unrecognized outcome "stops, never as success".
    for (const outcome of [
      "SURFACE_UNCHANGED",
      "SURFACE_CHANGED_UNRECOGNIZED",
      "OFF_OPEN_API_SURFACE",
      "OVERLAY_NOT_CLEARED",
      "NOT_OBSERVED",
      "CREDENTIAL_SURFACE_APPEARED",
    ] as const) {
      const { driver, io, notes } = harness({ result: result({ outcome }) });
      await runRevealWalk(driver, io, "wing_host");
      const text = noteText(notes);
      expect(text, outcome).toContain("UNEXPECTED OUTCOME");
      expect(text, outcome).toContain(outcome);
      expect(text, outcome).toContain("WING에서 더 진행하지 마세요");
    }
  });

  it("the EXPECTED outcome gets no STOP block — but still tells the operator to stop", async () => {
    const { driver, io, notes } = harness({ result: result({ outcome: "CONFIGURATION_SURFACE_SUSPECTED" }) });
    await runRevealWalk(driver, io, "wing_host");
    const text = noteText(notes);
    expect(text).not.toContain("UNEXPECTED OUTCOME");
    // Asserting only the ABSENCE let this line be deleted silently. On the expected outcome — the one with no
    // STOP block — it is the ONLY thing telling the seller not to continue, at the moment they are looking at a
    // form that invites 확인.
    expect(text).toContain("WING에서 더 진행하지 마세요");
    expect(text).toContain("이 창은 곧 닫힙니다");
  });

  it("only the keys-displayed outcome gets the extra key-creation sentences", async () => {
    for (const outcome of ["SURFACE_UNCHANGED", "OFF_OPEN_API_SURFACE"] as const) {
      const { driver, io, notes } = harness({ result: result({ outcome }) });
      await runRevealWalk(driver, io, "wing_host");
      expect(noteText(notes), outcome).not.toContain("keys-displayed category");
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

  it("the walk takes a DRIVER, so a test never needs Playwright", () => {
    // The proof is the signature: `RevealWalkDriverLike` has five methods, none of which can navigate, click,
    // type, or read a value. A walk given a `BrowserContext` could grow any of those without a test noticing.
    expect(src).toContain("export interface RevealWalkDriverLike");
    expect(src).toContain("driver: RevealWalkDriverLike");
  });

  it("the walk body launches nothing and navigates nowhere", () => {
    const body = src.slice(src.indexOf("export async function runRevealWalk("));
    const fn = body.slice(0, body.indexOf("\n}\n"));
    expect(fn.length, "the walk body must actually have been sliced").toBeGreaterThan(200);
    for (const forbidden of ["launchNaverContext", "newPage", "goto(", "loadConfig", "existsSync", "process.argv"]) {
      expect(fn, `runRevealWalk must not reference ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("the walk calls ONLY the five driver methods the interface declares", () => {
    // The forbidden-token list is a denylist, and a denylist cannot see a method that does not exist yet: review
    // showed a seventh interface method named e.g. `pressIssueControl()` would pass every check here. So the
    // allowlist is asserted instead — the set of `driver.` calls in the walk must be exactly the interface.
    const iface = src.slice(src.indexOf("export interface RevealWalkDriverLike {"), src.indexOf("/** Where the walk stopped"));
    const declared = new Set([...iface.matchAll(/^\s{2}([a-zA-Z]+)\(/gm)].map((m) => m[1]!));
    expect(declared).toEqual(
      new Set(["classifyInitialSurface", "probeIssueMatch", "highlightIssueCheckpoint", "observeRevealOutcome", "cleanup"]),
    );
    const body = src.slice(src.indexOf("export async function runRevealWalk("));
    const fn = body.slice(0, body.indexOf("\n}\n"));
    for (const m of fn.matchAll(/driver\.([a-zA-Z]+)\(/g)) {
      expect(declared, `the walk calls an undeclared driver method: ${m[1]}`).toContain(m[1]);
    }
  });

  it("main() is NOT exported — the only way to launch Chrome is to invoke the file", () => {
    expect(src).toContain("async function main(): Promise<void>");
    expect(src).not.toContain("export async function main");
  });

  it("the record's urlCategory is the ENUM type, so a raw URL cannot be passed", () => {
    expect(src).toContain("urlCategory: WingUrlCategory,");
    expect(src).not.toContain("urlCategory: string,");
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
    // The COARSE category, never the URL. As a bare `string` parameter, `runRevealWalk(driver, io, url)`
    // typechecked and printed the raw WING URL into the sanitized stdout record; the parameter is now the enum,
    // and this pins the call site too.
    expect(body).toContain("await runRevealWalk(driver, io, screen.urlCategory)");
    expect(body).toContain("makeRevealIo(");
    // The refusal/observation decisions must live in the tested walk, not be duplicated back into main().
    for (const decision of ["classifyInitialSurface", "probeIssueMatch", "observeRevealOutcome"]) {
      expect(body, `${decision} must not be re-implemented in main()`).not.toContain(decision);
    }
  });
});

/* ────────────────────────────── the wiring itself ────────────────────────────── */

/**
 * `makeRevealIo` is the ONE place `waitForSignal`'s label and its target file are re-joined, and it had no test:
 * the walk test injects `io.waitFor` wholesale, and the source guard only checked that the call site existed.
 *
 * Review demonstrated what that costs. Point both waits at `readyPath` — a one-token edit that typechecks and
 * passed the entire suite — and because the ready sentinel was never consumed, the checkpoint wait returns on
 * tick 0. SellerOps highlights 발급 and immediately takes its "post-press" observation of a page nobody pressed,
 * emits the record, and exits 0. The human checkpoint is skipped in silence.
 */
describe("makeRevealIo — the two waits must watch DIFFERENT files", () => {
  function ioFor(present: string[]) {
    const files = new Set(present);
    const removed: string[] = [];
    const io = makeRevealIo(
      { readyPath: "/s/ready", donePath: "/s/pressed", abortPath: "/s/abort" },
      {
        exists: (p) => files.has(p),
        sleep: async () => undefined,
        aborted: () => false,
        maxTicks: 3,
        pollMs: 1,
        remove: (p) => {
          files.delete(p);
          removed.push(p);
        },
      },
    );
    return { io, removed, files };
  }

  it("the readiness wait watches the ready file", async () => {
    expect(await ioFor(["/s/ready"]).io.waitFor("ready")).toBe("ready");
  });

  it("the press wait watches the PRESSED file — a ready sentinel does not satisfy it", async () => {
    // The mutation this kills: `waitForSignal(readyPath, kind, …)` for both.
    expect(await ioFor(["/s/ready"]).io.waitFor("pressed")).toBe("timeout");
    expect(await ioFor(["/s/pressed"]).io.waitFor("pressed")).toBe("pressed");
  });

  it("the readiness wait is not satisfied by the pressed file either", async () => {
    expect(await ioFor(["/s/pressed"]).io.waitFor("ready")).toBe("timeout");
  });

  it("a fired sentinel is CONSUMED, so it cannot satisfy the next wait", async () => {
    const { io, removed, files } = ioFor(["/s/ready", "/s/pressed"]);
    expect(await io.waitFor("ready")).toBe("ready");
    expect(removed).toEqual(["/s/ready"]);
    expect(files.has("/s/ready")).toBe(false);
  });

  it("an abort is not consumed — it must keep aborting", async () => {
    const { io, removed } = ioFor(["/s/abort"]);
    expect(await io.waitFor("ready")).toBe("abort");
    expect(removed).toEqual([]);
  });

  it("the press hint names the completion sentinel, so the walk can disclose it at the checkpoint", () => {
    expect(ioFor([]).io.pressSignalHint).toBe("/s/pressed");
  });

  it("narration goes to stderr and the sanitized record to STDOUT — the channels are a contract", () => {
    // Swapping them survived every test. The record is the machine-readable artifact of the run; emitting it on
    // stderr and the prose on stdout means the record never reaches a caller capturing stdout.
    const out: string[] = [];
    const err: string[] = [];
    const [oLog, oErr] = [console.log, console.error];
    console.log = (...a: unknown[]) => void out.push(a.map(String).join(" "));
    console.error = (...a: unknown[]) => void err.push(a.map(String).join(" "));
    try {
      const { io } = ioFor([]);
      io.note("a narration line");
      io.emit({ outcome: "SURFACE_UNCHANGED" });
    } finally {
      console.log = oLog;
      console.error = oErr;
    }
    expect(err).toEqual(["a narration line"]);
    expect(out).toHaveLength(1);
    expect(JSON.parse(out[0]!)).toEqual({ outcome: "SURFACE_UNCHANGED" });
  });
});

describe("waitForSignal — a pathological poll interval cannot disable the deadline", () => {
  const base = { exists: () => false, sleep: async () => undefined, aborted: () => false };

  it("pollMs 0 does not produce an infinite wait", async () => {
    // `Math.ceil(WAIT_TIMEOUT_MS / 0)` is Infinity: the loop would never end, on the seam that decides when
    // SellerOps reads a live page.
    expect(await waitForSignal("/r", "ready", "/a", { ...base, pollMs: 0 })).toBe("timeout");
  });

  it("a negative pollMs does not skip the loop body entirely", async () => {
    // A negative budget makes the body never run: it would return `timeout` without ever checking abort or the
    // target — including when the operator had already signalled.
    let checked = 0;
    const sig = await waitForSignal("/r", "ready", "/a", {
      ...base,
      exists: (p) => {
        checked += 1;
        return p === "/r";
      },
      pollMs: -5,
    });
    expect(checked).toBeGreaterThan(0);
    expect(sig).toBe("ready");
  });

  it("a non-positive tick budget still checks at least once", async () => {
    let checked = 0;
    const sig = await waitForSignal("/r", "ready", "/a", {
      ...base,
      exists: (p) => {
        checked += 1;
        return p === "/r";
      },
      maxTicks: 0,
    });
    expect(checked).toBeGreaterThan(0);
    expect(sig).toBe("ready");
  });
});

describe("the report is reported — a run that exits 0 whatever happened is an all-clear", () => {
  it("a cleanup that REPORTS a stuck panel is recorded — the shape the real driver actually uses", async () => {
    // The finding this closes: `CoupangWingRevealDriver.clearHighlight` catches every error it can hit, so
    // `cleanup()` cannot reject. Wiring the guarantee to a rejection made it unreachable in production while a
    // `cleanupThrows` fake — a shape the real driver cannot produce — kept its test green.
    const { driver, io, notes } = harness({ cleanupReportsStuck: true });
    const report = await runRevealWalk(driver, io, "wing_host");
    expect(report.cleanupFailed).toBe(true);
    expect(noteText(notes)).toContain("overlay could not be cleared");
    expect(revealExitCode(report)).toBe(8);
  });

  it("the real driver signals a stuck panel by RETURN VALUE, not by throwing", async () => {
    // Asserted against the production class, not a fake: its cleanup() must hand back clearHighlight's verdict.
    const { CoupangWingRevealDriver } = await import("../../src/action-window/coupang-wing-reveal-driver");
    const src = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../../src/action-window/coupang-wing-reveal-driver.ts"),
      "utf8",
    );
    expect(src).toContain("async cleanup(): Promise<boolean>");
    expect(src).toContain("return this.clearHighlight();");
    expect(typeof CoupangWingRevealDriver.prototype.cleanup).toBe("function");
  });

  it("a failed cleanup is recorded on the report, not swallowed", async () => {
    // The original let a throwing overlay clear propagate → nonzero exit. Swallowing it would leave SellerOps'
    // panel and its `data-aw-target` annotation on the seller's live WING DOM with no signal anywhere.
    const { driver, io, notes } = harness({ cleanupThrows: true });
    const report = await runRevealWalk(driver, io, "wing_host");
    expect(report.cleanupFailed).toBe(true);
    expect(noteText(notes)).toContain("overlay could not be cleared");
  });

  it("a clean run reports cleanupFailed false", async () => {
    const report = await runRevealWalk(harness().driver, harness().io, "wing_host");
    expect(report.cleanupFailed).toBe(false);
  });

  it("a cleanup failure on a REFUSAL path is reported too", async () => {
    const { driver, io } = harness({ cleanupThrows: true, matchCount: 0 });
    const report = await runRevealWalk(driver, io, "wing_host");
    expect(report.stop).toBe("ISSUE_NOT_UNIQUE");
    expect(report.cleanupFailed).toBe(true);
  });

  it("revealExitCode maps each outcome class to its OWN code — asserted by value", () => {
    // The source-token version of this test was vacuous: inverting the codes so an UNEXPECTED outcome exits 0
    // and the expected one exits 6 — the exact opposite of why they exist — passed it unchanged.
    const base = { stop: "OBSERVED" as const, result: null, outcomeAsExpected: true, cleanupFailed: false };
    expect(revealExitCode(base)).toBe(0);
    expect(revealExitCode({ ...base, outcomeAsExpected: false })).toBe(6);
    expect(revealExitCode({ ...base, stop: "ABORTED_AT_CHECKPOINT", outcomeAsExpected: false })).toBe(7);
    expect(revealExitCode({ ...base, cleanupFailed: true })).toBe(8);
    // …and the codes are pairwise distinct, so no two classes can be collapsed.
    const codes = [
      revealExitCode(base),
      revealExitCode({ ...base, outcomeAsExpected: false }),
      revealExitCode({ ...base, stop: "NOT_OPEN_API_SURFACE", outcomeAsExpected: false }),
      revealExitCode({ ...base, cleanupFailed: true }),
    ];
    expect(new Set(codes).size).toBe(4);
    // A stuck overlay outranks everything: it is the only one describing state left on the seller's live page.
    expect(revealExitCode({ ...base, stop: "NOT_OPEN_API_SURFACE", cleanupFailed: true })).toBe(8);
  });

  it("main() reads the report and delegates the code to revealExitCode", () => {
    const src2 = readFileSync(SRC, "utf8");
    const body = src2.slice(src2.indexOf("async function main(): Promise<void>"));
    expect(body).toContain("const report = await runRevealWalk(");
    expect(body).toContain("process.exitCode = revealExitCode(report);");
  });

  it("main() wires BOTH sentinel paths and the sentinel CONSUMER — the seam tests cannot see this", () => {
    // Review's finding 5: `makeRevealIo` is tested in both directions, but main() also joins label to file, and
    // `SignalWaitDeps.remove` is OPTIONAL — dropping it typechecks, and the consumption test keeps passing
    // because it injects its own `remove`. Dropping it plus pointing donePath at the ready filename reproduces
    // the original fail-open exactly, at the one place no seam test looks.
    const src2 = readFileSync(SRC, "utf8");
    const body = src2.slice(src2.indexOf("async function main(): Promise<void>"));
    expect(body).toContain("sentinelPath(cfg.statusFile, REVEAL_READY_FILENAME)");
    expect(body).toContain("sentinelPath(cfg.statusFile, REVEAL_DONE_FILENAME)");
    expect(body).toContain("remove: removeSentinel,");
    // The three sentinels must come from three DIFFERENT filename constants.
    const names = [...body.matchAll(/sentinelPath\(cfg\.statusFile, (REVEAL_\w+)\)/g)].map((m) => m[1]!);
    expect(names).toHaveLength(3);
    expect(new Set(names).size).toBe(3);
  });
});
