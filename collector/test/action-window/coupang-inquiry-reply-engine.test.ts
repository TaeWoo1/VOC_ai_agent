/**
 * **The guided Coupang 고객문의 answer, and the things it must never be able to do.**
 *
 * Two kinds of property here. The first is ordinary: the three steps advance in order, only on a
 * reported human action, and the emitted views/events are valid against the v2 contract.
 *
 * The second is the reason this runtime exists in the shape it does. SellerOps must be structurally
 * incapable of posting a reply to Coupang, must never claim a reply was verified, and must never
 * point at a control on a screen nobody has measured. Those are asserted here as absences —
 * including a source-level check that no submit/click path was ever added — because a regression in
 * any of them would look like a feature.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateEventEnvelope, validateRunView } from "../../../contracts/action-window/v2/index";
import { CoupangInquiryReplyEngine } from "../../src/action-window/coupang-inquiry/coupang-inquiry-reply-engine";
import {
  COUPANG_INQUIRY_REPLY_STEP_PLAN,
  COUPANG_INQUIRY_REPLY_TOTAL_STEPS,
} from "../../src/action-window/coupang-inquiry/coupang-inquiry-reply-stages";

const HERE = dirname(fileURLToPath(import.meta.url));
const SUBMISSION_REF = "a1b2c3d4e5f60718";

function engine(): CoupangInquiryReplyEngine {
  // A synthetic monotonic ISO-like marker — the contract requires the shape, and the engine must
  // never reach for a wall clock of its own.
  let tick = 0;
  return new CoupangInquiryReplyEngine({
    runId: "run-coupang-inquiry-1",
    submissionRef: SUBMISSION_REF,
    clock: () => `2026-08-14T00:00:00.${String(++tick).padStart(3, "0")}Z`,
  });
}

/** Drive the run to the submit barrier — the state every interesting assertion starts from. */
function atSubmitBarrier(): CoupangInquiryReplyEngine {
  const run = engine();
  run.start();
  run.onWindowOpened();
  run.onScreenConfirmed();
  return run;
}

describe("the guided Coupang inquiry reply carries the seller and then rests", () => {
  it("walks the three steps in order, resting at both human barriers", () => {
    const run = engine();
    run.start();
    expect(run.currentStage()).toBe("PREPARE_SESSION");
    expect(run.view().status).toBe("PREPARING");

    run.onWindowOpened();
    // A window on the WING host is NOT the inquiry screen — the run says so by resting here.
    expect(run.currentStage()).toBe("WAIT_FOR_SCREEN");
    expect(run.view().status).toBe("WAITING_FOR_HUMAN");
    expect(run.isAtBarrier()).toBe(true);

    run.onScreenConfirmed();
    expect(run.currentStage()).toBe("WAIT_FOR_SUBMIT");
    expect(run.view().currentStep?.stepNumber).toBe(3);
    expect(run.isAtBarrier()).toBe(true);
  });

  it("**cannot skip a barrier** — a report from the wrong stage is refused", () => {
    const run = engine();
    run.start();
    // The seller never confirmed they reached the screen; a submission report here would be a
    // report about a barrier they never stood at.
    expect(run.onOperatorReported("OPERATOR_REPORTED_SUBMITTED")).toMatchObject({ ok: false });
    expect(run.onScreenConfirmed()).toMatchObject({ ok: false });
    expect(run.currentStage()).toBe("PREPARE_SESSION");
  });

  it("reaches OPERATOR_REPORTED, never COMPLETED, and reports verification separately", () => {
    const run = atSubmitBarrier();

    expect(run.onOperatorReported("OPERATOR_REPORTED_SUBMITTED")).toMatchObject({ ok: true });

    const view = run.view();
    expect(view.status).toBe("OPERATOR_REPORTED");
    // COMPLETED would claim SellerOps confirmed the reply landed. Nothing here can know that.
    expect(view.status).not.toBe("COMPLETED");
    expect(view.progress).toEqual({
      completedSteps: COUPANG_INQUIRY_REPLY_TOTAL_STEPS,
      totalSteps: COUPANG_INQUIRY_REPLY_TOTAL_STEPS,
    });

    const reported = run.events().filter((e) => e.type === "SUBMISSION_REPORTED");
    expect(reported).toHaveLength(1);
    // The two fields stay separate so no consumer can read a report as a confirmation.
    expect(reported[0]!.payload.operatorOutcome).toBe("OPERATOR_REPORTED_SUBMITTED");
    expect(reported[0]!.payload.verification).toBe("UNVERIFIED");
  });

  it("records an abort as its own outcome rather than as a failure or a success", () => {
    const run = atSubmitBarrier();

    run.onOperatorReported("SUBMISSION_ABORTED");

    const terminal = run.events().find((e) => e.type === "RUN_OPERATOR_REPORTED");
    expect(terminal?.payload.operatorOutcome).toBe("SUBMISSION_ABORTED");
    expect(terminal?.payload.verification).toBe("UNVERIFIED");
    expect(run.view().status).toBe("OPERATOR_REPORTED");
  });

  it("every emitted view and event is valid against the v2 contract", () => {
    const run = engine();
    const views = [];
    run.start();
    views.push(run.view());
    run.onWindowOpened();
    views.push(run.view());
    run.onScreenConfirmed();
    views.push(run.view());
    run.pause();
    views.push(run.view());
    run.resume();
    run.onOperatorReported("OPERATOR_REPORTED_SUBMITTED");
    views.push(run.view());

    for (const view of views) {
      expect(validateRunView(view), JSON.stringify(view)).toMatchObject({ ok: true });
    }
    for (const event of run.events()) {
      expect(validateEventEnvelope(event), JSON.stringify(event)).toMatchObject({ ok: true });
    }
  });

  it("a paused run offers only resume/cancel/find, and refuses to advance", () => {
    const run = atSubmitBarrier();
    run.pause();

    expect(run.view().status).toBe("PAUSED");
    expect(run.view().allowedCommands).toEqual(["RESUME_RUN", "CANCEL_RUN", "FIND_CURRENT_STEP"]);
    expect(run.onOperatorReported("OPERATOR_REPORTED_SUBMITTED")).toMatchObject({ ok: false });

    run.resume();
    expect(run.onOperatorReported("OPERATOR_REPORTED_SUBMITTED")).toMatchObject({ ok: true });
  });

  it("a cancelled run is terminal and offers nothing", () => {
    const run = atSubmitBarrier();

    expect(run.cancel()).toMatchObject({ ok: true });
    expect(run.view().status).toBe("CANCELLED");
    expect(run.view().allowedCommands).toEqual([]);
    expect(run.onOperatorReported("OPERATOR_REPORTED_SUBMITTED")).toMatchObject({ ok: false });
    expect(run.cancel()).toMatchObject({ ok: false });
  });

  it("**the seller can always leave the guided run** at either barrier", () => {
    const run = engine();
    run.start();
    run.onWindowOpened();
    expect(run.view().allowedCommands).toContain("SWITCH_TO_MANUAL");
    run.onScreenConfirmed();
    expect(run.view().allowedCommands).toContain("SWITCH_TO_MANUAL");
  });
});

describe("what this runtime is structurally unable to do", () => {
  it("refuses to exist without an opaque binding to an approved draft", () => {
    for (const bad of ["", "not-hex", "A1B2C3D4E5F60718", "a1b2c3d4e5f6071", "reply text"]) {
      expect(
        () => new CoupangInquiryReplyEngine({ runId: "r", submissionRef: bad, clock: () => "t" }),
      ).toThrow(/submissionRef/);
    }
  });

  it("**never emits a highlight** — nothing on that screen has been measured", () => {
    const run = atSubmitBarrier();
    run.onOperatorReported("OPERATOR_REPORTED_SUBMITTED");

    // A guessed selector either points at the wrong control or silently matches nothing. Until a
    // calibration sitting measures the WING 고객문의 screen, pointing at nothing is the honest state.
    expect(run.events().some((e) => e.type === "TARGET_HIGHLIGHTED")).toBe(false);
    expect(run.events().some((e) => e.payload.targetRef !== undefined)).toBe(false);
  });

  it("never emits an observation — no DOM is read, so nothing is observed", () => {
    const run = atSubmitBarrier();
    run.onOperatorReported("OPERATOR_REPORTED_SUBMITTED");

    expect(run.events().some((e) => e.type === "USER_ACTION_OBSERVED")).toBe(false);
  });

  it("carries no reply text, inquiry id, or buyer anywhere in its events or view", () => {
    const run = atSubmitBarrier();
    run.onOperatorReported("OPERATOR_REPORTED_SUBMITTED");

    const wire = JSON.stringify({ view: run.view(), events: run.events() });
    // The engine is never given these, so this asserts the design rather than a filter: the only
    // binding that travels is the opaque ref.
    expect(wire).toContain(SUBMISSION_REF);
    for (const forbidden of ["오늘 출고", "onlineInquiry:", "buyer@", "4001"]) {
      expect(wire).not.toContain(forbidden);
    }
  });

  it("**has no submit or click path in its source** — the anti-double-post guarantee", () => {
    // The runtime's guarantee against double-posting is that it never posts. That is only true while
    // no driver call sneaks in, and this is the assertion that would catch one.
    for (const file of ["coupang-inquiry-reply-engine.ts", "coupang-inquiry-reply-stages.ts"]) {
      const source = readFileSync(
        resolve(HERE, "../../src/action-window/coupang-inquiry", file),
        "utf8",
      );
      const code = source
        .split("\n")
        .filter((line) => !line.trimStart().startsWith("*") && !line.trimStart().startsWith("//") && !line.trimStart().startsWith("/*"))
        .join("\n");
      for (const forbidden of [".click(", ".type(", ".fill(", ".press(", "page.", "evaluate("]) {
        expect(code, `${file} must not contain ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it("the step plan is exactly three steps, and only the first is automatic", () => {
    expect(COUPANG_INQUIRY_REPLY_STEP_PLAN).toHaveLength(3);
    expect(COUPANG_INQUIRY_REPLY_STEP_PLAN[0]!.mode).toBe("AUTOMATIC_OPERATION");
    // Both human steps are ACTION_WINDOW: the seller performs every marketplace action.
    expect(COUPANG_INQUIRY_REPLY_STEP_PLAN.slice(1).map((s) => s.mode)).toEqual([
      "ACTION_WINDOW",
      "ACTION_WINDOW",
    ]);
  });
});
