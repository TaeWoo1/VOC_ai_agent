/**
 * Tests for the WING label recon — the read-only way to narrow a fixed label that failed to resolve on the real
 * no-key form (`self_dev` 0, `vendor_info` 8, `call_ip` 0).
 *
 * Two properties matter more than the folding logic, and both are asserted structurally rather than trusted:
 *
 *  1. **It can only measure.** There is no path from a recon result to `WING_HIGHLIGHT_LABELS`. A live reading
 *     may justify promoting a candidate, but a human does that in a reviewed diff — not a function at runtime.
 *  2. **It leaks nothing.** Every string sent to the page is one we wrote; everything returned is an integer and
 *     our own candidate id. The in-page half is the already-audited `buildFixedLabelProbeScript`, reused rather
 *     than reimplemented, so there is no second value-free contract to keep in sync.
 */
import { describe, it, expect } from "vitest";
import {
  WING_LABEL_RECON_CANDIDATES,
  WING_RECON_APPROVED_SCOPE,
  WING_RECON_TARGETS,
  WING_RECON_VERDICTS,
  buildWingReconScript,
  interpretWingRecon,
  wingReconProbes,
  type WingReconTarget,
} from "../../../src/action-window/coupang-wing-label-recon";
import { WING_HIGHLIGHT_LABELS } from "../../../src/action-window/coupang-wing-issuance-driver";
import { buildFixedLabelProbeScript } from "../../../src/action-window/api-issuance-calibration/visual-recon-inpage";

const ALL = WING_RECON_TARGETS as readonly WingReconTarget[];

describe("the candidate sets — hypotheses to measure, with the baseline always included", () => {
  it("covers exactly the three targets that failed on the real no-key form", () => {
    expect([...WING_RECON_TARGETS]).toEqual(["self_dev", "vendor_info", "call_ip"]);
    // `issue` resolved uniquely live, so re-measuring it here would invite retuning something already proven.
    expect(WING_RECON_TARGETS as readonly string[]).not.toContain("issue");
  });

  it("every target leads with the CURRENTLY SHIPPED label, so the baseline is measured in the same conditions", () => {
    // Without this, a candidate could look better than the baseline only because the page changed between runs.
    for (const t of ALL) {
      const first = WING_LABEL_RECON_CANDIDATES[t][0]!;
      expect(first.id, t).toBe(`${t}.baseline`);
      expect(first.exactText, t).toBe(WING_HIGHLIGHT_LABELS[t].exactText);
      expect(first.candidateQuery, t).toBe(WING_HIGHLIGHT_LABELS[t].candidateQuery);
    }
  });

  it("candidate ids are unique and namespaced by target — a collision would silently merge two measurements", () => {
    const ids = ALL.flatMap((t) => WING_LABEL_RECON_CANDIDATES[t].map((c) => c.id));
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of ALL) for (const c of WING_LABEL_RECON_CANDIDATES[t]) expect(c.id.startsWith(`${t}.`)).toBe(true);
  });

  it("every candidate states a rationale — a guess nobody had to justify is how speculative retuning starts", () => {
    for (const t of ALL) for (const c of WING_LABEL_RECON_CANDIDATES[t]) {
      expect(c.rationale.length, c.id).toBeGreaterThan(20);
    }
  });

  it("the candidate sets are frozen — nothing derived from a page can be appended at runtime", () => {
    expect(Object.isFrozen(WING_LABEL_RECON_CANDIDATES)).toBe(true);
    for (const t of ALL) expect(Object.isFrozen(WING_LABEL_RECON_CANDIDATES[t]), t).toBe(true);
  });
});

describe("probe construction — value-free by shape", () => {
  it("emits one probe per candidate, carrying only our own id/query/label", () => {
    const probes = wingReconProbes(ALL);
    expect(probes).toHaveLength(ALL.reduce((n, t) => n + WING_LABEL_RECON_CANDIDATES[t].length, 0));
    for (const p of probes) expect(Object.keys(p).sort()).toEqual(["candidateQuery", "exactText", "targetId"]);
  });

  it("a repeated target is measured once — a duplicate would double the page work for no new information", () => {
    expect(wingReconProbes(["call_ip", "call_ip"])).toEqual(wingReconProbes(["call_ip"]));
  });

  it("the in-page script IS the audited shared probe — not a second implementation", () => {
    // If someone forks the in-page script for WING, this equality breaks and the fork must be justified.
    expect(buildWingReconScript(ALL)).toBe(buildFixedLabelProbeScript(wingReconProbes(ALL)));
  });

  it("the script never clicks, types, mutates or returns text", () => {
    const src = buildWingReconScript(ALL);
    for (const forbidden of [".click(", ".type(", ".fill(", "setAttribute", "innerHTML", "outerHTML", "screenshot"]) {
      expect(src, `must not contain ${forbidden}`).not.toContain(forbidden);
    }
    // It returns the count and our id, and nothing else.
    expect(src).toContain("matchCount");
    expect(src).not.toContain("textContent: ");
  });

  it("no candidate label carries operator or company data — they are WING's generic UI words", () => {
    const labels = ALL.flatMap((t) => WING_LABEL_RECON_CANDIDATES[t].map((c) => c.exactText));
    for (const l of labels) {
      expect(l.length, l).toBeLessThan(12); // a field label, never a sentence or a pasted value
      for (const forbidden of ["@", "http", ".com", "Secret", "Access Key"]) {
        expect(l, `candidate label must not contain ${forbidden}`).not.toContain(forbidden);
      }
    }
  });
});

describe("interpretation — it records, it does not decide", () => {
  const raw = (over: Record<string, number>) =>
    Object.entries(over).map(([targetId, matchCount]) => ({ targetId, matchCount }));

  it("classifies each candidate as UNIQUE / ABSENT / AMBIGUOUS", () => {
    const [r] = interpretWingRecon(["call_ip"], raw({
      "call_ip.baseline": 0, "call_ip.nospace": 1, "call_ip.lower": 0, "call_ip.ip_addr": 3,
    }));
    expect(r!.candidates.map((c) => [c.id, c.verdict])).toEqual([
      ["call_ip.baseline", "ABSENT"], ["call_ip.nospace", "UNIQUE"],
      ["call_ip.lower", "ABSENT"], ["call_ip.ip_addr", "AMBIGUOUS"],
    ]);
    expect(r!.uniqueCandidateIds).toEqual(["call_ip.nospace"]);
    expect(r!.resolvedUnambiguously).toBe(true);
  });

  it("TWO unique candidates is NOT resolved — they may be two different elements", () => {
    // The tempting shortcut is "pick the first unique one". Two labels each matching one element tells you
    // nothing about whether it is the SAME element, and a highlight aimed at the wrong one is a real defect.
    const [r] = interpretWingRecon(["vendor_info"], raw({
      "vendor_info.baseline": 8, "vendor_info.label_only": 1, "vendor_info.th_dt": 1, "vendor_info.vendor_name": 0,
    }));
    expect(r!.uniqueCandidateIds).toEqual(["vendor_info.label_only", "vendor_info.th_dt"]);
    expect(r!.resolvedUnambiguously).toBe(false);
  });

  it("no unique candidate is a real, recordable outcome — not an error and not a fallback", () => {
    const [r] = interpretWingRecon(["self_dev"], raw({
      "self_dev.baseline": 0, "self_dev.spaced": 0, "self_dev.radio": 0, "self_dev.dev_type": 0,
    }));
    expect(r!.uniqueCandidateIds).toEqual([]);
    expect(r!.resolvedUnambiguously).toBe(false);
    expect(r!.candidates.every((c) => c.verdict === "ABSENT")).toBe(true);
  });

  it("a candidate MISSING from the reading is recorded as ABSENT, never dropped", () => {
    // A dropped row would make a partial reading look complete — the same class of bug as a truncated scan
    // reading as "nothing found".
    const [r] = interpretWingRecon(["call_ip"], raw({ "call_ip.nospace": 1 }));
    expect(r!.candidates).toHaveLength(WING_LABEL_RECON_CANDIDATES.call_ip.length);
    expect(r!.candidates.filter((c) => c.verdict === "ABSENT")).toHaveLength(3);
  });

  it("unknown ids in the reading are ignored rather than invented into a target", () => {
    const [r] = interpretWingRecon(["call_ip"], raw({ "call_ip.nospace": 1, "something.else": 9 }));
    expect(r!.candidates.map((c) => c.id).every((id) => id.startsWith("call_ip."))).toBe(true);
  });

  it("every verdict is from the closed enum, and the result carries only ids, ints and booleans", () => {
    const results = interpretWingRecon(ALL, raw({ "self_dev.baseline": 2 }));
    const serialized = JSON.stringify(results);
    for (const r of results) for (const c of r.candidates) {
      expect(WING_RECON_VERDICTS as readonly string[]).toContain(c.verdict);
      expect(Number.isInteger(c.matchCount)).toBe(true);
    }
    // No candidate LABEL text reaches the record — ids only, so a record can be pasted into a doc safely.
    for (const t of ALL) for (const c of WING_LABEL_RECON_CANDIDATES[t]) {
      expect(serialized).not.toContain(c.exactText);
    }
  });
});

describe("the recon cannot change what ships", () => {
  it("the module exposes no promotion/apply/write path", () => {
    // Structural, not aspirational: if a `promote`/`apply` export ever appears, this fails and the reviewer has
    // to argue for it explicitly.
    const mod = { WING_LABEL_RECON_CANDIDATES, wingReconProbes, buildWingReconScript, interpretWingRecon };
    for (const name of Object.keys(mod)) {
      expect(/promote|apply|write|update|set|mutate/i.test(name), name).toBe(false);
    }
  });

  it("running a full interpretation leaves the shipped labels byte-identical", () => {
    const before = JSON.stringify(WING_HIGHLIGHT_LABELS);
    interpretWingRecon(ALL, [{ targetId: "self_dev.spaced", matchCount: 1 }]);
    expect(JSON.stringify(WING_HIGHLIGHT_LABELS)).toBe(before);
  });

  it("the approved live scope is exactly the three unresolved targets — no widening by default", () => {
    expect([...WING_RECON_APPROVED_SCOPE]).toEqual(["self_dev", "vendor_info", "call_ip"]);
    expect(Object.isFrozen(WING_RECON_APPROVED_SCOPE)).toBe(true);
  });
});
