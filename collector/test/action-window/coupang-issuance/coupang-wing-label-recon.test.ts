/**
 * Tests for the WING label recon — the read-only way to narrow a fixed label that failed to resolve on the real
 * no-key form (`self_dev` 0, `vendor_info` 8, `call_ip` 0).
 *
 * Two properties matter more than the folding logic, and both are asserted structurally rather than trusted:
 *
 *  1. **It can only measure.** There is no path from a recon result to `WING_HIGHLIGHT_LABELS`. A live reading
 *     may justify promoting a candidate, but a human does that in a reviewed diff — not a function at runtime.
 *  2. **It leaks nothing.** Every string sent to the page is one we wrote; everything returned is an integer, an
 *     opaque signature, or one of our own constants. The in-page half is the already-audited
 *     `buildFixedLabelLocateScript`, reached through the driver's existing `probeFixedLabelMatch` seam — the
 *     same call the shipped baseline probe makes — so there is no second value-free contract to keep in sync.
 */
import { describe, it, expect } from "vitest";
import * as recon from "../../../src/action-window/coupang-wing-label-recon";
import {
  UnknownWingReconTargetError,
  WING_LABEL_RECON_CANDIDATES,
  WING_RECON_APPROVED_SCOPE,
  WING_RECON_TARGETS,
  WING_RECON_VERDICTS,
  interpretWingRecon,
  isWingReconTarget,
  wingReconProbes,
  type WingReconTarget,
} from "../../../src/action-window/coupang-wing-label-recon";
import { WING_HIGHLIGHT_LABELS } from "../../../src/action-window/coupang-wing-issuance-driver";

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

  it("a probe spec IS a driver fixed-label spec — so recon adds no in-page script of its own", () => {
    // The module used to export `buildWingReconScript`, a BATCH in-page script. It was dropped (2026-08-08)
    // because it returns counts only: two simultaneously-unique candidates could then not be told apart even
    // offline, and a `candidateQuery` the browser rejected came back as a real `0`. The sweep now goes through
    // the driver's `probeFixedLabelMatch`, so this asserts the shape that seam consumes.
    for (const p of wingReconProbes(ALL)) {
      const { targetId, ...spec } = p;
      expect(typeof targetId).toBe("string");
      expect(Object.keys(spec).sort()).toEqual(["candidateQuery", "exactText"]);
    }
  });

  it("no builder for a second in-page script survives on the export surface", () => {
    // The replacement for the removed identity assertion: if someone reintroduces a WING-specific page script,
    // it shows up here and has to be justified rather than quietly landing beside the audited seam.
    const builders = Object.keys(recon).filter((n) => /script|evaluate|inpage|dump/i.test(n));
    expect(builders, `recon must build no page script of its own: ${builders.join(", ")}`).toEqual([]);
  });

  it("every candidateQuery is a plain structural tag list — a query the browser rejects reads as a real zero", () => {
    // Neither in-page script distinguishes "querySelectorAll threw" from "nothing matched": both swallow the
    // error and report 0. Runtime detection is therefore impossible, so validity is proven HERE instead, over
    // constants. The allowed shape is comma-separated bare element names — everything the sets actually use.
    const ALLOWED = /^[a-z]+(,[a-z]+)*$/;
    for (const t of ALL) for (const c of WING_LABEL_RECON_CANDIDATES[t]) {
      expect(ALLOWED.test(c.candidateQuery), `${c.id} = ${JSON.stringify(c.candidateQuery)}`).toBe(true);
    }
    // Falsifiable: the shapes that would actually break, and the ones that would smuggle in attribute reads.
    for (const bad of ["label,", ",label", "label,,span", "input[value]", "[data-x='a']", "label:has(> b)", ""]) {
      expect(ALLOWED.test(bad), bad).toBe(false);
    }
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
    for (const r of results) for (const c of r.candidates) {
      expect(WING_RECON_VERDICTS as readonly string[]).toContain(c.verdict);
      // null only ever accompanies NOT_MEASURED — it is an explicit "no reading", never a stand-in for 0.
      if (c.matchCount === null) expect(c.verdict).toBe("NOT_MEASURED");
      else expect(Number.isInteger(c.matchCount)).toBe(true);
    }
  });

  it("every STRING in the record is one of our own constants — an allowlist over the whole payload", () => {
    // This replaces "no candidate label reaches the record". The runner's output spec asks for the fixed
    // candidate label, so labels now DO appear — which makes "labels are absent" the wrong property to hold.
    // The stronger one is asserted instead: enumerate every string the serialized record contains and require
    // each to come from a known constant. Page content could not satisfy that whatever field it arrived in.
    const results = interpretWingRecon(ALL, [
      { targetId: "self_dev.baseline", matchCount: 1, sig: "0123456789abcdef" },
      { targetId: "vendor_info.th_dt", matchCount: 4 },
    ]);
    const allowed = new Set<string>([
      ...ALL,
      ...(WING_RECON_VERDICTS as readonly string[]),
      ...ALL.flatMap((t) => WING_LABEL_RECON_CANDIDATES[t].flatMap((c) => [c.id, c.exactText])),
    ]);
    const strings: string[] = [];
    const walk = (v: unknown): void => {
      if (typeof v === "string") strings.push(v);
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") Object.values(v).forEach(walk);
    };
    walk(results);
    expect(strings.length).toBeGreaterThan(20); // the walk actually reached the payload
    for (const s of strings) {
      // The one non-constant string class is the opaque 16-hex signature, which is a structural hash.
      if (/^[0-9a-f]{16}$/.test(s)) continue;
      expect(allowed.has(s), `unexpected string in the record: ${JSON.stringify(s)}`).toBe(true);
    }
  });

  it("each candidate echoes ITS OWN label — a mismatch would misattribute a reading", () => {
    for (const r of interpretWingRecon(ALL, [])) {
      const expected = WING_LABEL_RECON_CANDIDATES[r.target];
      expect(r.candidates.map((c) => [c.id, c.label])).toEqual(expected.map((c) => [c.id, c.exactText]));
    }
  });

  it("a signature is retained ONLY for a UNIQUE candidate", () => {
    // A sig alongside any other count is incoherent — the locate script emits one only for a single match — so
    // carrying it would dress an ambiguous or junk reading in evidence it does not have.
    const [r] = interpretWingRecon(["call_ip"], [
      { targetId: "call_ip.baseline", matchCount: 1, sig: "aaaaaaaaaaaaaaaa" },
      { targetId: "call_ip.nospace", matchCount: 3, sig: "bbbbbbbbbbbbbbbb" },
      { targetId: "call_ip.lower", matchCount: 0, sig: "cccccccccccccccc" },
      { targetId: "call_ip.ip_addr", matchCount: -1, sig: "dddddddddddddddd" },
    ]);
    expect(r!.candidates.map((c) => [c.verdict, c.sig16])).toEqual([
      ["UNIQUE", "aaaaaaaaaaaaaaaa"], ["AMBIGUOUS", null], ["ABSENT", null], ["INVALID_COUNT", null],
    ]);
  });

  it("two unique candidates with the SAME signature are still not auto-resolved — but the record can settle it", () => {
    // Equal sigs mean one element wearing two labels; unequal means two elements. Either way the module does
    // not choose — it just has to make the distinction VISIBLE, which counts alone could not.
    const [r] = interpretWingRecon(["vendor_info"], [
      { targetId: "vendor_info.label_only", matchCount: 1, sig: "1111111111111111" },
      { targetId: "vendor_info.th_dt", matchCount: 1, sig: "1111111111111111" },
      { targetId: "vendor_info.baseline", matchCount: 8 },
      { targetId: "vendor_info.vendor_name", matchCount: 0 },
    ]);
    expect(r!.resolvedUnambiguously).toBe(false);
    const sigs = r!.candidates.filter((c) => c.verdict === "UNIQUE").map((c) => c.sig16);
    expect(new Set(sigs).size).toBe(1);
  });

  it("a NOT_MEASURED candidate never carries a signature", () => {
    const [r] = interpretWingRecon(["call_ip"], [
      { targetId: "call_ip.nospace", matchCount: 1, sig: "eeeeeeeeeeeeeeee" },
      { targetId: "call_ip.nospace", matchCount: 5, sig: "ffffffffffffffff" },
    ]);
    const c = r!.candidates.find((x) => x.id === "call_ip.nospace")!;
    expect([c.verdict, c.matchCount, c.sig16]).toEqual(["NOT_MEASURED", null, null]);
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
    expect(wingReconProbes(["call_ip"]).some((p) => p.exactText === "INJECTED")).toBe(false);
  });

  it("the approved live scope is exactly the three unresolved targets — no widening by default", () => {
    expect([...WING_RECON_APPROVED_SCOPE]).toEqual(["self_dev", "vendor_info", "call_ip"]);
    expect(Object.isFrozen(WING_RECON_APPROVED_SCOPE)).toBe(true);
  });
});
