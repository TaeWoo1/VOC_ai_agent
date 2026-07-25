/**
 * **The in-page guidance panel's copy discipline, and the assembly that feeds it.**
 *
 * Guidance moved into the marketplace page (2026-07-26) so the seller can finish an import without watching a
 * second window. That put user-facing prose inside the runtime for the first time, which is exactly where
 * contract §6 says it must never be authored. The arrangement that keeps §6 intact is: the frontend sends the
 * words, the runtime does lookup and `{param}` substitution, and there is no fallback sentence anywhere.
 *
 * These tests pin that arrangement from both directions — the behaviour of the assembly, and the ABSENCE of any
 * Korean string in the two modules that could quietly reintroduce runtime-authored copy.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ActionWindowRunView } from "../../../contracts/action-window/v2/index";
import type { AwGuidancePack } from "../../../contracts/action-window/v2/transport";
import {
  guidancePanelStateFrom,
  isGuidancePack,
  panelCommandLabel,
  PANEL_COMMANDS,
} from "../../src/action-window/guidance-copy";

const PACK: AwGuidancePack = {
  chrome: {
    product: "SellerOps",
    stepCounter: "STEP {step}/{total}",
    requiredRange: "WINDOW {start} - {end}",
    blockedLabel: "STOPPED",
  },
  steps: {
    "actionWindow.import.setStartDate": "PICK-START",
    "actionWindow.import.export": "PRESS-EXPORT",
  },
  blockers: { SCOPE_MISMATCH: { title: "WRONG-WINDOW", fix: "FIX-THE-DATES" } },
  commands: { REQUEST_STEP_RECHECK: "RECHECK", CANCEL_RUN: "STOP" },
  recheck: {
    byBlocker: { SCOPE_MISMATCH: "RECHECK-DATES" },
    byStep: { "actionWindow.import.export": "RECHECK-EXPORT" },
    fallback: "RECHECK-FALLBACK",
  },
};

function view(over: Partial<ActionWindowRunView> = {}): ActionWindowRunView {
  return {
    protocolVersion: 2,
    runId: "run_a",
    revision: 4,
    channelCode: "naver",
    runCopyKey: "actionWindow.run.naverInitialReviewImportSegment",
    status: "WAITING_FOR_HUMAN",
    executionMode: "ACTION_WINDOW",
    intent: "INITIAL_REVIEW_IMPORT_SEGMENT",
    currentStep: {
      stepId: "aw.import_set_start_date",
      stepNumber: 3,
      totalSteps: 8,
      copyKey: "actionWindow.import.setStartDate",
      copyParams: { targetKind: "start_date", requiredStart: "2026-06-01", requiredEnd: "2026-06-30" },
      status: "AWAITING_USER",
    },
    guidanceEnabled: true,
    allowedCommands: ["REQUEST_STEP_RECHECK", "PAUSE_RUN", "CANCEL_RUN", "SWITCH_TO_MANUAL"],
    progress: { completedSteps: 2, totalSteps: 8 },
    updatedAt: "2026-01-01T00:00:00.000001Z",
    ...over,
  };
}

describe("guidancePanelStateFrom", () => {
  it("substitutes the runtime's facts into the frontend's templates", () => {
    const state = guidancePanelStateFrom(view(), PACK);
    expect(state?.product).toBe("SellerOps");
    expect(state?.instruction).toBe("PICK-START");
    // Neither side could produce these lines alone: the wording is the frontend's, the numbers and dates the
    // runtime's.
    expect(state?.stepLine).toBe("STEP 3/8");
    expect(state?.requiredRange).toBe("WINDOW 2026-06-01 - 2026-06-30");
  });

  /**
   * The rule that makes copy ownership structural. A step the frontend has no sentence for renders NO sentence
   * — the panel still shows the spotlight and the counter, and stays quiet about what to do.
   */
  it("renders no instruction at all for a copy key the frontend did not send", () => {
    const state = guidancePanelStateFrom(
      view({
        currentStep: { ...view().currentStep!, copyKey: "actionWindow.import.applyRange" },
      }),
      PACK,
    );
    expect(state?.instruction).toBe("");
    // And nothing was invented in its place.
    expect(JSON.stringify(state)).not.toContain("applyRange");
  });

  it("shows nothing without a pack — there is no runtime-authored fallback", () => {
    expect(guidancePanelStateFrom(view(), null)).toBeNull();
  });

  it("omits the window line when the step carries no required dates", () => {
    const state = guidancePanelStateFrom(
      view({ currentStep: { ...view().currentStep!, copyParams: { targetKind: "start_date" } } }),
      PACK,
    );
    expect(state?.requiredRange).toBe("");
  });

  it("states the cause AND the repair when the run is blocked", () => {
    const state = guidancePanelStateFrom(
      view({ blocker: { code: "SCOPE_MISMATCH", recoverable: true } }),
      PACK,
    );
    expect(state?.blocked).toEqual({ label: "STOPPED", title: "WRONG-WINDOW", fix: "FIX-THE-DATES" });
  });

  /** A blocker the frontend has no words for renders no blocker box rather than a bare code. */
  it("shows no blocker box for a code the frontend did not send", () => {
    const state = guidancePanelStateFrom(
      view({ blocker: { code: "DOWNLOAD_TIMEOUT", recoverable: false } }),
      PACK,
    );
    expect(state?.blocked).toBeNull();
  });

  it("offers only the panel's own commands, and only those the runtime allows", () => {
    const state = guidancePanelStateFrom(view(), PACK);
    // `SWITCH_TO_MANUAL` and `PAUSE_RUN` are allowed by the runtime but are not panel controls — a seller
    // mid-export has two decisions, not six.
    expect(state?.actions).toEqual([
      { command: "REQUEST_STEP_RECHECK", label: "RECHECK-FALLBACK" },
      { command: "CANCEL_RUN", label: "STOP" },
    ]);
  });

  it("drops a command the frontend never named", () => {
    const pack: AwGuidancePack = { ...PACK, commands: { REQUEST_STEP_RECHECK: "RECHECK" } };
    const state = guidancePanelStateFrom(view(), pack);
    expect(state?.actions.map((a) => a.command)).toEqual(["REQUEST_STEP_RECHECK"]);
  });

  it("hides the panel on a terminal run rather than leaving its last instruction up", () => {
    for (const status of ["COMPLETED", "FAILED", "CANCELLED", "OPERATOR_REPORTED"] as const) {
      expect(guidancePanelStateFrom(view({ status }), PACK), status).toBeNull();
    }
  });

  /** Guidance off is the seller asking not to be guided. It must silence the marketplace-side panel too. */
  it("hides the panel when guidance is switched off", () => {
    expect(guidancePanelStateFrom(view({ guidanceEnabled: false }), PACK)).toBeNull();
  });
});

describe("panelCommandLabel — contextual recheck wording", () => {
  /**
   * One fixed label cannot be right everywhere. "확인 완료" reads correctly at a date field and means nothing at
   * a download barrier; on the 2026-07-25 live run the operator could not find the control they had been told
   * to press. Resolution is blocker → step → fallback, because what a run is BLOCKED on describes the repair
   * better than the step it is nominally at.
   */
  it("prefers the blocker's wording over the step's", () => {
    const label = panelCommandLabel(PACK, "REQUEST_STEP_RECHECK", {
      stepCopyKey: "actionWindow.import.export",
      blockerCode: "SCOPE_MISMATCH",
    });
    expect(label).toBe("RECHECK-DATES");
  });

  it("falls back to the step's wording when nothing is blocked", () => {
    const label = panelCommandLabel(PACK, "REQUEST_STEP_RECHECK", {
      stepCopyKey: "actionWindow.import.export",
      blockerCode: null,
    });
    expect(label).toBe("RECHECK-EXPORT");
  });

  it("uses the frontend's fallback when neither is named", () => {
    const label = panelCommandLabel(PACK, "REQUEST_STEP_RECHECK", { stepCopyKey: null, blockerCode: null });
    expect(label).toBe("RECHECK-FALLBACK");
  });

  it("takes every other command's label straight from the pack, and null when absent", () => {
    const ctx = { stepCopyKey: null, blockerCode: null };
    expect(panelCommandLabel(PACK, "CANCEL_RUN", ctx)).toBe("STOP");
    expect(panelCommandLabel(PACK, "PAUSE_RUN", ctx)).toBeNull();
  });
});

describe("isGuidancePack", () => {
  it("accepts the shape the frontend sends", () => {
    expect(isGuidancePack(PACK)).toBe(true);
  });

  /**
   * Fail closed on a malformed pack rather than render half a panel: a panel missing the line that says what to
   * do is worse than no panel, because the seller cannot tell it is incomplete.
   */
  it.each([
    ["not an object", "nope"],
    ["null", null],
    ["no chrome", { ...PACK, chrome: undefined }],
    ["empty product", { ...PACK, chrome: { ...PACK.chrome, product: "" } }],
    ["non-string step copy", { ...PACK, steps: { a: 1 } }],
    ["blocker missing its fix", { ...PACK, blockers: { X: { title: "t" } } }],
    ["no recheck fallback", { ...PACK, recheck: { byBlocker: {}, byStep: {} } }],
  ])("refuses %s", (_label, value) => {
    expect(isGuidancePack(value)).toBe(false);
  });
});

/* ────────────────────────── the copy-ownership source guard ────────────────────────── */

const MODULES = ["guidance-copy.ts", "guidance-panel.ts"] as const;

/** Comment lines are stripped first: prose ABOUT Korean copy must not fail a check on Korean copy. */
function codeOf(file: string): string {
  const source = readFileSync(join(__dirname, "../../src/action-window", file), "utf8");
  let inBlock = false;
  const out: string[] = [];
  for (const line of source.split("\n")) {
    const t = line.trim();
    if (inBlock) {
      if (t.includes("*/")) inBlock = false;
      continue;
    }
    if (t.startsWith("/*")) {
      if (!t.includes("*/")) inBlock = true;
      continue;
    }
    if (t.startsWith("//") || t.startsWith("*")) continue;
    out.push(line.replace(/\/\/.*$/, ""));
  }
  return out.join("\n");
}

describe("the guidance runtime authors no copy", () => {
  /**
   * The strongest form of "the FE owns all copy" available: there is no Korean string in the modules that
   * render the panel, so a runtime-authored sentence cannot be added without failing this test. Note it is not
   * a style rule — every word the seller reads in the marketplace page arrives from the frontend or does not
   * exist.
   */
  it.each(MODULES)("has no Korean string literal in %s", (file) => {
    expect(codeOf(file)).not.toMatch(/[가-힣]/);
  });

  /** The panel must never be able to press a marketplace control — it is an input surface, not an actor. */
  it("never clicks anything in the page", () => {
    const code = codeOf("guidance-panel.ts");
    expect(code).not.toContain(".click(");
    expect(code).not.toContain("dispatchEvent");
    expect(code).not.toContain("submit(");
  });

  /**
   * Two properties of the panel's own DOM, both load-bearing: it takes pointer events (it has buttons, unlike
   * the spotlight, which must stay transparent), and its own button clicks are stopped at the panel so they can
   * never continue into a marketplace control underneath.
   */
  it("is the one interactive layer, and contains its own clicks", () => {
    const code = codeOf("guidance-panel.ts");
    expect(code).toContain("pointer-events:auto");
    expect(code).toContain("event.stopPropagation()");
    expect(code).toContain("event.preventDefault()");
  });

  /** Copy is inserted as TEXT. Treating the frontend's prose as markup would make a copy change an injection. */
  it("never writes markup from the pack", () => {
    const code = codeOf("guidance-panel.ts");
    expect(code).not.toContain("innerHTML");
    expect(code).not.toContain("insertAdjacentHTML");
    expect(code).toContain("textContent");
  });

  it("offers exactly the two commands a seller has decisions about", () => {
    expect([...PANEL_COMMANDS]).toEqual(["REQUEST_STEP_RECHECK", "CANCEL_RUN"]);
  });
});
