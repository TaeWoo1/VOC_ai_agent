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
import { readFileSync, readdirSync } from "node:fs";
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
  /**
   * Injected because the SHIPPED flag is now `false` (the 발급 calibration was refuted live). These cases exercise
   * what the walk does once past the calibration gate; with the real flag every one of them would stop at the
   * refusal and assert nothing about the behaviour it names. The gate itself is proven separately, from the
   * uninjected default, below — so this injection cannot hide a regression in it.
   */
  calibrated?: boolean;
}

function fakeDriver(o: FakeOpts = {}): {
  driver: CoupangWingRevealDriver;
  evaluated: string[];
  mounts: { label: string; residentPanel?: boolean }[];
  /** Every page interaction, in order — the only way to assert clear-BEFORE-observe. */
  order: string[];
} {
  const evaluated: string[] = [];
  const order: string[] = [];
  const mounts: { label: string; residentPanel?: boolean }[] = [];
  let censusIdx = 0;
  let paintChecks = 0;
  const page = {
    url: () => o.url ?? "https://wing.coupang.com/tenants/seller-api",
    evaluate: async (script: string): Promise<unknown> => {
      evaluated.push(script);
      // ORDER MATTERS in this dispatch: the locate script with `tag: true` ALSO queries `[data-aw-target]` (to
      // clear any prior tag), so a clear-tag check placed first swallows it and the highlight silently fails.
      // Match on the audited scripts' own comment markers instead of on a shared substring.
      if (script.includes("issuance-fixed-label-tag")) {
        order.push("tag");
        const count = o.issueCount ?? 1;
        return count === 1 ? { count: 1, sig: o.issueSig ?? "abcdef0123456789" } : { count };
      }
      if (script.includes("issuance-fixed-label-locate") || script.includes("visual-recon")) {
        order.push("locate");
        const count = o.issueCount ?? 1;
        return count === 1 ? { count: 1, sig: o.issueSig ?? "abcdef0123456789" } : { count };
      }
      if (script.includes("data-aw-target]")) {
        order.push("clear-tag");
        return 0;
      }
      order.push("census");
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
    calibrated: o.calibrated ?? true,
    locatorSettleMs: 0,
    verifyPollMs: 0,
    mountOverlayFn: (async (_p: unknown, opts: { label: string; residentPanel?: boolean }) => {
      order.push("mount");
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
  return { driver, evaluated, mounts, order };
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

  it("performs exactly ONE page mutation — the read-only tag — and clears it", () => {
    // What the token denylist above does NOT establish, said plainly: it proves no obvious Playwright action API
    // is called IN THIS FILE. A method that evaluated an in-page `HTMLElement.prototype.click.call(...)` string
    // would pass it (review demonstrated exactly that). So the page-side surface is bounded instead: the only
    // in-page scripts this driver may evaluate are the audited locate builder, the census, and the tag clear.
    const evalCalls = code.match(/this\.evalStr[<(]/g) ?? [];
    expect(evalCalls.length, "every in-page evaluation must be one of the three audited scripts").toBe(3);
    expect(code).toContain("buildFixedLabelLocateScript");
    expect(code).toContain("EXTRACT_WING_CENSUS");
    expect(code).toContain("IN_PAGE_CLEAR_TAG");
    // …and no method name suggests acting for the operator.
    for (const bad of ["press", "confirm", "issueKey", "submitForm", "fillVendor", "selectSelfDev"]) {
      expect(code, `no method may be named ${bad}*`).not.toMatch(new RegExp(`async\\s+${bad}`, "i"));
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
    const uncalibrated = new CoupangWingRevealDriver({ url: () => "https://wing.coupang.com/x" } as never, {
      calibrated: false,
    });
    expect(uncalibrated.isCalibrated()).toBe(false);
    await expect(uncalibrated.highlightIssueCheckpoint()).rejects.toThrow(/not calibrated/);
  });

  it("the UNINJECTED default is the shared constant — the only construction the live CLI uses", () => {
    // Read from a driver with NO `calibrated` option. The rest of this file injects `calibrated: true` to reach
    // the walk; if that injection were also the sole description of shipped behaviour, withdrawing the constant
    // would change nothing any test can see. Landed value asserted explicitly so a silent flip fails here too.
    const shipped = new CoupangWingRevealDriver({ url: () => "https://wing.coupang.com/x" } as never, {});
    expect(shipped.isCalibrated()).toBe(WING_ISSUE_SELECTOR_CALIBRATED);
    expect(WING_ISSUE_SELECTOR_CALIBRATED).toBe(true);
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
  it("states the outcome as an EXPECTATION, never as a fact", () => {
    expect(WING_REVEAL_CHECKPOINT_LABEL).toContain("예상되지만 확인된 사실은 아닙니다");
    expect(WING_REVEAL_CHECKPOINT_LABEL).not.toMatch(/열립니다(?!\s*라고)/);
    expect(WING_REVEAL_CHECKPOINT_LABEL).not.toMatch(/이동합니다(?!\s*라고)/);
  });

  it("tells the SELLER what to do — an imperative to STOP, not just a description of SellerOps", () => {
    // Review's most important UX finding. Every sentence used to describe what SellerOps would do; none told the
    // seller what to do. After the press they face a form that invites completion (자체개발 → 업체명 → URL → IP →
    // 확인) with the panel already torn down, so the natural continuation CREATES A KEY. These two sentences are
    // the only thing on screen that stops that, and they must not be softened away.
    expect(WING_REVEAL_CHECKPOINT_LABEL).toContain("더 진행하지 마세요");
    expect(WING_REVEAL_CHECKPOINT_LABEL).toContain("절대 누르지 마세요");
    expect(WING_REVEAL_CHECKPOINT_LABEL).toContain("확인");
  });

  it("names WHICH control, since the panel is detached from the highlight ring", () => {
    expect(WING_REVEAL_CHECKPOINT_LABEL).toContain("강조 표시된");
    expect(WING_REVEAL_CHECKPOINT_LABEL).toContain("발급");
    // "이 버튼" has no referent in a fixed bottom-centre box on a page with "many" inputs.
    expect(WING_REVEAL_CHECKPOINT_LABEL).not.toContain("이 버튼을");
  });

  it("carries the honest limit IN KOREAN — it used to exist only in English, in the terminal", () => {
    // The person who can resolve the ambiguity by looking at the screen is the one who never reads the terminal.
    expect(WING_REVEAL_CHECKPOINT_LABEL).toContain("판단할 수 없습니다");
    expect(WING_REVEAL_CHECKPOINT_LABEL).toContain("판매자만 확인할 수 있습니다");
  });

  it("discloses that the window closes on the signal, so the screen is read BEFORE signalling", () => {
    expect(WING_REVEAL_CHECKPOINT_LABEL).toContain("이 창은 닫히므로");
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

  it("the KEYS-DISPLAYED surface is its own outcome — never the expected one", () => {
    // Review's second-worst finding: `credential_shown` had been accepted as "still the open-API surface", so a
    // transition into the one category that most suggests a key WAS created came back as
    // CONFIGURATION_SURFACE_SUSPECTED — the benign, expected result. The worst possible input to round up.
    const after: WingObservation = {
      ...initialSurface({ submitAffordancePresent: true, readonlyFieldCountBucket: "few" }),
      pageCategory: "credential_shown",
    };
    expect(classifyRevealOutcome(initialSurface(), after)).toBe("CREDENTIAL_SURFACE_APPEARED");
    // …and it wins even with no other change at all.
    const quiet: WingObservation = { ...initialSurface(), pageCategory: "credential_shown" };
    expect(classifyRevealOutcome(initialSurface(), quiet)).toBe("CREDENTIAL_SURFACE_APPEARED");
  });

  it("an UNCLEARED overlay invalidates the reading — no outcome is claimed from it", () => {
    // The census counts our own injected panel's elements, so an observation taken through it is not a reading of
    // WING. It is ordered before every interpretation branch, including the credential surface.
    const after = initialSurface({ submitAffordancePresent: true });
    expect(classifyRevealOutcome(initialSurface(), after, false)).toBe("OVERLAY_NOT_CLEARED");
    const cred: WingObservation = { ...initialSurface(), pageCategory: "credential_shown" };
    expect(classifyRevealOutcome(initialSurface(), cred, false)).toBe("OVERLAY_NOT_CLEARED");
    // The default is `true`, so a caller that forgets the argument gets interpretation, not a silent skip.
    expect(classifyRevealOutcome(initialSurface(), after)).toBe("CONFIGURATION_SURFACE_SUSPECTED");
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

  it("compares by KEY — a signal the fixture does not know about is still reported", () => {
    // Review: replacing the key-union with a hardcoded list of today's ten signal names left every test green,
    // because no test ever passed an observation carrying an unknown key. This one does, in both directions.
    const before = initialSurface();
    const withNew = {
      ...before,
      signals: { ...before.signals, futureCensusField: "few" } as unknown as WingObservation["signals"],
    };
    expect(changedSignalNames(before, withNew)).toEqual(["futureCensusField"]);
    expect(changedSignalNames(withNew, before)).toEqual(["futureCensusField"]);
  });
});

describe("the operator-action step", () => {
  it("clears the overlay BEFORE the post-press census — asserted on the ORDER, not just the flag", async () => {
    // Found by review: moving the clear to AFTER the polling loop left all 29 tests green, because nothing
    // recorded the interleaving. The census would then read SellerOps' own injected panel as WING structure.
    const { driver, order } = fakeDriver({ censuses: [{}, { submitAffordancePresent: true }] });
    await driver.classifyInitialSurface();
    await driver.highlightIssueCheckpoint();
    order.length = 0; // ignore everything up to the operator-action step
    await driver.observeRevealOutcome();
    const firstCensus = order.indexOf("census");
    const clearTag = order.indexOf("clear-tag");
    expect(clearTag, "the tag clear must happen").toBeGreaterThan(-1);
    expect(firstCensus, "a census must happen").toBeGreaterThan(-1);
    expect(clearTag, "the overlay/tag clear must precede the post-press census").toBeLessThan(firstCensus);
  });

  it("removes the read-only data-aw-target annotation, not just the overlay", async () => {
    // Review found it left on the seller's live marketplace DOM while the docstring claimed both were removed.
    // It also matters mechanically: `mountOverlay` finds its ring by `[data-aw-target]` and early-returns when
    // there is none, so a stale tag lets a LATER mount report painted against an element it never located.
    const { driver, order } = fakeDriver();
    await driver.classifyInitialSurface();
    await driver.highlightIssueCheckpoint();
    expect(order).toContain("tag");
    await driver.cleanup();
    expect(order).toContain("clear-tag");
  });

  it("reports that the clear happened", async () => {
    // Observing through our own panel would census SellerOps' injected DOM as WING structure — and could invent
    // the very submit affordance the outcome is decided on.
    const { driver } = fakeDriver({ censuses: [{}, { submitAffordancePresent: true }] });
    await driver.classifyInitialSurface();
    await driver.highlightIssueCheckpoint();
    const res = await driver.observeRevealOutcome();
    expect(res.overlayClearedBeforeObservation).toBe(true);
    expect(res.outcome).toBe("CONFIGURATION_SURFACE_SUSPECTED");
  });

  it("a FAILED clear makes the OUTCOME untrusted, not just a flag beside a confident verdict", async () => {
    // Review: the failure used to be recorded and then ignored — the observation proceeded through the live panel
    // and could still report CONFIGURATION_SURFACE_SUSPECTED. It now fails closed.
    const { driver } = fakeDriver({ panelStuck: true, censuses: [{}, { submitAffordancePresent: true }] });
    await driver.classifyInitialSurface();
    await driver.highlightIssueCheckpoint();
    const res = await driver.observeRevealOutcome();
    expect(res.overlayClearedBeforeObservation).toBe(false);
    expect(res.outcome).toBe("OVERLAY_NOT_CLEARED");
  });

  it("cleanup() RETURNS the clear verdict — false when the panel is stuck, true when it is gone", async () => {
    // The first review's HIGH #1: `cleanupFailed` was wired to cleanup() REJECTING, which clearHighlight makes
    // impossible. The fix made cleanup() return the verdict — and was then guarded only by a source substring,
    // which is the same substitution of a token for a behaviour that HIGH #2 was about.
    const stuck = fakeDriver({ panelStuck: true });
    await stuck.driver.classifyInitialSurface();
    await stuck.driver.highlightIssueCheckpoint();
    expect(await stuck.driver.cleanup()).toBe(false);

    const clean = fakeDriver();
    await clean.driver.classifyInitialSurface();
    await clean.driver.highlightIssueCheckpoint();
    expect(await clean.driver.cleanup()).toBe(true);
  });

  it("…and still reports the verdict AFTER the observation — the only path where 발급 was actually pressed", async () => {
    // The surviving mutation this closes: `if (this.phase === "observed") return true;` — a plausible
    // "already cleared, skip the re-probe" line. It fires on the OBSERVED path only, so cleanupFailed would be
    // permanently false exactly when the operator HAS pressed the button, the exit code would be 0/6 instead of
    // 8, and SellerOps' panel could stay on the seller's live WING DOM with no signal anywhere.
    const { driver } = fakeDriver({ panelStuck: true, censuses: [{}, { submitAffordancePresent: true }] });
    await driver.classifyInitialSurface();
    await driver.highlightIssueCheckpoint();
    await driver.observeRevealOutcome();
    expect(driver.currentPhase()).toBe("observed");
    expect(await driver.cleanup(), "a stuck panel must still report false after observing").toBe(false);
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

describe("the issue calibration is LIVE-CONFIRMED, on exactly one measurement", () => {
  it("is CONFIRMED, and the selector flag lands with it", () => {
    // A confirmed record with a still-false flag would be evidence nothing downstream reads; the reverse — a
    // true flag over a refuted record — is what this pair existed to make impossible in the first place.
    expect(WING_ISSUE_CALIBRATION_EVIDENCE.status).toBe("LIVE_DOM_CALIBRATION_CONFIRMED");
    expect(WING_ISSUE_SELECTOR_CALIBRATED).toBe(true);
  });

  it("the SHIPPED spec is byte-for-byte the spec that was MEASURED", () => {
    // The load-bearing assertion of this block, and the successor to "the refuted spec is not the shipped spec".
    // Uniqueness was measured against THIS spec and no other, so any retune — a widened candidateQuery, a
    // shortened label, a revert to the refuted `발급` — invalidates the evidence, and must fail here to say so.
    expect(WING_HIGHLIGHT_LABELS.issue).toEqual(WING_ISSUE_CALIBRATION_EVIDENCE.measuredSpec);
    expect(WING_HIGHLIGHT_LABELS.issue.exactText).toBe(WING_ISSUE_CALIBRATION_EVIDENCE.label);
    // `exactText` compares the WHOLE normalized text — precisely what the refuted spec got wrong.
    expect(WING_HIGHLIGHT_LABELS.issue.exactText).toContain("발급");
    expect(WING_HIGHLIGHT_LABELS.issue.exactText).not.toBe("발급");
  });

  it("adopts the visible label as the anchor — never the observed id or class", () => {
    // The operator's sighting reported `id="policyAgreementWithAutoCategoryBtn"` and
    // `class="wing-web-component btn-api-key-gen"`. Those were candidate evidence for correcting the label, not
    // anchors: nobody has watched WING's generated ids or component classes across releases, so promoting one
    // would be the same species of unmeasured stability guess that produced the refuted record.
    expect(WING_HIGHLIGHT_LABELS.issue.candidateQuery).toBe("button");
    const wire = JSON.stringify(WING_HIGHLIGHT_LABELS);
    for (const anchor of ["policyAgreementWithAutoCategoryBtn", "btn-api-key-gen", "wing-web-component", "#", "["]) {
      expect(wire, anchor).not.toContain(anchor);
    }
  });

  it("records ONLY what the probe measured — the `role` over-claim is gone and stays gone", () => {
    // `role: "button"` was asserted by hand while `buildFixedLabelLocateScript` returned only { count, sig }. The
    // single property that would have caught the mismatch was the one the apparatus never produced.
    expect("role" in WING_ISSUE_CALIBRATION_EVIDENCE).toBe(false);
    expect(WING_ISSUE_CALIBRATION_EVIDENCE.measured).toEqual({
      visibleCount: 1,
      hiddenCount: 0,
      observedTag: "BUTTON",
      canHighlight: true,
      fault: null,
    });
    const src = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../../../src/action-window/api-issuance-calibration/visual-recon-inpage.ts"),
      "utf8",
    );
    // A measured tag is only honest if the script actually returns one.
    expect(src).toContain("tag: el.tagName");
  });

  it("labels the ONE field the apparatus cannot produce — `surface` is attributed, not measured", () => {
    // `wingIssuedStateFrom` answers NO_DISCRIMINATING_SIGNAL precisely because no sanitized signal separates a
    // no-key page from an issued one, and `pageCategory` is `open_api_issuance` on both. So "no_key" is the
    // operator's word. Unlabelled, it would be `role: "button"` again: a value from outside the apparatus sitting
    // among values from inside it, in a record that certifies everything in it was observed.
    expect(WING_ISSUE_CALIBRATION_EVIDENCE.surfaceAttribution).toBe("OPERATOR_REPORTED_NOT_MEASURED");
    expect(WING_ISSUE_CALIBRATION_EVIDENCE.surface).toBe("no_key_initial_surface");
    // Everything the probe DOES produce lives under `measured` and is not duplicated outside it.
    expect(Object.keys(WING_ISSUE_CALIBRATION_EVIDENCE.measured).sort()).toEqual([
      "canHighlight",
      "fault",
      "hiddenCount",
      "observedTag",
      "visibleCount",
    ]);
  });

  it("the MEASURED tag AGREES with the EXPECTED role — the comparison whose absence let the failure through", async () => {
    const { WING_TARGET_EXPECTED_ROLE } = await import("../../../instruments/calibration/probe-wing-issuance-selectors");
    expect(WING_TARGET_EXPECTED_ROLE.issue).toBe("button");
    expect(WING_ISSUE_CALIBRATION_EVIDENCE.measured.observedTag.toLowerCase()).toBe(WING_TARGET_EXPECTED_ROLE.issue);
  });

  it("claims exactly ONE capture, on ONE surface, and does not launder the withdrawn four into support", () => {
    expect(WING_ISSUE_CALIBRATION_EVIDENCE.captureCount).toBe(1);
    expect(WING_ISSUE_CALIBRATION_EVIDENCE.surface).toBe("no_key_initial_surface");
    expect(WING_ISSUE_CALIBRATION_EVIDENCE.signatureStability).toBe("SINGLE_CAPTURE_NOT_ESTABLISHED");
    // The four withdrawn captures are retained as a RETRACTION, under a field that says so, and the record they
    // support is not this one. Re-citing them as coverage is the specific regression this pins.
    const { supersedes, recordId } = WING_ISSUE_CALIBRATION_EVIDENCE;
    expect(supersedes.status).toBe("LIVE_DOM_CALIBRATION_REFUTED");
    expect(supersedes.withdrawnClaim).toBe("FOUR_AGREEING_CAPTURES_WITH_AN_UNMEASURED_ROLE");
    expect(supersedes.withdrawnRecordIds).toHaveLength(4);
    expect(supersedes.withdrawnRecordIds).not.toContain(recordId);
    expect(supersedes.refutedObservation).toEqual({ visibleMatchCount: 0, nonPaintingMatchCount: 1 });
    expect(supersedes.refutedSpec.exactText).not.toBe(WING_HIGHLIGHT_LABELS.issue.exactText);
  });

  it("sig16 is EVIDENCE_ONLY — and no runtime module can read the record to make it an anchor", () => {
    expect(WING_ISSUE_CALIBRATION_EVIDENCE.sig16).toMatch(/^[0-9a-f]{16}$/);
    expect(WING_ISSUE_CALIBRATION_EVIDENCE.signatureRole).toBe("EVIDENCE_ONLY");
    // The withdrawn signatures were the DECOY's — a live signature must never be compared against any of them.
    for (const sig of WING_ISSUE_CALIBRATION_EVIDENCE.supersedes.withdrawnSig16) expect(sig).toMatch(/^[0-9a-f]{16}$/);
    expect(WING_ISSUE_CALIBRATION_EVIDENCE.supersedes.withdrawnSig16).not.toContain(WING_ISSUE_CALIBRATION_EVIDENCE.sig16);
    // One capture cannot establish cross-run stability, so a cross-run comparison must be unreachable rather than
    // merely discouraged: no module outside the record's own file may name the record or its signature.
    const srcRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../src");
    // Exempt by resolved PATH, not by basename: the exemption must name one file, not every file that happens to
    // be called that. And it is exactly one file — the record's own home.
    const HOME = resolve(srcRoot, "action-window/coupang-wing-issuance-driver.ts");
    // Comments legitimately discuss the record; only code may not reach it.
    const codeOf = (p: string): string =>
      readFileSync(p, "utf8")
        .split("\n")
        .filter((l) => {
          const t = l.trim();
          return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
        })
        .join("\n");

    const offenders: string[] = [];
    let scanned = 0;
    const walk = (dir: string): void => {
      for (const ent of readdirSync(dir, { withFileTypes: true })) {
        const p = resolve(dir, ent.name);
        if (ent.isDirectory()) {
          walk(p);
          continue;
        }
        if (!ent.name.endsWith(".ts") || p === HOME) continue;
        scanned += 1;
        const body = codeOf(p);
        if (body.includes("WING_ISSUE_CALIBRATION_EVIDENCE") || body.includes(WING_ISSUE_CALIBRATION_EVIDENCE.sig16)) {
          offenders.push(ent.name);
        }
      }
    };
    walk(srcRoot);
    // A sweep that swept nothing passes for free — the exact shape of the bug this whole sequence came from.
    expect(scanned).toBeGreaterThan(50);
    expect(offenders).toEqual([]);

    // The exemption is transitive unless it is closed here. `coupang-wing-issuance-driver.ts` is a runtime module,
    // not a data file — it already holds signature constants the guided walk returns — so two lines inside it
    // (`export const X = WING_ISSUE_CALIBRATION_EVIDENCE.sig16;`, consumed anywhere) would rebuild the cross-run
    // anchor with the sweep above still green. So: inside its home, the record may be DECLARED and nothing else.
    const home = codeOf(HOME);
    expect(home.match(/WING_ISSUE_CALIBRATION_EVIDENCE/g) ?? []).toHaveLength(1); // the declaration, and only it
    expect(home).not.toMatch(/WING_ISSUE_CALIBRATION_EVIDENCE\s*\./); // no member access, so no alias export
    expect(home.match(new RegExp(WING_ISSUE_CALIBRATION_EVIDENCE.sig16, "g")) ?? []).toHaveLength(1);
  });

  it("says nothing about the press, and nothing about whether a key exists", () => {
    // A calibrated LOCATOR is a claim about finding a control. It is not a claim about what pressing it does…
    expect(WING_ISSUE_CALIBRATION_EVIDENCE.pressOutcome).toBe("UNCONFIRMED");
    // …nor about issued state. This very capture read `credentialAnchorPresent: true` on a REAL no-key surface,
    // which is the standing reason the anchor is not a discriminator and the classifier answers indeterminate.
    expect(WING_ISSUE_CALIBRATION_EVIDENCE.credentialAnchorPresentOnNoKeySurface).toBe(true);
    expect(WING_ISSUE_CALIBRATION_EVIDENCE.issuedStateReason).toBe("NO_DISCRIMINATING_SIGNAL");
  });

  it("does NOT flip the overall WING highlight calibration — the other three targets are still unresolved", async () => {
    const { WING_HIGHLIGHT_CALIBRATION } = await import("../../../src/action-window/coupang-wing-issuance-driver");
    expect(WING_HIGHLIGHT_CALIBRATION).toBe("LIVE_DOM_CALIBRATION_PENDING");
  });
});
