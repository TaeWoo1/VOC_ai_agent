/**
 * Executes `EXTRACT_WING_CENSUS` — the in-page census script — against a synthetic DOM.
 *
 * Why this file exists: the census is a template STRING shipped to `page.evaluate`, so nothing in the suite
 * ever ran it. Review found that `credentialAnchorPresent` is a bounded scan (it stops at a candidate cap) and
 * that the issued-state verdict had promoted that truncation-sensitive negative to "machine-checkable deletion
 * evidence". The cap now reports itself via `markerScanTruncated` — and a mutation that hardcodes it to `false`
 * must fail HERE, because no other test can see inside the string.
 *
 * The stub implements only what the script touches. It is not a DOM emulator; it exists to drive the scan.
 */
import { describe, it, expect } from "vitest";
import { EXTRACT_WING_CENSUS, type WingStructuralCensus } from "../../src/cli/coupang-wing-classifier";

interface StubEl {
  textContent: string;
  childElementCount: number;
  getAttribute(name: string): string | null;
}

function el(text: string, childElementCount = 0): StubEl {
  return { textContent: text, childElementCount, getAttribute: () => null };
}

/** Run the in-page script with a fake `document`. `markers` is the ordered candidate list the scan walks. */
function runCensus(markers: StubEl[]): WingStructuralCensus {
  const document = {
    querySelectorAll(sel: string): StubEl[] {
      // The marker/anchor scan is the only selector this test drives; everything else returns empty so the
      // counts stay zero and the assertions stay about truncation.
      if (sel.includes("[role='heading']")) return markers;
      return [];
    },
    querySelector(): null {
      return null;
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const fn = new Function("document", `return ${EXTRACT_WING_CENSUS};`) as (d: unknown) => WingStructuralCensus;
  return fn(document);
}

const CAP = 6000;

describe("EXTRACT_WING_CENSUS — the bounded marker scan reports its own truncation", () => {
  it("a small page: not truncated, and the anchor is found", () => {
    const r = runCensus([el("something"), el("Access Key"), el("else")]);
    expect(r.credentialAnchorPresent).toBe(true);
    expect(r.markerScanTruncated).toBe(false);
  });

  it("a small page without the anchor: absent AND not truncated — absence is trustworthy here", () => {
    const r = runCensus([el("a"), el("b")]);
    expect(r.credentialAnchorPresent).toBe(false);
    expect(r.markerScanTruncated).toBe(false);
  });

  it("the anchor BEYOND the cap is missed — and the scan says so", () => {
    // The exact false-'deleted' review demonstrated: on a large DOM the credential heading can sit past the
    // cap, so `credentialAnchorPresent` reads false purely from page size. Unreported, the issued-state verdict
    // would call that a deletion.
    const markers = [...Array.from({ length: CAP + 50 }, () => el("filler")), el("Access Key")];
    const r = runCensus(markers);
    expect(r.credentialAnchorPresent).toBe(false); // missed, as expected
    expect(r.markerScanTruncated, "truncation MUST be reported or absence looks like evidence").toBe(true);
  });

  it("stopping early because BOTH were found is NOT truncation", () => {
    // The loop also exits once both markers are found. That is a complete answer, not a curtailed one — marking
    // it truncated would make every healthy already-issued page report `indeterminate`.
    const markers = [el("오픈API 키 발급"), el("Access Key"), ...Array.from({ length: CAP + 50 }, () => el("filler"))];
    const r = runCensus(markers);
    expect(r.openApiMarkerPresent).toBe(true);
    expect(r.credentialAnchorPresent).toBe(true);
    expect(r.markerScanTruncated).toBe(false);
  });

  it("BOTH found at the LAST examined index on an over-cap page is complete, not truncated", () => {
    // The boundary: the loop increments past the cap on the iteration that finds the second marker, so a naive
    // `mi >= CAP` reads as truncated even though the scan answered both questions. Harmless today (a found
    // anchor short-circuits to `issued` before the truncation branch), but it would turn into a spurious
    // `SCAN_TRUNCATED` the moment the branch order changed.
    const markers = [
      ...Array.from({ length: CAP - 2 }, () => el("filler")),
      el("오픈API 키 발급"),
      el("Access Key"),
      ...Array.from({ length: 100 }, () => el("filler")),
    ];
    const r = runCensus(markers);
    expect(r.openApiMarkerPresent).toBe(true);
    expect(r.credentialAnchorPresent).toBe(true);
    expect(r.markerScanTruncated).toBe(false);
  });

  it("a page exactly at the cap is not truncated (nothing was left unexamined)", () => {
    const r = runCensus(Array.from({ length: CAP }, () => el("filler")));
    expect(r.markerScanTruncated).toBe(false);
  });

  it("the anchor match is EXACT — a superstring does not count", () => {
    // Stated as a limit in the classifier docs; asserted so it is a known property rather than a surprise.
    expect(runCensus([el("Access Key ID")]).credentialAnchorPresent).toBe(false);
    expect(runCensus([el("Access Key")]).credentialAnchorPresent).toBe(true);
  });

  it("the census returns booleans/integers only — no text ever leaves the page", () => {
    const r = runCensus([el("Access Key"), el("some secret looking value")]);
    for (const v of Object.values(r)) expect(["boolean", "number"]).toContain(typeof v);
    expect(JSON.stringify(r)).not.toContain("secret");
  });
});
