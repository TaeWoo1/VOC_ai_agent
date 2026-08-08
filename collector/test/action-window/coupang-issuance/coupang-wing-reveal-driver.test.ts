/**
 * The WING issuance-form REVEAL driver — the step that separates the operator's first `발급` press from key
 * creation, which the shipped guided runtime conflates.
 *
 * Four properties matter more than the mechanics, and each is asserted on behaviour rather than trusted:
 *
 *  1. **The agent never acts on the marketplace.** A source guard proves there is no click/type/submit path at
 *     all — not "we don't call it", but "the token is not in the file".
 *  2. **The checkpoint is mandatory.** The operator-action step throws unless the expectation copy was painted,
 *     so the walk cannot reach a real WING press with nothing on screen explaining it.
 *  3. **The overlay is gone before the observation.** Observing through our own panel would census SellerOps'
 *     own injected DOM as WING structure — and could invent the very `submitAffordancePresent` flip the outcome
 *     is decided on.
 *  4. **It never claims a key was not created, and never auto-advances.** `keyCreationRuledOut` is structurally
 *     `false`; the outcome enum has no success-adjacent member for an unrecognized surface.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CoupangWingRevealDriver,
  WING_KEY_CREATION_ACTION,
  WING_REVEAL_CHECKPOINT_LABEL,
  WING_REVEAL_OPERATOR_ACTION,
  WING_REVEAL_OUTCOMES,
  changedSignalNames,
  classifyRevealOutcome,
} from "../../../src/action-window/coupang-wing-reveal-driver";
import { WING_HIGHLIGHT_LABELS, WING_ISSUE_SELECTOR_CALIBRATED, WING_ISSUE_CALIBRATION_EVIDENCE } from "../../../src/action-window/coupang-wing-issuance-driver";
import type { WingObservation } from "../../../src/cli/coupang-wing-classifier";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../../../src/action-window/coupang-wing-reveal-driver.ts");

/** The real no-key initial surface, as measured on 2026-08-08 (three independent captures agreed). */
function initialSurface(over: Partial<WingObservation["signals"]> = {}): WingObservation {
  return {
    urlCategory: "wing_host",
    pageCategory: "open_api_issuance",
    signals: {
      urlCategory: "wing_host",
      passwordFieldPresent: false,
      submitAffordancePresent: false,
      formCountBucket: "few",
      editableTextInputCountBucket: "many",
      readonlyFieldCountBucket: "none",
      listLikeContainerCountBucket: "many",
      openApiMarkerPresent: false,
      credentialAnchorPresent: true,
      markerScanTruncated: false,
      ...over,
    },
    blockers: ["LIVE_DOM_CALIBRATION_PENDING"],
  };
}

interface FakeOpts {
  /** Census values returned in order; the last is repeated once exhausted. */
  censuses?: Partial<WingObservation["signals"]>[];
  /** What the fixed-label locate returns for 발급. */
  issueCount?: number;
  issueSig?: string;
  url?: string;
  /** Whether the checkpoint panel reports as painted. */
  painted?: boolean;
  /** Panel still up when `clearHighlight` re-checks ⇒ the clear failed. */
  panelStuck?: boolean;
}

function fakeDriver(o: FakeOpts = {}): {
  driver: CoupangWingRevealDriver;
  evaluated: string[];
  mounts: { label: string; residentPanel?: boolean }[];
} {
  const evaluated: string[] = [];
  const mounts: { label: string; residentPanel?: boolean }[] = [];
  let censusIdx = 0;
  let paintChecks = 0;
  const page = {
    url: () => o.url ?? "https://wing.coupang.com/tenants/seller-api",
    evaluate: async (script: string): Promise<unknown> => {
      evaluated.push(script);
      if (script.includes("visual-recon") || script.includes("issuance-fixed-label")) {
        const count = o.issueCount ?? 1;
        return count === 1 ? { count: 1, sig: o.issueSig ?? "abcdef0123456789" } : { count };
      }
      // the census
      const over = o.censuses?.[Math.min(censusIdx, (o.censuses.length ?? 1) - 1)] ?? {};
      censusIdx += 1;
      const s = initialSurface(over).signals;
      return {
        passwordFieldPresent: s.passwordFieldPresent,
        submitAffordancePresent: s.submitAffordancePresent,
        formCount: s.formCountBucket === "few" ? 2 : 0,
        editableTextInputCount: 40,
        readonlyFieldCount: 0,
        listLikeContainerCount: 40,
        openApiMarkerPresent: s.openApiMarkerPresent,
        credentialAnchorPresent: s.credentialAnchorPresent,
        markerScanTruncated: s.markerScanTruncated,
      };
    },
  };
  const driver = new CoupangWingRevealDriver(page as never, {
    locatorSettleMs: 0,
    verifyPollMs: 0,
    mountOverlayFn: (async (_p: unknown, opts: { label: string; residentPanel?: boolean }) => {
      mounts.push({ label: opts.label, residentPanel: opts.residentPanel });
    }) as never,
    // Called TWICE with different meanings: once to verify the mount painted, once after the clear to verify it
    // is gone. A fake that answered the same both times could not tell the two apart — and the clear-before-
    // observe property is exactly what needs proving here.
    checkpointPaintedFn: (async () => {
      if (mounts.length === 0) return false; // nothing mounted yet
      if (!(o.painted ?? true)) return false; // the mount never painted
      paintChecks += 1;
      if (paintChecks === 1) return true; // mount verification
      return o.panelStuck ?? false; // post-clear verification
    }) as never,
  });
  return { driver, evaluated, mounts };
}

/* ────────────────────────────── the agent acts on nothing ────────────────────────────── */

describe("source guard — the agent has no marketplace action path at all", () => {
  const raw = readFileSync(SRC, "utf8");
  const code = raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => {
      const t = l.trim();
      return !t.startsWith("//") && !t.startsWith("*");
    })
    .join("\n");

  it("contains no click / type / submit / keyboard token", () => {
    for (const forbidden of [
      ".click(", ".dblclick(", ".tap(", ".hover(", ".type(", ".fill(", ".press(",
      ".check(", ".uncheck(", ".selectOption(", ".setInputFiles(", ".keyboard", "dispatchEvent", ".submit(",
    ]) {
      expect(code, `must not contain ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("reads no field value and captures no screenshot / DOM", () => {
    for (const forbidden of [".inputValue(", ".textContent(", ".innerText", ".innerHTML", ".outerHTML", "screenshot", ".content("]) {
      expect(code, `must not contain ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("never navigates — the operator does", () => {
    for (const forbidden of [".goto(", ".goBack(", ".reload(", "window.location"]) {
      expect(code, `must not contain ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("names the key-creating action ONLY to declare it forbidden — it has no code path", () => {
    // The whole point of the phase. The constant may be referenced; there must be nothing that performs it.
    expect(code).toContain("WING_KEY_CREATION_ACTION");
    expect(WING_KEY_CREATION_ACTION).not.toBe(WING_REVEAL_OPERATOR_ACTION as string);
    // It must TARGET exactly one label — `issue`. Checking for the Korean words themselves would be wrong: the
    // checkpoint copy legitimately says "실제 키 발급/최종 확인은 … 하지 않습니다", which is the sentence telling the
    // operator that 확인 is NOT part of this step. What must be absent is any locator for another control.
    expect(code).toContain("WING_HIGHLIGHT_LABELS.issue");
    for (const other of [
      "WING_HIGHLIGHT_LABELS.self_dev", "WING_HIGHLIGHT_LABELS.vendor_info", "WING_HIGHLIGHT_LABELS.call_ip",
      "WING_HIGHLIGHT_LABELS.credentials", "WING_DELETION_LABELS", "WING_STAGE2_RECON_CANDIDATES",
    ]) {
      expect(code, `the driver must not locate ${other}`).not.toContain(other);
    }
    // …and exactly one locate call site, so a second control cannot be resolved alongside it.
    expect(code.match(/buildFixedLabelLocateScript\(/g) ?? []).toHaveLength(1);
  });
});

/* ────────────────────────────── refusals ────────────────────────────── */

describe("the driver refuses before it can mislead", () => {
  it("refuses a page that is not the open-API surface, and records no baseline", async () => {
    const { driver } = fakeDriver({ censuses: [{ passwordFieldPresent: true }] });
    const res = await driver.classifyInitialSurface();
    expect(res.ok).toBe(false);
    expect(driver.currentPhase()).toBe("init");
    // …and the checkpoint is unreachable from there.
    await expect(driver.highlightIssueCheckpoint()).rejects.toThrow(/classify the initial open-API surface/);
  });

  it("refuses to highlight when the 발급 control does not resolve uniquely", async () => {
    for (const issueCount of [0, 2, 7]) {
      const { driver, mounts } = fakeDriver({ issueCount });
      await driver.classifyInitialSurface();
      const located = await driver.highlightIssueCheckpoint();
      expect(located.count, `issueCount=${issueCount}`).toBe(issueCount);
      expect(mounts, `issueCount=${issueCount}`).toHaveLength(0);
      expect(driver.currentPhase()).toBe("classified");
    }
  });

  it("highlights and rests when it resolves to exactly one", async () => {
    const { driver, mounts } = fakeDriver({ issueCount: 1, issueSig: "1111222233334444" });
    await driver.classifyInitialSurface();
    const located = await driver.highlightIssueCheckpoint();
    expect(located).toEqual({ count: 1, sig: "1111222233334444" });
    expect(driver.currentPhase()).toBe("highlighted");
    expect(mounts).toHaveLength(1);
  });

  it("refuses to highlight at all when the issue calibration is withdrawn", async () => {
    const { driver } = fakeDriver();
    await driver.classifyInitialSurface();
    const uncalibrated = new CoupangWingRevealDriver({ url: () => "https://wing.coupang.com/x" } as never, {
      calibrated: false,
    });
    expect(uncalibrated.isCalibrated()).toBe(false);
    await expect(uncalibrated.highlightIssueCheckpoint()).rejects.toThrow(/not calibrated/);
    // The default is the SHARED constant, never a hardcoded true.
    expect(driver.isCalibrated()).toBe(WING_ISSUE_SELECTOR_CALIBRATED);
  });

  it("the operator-action step requires the checkpoint — it cannot be skipped", async () => {
    const { driver } = fakeDriver();
    await driver.classifyInitialSurface();
    await expect(driver.observeRevealOutcome()).rejects.toThrow(/checkpoint required/);
  });

  it("a checkpoint that failed to PAINT does not reach `highlighted`", async () => {
    // Awaiting `mountOverlay` proves nothing — it returns silently when the tagged element is gone. Without this
    // the operator would face a real 발급 press with no copy on screen explaining what it does.
    const { driver } = fakeDriver({ painted: false });
    await driver.classifyInitialSurface();
    expect((await driver.highlightIssueCheckpoint()).count).toBe(0);
    expect(driver.currentPhase()).toBe("classified");
    expect(driver.checkpointPaintDidFail()).toBe(true);
    await expect(driver.observeRevealOutcome()).rejects.toThrow(/checkpoint required/);
  });
});

/* ────────────────────────────── the checkpoint copy ────────────────────────────── */

describe("the checkpoint copy tells the operator the truth about the press", () => {
  it("states the outcome as an EXPECTATION and excludes key issuance from this step", () => {
    expect(WING_REVEAL_CHECKPOINT_LABEL).toContain("예상됩니다");
    expect(WING_REVEAL_CHECKPOINT_LABEL).toContain("실제 키 발급");
    expect(WING_REVEAL_CHECKPOINT_LABEL).toContain("하지 않습니다");
    // It must NOT promise the transition as a fact — that is the claim no live run has confirmed.
    expect(WING_REVEAL_CHECKPOINT_LABEL).not.toMatch(/이동합니다(?!\s*라고)/);
  });

  it("is mounted in the RESIDENT panel — the ring badge would truncate it off-screen", () => {
    expect(WING_REVEAL_CHECKPOINT_LABEL.length).toBeGreaterThan(60);
  });

  it("the mounted label IS that copy, in the resident panel", async () => {
    const { driver, mounts } = fakeDriver();
    await driver.classifyInitialSurface();
    await driver.highlightIssueCheckpoint();
    expect(mounts[0]!.label).toBe(WING_REVEAL_CHECKPOINT_LABEL);
    expect(mounts[0]!.residentPanel).toBe(true);
  });
});

/* ────────────────────────────── the outcome ────────────────────────────── */

describe("classifyRevealOutcome — narrow on purpose, and every non-expected outcome is a STOP", () => {
  it("a submit affordance appearing on the open-API surface is the expected outcome", () => {
    const before = initialSurface();
    const after = initialSurface({ submitAffordancePresent: true });
    expect(classifyRevealOutcome(before, after)).toBe("CONFIGURATION_SURFACE_SUSPECTED");
  });

  it("no observable change is SURFACE_UNCHANGED, not a pass", () => {
    expect(classifyRevealOutcome(initialSurface(), initialSurface())).toBe("SURFACE_UNCHANGED");
  });

  it("a change that is not the expected shape is UNRECOGNIZED — never rounded up to success", () => {
    // This is the outcome a real Stage-2 would produce if it does NOT present a submit affordance. Reporting it
    // honestly is the point: it is a STOP and it is the evidence the next unit needs.
    const after = initialSurface({ readonlyFieldCountBucket: "few" });
    expect(classifyRevealOutcome(initialSurface(), after)).toBe("SURFACE_CHANGED_UNRECOGNIZED");
  });

  it("leaving the open-API surface is OFF_OPEN_API_SURFACE, even if a submit affordance appeared", () => {
    const after: WingObservation = { ...initialSurface({ submitAffordancePresent: true }), pageCategory: "login" };
    expect(classifyRevealOutcome(initialSurface(), after)).toBe("OFF_OPEN_API_SURFACE");
  });

  it("a missing observation on either side is NOT_OBSERVED", () => {
    expect(classifyRevealOutcome(null, initialSurface())).toBe("NOT_OBSERVED");
    expect(classifyRevealOutcome(initialSurface(), null)).toBe("NOT_OBSERVED");
  });

  it("the outcome enum has NO member asserting a key was not created", () => {
    // The classifier cannot distinguish issued from no-key on any sanitized signal, so no outcome may imply it.
    for (const o of WING_REVEAL_OUTCOMES) {
      expect(o).not.toMatch(/NO_KEY|NOT_ISSUED|SAFE|CLEAN/i);
    }
  });

  it("changedSignalNames compares by KEY, so a census field added later is not silently ignored", () => {
    const before = initialSurface();
    const after = initialSurface({ submitAffordancePresent: true, readonlyFieldCountBucket: "few" });
    expect(changedSignalNames(before, after)).toEqual(["readonlyFieldCountBucket", "submitAffordancePresent"]);
    expect(changedSignalNames(before, before)).toEqual([]);
    // pageCategory is not a signal but is reported alongside them.
    expect(changedSignalNames(before, { ...before, pageCategory: "credential_shown" })).toEqual(["pageCategory"]);
  });
});

describe("the operator-action step", () => {
  it("clears the overlay BEFORE observing, and reports that it did", async () => {
    // Observing through our own panel would census SellerOps' injected DOM as WING structure — and could invent
    // the very submit affordance the outcome is decided on.
    const { driver } = fakeDriver({ censuses: [{}, { submitAffordancePresent: true }] });
    await driver.classifyInitialSurface();
    await driver.highlightIssueCheckpoint();
    const res = await driver.observeRevealOutcome();
    expect(res.overlayClearedBeforeObservation).toBe(true);
    expect(res.outcome).toBe("CONFIGURATION_SURFACE_SUSPECTED");
  });

  it("reports a FAILED clear rather than assuming success", async () => {
    const { driver } = fakeDriver({ panelStuck: true, censuses: [{}, { submitAffordancePresent: true }] });
    await driver.classifyInitialSurface();
    await driver.highlightIssueCheckpoint();
    const res = await driver.observeRevealOutcome();
    expect(res.overlayClearedBeforeObservation).toBe(false);
  });

  it("NEVER rules key creation out, whatever the outcome — and says why", async () => {
    for (const censuses of [[{}, { submitAffordancePresent: true }], [{}, {}], [{}, { readonlyFieldCountBucket: "few" as const }]]) {
      const { driver } = fakeDriver({ censuses });
      await driver.classifyInitialSurface();
      await driver.highlightIssueCheckpoint();
      const res = await driver.observeRevealOutcome();
      expect(res.keyCreationRuledOut).toBe(false);
      expect(res.keyCreationReason).toBe("NO_DISCRIMINATING_SIGNAL");
    }
  });

  it("stops after ONE observation — the phase becomes `observed` and never advances further", async () => {
    const { driver } = fakeDriver({ censuses: [{}, { submitAffordancePresent: true }] });
    await driver.classifyInitialSurface();
    await driver.highlightIssueCheckpoint();
    await driver.observeRevealOutcome();
    expect(driver.currentPhase()).toBe("observed");
    // A second call is refused: there is no path from `observed` onward.
    await expect(driver.observeRevealOutcome()).rejects.toThrow(/checkpoint required/);
  });

  it("carries both observations plus the changed signal NAMES, and no values beyond them", async () => {
    const { driver } = fakeDriver({ censuses: [{}, { submitAffordancePresent: true }] });
    await driver.classifyInitialSurface();
    await driver.highlightIssueCheckpoint();
    const res = await driver.observeRevealOutcome();
    expect(res.changedSignals).toEqual(["submitAffordancePresent"]);
    const wire = JSON.stringify(res);
    for (const leak of ["wing.coupang.com", "https://", "Access Key", "발급"]) {
      expect(wire, leak).not.toContain(leak);
    }
  });
});

/* ────────────────────────────── the calibration claim ────────────────────────────── */

describe("the issue calibration is scoped to the LOCATOR, not to what the press does", () => {
  it("declares the press outcome UNCONFIRMED", () => {
    expect(WING_ISSUE_CALIBRATION_EVIDENCE.pressOutcome).toBe("UNCONFIRMED");
    expect(WING_ISSUE_CALIBRATION_EVIDENCE.matchCount).toBe(1);
    expect(WING_ISSUE_CALIBRATION_EVIDENCE.label).toBe(WING_HIGHLIGHT_LABELS.issue.exactText);
  });

  it("records the signature as EVIDENCE_ONLY, because four captures show it MOVING", () => {
    // Stronger than "stability not established": the same control on the same page reported two different
    // signatures across sessions, so any runtime gate comparing against one would compare against a moving value.
    expect(WING_ISSUE_CALIBRATION_EVIDENCE.signatureRole).toBe("EVIDENCE_ONLY");
    expect(WING_ISSUE_CALIBRATION_EVIDENCE.signatureStability).toBe("CROSS_SESSION_VARIATION_OBSERVED");
    expect(new Set(WING_ISSUE_CALIBRATION_EVIDENCE.observedSig16).size).toBeGreaterThan(1);
    for (const sig of WING_ISSUE_CALIBRATION_EVIDENCE.observedSig16) expect(sig).toMatch(/^[0-9a-f]{16}$/);
  });

  it("is backed by one record id per capture, across BOTH account states", () => {
    expect(WING_ISSUE_CALIBRATION_EVIDENCE.recordIds).toHaveLength(WING_ISSUE_CALIBRATION_EVIDENCE.captureCount);
    expect(new Set(WING_ISSUE_CALIBRATION_EVIDENCE.recordIds).size).toBe(WING_ISSUE_CALIBRATION_EVIDENCE.captureCount);
    expect([...WING_ISSUE_CALIBRATION_EVIDENCE.surfaces]).toEqual(["already_issued_page", "no_key_initial_surface"]);
  });

  it("does NOT flip the overall WING highlight calibration — the other three targets are still unresolved", async () => {
    const { WING_HIGHLIGHT_CALIBRATION } = await import("../../../src/action-window/coupang-wing-issuance-driver");
    expect(WING_HIGHLIGHT_CALIBRATION).toBe("LIVE_DOM_CALIBRATION_PENDING");
  });
});
