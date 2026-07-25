/**
 * The frame fix, pinned structurally.
 *
 * The first live run (2026-07-25) failed closed at `TARGET_NOT_FOUND` on the start-date control with
 * `dateInputCount: 0` and `iframePresent: true`: the driver read the TOP document while the NAVER review
 * surface is frame-hosted. The composed driver already resolves that frame, so the bug was one place where
 * this driver stopped composing and reached for the raw page.
 *
 * These are source-level assertions on purpose. The property that matters — "there is no way to read the top
 * document from here" — is about what the class CAN do, not about what one scripted call returns, and a
 * behavioural test with a fake page would pass even if the page handle came back.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NaverLiveImportDriver } from "../../../src/action-window/initial-import/naver-live-import-driver";

const SOURCE = readFileSync(
  join(__dirname, "../../../src/action-window/initial-import/naver-live-import-driver.ts"),
  "utf8",
);

/** Code only — prose about `this.page` in the module note must not fail these. */
const CODE = SOURCE.split("\n")
  .filter((line) => {
    const t = line.trim();
    return !t.startsWith("*") && !t.startsWith("//") && !t.startsWith("/*");
  })
  .join("\n");

describe("live import driver — frame resolution is shared", () => {
  /** With no page handle the mistake cannot recur by someone reaching for the convenient object. */
  it("holds no page handle at all", () => {
    expect(CODE).not.toContain("this.page");
    expect(CODE).not.toMatch(/private\s+readonly\s+page\s*:/);
  });

  it("takes only the composed driver, not a page", () => {
    expect(NaverLiveImportDriver.length).toBeLessThanOrEqual(2);
    expect(CODE).toContain("constructor(proven: NaverLiveProbeDriver");
  });

  it("reads every surface fact through the composed driver's resolved context", () => {
    expect(CODE).toContain("return this.proven.surfaceContext();");
    // Nothing reads a document except through ctx().
    const contentReads = [...CODE.matchAll(/\.content\(\)/g)].length;
    const ctxContentReads = [...CODE.matchAll(/this\.ctx\(\)\.content\(\)/g)].length;
    expect(contentReads).toBeGreaterThan(0);
    expect(ctxContentReads).toBe(contentReads);
  });

  it("evaluates, annotates and observes in that same context", () => {
    for (const call of [
      "this.ctx().evaluate(NAME_SHIM)",
      "mountOverlay(this.ctx()",
      "armObserver(this.ctx())",
      "waitForUserAction(this.ctx()",
    ]) {
      expect(CODE, call).toContain(call);
    }
  });

  /**
   * "Zero in the right frame" and "zero because we never left the top document" have the same symptom and
   * different fixes. Without this flag the first failure would have been undiagnosable from the log.
   */
  it("reports whether a child frame was actually resolved", () => {
    expect(CODE).toContain("frameResolved: this.proven.surfaceFrameResolved()");
    const unresolvedLog = CODE.slice(CODE.indexOf('log("aw_import_locate_unresolved"'));
    expect(unresolvedLog.slice(0, 300)).toContain("frameResolved");
  });

  /**
   * A date field is not a button. Clicking a calendar-backed input opens the picker; the seller may close it
   * without choosing. Advancing on that click would hand an unset date to the scope gate.
   */
  it("observes that a date was SET, not that the field was clicked", () => {
    expect(CODE).toContain("armDateObserve");
    expect(CODE).toContain("__aw_import_date_changed__");
    // The generic click observer is still used for the button-like targets, and not for the date ones.
    const armBody = CODE.slice(CODE.indexOf("async armTargetObserve"), CODE.indexOf("async waitForTargetAction"));
    expect(armBody).toContain('target === "start_date" || target === "end_date"');
    expect(armBody.indexOf("armDateObserve")).toBeLessThan(armBody.indexOf("armObserver"));
  });

  /** The seller's own date never crosses back to the agent — only a boolean does. */
  it("compares the date value in-page and returns only a boolean", () => {
    const arm = CODE.slice(CODE.indexOf("private async armDateObserve"), CODE.indexOf("private async waitForDateSet"));
    expect(arm).toContain("const baseline = first.value");
    // No return of a value, and nothing that would ship it out of the page.
    expect(arm).not.toMatch(/return\s+(el|first)\.value/);
    expect(CODE).toContain("waitForDateSet(timeoutMs: number): Promise<boolean>");
  });

  /**
   * A hazard, not a diagnosed failure — the distinction is the point.
   *
   * A captured node reference goes stale when Angular re-renders the conditions area, and the poll then
   * watches a DETACHED input whose value can never change again, so the barrier would wait forever while the
   * seller does everything right. This was written on the theory that it had caused the 2026-07-25 stall; the
   * operator's inspection disproved that (the tag was still on the input, and the run had actually passed the
   * barrier and parked at the scope gate). The property is worth holding anyway, and this test says so
   * without claiming evidence it does not have.
   */
  it("re-resolves the tagged input on every poll instead of capturing it once", () => {
    const arm = CODE.slice(CODE.indexOf("private async armDateObserve"), CODE.indexOf("private async waitForDateSet"));
    expect(arm).toContain("const resolve = ()");
    const pollBody = arm.slice(arm.indexOf("const poll = ()"));
    expect(pollBody).toContain("const el = resolve();");
    // The poll must not close over an element captured at arm time.
    expect(pollBody).not.toMatch(/\bfirst\.value\b/);
  });

  /**
   * `blur` must not mean "they acted".
   *
   * Focusing a calendar-backed field and clicking away is not a selection, and passing the barrier on it would
   * hand an unset date to the scope gate — the same class of mistake as advancing on a click.
   */
  it("never treats a focus loss alone as a date selection", () => {
    const arm = CODE.slice(CODE.indexOf("private async armDateObserve"), CODE.indexOf("private async waitForDateSet"));
    // Every listener runs the same value-diff poll; none sets the flag directly.
    expect(arm).toMatch(/for \(const ev of \["change", "input", "blur"\]\) first\.addEventListener\(ev, poll\)/);
    expect(arm).not.toMatch(/addEventListener\("blur",\s*(done|onCommit)/);
  });

  it("stops the value poll on cleanup so it cannot outlive the run", () => {
    const cleanup = CODE.slice(CODE.indexOf("async cleanup()"));
    expect(cleanup).toContain("clearInterval");
  });

  it("still never performs a marketplace action", () => {
    for (const token of [".click(", ".type(", ".fill(", ".press(", ".selectOption("]) {
      expect(CODE, token).not.toContain(token);
    }
  });
});

/**
 * The discovery capability, pinned where it is a privacy question rather than a behavioural one.
 *
 * Discovery is the ONE place the driver returns dates instead of a verdict, because there the range is the
 * run's product rather than incidental page content. That makes "which reads exist, and what they may log" the
 * property worth pinning structurally — a behavioural test with a fake page would pass with a `log` line that
 * shipped the seller's dates.
 */
/*
 * The two live defects the 2026-07-25 CTA run left behind, and the panel that replaced the "look at the other
 * window" assumption. Source-level for the same reason as the frame tests above: these are properties about
 * what this class can and cannot do — which context it reads, and what leaves a method — and a behavioural
 * test against a fake page would pass even if the property were broken.
 */
describe("live import driver — stopping, skipping, and the panel", () => {
  /** finding 12: a stopped run must not keep pointing at a control the seller has left. */
  it("clears the annotation AND the tag AND the date poll when the run stops", () => {
    const body = CODE.slice(CODE.indexOf("async clearTargetHighlight"), CODE.indexOf("async isTargetPrefilled"));
    expect(body).toContain("unmountOverlay(this.ctx())");
    expect(body).toContain('removeAttribute("data-aw-target")');
    // The poll would otherwise keep watching a field whose barrier is no longer open.
    expect(body).toContain("clearInterval");
  });

  /**
   * finding 13: the prefilled probe goes through the SAME read the gate uses. A second, independent value
   * read could disagree with the gate — which would skip a step and then block the run on the field it skipped.
   */
  it("answers the prefilled question through the gate's own read, and returns only a boolean", () => {
    const body = CODE.slice(CODE.indexOf("async isTargetPrefilled"), CODE.indexOf("async renderGuidance"));
    expect(body).toContain("this.proven.readExportScope()");
    expect(body).toContain("matchExportScope(readback.rangeValues");
    expect(body).toContain('verdict.match === "MATCH"');
    // Anything short of a full match asks the seller — the safe direction.
    expect(body).not.toContain("return true");
  });

  it("logs the prefilled verdict as a class and a boolean, never a date", () => {
    const body = CODE.slice(CODE.indexOf("async isTargetPrefilled"), CODE.indexOf("async renderGuidance"));
    for (const line of body.split("\n")) {
      if (!line.includes("log(")) continue;
      for (const forbidden of ["required.start", "required.end", "rangeValues"]) {
        expect(line, forbidden).not.toContain(forbidden);
      }
    }
    expect(body).toContain("prefilled, datesParsed: verdict.datesParsed");
  });

  /**
   * The panel is drawn in the SAME context as the spotlight. In a different document it would be describing a
   * control the seller cannot see next to it.
   */
  it("renders the panel in the resolved surface context, and unmounts on null", () => {
    const body = CODE.slice(CODE.indexOf("async renderGuidance"), CODE.indexOf("async takeGuidanceIntent"));
    expect(body).toContain("mountGuidancePanel(this.ctx()");
    expect(body).toContain("unmountGuidancePanel(this.ctx())");
  });

  /**
   * The runtime writes none of the panel's words: `renderGuidance` takes a fully-worded state and passes it
   * through. A string literal built here would be runtime-authored copy, which contract §6 gives to the FE.
   */
  it("authors no panel copy of its own", () => {
    const body = CODE.slice(CODE.indexOf("async renderGuidance"), CODE.indexOf("async takeGuidanceIntent"));
    expect(body).not.toMatch(/[가-힣]/);
    expect(body).toContain("state");
  });

  /** A finished run's instructions left on the seller's page are the in-page version of a stale highlight. */
  it("takes the panel down on cleanup", () => {
    const body = CODE.slice(CODE.indexOf("async cleanup()"));
    expect(body).toContain("unmountGuidancePanel(this.ctx())");
  });
});
