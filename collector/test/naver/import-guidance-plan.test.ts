import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  IMPORT_GUIDANCE_COPY_KEYS,
  SELLER_ACTION_STAGES,
  gateOnScope,
  isSellerActionStage,
  planSegmentGuidance,
  planSegmentGuidanceWithGate,
  type ImportGuidanceStage,
} from "../../src/naver/import-guidance-plan";

const facts = (requiresApply = false, requiresFilters = false) => ({ requiresApply, requiresFilters });

/**
 * The guided segment choreography. Pinned offline because a wrong ordering found during a seated live run
 * costs a real export window; the branch that actually matters is the scope gate.
 */
describe("planSegmentGuidance", () => {
  it("walks required range → start → end → export → consent → ingest", () => {
    expect(planSegmentGuidance(facts())).toEqual([
      "OPEN_REVIEW_SURFACE",
      "SHOW_REQUIRED_RANGE",
      "SET_START_DATE",
      "SET_END_DATE",
      "EXPORT",
      "CONSENT",
      "INGEST",
    ]);
  });

  it("shows the required range BEFORE asking for any click", () => {
    const stages = planSegmentGuidance(facts());
    expect(stages.indexOf("SHOW_REQUIRED_RANGE")).toBeLessThan(stages.indexOf("SET_START_DATE"));
  });

  it("inserts the apply step only when the surface actually has one", () => {
    // Highlighting a control that isn't there leaves the seller hunting; a shorter tutorial is better than
    // one that points at nothing.
    expect(planSegmentGuidance(facts(false))).not.toContain("APPLY_RANGE");
    const withApply = planSegmentGuidance(facts(true));
    expect(withApply).toContain("APPLY_RANGE");
    expect(withApply.indexOf("APPLY_RANGE")).toBeGreaterThan(withApply.indexOf("SET_END_DATE"));
    expect(withApply.indexOf("APPLY_RANGE")).toBeLessThan(withApply.indexOf("EXPORT"));
  });

  it("never puts consent before export, or ingest before consent", () => {
    for (const f of [facts(false), facts(true)]) {
      const s = planSegmentGuidance(f);
      expect(s.indexOf("EXPORT")).toBeLessThan(s.indexOf("CONSENT"));
      expect(s.indexOf("CONSENT")).toBeLessThan(s.indexOf("INGEST"));
    }
  });

  it("does not include a confirm step by default — it is only for an unreadable range", () => {
    expect(planSegmentGuidance(facts())).not.toContain("CONFIRM_RANGE");
  });
});

describe("gateOnScope", () => {
  it("MATCH proceeds and records that SellerOps confirmed the scope", () => {
    expect(gateOnScope("MATCH")).toEqual({
      proceed: true,
      insertConfirmStage: false,
      scopeEvidence: "MACHINE_MATCHED",
    });
  });

  it("UNREADABLE proceeds but requires the SELLER's confirmation, recorded as theirs", () => {
    expect(gateOnScope("UNREADABLE")).toEqual({
      proceed: true,
      insertConfirmStage: true,
      scopeEvidence: "OPERATOR_CONFIRMED",
    });
  });

  it("MISMATCH stops the run, recoverably", () => {
    // Recoverable on purpose: the seller fixing the dates and asking for a re-check is the normal repair,
    // not a failed run.
    expect(gateOnScope("MISMATCH")).toEqual({ proceed: false, blocker: "SCOPE_MISMATCH", recoverable: true });
  });

  it("never reports a machine match for a scope it could not read", () => {
    const unreadable = gateOnScope("UNREADABLE");
    expect(unreadable.proceed && unreadable.scopeEvidence).toBe("OPERATOR_CONFIRMED");
  });
});

describe("planSegmentGuidanceWithGate", () => {
  it("a matched scope goes straight to export, with no confirm step", () => {
    const stages = planSegmentGuidanceWithGate(facts(), gateOnScope("MATCH"));
    expect(stages).not.toContain("CONFIRM_RANGE");
    expect(stages).toContain("EXPORT");
  });

  it("an unreadable scope inserts the confirm step immediately before export", () => {
    const stages = planSegmentGuidanceWithGate(facts(), gateOnScope("UNREADABLE"));
    expect(stages.indexOf("CONFIRM_RANGE")).toBe(stages.indexOf("EXPORT") - 1);
  });

  it("inserts the confirm step before export even when an apply step exists", () => {
    const stages = planSegmentGuidanceWithGate(facts(true), gateOnScope("UNREADABLE"));
    expect(stages.indexOf("APPLY_RANGE")).toBeLessThan(stages.indexOf("CONFIRM_RANGE"));
    expect(stages.indexOf("CONFIRM_RANGE")).toBe(stages.indexOf("EXPORT") - 1);
  });

  // The stop is expressed in the DATA. A caller advancing through a list that still contained EXPORT is
  // exactly how a mismatch would leak past the gate and ingest the wrong window into this segment.
  it("a mismatched scope truncates the plan before export, consent, and ingest", () => {
    for (const f of [facts(false), facts(true)]) {
      const stages = planSegmentGuidanceWithGate(f, gateOnScope("MISMATCH"));
      expect(stages).not.toContain("EXPORT");
      expect(stages).not.toContain("CONSENT");
      expect(stages).not.toContain("INGEST");
      // ...but the seller still sees what was required and what they set, so they can fix it
      expect(stages).toContain("SHOW_REQUIRED_RANGE");
      expect(stages).toContain("SET_END_DATE");
    }
  });

  it("only a blocked gate can produce a plan without an ingest stage", () => {
    for (const match of ["MATCH", "UNREADABLE"] as const) {
      expect(planSegmentGuidanceWithGate(facts(), gateOnScope(match))).toContain("INGEST");
    }
  });
});

describe("stage metadata", () => {
  it("every stage has a semantic copy key and none is prose", () => {
    const stages = [...planSegmentGuidance(facts(true)), "CONFIRM_RANGE"] as ImportGuidanceStage[];
    for (const stage of stages) {
      const key = IMPORT_GUIDANCE_COPY_KEYS[stage];
      expect(key).toBeTruthy();
      // dotted semantic key, exactly what the AW contract's COPY_KEY pattern accepts
      expect(key).toMatch(/^[A-Za-z][A-Za-z0-9]*(\.[A-Za-z0-9]+)+$/);
      expect(key).not.toMatch(/[가-힣\s]/); // never Korean prose — the FE owns all copy
    }
  });

  it("the seller acts on the marketplace steps; the runtime never claims them", () => {
    // Every marketplace control in the sequence is a seller action. The runtime highlights and observes.
    for (const stage of ["SET_START_DATE", "SET_END_DATE", "EXPORT", "CONSENT"] as const) {
      expect(isSellerActionStage(stage)).toBe(true);
    }
    for (const stage of ["OPEN_REVIEW_SURFACE", "SHOW_REQUIRED_RANGE", "INGEST"] as const) {
      expect(isSellerActionStage(stage)).toBe(false);
    }
    expect(SELLER_ACTION_STAGES).toContain("CONFIRM_RANGE");
  });
});

describe("import-guidance-plan — module boundary", () => {
  const src = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../../src/naver/import-guidance-plan.ts"),
    "utf8",
  );
  const code = src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

  it("is a pure planner: no DOM, no clock, and no click of its own", () => {
    expect(code).not.toMatch(/\bDate\b/);
    expect(code).not.toMatch(/document\.|page\.|playwright/);
    expect(code).not.toMatch(/\.click\(/);
  });
});
