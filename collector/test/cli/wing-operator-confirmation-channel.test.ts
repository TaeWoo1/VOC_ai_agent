/**
 * **The WING recorder advances on a verified press, and on nothing else.**
 *
 * The failure being locked out happened on 2026-08-13: a calibration checkpoint advanced because the assistant
 * created the `.ready` sentinel on the strength of a chat line the operator never wrote. The run halted one
 * checkpoint later — at the screen gate, not at the confirmation — and the measurement it was taking was lost.
 *
 * These tests therefore assert two different KINDS of thing, and both are needed:
 *  - behaviour: the discovery loop takes no reading, and records no provenance, without a `ready` confirmation;
 *  - source shape: the readiness sentinel is GONE from the recorder, the confirmation surface is a separate page
 *    the driver never measures, and the operator's instruction reaches the surface from the same builder that
 *    printed it. None of those can be proved by driving the fake deps, because they live in `main()`.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { OPERATOR_UI_CONFIRMED } from "../../src/cli/operator-confirm";
import { WING_FLOW_CHECKPOINTS, WING_STAGE2_RECON_TARGETS } from "../../src/action-window/coupang-wing-label-recon";
import {
  WING_ISSUANCE_FLOW_DISCOVERY_PHASE,
  baselineAskCopy,
  discoveryCheckpointCopy,
  runWingFlowDiscovery,
  runWingSelectorRecord,
  withConfirmTail,
  type WingOperatorAsk,
  type WingSelectorRecordDeps,
} from "../../src/cli/probe-wing-issuance-selectors";
import { observeFrom, type WingStructuralCensus } from "../../src/cli/coupang-wing-classifier";
import { OPERATOR_ABORTED, OPERATOR_CONFIRMED, OPERATOR_TIMED_OUT } from "../fixtures/operator-confirmation";

const SOURCE = readFileSync(resolve(__dirname, "../../src/cli/probe-wing-issuance-selectors.ts"), "utf8");
/**
 * The source with COMMENTS STRIPPED. The doc comment above the abort sentinel names the readiness file it
 * replaced — deliberately, because a reader deserves to know what used to be there — and a bare substring sweep
 * over the whole file would read that history as the defect it records.
 */
const CODE = SOURCE.split("\n")
  .filter((l) => {
    const t = l.trimStart();
    return !t.startsWith("*") && !t.startsWith("/*") && !t.startsWith("//");
  })
  .join("\n");

const CENSUS: WingStructuralCensus = {
  passwordFieldPresent: false,
  submitAffordancePresent: false,
  dialogLikePresent: false,
  choiceControlCount: 2,
  actionControlCount: 3,
  formCount: 2,
  editableTextInputCount: 6,
  readonlyFieldCount: 0,
  listLikeContainerCount: 5,
  markerScanTruncated: false,
  openApiMarkerPresent: false,
  credentialAnchorPresent: true,
};

const PURPOSE_TEXT = "키의 사용 목적을 골라주세요";
const onPurposeScreen = (text: string): boolean => text === PURPOSE_TEXT;

/** Minimal deps: enough for the discovery loop to take a reading, with the confirmation seam scripted. */
function deps(script: readonly (typeof OPERATOR_CONFIRMED)[], asks: WingOperatorAsk[] = []): WingSelectorRecordDeps {
  let i = 0;
  return {
    awaitOperatorConfirmation: async (ask) => {
      asks.push(ask);
      return script[i++] ?? OPERATOR_TIMED_OUT;
    },
    observeSurface: async () => observeFrom("wing_host", CENSUS),
    probeTarget: async () => ({ matchCount: 0, canHighlight: false }),
    // The purpose screen, and only it. `probeContainment` has to answer too: a presence verdict needs both, and
    // without it every reading is NOT_MEASURED and the screen gate halts the run before the second checkpoint.
    probeCandidate: async (spec) => (onPurposeScreen(spec.exactText) ? { matchCount: 1, canHighlight: true } : { matchCount: 0, canHighlight: false }),
    probeContainment: async (spec) =>
      onPurposeScreen(spec.exactText)
        ? { exactVisible: 1, exactHidden: 0, deepestContainsVisible: 1, deepestContainsHidden: 0, scanTruncated: false }
        : { exactVisible: 0, exactHidden: 2, deepestContainsVisible: 0, deepestContainsHidden: 3, scanTruncated: false },
    choiceAssociationCensus: async () => null,
  };
}

describe("a checkpoint advances only on a confirmed press", () => {
  it("every reading records the channel that let it happen", async () => {
    const flow = await runWingFlowDiscovery(deps([OPERATOR_CONFIRMED, OPERATOR_CONFIRMED]), {
      targets: [...WING_STAGE2_RECON_TARGETS],
      phase: WING_ISSUANCE_FLOW_DISCOVERY_PHASE,
      checkpoints: WING_FLOW_CHECKPOINTS.slice(0, 2),
    });
    expect(flow.readings.length).toBe(2);
    for (const reading of flow.readings) expect(reading.confirmedBy).toBe(OPERATOR_UI_CONFIRMED);
  });

  it("a timeout takes no reading at all — it does not fall through to one", async () => {
    const flow = await runWingFlowDiscovery(deps([OPERATOR_TIMED_OUT]), {
      targets: [...WING_STAGE2_RECON_TARGETS],
      phase: WING_ISSUANCE_FLOW_DISCOVERY_PHASE,
      checkpoints: WING_FLOW_CHECKPOINTS.slice(0, 2),
    });
    expect(flow.readings).toEqual([]);
    expect(flow.halted).toBe("OPERATOR_SIGNAL_TIMEOUT");
  });

  it("an abort halts, and the readings taken before it keep their provenance", async () => {
    const flow = await runWingFlowDiscovery(deps([OPERATOR_CONFIRMED, OPERATOR_ABORTED]), {
      targets: [...WING_STAGE2_RECON_TARGETS],
      phase: WING_ISSUANCE_FLOW_DISCOVERY_PHASE,
      checkpoints: WING_FLOW_CHECKPOINTS.slice(0, 2),
    });
    expect(flow.halted).toBe("OPERATOR_ABORTED");
    expect(flow.aborted).toBe(true);
    expect(flow.readings.map((r) => r.confirmedBy)).toEqual([OPERATOR_UI_CONFIRMED]);
  });

  it("the single-reading run records the provenance too, and null when nothing confirmed it", async () => {
    const confirmed = await runWingSelectorRecord(deps([OPERATOR_CONFIRMED]), []);
    expect(confirmed.confirmedBy).toBe(OPERATOR_UI_CONFIRMED);
    const timedOut = await runWingSelectorRecord(deps([OPERATOR_TIMED_OUT]), []);
    expect(timedOut.confirmedBy).toBeNull();
    expect(timedOut.observation).toBeNull();
  });

  it("each wait is told WHICH checkpoint it is asking about, so the surface can show that copy", async () => {
    const asks: WingOperatorAsk[] = [];
    await runWingFlowDiscovery(deps([OPERATOR_CONFIRMED, OPERATOR_CONFIRMED], asks), {
      targets: [...WING_STAGE2_RECON_TARGETS],
      phase: WING_ISSUANCE_FLOW_DISCOVERY_PHASE,
      checkpoints: WING_FLOW_CHECKPOINTS.slice(0, 2),
    });
    expect(asks).toEqual([
      { checkpoint: WING_FLOW_CHECKPOINTS[0], index: 0, total: 2 },
      { checkpoint: WING_FLOW_CHECKPOINTS[1], index: 1, total: 2 },
    ]);
  });
});

describe("the printed record carries the provenance", () => {
  it("every reading's confirmedBy travels into the JSON a reviewer reads", () => {
    // It was only in the run's log lines at first. The record is the artefact that outlives the terminal, and a
    // record that cannot show HOW its checkpoints advanced is one an auditor would have to take on trust.
    expect(CODE).toContain("confirmedBy: r.confirmedBy");
  });
});

describe("the readiness sentinel is gone, not merely unused", () => {
  it("the recorder names no readiness file and reads none", () => {
    expect(CODE).not.toContain("probe-wing-issuance-selectors.ready");
    expect(CODE).not.toContain("RECORD_SENTINEL_FILENAME");
    expect(CODE).not.toContain("recordSentinelPathFor");
    expect(CODE).not.toContain("readyPath");
  });

  it("the ABORT sentinel survives, and the asymmetry is deliberate", () => {
    // A forged abort stops a run. Only ADVANCING needs a channel a model cannot reach, so the abort path is
    // left as a file the operator (or Ctrl+C) can use without a browser.
    expect(CODE).toContain("probe-wing-issuance-selectors.abort");
    expect(CODE).toContain("existsSync(abortPath)");
  });

  it("nothing in the recorder can mint a confirmation from a string", () => {
    // The one construction of a `ready` confirmation lives in `operator-confirm`, behind the verifier. A literal
    // here would be a second door into the same room.
    expect(CODE).not.toContain('signal: "ready"');
    expect(CODE).not.toContain("OPERATOR_UI_CONFIRMED");
  });
});

describe("the confirmation surface is separate from the page being measured", () => {
  it("the driver's context excludes the confirmation page", () => {
    // `activePage()` takes the NEWEST tab. Handed an unfiltered context, every measurement would land on the
    // blank confirmation page and be reported as a confident reading of nothing.
    expect(SOURCE).toContain("ctx.pages().filter((p) => p !== confirmPage)");
    expect(SOURCE).toContain("new CoupangWingIssuanceDriver(entry, { context: wingPages })");
  });

  it("the confirmation lives on its own page — nothing is mounted on the marketplace page", () => {
    expect(CODE).toContain("const confirmPage = (await ctx.newPage())");
    // The recorder's standing claim is that it adds nothing to WING. Evaluating the confirm scripts anywhere but
    // the confirmation page would retire that claim for a convenience.
    expect(CODE).toContain("evalOnConfirmPage");
    expect(CODE).not.toContain("entry.evaluate");
  });

  it("the run raises its own confirmation tab", () => {
    // Not the operator's job, and not the OS's. Raising the window from outside (`open -a`) routes into Chrome's
    // user-data-dir singleton and opens a THIRD blank window inside the run's own browser — a page the recorder
    // would then read as the newest tab. Playwright raises the TAB inside the context that owns it.
    expect(CODE).toContain("onArmed: () => (confirmPage as unknown as { bringToFront(): Promise<void> }).bringToFront()");
  });

  it("a fresh token is minted per wait, inside the seam", () => {
    const seam = SOURCE.slice(SOURCE.indexOf("awaitOperatorConfirmation: async (ask)"));
    expect(seam.slice(0, seam.indexOf("},"))).toContain("token: mintOperatorConfirmToken()");
  });

  it("the token is never logged — only the signal and the provenance are", () => {
    const logLines = CODE.split("\n").filter((l) => l.includes("log(")).join("\n");
    expect(logLines).not.toContain("token");
  });
});

describe("the operator reads one set of words", () => {
  it("the terminal and the surface are built by the same function", () => {
    // `askCopyFor` feeds BOTH `announce`/`announceCheckpoint` and the confirmation seam. Two builders would let
    // the printed instruction and the confirmed instruction drift apart — which is the shape of the original
    // defect, where the instruction reached the operator through a paraphrase.
    expect(SOURCE).toContain("printAsk(askCopyFor(");
    expect(SOURCE).toContain("askCopyFor(ask)");
  });

  it("every checkpoint's copy names its step, and the tail says what advances it", () => {
    const abortPath = "/tmp/x/probe-wing-issuance-selectors.abort";
    WING_FLOW_CHECKPOINTS.forEach((checkpoint, index) => {
      const ask = withConfirmTail(discoveryCheckpointCopy(checkpoint, index, WING_FLOW_CHECKPOINTS.length), abortPath);
      expect(ask.title).toBe(`DISCOVERY ${index + 1}/${WING_FLOW_CHECKPOINTS.length}`);
      expect(ask.headline.length).toBeGreaterThan(0);
      expect(ask.lines.join("\n")).toContain("현재 화면 확인");
      expect(ask.lines.join("\n")).toContain(abortPath);
    });
  });

  it("no instruction still tells the operator to say ready or to create a readiness file", () => {
    const asks = [
      ...WING_FLOW_CHECKPOINTS.map((c, i) => discoveryCheckpointCopy(c, i, WING_FLOW_CHECKPOINTS.length)),
      baselineAskCopy(),
    ];
    for (const ask of asks) {
      const all = [ask.title, ask.headline, ...ask.lines].join("\n");
      expect(all).not.toMatch(/say "ready"/);
      expect(all).not.toContain("signal readiness");
      expect(all).not.toContain(".ready");
    }
  });
});
