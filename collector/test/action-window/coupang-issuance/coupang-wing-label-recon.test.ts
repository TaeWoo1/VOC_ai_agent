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
import * as recon from "../../../src/action-window/coupang-wing-label-recon";
import {
  UnknownWingReconTargetError,
  WING_LABEL_RECON_CANDIDATES,
  WING_RECON_APPROVED_SCOPE,
  WING_RECON_TARGETS,
  WING_RECON_VERDICTS,
  buildWingReconScript,
  interpretWingRecon,
  isWingReconTarget,
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

  it("no candidate label can carry operator or company data — allowlisted shape, not a denylist", () => {
    // Strengthened after review: a denylist of "@ / http / .com / Secret" let a vendor-code-shaped string like
    // "A0012345" through. A field label is Korean UI text (optionally with a short ASCII word like IP), so the
    // ALLOWED shape is narrow enough to state positively — and anything identifier-shaped fails it.
    const ALLOWED = /^[가-힣A-Za-z][가-힣A-Za-z ]{0,10}$/;
    for (const t of ALL) for (const c of WING_LABEL_RECON_CANDIDATES[t]) {
      expect(ALLOWED.test(c.exactText), `${c.id} = ${JSON.stringify(c.exactText)} is not label-shaped`).toBe(true);
      expect(/\d/.test(c.exactText), `${c.id} contains a digit — codes and ids are never field labels`).toBe(false);
    }
    // …and the allowlist is itself falsifiable: these must all be rejected.
    for (const bad of ["A0012345", "acme@corp.com", "https://x", "AKIA1234567890", "업체명 주식회사 가나다라마바사"]) {
      expect(ALLOWED.test(bad) && !/\d/.test(bad), bad).toBe(false);
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

  it("a candidate MISSING from the reading is NOT_MEASURED — never conflated with a measured zero", () => {
    // Corrected after review. The first version recorded a missing row as matchCount 0 / ABSENT, which made a
    // partial reading byte-identical to a complete all-miss reading. That is the same "unmeasured vs measured
    // zero" conflation this whole unit exists to correct — inverted.
    const [r] = interpretWingRecon(["call_ip"], raw({ "call_ip.nospace": 1 }));
    expect(r!.candidates).toHaveLength(WING_LABEL_RECON_CANDIDATES.call_ip.length);
    const missing = r!.candidates.filter((c) => c.verdict === "NOT_MEASURED");
    expect(missing).toHaveLength(3);
    for (const c of missing) expect(c.matchCount).toBeNull();
  });

  it("a PARTIAL reading is distinguishable from a complete all-miss reading", () => {
    // The property the previous shape violated, asserted directly. A page script that silently failed for some
    // candidates (the shared probe swallows a bad query) must not read as 'all candidates confirmed absent'.
    const partial = interpretWingRecon(["call_ip"], []);
    const allMiss = interpretWingRecon(["call_ip"], raw({
      "call_ip.baseline": 0, "call_ip.nospace": 0, "call_ip.lower": 0, "call_ip.ip_addr": 0,
    }));
    expect(JSON.stringify(partial)).not.toBe(JSON.stringify(allMiss));
    expect(partial[0]!.candidates.every((c) => c.verdict === "NOT_MEASURED")).toBe(true);
    expect(allMiss[0]!.candidates.every((c) => c.verdict === "ABSENT")).toBe(true);
  });

  it("one unique candidate alongside an UNMEASURED one is not 'resolved'", () => {
    // The unmeasured candidate might have resolved too — that is the two-unique ambiguity wearing a disguise.
    const [r] = interpretWingRecon(["call_ip"], raw({ "call_ip.nospace": 1 }));
    expect(r!.uniqueCandidateIds).toEqual(["call_ip.nospace"]);
    expect(r!.resolvedUnambiguously).toBe(false);
  });

  it("a junk count is INVALID_COUNT, not folded into a real verdict", () => {
    const [r] = interpretWingRecon(["call_ip"], raw({
      "call_ip.baseline": -5, "call_ip.nospace": 1.5, "call_ip.lower": NaN, "call_ip.ip_addr": 2,
    }));
    expect(r!.candidates.map((c) => c.verdict)).toEqual([
      "INVALID_COUNT", "INVALID_COUNT", "INVALID_COUNT", "AMBIGUOUS",
    ]);
    expect(r!.uniqueCandidateIds).toEqual([]);
  });

  it("a DUPLICATE id with conflicting counts is NOT_MEASURED — last-one-wins would hide the conflict", () => {
    const [r] = interpretWingRecon(["call_ip"], [
      { targetId: "call_ip.nospace", matchCount: 1 },
      { targetId: "call_ip.nospace", matchCount: 7 },
    ]);
    expect(r!.candidates.find((c) => c.id === "call_ip.nospace")!.verdict).toBe("NOT_MEASURED");
  });

  it("unknown ids in the reading are ignored rather than invented into a target", () => {
    const [r] = interpretWingRecon(["call_ip"], raw({ "call_ip.nospace": 1, "something.else": 9 }));
    expect(r!.candidates.map((c) => c.id).every((id) => id.startsWith("call_ip."))).toBe(true);
  });

  it("an unknown TARGET is refused, not crashed on", () => {
    // Matters the moment recon is driven from an env-derived scope: `for…of undefined` would be a raw TypeError
    // where every other scope path in this codebase returns a closed refusal.
    for (const bad of ["issue", "credentials", "", "__proto__"]) {
      expect(() => wingReconProbes([bad as WingReconTarget]), bad).toThrow(UnknownWingReconTargetError);
      expect(() => interpretWingRecon([bad as WingReconTarget], []), bad).toThrow(UnknownWingReconTargetError);
    }
    expect(isWingReconTarget("call_ip")).toBe(true);
    expect(isWingReconTarget("issue")).toBe(false);
  });

  it("every verdict is from the closed enum, and the result carries only ids, ints and booleans", () => {
    const results = interpretWingRecon(ALL, raw({ "self_dev.baseline": 2 }));
    const serialized = JSON.stringify(results);
    for (const r of results) for (const c of r.candidates) {
      expect(WING_RECON_VERDICTS as readonly string[]).toContain(c.verdict);
      // null only ever accompanies NOT_MEASURED — it is an explicit "no reading", never a stand-in for 0.
      if (c.matchCount === null) expect(c.verdict).toBe("NOT_MEASURED");
      else expect(Number.isInteger(c.matchCount)).toBe(true);
    }
    // No candidate LABEL text reaches the record — ids only, so a record can be pasted into a doc safely.
    for (const t of ALL) for (const c of WING_LABEL_RECON_CANDIDATES[t]) {
      expect(serialized).not.toContain(c.exactText);
    }
  });
});

describe("the recon cannot change what ships", () => {
  it("the module's ACTUAL export surface contains no promotion/apply/write path", () => {
    // Corrected after review. The first version built a hardcoded object literal of the four exports it already
    // knew about and scanned THOSE names — so adding `export function promoteCandidateToShippedLabel()` passed
    // every test. Scanning the real namespace is what makes the guard failable.
    const forbidden = Object.keys(recon).filter((n) => /promote|apply|write|update|mutate/i.test(n));
    expect(forbidden, `these exports could change shipped selectors: ${forbidden.join(", ")}`).toEqual([]);
  });

  it("importing the module does not mutate the shipped labels", () => {
    // The companion check below snapshots AFTER import, so an import-time write would be invisible to it.
    // Comparing against the driver's own literal catches that.
    expect(WING_HIGHLIGHT_LABELS.call_ip.exactText).toBe("호출 IP");
    expect(WING_HIGHLIGHT_LABELS.self_dev.exactText).toBe("자체개발");
    expect(WING_HIGHLIGHT_LABELS.vendor_info.exactText).toBe("업체명");
  });

  it("running a full interpretation leaves the shipped labels byte-identical", () => {
    const before = JSON.stringify(WING_HIGHLIGHT_LABELS);
    interpretWingRecon(ALL, [{ targetId: "self_dev.spaced", matchCount: 1 }]);
    expect(JSON.stringify(WING_HIGHLIGHT_LABELS)).toBe(before);
  });

  it("a candidate object cannot be rewritten at runtime — freeze is DEEP, not just the container", () => {
    // `Object.freeze` is shallow and TS `readonly` is erased, so without freezing each candidate the string
    // shipped into the page is writable. Proven by attempting the write rather than by asserting isFrozen alone.
    const candidate = WING_LABEL_RECON_CANDIDATES.call_ip[0]!;
    expect(Object.isFrozen(candidate)).toBe(true);
    expect(() => {
      (candidate as { exactText: string }).exactText = "INJECTED";
    }).toThrow(TypeError); // modules are strict mode: a frozen write throws rather than silently no-ops
    expect(buildWingReconScript(["call_ip"])).not.toContain("INJECTED");
  });

  it("the approved live scope is exactly the three unresolved targets — no widening by default", () => {
    expect([...WING_RECON_APPROVED_SCOPE]).toEqual(["self_dev", "vendor_info", "call_ip"]);
    expect(Object.isFrozen(WING_RECON_APPROVED_SCOPE)).toBe(true);
  });
});
