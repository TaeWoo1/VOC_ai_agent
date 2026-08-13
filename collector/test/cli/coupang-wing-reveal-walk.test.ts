/**
 * The reveal CLI's **orchestration**, tested without a browser.
 *
 * Everything between the approval gate and the printed record used to live inside `main()` — unexported, wired
 * directly to `launchNaverContext`, `existsSync` and a 20-minute wall clock. So the paths that decide whether
 * SellerOps touches a live marketplace page at all (both operator checkpoints, both aborts, the timeout, the
 * three fail-closed refusals, and the unexpected-outcome stop) had no test: the only way to reach them was to open
 * Chrome on the seller's WING account. That is precisely backwards for the code that guards a real WING press.
 *
 * `runRevealWalk` + `makeRevealIo` are now the seam. Both take their surroundings as dependencies, so every
 * branch below runs offline against fakes, and `main()` is left as wiring: launch, hand over, tear down.
 *
 * The checkpoints themselves are no longer FILES. Both used to be sentinels the operator (or anything else) could
 * create; they are now verified presses on the SellerOps confirmation surface, and what this file pins is that
 * the walk asks for two different ones and takes nothing from the filesystem but an abort.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  makeRevealIo,
  REVEAL_WALK_STOPS,
  revealAskFor,
  revealExitCode,
  runRevealWalk,
  type RevealWalkDriverLike,
  type RevealWalkIo,
  type RevealWalkStop,
} from "../../src/cli/run-coupang-wing-reveal-live";
import { OPERATOR_CONFIRM_BUTTON_LABEL, OPERATOR_UI_CONFIRMED } from "../../src/cli/operator-confirm";
import {
  STAGE2_DISJUNCTS,
  WING_EMPIRICALLY_REFUTED_DISJUNCTS,
  WING_REVEAL_CHECKPOINT_LABEL,
  stage2DetectionEligibility,
  stage2DisjunctsWithHeadroom,
} from "../../src/action-window/coupang-wing-reveal-driver";
import type { WingRevealOutcome, WingRevealResult } from "../../src/action-window/coupang-wing-reveal-driver";
import { observeFrom, type WingObservation, type WingStructuralCensus } from "../../src/cli/coupang-wing-classifier";

/** What the walk discloses AT the checkpoint: the SellerOps button, never a file the operator could create. */
const PRESS_HINT = `SellerOps 확인 탭의 [${OPERATOR_CONFIRM_BUTTON_LABEL}] 버튼`;

const SRC = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../src/cli/run-coupang-wing-reveal-live.ts",
);

/* ────────────────────────────── fixtures ────────────────────────────── */

const BASE_CENSUS: WingStructuralCensus = {
  passwordFieldPresent: false,
  submitAffordancePresent: false,
  // The three Stage-2 signals are MEASURED here, because the shipped census always emits them. A fixture that
  // omitted them modelled a pre-repair collector, and under the eligibility gate it is a BLIND baseline — every
  // walk test would have stopped at BLIND_INSTRUMENT, testing the gate instead of the walk. `blindObservation()`
  // below is the deliberate version of that baseline.
  dialogLikePresent: false,
  choiceControlCount: 0,
  actionControlCount: 3,
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

/**
 * The baseline the gate exists for: `submitAffordancePresent` is the ONLY disjunct with structural headroom, and
 * it is the one live evidence refuted on WING. Built by omitting the three Stage-2 census fields — an
 * unmeasured signal cannot support a transition, so it contributes no headroom, which is exactly the real
 * pre-repair situation. Structural headroom is 1; eligible detection is 0.
 */
function blindObservation(): WingObservation {
  const { dialogLikePresent: _d, choiceControlCount: _c, actionControlCount: _a, ...rest } = BASE_CENSUS;
  return observeFrom("wing_host", rest);
}

function result(over: Partial<WingRevealResult> = {}): WingRevealResult {
  return {
    outcome: "CONFIGURATION_SURFACE_SUSPECTED",
    before: OPEN_API,
    after: AFTER_FORM,
    // DERIVED from `before`, as the real driver derives it. Hand-writing `["submitAffordancePresent"]` here made
    // every emitted record carry two capability reports over the same baseline that visibly disagreed, while the
    // code comment claimed a test asserted they agreed. Review caught both; the test now exists, below.
    detectableDisjuncts: stage2DisjunctsWithHeadroom(OPEN_API),
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
          : line.includes(PRESS_HINT)
            ? "note:presshint"
            : "note",
      );
      notes.push(line);
    },
    emit(record) {
      order.push("emit");
      emitted.push(record);
    },
    pressSignalHint: PRESS_HINT,
  };

  return { driver, io, order, notes, emitted };
}

const noteText = (notes: string[]): string => notes.join("\n");

/* ────────────────────────────── the operator checkpoints ────────────────────────────── */

describe("makeRevealIo — a checkpoint advances on a verified press and on nothing else", () => {
  const CONFIRMED = { signal: "ready", provenance: OPERATOR_UI_CONFIRMED } as const;

  it("**the two checkpoints are two different asks** — the second is not the first read twice", () => {
    // The mapping from checkpoint to ask is the one place a walk can silently skip a human step. When these were
    // sentinel files, pointing both waits at the same path made the second return on tick 0 — SellerOps would
    // observe a page nobody pressed, and exit 0. The equivalent mistake now is one ask for both.
    const ready = revealAskFor("ready");
    const pressed = revealAskFor("pressed");
    expect(ready.title).not.toBe(pressed.title);
    expect(ready.headline).not.toBe(pressed.headline);
    // The second names the real marketplace action, and says who performs it.
    expect([pressed.headline, ...pressed.lines].join("\n")).toContain("발급");
    expect([pressed.headline, ...pressed.lines].join("\n")).toContain("직접");
  });

  it("each wait is confirmed against ITS OWN ask", async () => {
    const asks: string[] = [];
    const io = makeRevealIo(async (ask) => {
      asks.push(ask.title);
      return CONFIRMED;
    });
    expect(await io.waitFor("ready")).toBe("ready");
    expect(await io.waitFor("pressed")).toBe("pressed");
    expect(asks).toEqual([revealAskFor("ready").title, revealAskFor("pressed").title]);
  });

  it("an abort and a timeout pass straight through — neither is a press", async () => {
    const abort = makeRevealIo(async () => ({ signal: "abort", provenance: null }) as const);
    const timeout = makeRevealIo(async () => ({ signal: "timeout", provenance: null }) as const);
    expect(await abort.waitFor("ready")).toBe("abort");
    expect(await abort.waitFor("pressed")).toBe("abort");
    expect(await timeout.waitFor("pressed")).toBe("timeout");
  });

  it("**the press hint names the SellerOps button, not a file the operator could create**", () => {
    const io = makeRevealIo(async () => CONFIRMED);
    expect(io.pressSignalHint).toContain(OPERATOR_CONFIRM_BUTTON_LABEL);
    expect(io.pressSignalHint).not.toContain(".ready");
    expect(io.pressSignalHint).not.toContain(".pressed");
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

describe("makeRevealIo — the channels are a contract", () => {
  it("narration goes to stderr and the sanitized record to STDOUT", () => {
    // Swapping them survived every test. The record is the machine-readable artifact of the run; emitting it on
    // stderr and the prose on stdout means the record never reaches a caller capturing stdout.
    const out: string[] = [];
    const err: string[] = [];
    const [oLog, oErr] = [console.log, console.error];
    console.log = (...a: unknown[]) => void out.push(a.map(String).join(" "));
    console.error = (...a: unknown[]) => void err.push(a.map(String).join(" "));
    try {
      const io = makeRevealIo(async () => ({ signal: "timeout", provenance: null }));
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
    const base = {
      stop: "OBSERVED" as const,
      result: null,
      eligibility: null,
      outcomeAsExpected: true,
      cleanupFailed: false,
    };
    expect(revealExitCode(base)).toBe(0);
    expect(revealExitCode({ ...base, outcomeAsExpected: false })).toBe(6);
    expect(revealExitCode({ ...base, stop: "ABORTED_AT_CHECKPOINT", outcomeAsExpected: false })).toBe(7);
    expect(revealExitCode({ ...base, cleanupFailed: true })).toBe(8);
    expect(revealExitCode({ ...base, stop: "BLIND_INSTRUMENT", outcomeAsExpected: false })).toBe(9);
    // …and the codes are pairwise distinct, so no two classes can be collapsed.
    const codes = [
      revealExitCode(base),
      revealExitCode({ ...base, outcomeAsExpected: false }),
      revealExitCode({ ...base, stop: "NOT_OPEN_API_SURFACE", outcomeAsExpected: false }),
      revealExitCode({ ...base, cleanupFailed: true }),
      revealExitCode({ ...base, stop: "BLIND_INSTRUMENT", outcomeAsExpected: false }),
    ];
    expect(new Set(codes).size).toBe(5);
    // 9 must not collapse into the generic "nothing observed" 7. They call for opposite responses: 7 can be
    // retried as-is, 9 cannot — the instrument, not the run, is what failed.
    expect(revealExitCode({ ...base, stop: "BLIND_INSTRUMENT", outcomeAsExpected: false })).not.toBe(
      revealExitCode({ ...base, stop: "ABORTED_AT_CHECKPOINT", outcomeAsExpected: false }),
    );
    // A stuck overlay outranks everything: it is the only one describing state left on the seller's live page.
    expect(revealExitCode({ ...base, stop: "NOT_OPEN_API_SURFACE", cleanupFailed: true })).toBe(8);
    // Including 9. The pair is reachable — `clearHighlight()` reports NOT cleared whenever the page is
    // unreadable, which can happen on the blind path too — and pinning 8-over-7 alone left the ordering of
    // 8-against-9 free to flip.
    expect(revealExitCode({ ...base, stop: "BLIND_INSTRUMENT", cleanupFailed: true, outcomeAsExpected: false })).toBe(8);
  });

  it("main() CALLS banner() — printing it is not the same as showing it", () => {
    // The sixth instance of this branch's dominant pattern. The guard moved from "the constant holds the two
    // claim lines" to "banner() prints them" and stopped one layer short: deleting `banner();` from main()
    // typechecks, keeps every suite green, and the operator opens a live WING window told none of the six lines
    // — strictly worse than the `.slice(0, 4)` mutation the previous fix was written for.
    const src2 = readFileSync(SRC, "utf8");
    const body = src2.slice(src2.indexOf("async function main(): Promise<void>"));
    expect(body).toContain("banner();");
    // …and FIRST, before any refusal path can return early without disclosing anything.
    expect(body.indexOf("banner();")).toBeLessThan(body.indexOf("hasCoupangWingRunApproval"));
  });

  it("main() reads the report and delegates the code to revealExitCode", () => {
    const src2 = readFileSync(SRC, "utf8");
    const body = src2.slice(src2.indexOf("async function main(): Promise<void>"));
    expect(body).toContain("const report = await runRevealWalk(");
    expect(body).toContain("process.exitCode = revealExitCode(report);");
  });

  it("**main() wires the confirmation channel, and no readiness file survives it**", () => {
    // The predecessor of this test guarded the one place a label was re-joined to a sentinel FILE: drop the
    // consumer, point both waits at the same path, and the human checkpoint is skipped in silence. There is no
    // such file any more, so what has to be guarded is that none came back and that the walk's IO is built from
    // the confirmation host rather than from the filesystem.
    const src2 = readFileSync(SRC, "utf8");
    const body = src2.slice(src2.indexOf("async function main(): Promise<void>"));
    expect(body).toContain("attachOperatorConfirmTab(");
    expect(body).toContain("confirmHost.confirm(ask)");
    expect(body).not.toContain("REVEAL_READY_FILENAME");
    expect(body).not.toContain("REVEAL_DONE_FILENAME");
    // The driver reads a context the confirmation tab is filtered out of. `activePage()` takes the NEWEST tab,
    // so an unfiltered context would have the reveal observation land on the blank SellerOps surface.
    expect(body).toContain("context: confirmHost.contextLike");
    // The abort sentinel is still cleared before the browser opens: a leftover from a killed run would
    // otherwise abort this one on tick 0. It is the ONLY file this run reads.
    const sweep = "removeSentinel(abortPath);";
    expect(body.split(sweep).length - 1, "both the startup and the teardown clear must be present").toBe(2);
    expect(body.indexOf(sweep), "the startup clear must run BEFORE the browser launches").toBeLessThan(
      body.indexOf("launchNaverContext("),
    );
    const names = [...body.matchAll(/sentinelPath\(cfg\.statusFile, (REVEAL_\w+)\)/g)].map((m) => m[1]!);
    expect(names).toEqual(["REVEAL_ABORT_FILENAME"]);
  });
});

/* ────────────────────── the pre-press detection-eligibility gate ────────────────────── */

/**
 * The gate that decides whether the operator is asked to press 발급 at all.
 *
 * It exists because "this bucket is below its ceiling" and "this signal can move on WING" are different claims,
 * and the reveal runtime was reading the first as the second. `submitAffordancePresent` has structural headroom on
 * every WING baseline — `!false` — and live evidence says it cannot fire there, so a capability check that counts
 * it would pass forever on the strength of the one detector proven blind.
 *
 * What the gate does NOT assert: that Stage-2 will be detected. Only that we do not ask for a real marketplace
 * press when every remaining detector is already refuted.
 */
describe("stage2DetectionEligibility — structural headroom is not empirical detectability", () => {
  it("splits the live-recorded blind baseline into headroom=1, refuted=1, eligible=0", () => {
    const e = stage2DetectionEligibility(blindObservation());
    expect(e.structuralHeadroomDisjuncts).toEqual(["submitAffordancePresent"]);
    expect(e.empiricallyRefutedDisjuncts).toEqual(["submitAffordancePresent"]);
    // The whole point: headroom is non-empty, and the run is still blind.
    expect(e.structuralHeadroomDisjuncts.length).toBeGreaterThan(0);
    expect(e.eligibleDetectionDisjuncts).toEqual([]);
  });

  it("never counts a refuted disjunct as eligible, on ANY baseline", () => {
    // Guards the mutation that re-admits `submitAffordancePresent` to the eligible set — the precise regression
    // that would restore the false-capability reading, and which the count-only assertions above cannot see.
    for (const obs of [blindObservation(), OPEN_API, AFTER_FORM, observation({ dialogLikePresent: true })]) {
      const e = stage2DetectionEligibility(obs);
      for (const refuted of WING_EMPIRICALLY_REFUTED_DISJUNCTS) {
        expect(e.eligibleDetectionDisjuncts).not.toContain(refuted);
      }
      // …and the three layers stay consistent: eligible ⊎ refuted partitions the structural headroom exactly.
      expect([...e.eligibleDetectionDisjuncts, ...e.empiricallyRefutedDisjuncts].sort()).toEqual(
        [...e.structuralHeadroomDisjuncts].sort(),
      );
    }
  });

  it("an UNMEASURED signal is not promoted to eligibility", () => {
    // `undefined` is not a measured zero. A census that never emitted these fields cannot support a transition,
    // so the fields must contribute nothing — not "no ceiling reached, therefore capable".
    const e = stage2DetectionEligibility(blindObservation());
    expect(e.structuralHeadroomDisjuncts).not.toContain("dialogLikePresent");
    expect(e.structuralHeadroomDisjuncts).not.toContain("choiceControlCountBucket");
    expect(e.structuralHeadroomDisjuncts).not.toContain("actionControlCountBucket");
    expect(e.eligibleDetectionDisjuncts).toEqual([]);
  });

  it("a measured baseline with room yields real eligibility", () => {
    const e = stage2DetectionEligibility(OPEN_API);
    expect(e.eligibleDetectionDisjuncts).toEqual([
      "dialogLikePresent",
      "choiceControlCountBucket",
      "actionControlCountBucket",
    ]);
  });

  it("a ceilinged measured baseline is blind even though the fields WERE measured", () => {
    // Measured is not the same as capable. Every ladder at its top ⇒ nothing can rise ⇒ eligible is empty, and
    // the gate must refuse exactly as it does for the unmeasured case.
    const e = stage2DetectionEligibility(
      observation({ dialogLikePresent: true, choiceControlCount: 40, actionControlCount: 40 }),
    );
    expect(e.eligibleDetectionDisjuncts).toEqual([]);
  });

  it("the refuted list is a strict subset of the predicate's disjuncts", () => {
    // A name that is not a disjunct would subtract nothing and silently weaken the gate to a no-op.
    for (const r of WING_EMPIRICALLY_REFUTED_DISJUNCTS) expect(STAGE2_DISJUNCTS).toContain(r);
    expect(WING_EMPIRICALLY_REFUTED_DISJUNCTS.length).toBeLessThan(STAGE2_DISJUNCTS.length);
  });

  it("refuting a disjunct removes it from eligibility WITHOUT removing it from the predicate", () => {
    // The predicate keeps `submitAffordancePresent`: a real Stage-2 that does emit `type=submit` should still be
    // recognised. Only the pre-press capability claim drops it.
    expect(STAGE2_DISJUNCTS).toContain("submitAffordancePresent");
    expect(stage2DisjunctsWithHeadroom(blindObservation())).toContain("submitAffordancePresent");
  });
});

describe("runRevealWalk — BLIND_INSTRUMENT stops before the operator is asked to act", () => {
  it("a blind baseline stops the walk and never highlights, checkpoints, or hints the press", async () => {
    const { driver, io, order, notes } = harness({ classifyObservation: blindObservation() });
    const report = await runRevealWalk(driver, io, "wing_host");

    expect(report.stop).toBe("BLIND_INSTRUMENT");
    expect(revealExitCode(report)).toBe(9);
    // Nothing touched the page beyond the read-only classify — no tag, no overlay, no probe.
    expect(order).not.toContain("highlight");
    expect(order).not.toContain("probe");
    expect(order).not.toContain("note:checkpoint");
    expect(order).not.toContain("note:presshint");
    // …and the operator was never asked for the press sentinel, so no press could be reported.
    expect(order).not.toContain("wait:pressed");
    expect(order).not.toContain("observe");
    expect(order).not.toContain("emit");
    // The overlay teardown still runs on this path, like every other exit.
    expect(order).toContain("cleanup");
    expect(noteText(notes)).toContain("BLIND_INSTRUMENT");
  });

  it("the refusal DISCLOSES all three sets, not just the verdict", async () => {
    const { driver, io, notes } = harness({ classifyObservation: blindObservation() });
    const report = await runRevealWalk(driver, io, "wing_host");
    // Asserted FIRST. Without it this passes under a gate that lets the blind baseline through to the
    // checkpoint, where the same disclosure prints the same three lines — "some path discloses" is not the
    // property. Review caught exactly that.
    expect(report.stop).toBe("BLIND_INSTRUMENT");
    const text = noteText(notes);
    expect(text).toContain("structural headroom (1): submitAffordancePresent");
    expect(text).toContain("empirically refuted on WING (1): submitAffordancePresent");
    expect(text).toContain("ELIGIBLE detectors (0)");
  });

  it("the gate reads the ELIGIBLE set, not the structural one", async () => {
    // The mutation this catches is a one-word swap in the gate condition. Under it the blind baseline — whose
    // structural headroom is NON-empty — sails through to the checkpoint and the operator is asked to press.
    //
    // The premise is asserted, not assumed: if structural headroom were empty here, both readings would refuse
    // and the test would pass while distinguishing nothing.
    expect(stage2DisjunctsWithHeadroom(blindObservation()).length).toBeGreaterThan(0);
    // ONE harness. The first version destructured `order` from one and passed a second harness's `io`, so the
    // array under assertion never received a single io event — every narration property its name claims was
    // unobservable through it. Review caught it.
    const { driver, io, order, notes } = harness({ classifyObservation: blindObservation() });
    const report = await runRevealWalk(driver, io, "wing_host");
    expect(report.stop).toBe("BLIND_INSTRUMENT");
    expect(order).not.toContain("highlight");
    // The operator-facing property the name actually asserts: they are never invited to press.
    expect(order).not.toContain("note:presshint");
    expect(noteText(notes)).not.toContain("Press 발급 YOURSELF");
  });

  it("an ELIGIBLE baseline reaches the checkpoint and the press hint, in order", async () => {
    const { driver, io, order } = harness();
    const report = await runRevealWalk(driver, io, "wing_host");
    expect(report.stop).toBe("OBSERVED");
    expect(order).toContain("highlight");
    expect(order).toContain("note:presshint");
    // Disclosure precedes the press request — the operator learns what can be seen BEFORE being asked to act.
    expect(order.indexOf("note:checkpoint")).toBeLessThan(order.indexOf("note:presshint"));
    expect(order.indexOf("note:presshint")).toBeLessThan(order.indexOf("wait:pressed"));
  });

  it("the eligibility disclosure is printed before the press hint, with the eligible names", async () => {
    const { driver, io, notes } = harness();
    await runRevealWalk(driver, io, "wing_host");
    const text = noteText(notes);
    const disclosure = text.indexOf("ELIGIBLE detectors (3)");
    expect(disclosure).toBeGreaterThan(-1);
    expect(disclosure).toBeLessThan(text.indexOf("Press 발급 YOURSELF"));
    expect(text).toContain("dialogLikePresent, choiceControlCountBucket, actionControlCountBucket");
  });

  it("the gate runs BEFORE the highlight even when the 발급 selector is fine", async () => {
    // Ordering, not just presence: a gate placed after `highlightIssueCheckpoint` would tag and paint the live
    // page before refusing — the seller sees a spotlight on a control the run then declines to watch.
    const { driver, io, order } = harness({ classifyObservation: blindObservation(), matchCount: 1 });
    await runRevealWalk(driver, io, "wing_host");
    // Narration is filtered out so the assertion pins the INTERACTIONS, not how many lines the disclosure runs to.
    expect(order.filter((o) => o !== "note")).toEqual(["wait:ready", "classify", "cleanup"]);
  });

  it("the report carries the eligibility on the refusal path", async () => {
    const { driver, io } = harness({ classifyObservation: blindObservation() });
    const report = await runRevealWalk(driver, io, "wing_host");
    // The stop is part of the property: without it this passes under a gate that never refuses, because the
    // checkpoint path carries the identical eligibility.
    expect(report.stop).toBe("BLIND_INSTRUMENT");
    expect(report.eligibility?.eligibleDetectionDisjuncts).toEqual([]);
    expect(report.eligibility?.structuralHeadroomDisjuncts).toEqual(["submitAffordancePresent"]);
  });

  it("a walk that never classifies has NO eligibility rather than an empty-looking one", async () => {
    // `null` and "computed, and empty" are different facts. Defaulting the field to an empty object would make an
    // aborted run read as a measured blind one.
    const { driver, io } = harness({ signals: ["abort"] });
    const report = await runRevealWalk(driver, io, "wing_host");
    expect(report.stop).toBe("ABORTED_BEFORE_CHECKPOINT");
    expect(report.eligibility).toBeNull();
  });

  it("an OFF-SURFACE refusal reports NO eligibility, though it does hold an observation", async () => {
    // The docstring used to say null meant "no baseline existed". It does not: this path classified. Capability
    // measured against a login or credential page is not a fact about the reveal surface, and reporting it as
    // one is the same over-claim the gate exists to prevent — so it is deliberately not computed here.
    const { driver, io } = harness({ classifyOk: false });
    const report = await runRevealWalk(driver, io, "wing_host");
    expect(report.stop).toBe("NOT_OPEN_API_SURFACE");
    expect(report.eligibility).toBeNull();
  });
});

describe("the emitted record carries the computed sets", () => {
  it("emits all three sets, computed from THIS run's baseline — not a literal", async () => {
    // Against the DEFAULT baseline this test was passable by a hardcoded literal: `OPEN_API` is every test's
    // classify observation, so the expected value was a compile-time constant and a fabricated record matching
    // it survived. Review demonstrated the surviving mutation. A non-default baseline removes the constant.
    const baseline = observation({ choiceControlCount: 40, actionControlCount: 12 });
    const { driver, io, emitted } = harness({
      classifyObservation: baseline,
      result: result({ before: baseline, detectableDisjuncts: stage2DisjunctsWithHeadroom(baseline) }),
    });
    await runRevealWalk(driver, io, "wing_host");
    expect(emitted).toHaveLength(1);
    const rec = emitted[0]!;
    expect(rec.detectionEligibility).toEqual(stage2DetectionEligibility(baseline));
    // …and it is NOT the default baseline's answer, so a literal keyed to `OPEN_API` cannot pass.
    expect(rec.detectionEligibility).not.toEqual(stage2DetectionEligibility(OPEN_API));
  });

  it("the two independently-computed capability reports AGREE", async () => {
    // The code comment claimed this test existed. It did not, and the fixture actively contradicted it: every
    // emitted record carried a `detectableDisjuncts` of `["submitAffordancePresent"]` beside a
    // `structuralHeadroomDisjuncts` of all four, and the only assertion on the field was `Array.isArray`.
    // Both derive from the same baseline in the real driver, so disagreement means one of them is wrong.
    const baseline = observation({ choiceControlCount: 40, actionControlCount: 12 });
    const { driver, io, emitted } = harness({
      classifyObservation: baseline,
      result: result({ before: baseline, detectableDisjuncts: stage2DisjunctsWithHeadroom(baseline) }),
    });
    await runRevealWalk(driver, io, "wing_host");
    const rec = emitted[0]!;
    const e = rec.detectionEligibility as ReturnType<typeof stage2DetectionEligibility>;
    expect(e.structuralHeadroomDisjuncts).toEqual(rec.detectableDisjuncts);
    expect(e.structuralHeadroomDisjuncts.length).toBeGreaterThan(0);
  });

  it("a bare count is NOT the whole record — the sets themselves survive", async () => {
    // The pre-repair shape logged `detectableDisjunctCount` and nothing else, so a `SURFACE_UNCHANGED` could not
    // be read against what the run was able to see. A count alone must never be the only surviving evidence.
    const { driver, io, emitted } = harness();
    await runRevealWalk(driver, io, "wing_host");
    const rec = emitted[0]!;
    expect(Array.isArray((rec.detectionEligibility as { eligibleDetectionDisjuncts: unknown }).eligibleDetectionDisjuncts)).toBe(true);
    expect(Array.isArray(rec.detectableDisjuncts)).toBe(true);
  });

  it("the emitted record stays sanitized — names and enums only", async () => {
    const { driver, io, emitted } = harness();
    await runRevealWalk(driver, io, "wing_host");
    const json = JSON.stringify(emitted[0]);
    // Disjunct names are field identifiers, never page content. Nothing here may carry a URL, selector, or text.
    for (const forbidden of ["http", "://", "발급 받기", "querySelector", "button[", "<"]) {
      expect(json).not.toContain(forbidden);
    }
  });
});
