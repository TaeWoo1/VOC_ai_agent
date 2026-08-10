/**
 * **STAGE-2 LABEL CALIBRATION: what each choice control IS, measured rather than assumed.**
 *
 * The Stage-2 recon counted two radios and could say nothing about either. It also produced seven `ABSENT`
 * verdicts it could not bound: the sweep discarded the locate script's `hiddenCount`, so an absence meant "no
 * PAINTING whole-text match" and nothing more, and the leading explanation for all seven —
 * `WHOLE_TEXT_EXACT_MATCH_VS_NESTED_OR_PARTIAL_TEXT` — was recorded as INFERRED and untested.
 *
 * This unit builds the two instruments that close both, and these are the properties that keep them honest:
 * every reading is integers / booleans / closed categories / indices into OUR OWN candidate list; an unmeasured
 * field is `null` and never a measured zero; an absence under a truncated scan says so; and nothing here selects
 * a purpose, presses 확인, promotes a selector, or records a single character of the page's own wording.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildFixedLabelContainmentScript,
  buildFixedLabelLocateScript,
  sanitizeContainmentReading,
  type FixedLabelContainmentReading,
} from "../../../src/action-window/api-issuance-calibration/visual-recon-inpage";
import {
  buildWingChoiceAssociationScript,
  sanitizeChoiceAssociationCensus,
  sanitizeChoiceControlCensus,
  WING_NAME_LENGTH_BUCKETS,
  WING_NAME_SOURCES,
  type WingChoiceAssociationCensus,
} from "../../../src/cli/coupang-wing-classifier";
import {
  WING_LABEL_CALIBRATION_BLIND_REASON,
  WING_PURPOSE_CANDIDATE_PROVENANCES,
  WING_STAGE2_PRESENCES,
  WING_STAGE2_LABEL_CALIBRATION_EVIDENCE,
  WING_STAGE2_PURPOSE_OPTION_CANDIDATES,
  WING_STAGE2_RECON_CANDIDATES,
  interpretWingStage2Recon,
  wingLabelCalibrationBlind,
  wingStage2MissCause,
  wingStage2PresenceFrom,
  type WingPurposeOptionCandidate,
} from "../../../src/action-window/coupang-wing-label-recon";
import {
  WING_STAGE2_LABEL_CALIBRATION_PHASE,
  WING_STAGE2_RECON_PHASE,
  calibrationLaunchRefusal,
  resolveWingStage2Scope,
  runWingSelectorRecord,
  stage2RecordFor,
  type WingSelectorRecordDeps,
} from "../../../src/cli/probe-wing-issuance-selectors";
import { CoupangWingIssuanceDriver } from "../../../src/action-window/coupang-wing-issuance-driver";
import {
  PHASE_SPECS,
  WING_PHASES,
  isWingStage2Phase,
  validateApprovalPrerequisites,
  type ApprovalPrereqInput,
} from "../../../src/cli/approval-manifest";
import { WING_DEFAULT_URL, observeFrom, type WingStructuralCensus } from "../../../src/cli/coupang-wing-classifier";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = (p: string): string => readFileSync(resolve(HERE, "../../../src", p), "utf8");

/* ══════════════════════════ the CONTAINMENT probe ══════════════════════════ */

/**
 * A DOM double for the REAL generated containment script.
 *
 * `text` is the element's whole `textContent`; `kids` are its direct children, which is what the script's
 * innermost test walks. `css` is load-bearing for the same reason it is in the shape-census double: without a
 * real computed style, deleting the `display:none` branch of `paints()` would change no outcome.
 */
class Node2 {
  constructor(
    public tagName: string,
    public text: string,
    public kids: Node2[] = [],
    public visible = true,
    private attrs: Record<string, string> = {},
    public css: { display?: string; visibility?: string } = {},
  ) {}
  get children(): Node2[] {
    return this.kids;
  }
  get textContent(): string {
    return this.text;
  }
  get childElementCount(): number {
    return this.kids.length;
  }
  getAttribute(n: string): string | null {
    return Object.prototype.hasOwnProperty.call(this.attrs, n) ? this.attrs[n]! : null;
  }
  getClientRects(): { length: number }[] {
    return this.visible ? [{ length: 1 }] : [];
  }
  getBoundingClientRect(): { width: number; height: number } {
    return this.visible ? { width: 10, height: 10 } : { width: 0, height: 0 };
  }
}

/** Flatten a tree into document order, the way `querySelectorAll('*')` returns it. */
function flatten(roots: Node2[]): Node2[] {
  const out: Node2[] = [];
  const walk = (n: Node2): void => {
    out.push(n);
    for (const k of n.kids) walk(k);
  };
  for (const r of roots) walk(r);
  return out;
}

function runContainment(
  spec: { candidateQuery: string; exactText: string },
  opts: { candidates: Node2[]; all: Node2[] },
): { out: FixedLabelContainmentReading; asked: string[] } {
  const asked: string[] = [];
  const doc = {
    querySelectorAll(sel: string): Node2[] {
      asked.push(sel);
      // EXACT match on the two queries the script is contracted to ask for. A widened or misspelled query gets
      // an empty list, so a mutation surfaces as a wrong count rather than as the fixture answering anyway.
      if (sel === spec.candidateQuery) return opts.candidates;
      if (sel === "*") return opts.all;
      return [];
    },
  };
  const win = {
    getComputedStyle: (el: Node2) => ({ display: el.css.display ?? "block", visibility: el.css.visibility ?? "visible" }),
  };
  const out = new Function("document", "window", `return (${buildFixedLabelContainmentScript(spec)});`)(doc, win);
  return { out: sanitizeContainmentReading(out)!, asked };
}

describe("the containment probe — absent, or present in a form whole-text matching cannot see", () => {
  const SPEC = { candidateQuery: "label,legend", exactText: "자체개발" };

  it("counts an exact whole-text match, split by whether it paints", () => {
    const shown = new Node2("LABEL", "자체개발");
    const hidden = new Node2("LABEL", "자체개발", [], false);
    const out = runContainment(SPEC, { candidates: [shown, hidden], all: [shown, hidden] }).out;
    expect(out.exactVisible).toBe(1);
    expect(out.exactHidden).toBe(1);
  });

  it("**finds a label split across nested nodes that the exact matcher misses** — the untested hypothesis", () => {
    // <div><span>자체</span><span>개발</span></div>. `norm(textContent)` rejoins it on the PARENT, so the
    // parent contains the label while no child does and no element's whole text equals it. This is the exact
    // shape recorded as INFERRED against seven Stage-2 absences, and the reading now distinguishes it.
    const a = new Node2("SPAN", "자체");
    const b = new Node2("SPAN", "개발");
    const parent = new Node2("DIV", "자체개발", [a, b]);
    const out = runContainment(SPEC, { candidates: [], all: flatten([parent]) }).out;
    expect(out.exactVisible).toBe(0);
    expect(out.exactHidden).toBe(0);
    expect(out.deepestContainsVisible).toBe(1);
    expect(wingStage2PresenceFrom(out)).toBe("PRESENT_NOT_WHOLE_TEXT");
  });

  it("counts the INNERMOST container only — an ancestor chain does not inflate the number", () => {
    // Every ancestor up to <html> also contains the text. Counting them would report page depth, not a finding.
    const leaf = new Node2("SPAN", "자체개발");
    const mid = new Node2("DIV", "자체개발", [leaf]);
    const root = new Node2("BODY", "자체개발 그리고 더", [mid]);
    const out = runContainment(SPEC, { candidates: [], all: flatten([root]) }).out;
    expect(out.deepestContainsVisible).toBe(1);
    expect(out.deepestContainsHidden).toBe(0);
  });

  it("splits the innermost containers by PAINT too — a hidden one is not a visible finding", () => {
    // Without this the `paints()` branch of the containment half is dead weight: a label rendered into a
    // collapsed panel would be reported as visibly present, and the operator would be sent looking for
    // something that is not on screen. That is the `발급` locator's own live failure, one instrument over.
    const shown = new Node2("SPAN", "자체개발");
    const hiddenLeaf = new Node2("SPAN", "자체개발", [], false);
    const hiddenByStyle = new Node2("SPAN", "자체개발", [], true, {}, { display: "none" });
    const out = runContainment(SPEC, { candidates: [], all: [shown, hiddenLeaf, hiddenByStyle] }).out;
    expect(out.deepestContainsVisible).toBe(1);
    expect(out.deepestContainsHidden).toBe(2);
  });

  it("an EMPTY label reports zeros rather than the size of the page", () => {
    // `''.indexOf` is 0 for every string, so an empty candidate would "match" every element on the page and the
    // record would carry a document-size count dressed as a finding.
    const out = runContainment(
      { candidateQuery: "label", exactText: "   " },
      { candidates: [new Node2("LABEL", "무엇이든")], all: flatten([new Node2("DIV", "무엇이든")]) },
    ).out;
    expect(out.deepestContainsVisible).toBe(0);
    expect(out.deepestContainsHidden).toBe(0);
  });

  it("scans the document deep enough to find a match past the candidate cap", () => {
    // Pins the DOC cap by value. With a smaller cap the match at index 5000 is missed and the reading reads as
    // an absence — the truncation flag alone cannot catch that, because it is true either way at 8001 elements.
    const filler = () => new Node2("DIV", "관계없는 텍스트");
    const all = [...Array.from({ length: 5000 }, filler), new Node2("SPAN", "자체개발"), ...Array.from({ length: 999 }, filler)];
    const out = runContainment(SPEC, { candidates: [], all }).out;
    expect(out.deepestContainsVisible).toBe(1);
    expect(out.scanTruncated).toBe(false);
  });

  it("caps the CANDIDATE scan at the locate script's own 4000, so the exact halves stay comparable", () => {
    // A wider candidate cap here would count exact matches the locate script never saw, while the agreement
    // test (3 nodes) reported agreement. The candidate list is truncated at 4000 and SAYS so.
    const cands = [...Array.from({ length: 4001 }, () => new Node2("LABEL", "다른 라벨")), new Node2("LABEL", "자체개발")];
    const out = runContainment(SPEC, { candidates: cands, all: [] }).out;
    expect(out.exactVisible).toBe(0);
    expect(out.scanTruncated).toBe(true);
  });

  it("reports truncation, so an absence is never claimed over an unscanned document", () => {
    const many = Array.from({ length: 8001 }, () => new Node2("DIV", "관계없는 텍스트"));
    // 8001 > DOC_CAP. The candidate list is empty here, so this pins the DOCUMENT cap specifically.
    const out = runContainment(SPEC, { candidates: [], all: many }).out;
    expect(out.scanTruncated).toBe(true);
    // …and the presence verdict degrades with it, rather than asserting a whole-document absence.
    expect(wingStage2PresenceFrom(out)).toBe("ABSENT_WITHIN_SCAN_BOUND");
  });

  it("its exact-visible count AGREES with the shipped locate script for the same spec", () => {
    // The two scripts share `norm`, `accName` and `paints` by copy, and a drift between them would make the
    // calibration's "exact" half incomparable with every count already on the record.
    const nodes = [new Node2("LABEL", "자체개발"), new Node2("LABEL", "자체개발", [], false), new Node2("LEGEND", "다른 것")];
    const doc = {
      querySelectorAll: (sel: string): Node2[] => (sel === SPEC.candidateQuery ? nodes : []),
    };
    const win = { getComputedStyle: (el: Node2) => ({ display: el.css.display ?? "block", visibility: el.css.visibility ?? "visible" }) };
    const locate = new Function("document", "window", `return (${buildFixedLabelLocateScript({ ...SPEC, tag: false })});`)(doc, win) as {
      count: number;
      hiddenCount: number;
    };
    const contain = runContainment(SPEC, { candidates: nodes, all: nodes }).out;
    expect(contain.exactVisible).toBe(locate.count);
    expect(contain.exactHidden).toBe(locate.hiddenCount);
  });

  it("asks for exactly the caller's query and `*`, and returns five fields and nothing else", () => {
    const { out, asked } = runContainment(SPEC, { candidates: [], all: [] });
    expect(asked).toEqual([SPEC.candidateQuery, "*"]);
    expect(Object.keys(out).sort()).toEqual(
      ["deepestContainsHidden", "deepestContainsVisible", "exactHidden", "exactVisible", "scanTruncated"].sort(),
    );
    for (const [k, v] of Object.entries(out)) {
      expect(typeof v === "number" || typeof v === "boolean", `${k} = ${String(v)}`).toBe(true);
    }
  });

  it("the label it was asked about is the ONLY page-derived string it ever holds, and it is ours", () => {
    // The generated source embeds our own fixed label (it has to — that is the comparison). What must never
    // appear is a path that RETURNS text: no textContent in the output object, no innerHTML, no attribute dump.
    const src = buildFixedLabelContainmentScript(SPEC);
    expect(src).toContain(JSON.stringify(SPEC.exactText));
    for (const forbidden of ["innerHTML", "outerHTML", "innerText", ".value", "attributes", "screenshot"]) {
      expect(src, forbidden).not.toContain(forbidden);
    }
    // textContent is READ; the returned object is built from counters only.
    expect(src.slice(src.indexOf("return {"))).not.toContain("textContent");
  });

  it("is ES5-plain, so esbuild's `__name` shim is never referenced in the page", () => {
    const src = buildFixedLabelContainmentScript(SPEC);
    for (const modern of ["=>", "const ", "let ", "`", "...", "??"]) {
      expect(src, modern).not.toContain(modern);
    }
  });
});

describe("sanitizeContainmentReading — the host trusts the page for nothing", () => {
  it("coerces junk FIELDS to zeros and false rather than propagating them", () => {
    const r = sanitizeContainmentReading({
      exactVisible: -4,
      exactHidden: "7",
      deepestContainsVisible: 2.9,
      deepestContainsHidden: Number.NaN,
      scanTruncated: "yes",
    });
    expect(r).toEqual({
      exactVisible: 0,
      exactHidden: 0,
      deepestContainsVisible: 2,
      deepestContainsHidden: 0,
      // Only a literal `true` truncates. A truthy string must not, or a page could suppress an absence claim…
      // and, more importantly, could not manufacture one either.
      scanTruncated: false,
    });
  });

  it("**returns null for an unusable reading — never a complete set of zeros**", () => {
    // The defect this closes: `{0,0,0,0,false}` is a COMPLETE reading, and a complete reading folds to
    // `ABSENT_EVERYWHERE`. A page that swapped under the probe, or a CSP that killed the script, would have
    // produced a confident measured absence for a label nobody looked for. Only a throw produced a fault.
    for (const junk of [null, undefined, 42, "reading", [], true]) {
      expect(sanitizeContainmentReading(junk), String(junk)).toBeNull();
    }
    expect(wingStage2PresenceFrom(sanitizeContainmentReading(null))).toBe("NOT_MEASURED");
    // A real object with junk FIELDS is still a reading — the coercion above applies to it.
    expect(sanitizeContainmentReading({ exactVisible: "x" })).not.toBeNull();
  });
});

describe("wingStage2PresenceFrom — six outcomes, strongest evidence first", () => {
  const R = (o: Partial<FixedLabelContainmentReading>): FixedLabelContainmentReading => ({
    exactVisible: 0,
    exactHidden: 0,
    deepestContainsVisible: 0,
    deepestContainsHidden: 0,
    scanTruncated: false,
    ...o,
  });

  it("maps each reading to exactly one verdict", () => {
    expect(wingStage2PresenceFrom(R({ exactVisible: 1 }))).toBe("PRESENT_VISIBLE");
    expect(wingStage2PresenceFrom(R({ exactHidden: 3 }))).toBe("PRESENT_HIDDEN_ONLY");
    expect(wingStage2PresenceFrom(R({ deepestContainsVisible: 1 }))).toBe("PRESENT_NOT_WHOLE_TEXT");
    expect(wingStage2PresenceFrom(R({ deepestContainsHidden: 1 }))).toBe("PRESENT_NOT_WHOLE_TEXT");
    expect(wingStage2PresenceFrom(R({}))).toBe("ABSENT_EVERYWHERE");
    expect(wingStage2PresenceFrom(R({ scanTruncated: true }))).toBe("ABSENT_WITHIN_SCAN_BOUND");
    expect(wingStage2PresenceFrom(null)).toBe("NOT_MEASURED");
    expect(wingStage2PresenceFrom(undefined)).toBe("NOT_MEASURED");
  });

  it("prefers a PAINTING exact match over a hidden one, and either over mere containment", () => {
    expect(wingStage2PresenceFrom(R({ exactVisible: 1, exactHidden: 9, deepestContainsVisible: 9 }))).toBe("PRESENT_VISIBLE");
    expect(wingStage2PresenceFrom(R({ exactHidden: 1, deepestContainsVisible: 9 }))).toBe("PRESENT_HIDDEN_ONLY");
  });

  it("a PRESENT verdict is not weakened by truncation — only an absence is", () => {
    // Finding something under a truncated scan is still finding it; NOT finding something is the claim the
    // bound applies to. Collapsing both into one hedge would lose the distinction the vocabulary exists for.
    expect(wingStage2PresenceFrom(R({ exactVisible: 1, scanTruncated: true }))).toBe("PRESENT_VISIBLE");
    expect(wingStage2PresenceFrom(R({ deepestContainsHidden: 1, scanTruncated: true }))).toBe("PRESENT_NOT_WHOLE_TEXT");
  });

  it("every verdict it can return is in the declared closed vocabulary", () => {
    const produced = [
      wingStage2PresenceFrom(null),
      wingStage2PresenceFrom(R({ exactVisible: 1 })),
      wingStage2PresenceFrom(R({ exactHidden: 1 })),
      wingStage2PresenceFrom(R({ deepestContainsVisible: 1 })),
      wingStage2PresenceFrom(R({})),
      wingStage2PresenceFrom(R({ scanTruncated: true })),
    ];
    expect(new Set(produced).size).toBe(6);
    for (const p of produced) expect(WING_STAGE2_PRESENCES as readonly string[]).toContain(p);
  });
});

/* ══════════════════════════ the ASSOCIATION census ══════════════════════════ */

const CHOICE_SELECTOR = "input[type='radio'], input[type='checkbox'], [role='radio'], [role='option']";

/** A control double: attributes the census may read, plus the label wiring it walks. */
class Ctl {
  public kids: Ctl[] = [];
  constructor(
    public tagName: string,
    private attrs: Record<string, string> = {},
    public text = "",
    public visible = true,
    public disabled = false,
    public ancestorLabel: Ctl | null = null,
    public css: { display?: string; visibility?: string } = {},
  ) {}
  get textContent(): string {
    return this.text;
  }
  get childElementCount(): number {
    return this.kids.length;
  }
  getAttribute(n: string): string | null {
    return Object.prototype.hasOwnProperty.call(this.attrs, n) ? this.attrs[n]! : null;
  }
  closest(sel: string): Ctl | null {
    return sel === "label" ? this.ancestorLabel : null;
  }
  getClientRects(): { length: number }[] {
    return this.visible ? [{ length: 1 }] : [];
  }
  getBoundingClientRect(): { width: number; height: number } {
    return this.visible ? { width: 10, height: 10 } : { width: 0, height: 0 };
  }
}

interface AssocRow {
  index: number;
  nameSource: string;
  nameLengthBucket: string;
  exactCandidateIndex: number;
  containsCandidateIndex: number;
  hasIdAttr: boolean;
  labelForCount: number;
  ancestorLabelCount: number;
  ariaLabelledbyRefCount: number;
  ariaLabelledbyResolvedCount: number;
  groupIndex: number;
}
interface AssocOut {
  visibleChoiceControlCount: number;
  hiddenChoiceControlCount: number;
  rows: AssocRow[];
  nameGroupCount: number;
  largestNameGroupSize: number;
  ungroupedCount: number;
  scanTruncated: boolean;
  candidatesCompared: number;
}

function runAssoc(
  controls: Ctl[],
  candidates: readonly string[],
  wiring: { forLabels?: Record<string, Ctl[]>; byId?: Record<string, Ctl> } = {},
): { out: AssocOut; asked: string[]; sanitized: WingChoiceAssociationCensus } {
  const asked: string[] = [];
  const doc = {
    querySelectorAll(sel: string): Ctl[] {
      asked.push(sel);
      if (sel === CHOICE_SELECTOR) return controls;
      if (sel.startsWith("label[for=")) {
        // A real browser THROWS on a malformed attribute selector, and the script's own `catch` turns that into
        // zero associations. A lenient fixture accepts an unescaped quote and hands the labels back anyway — so
        // deleting the escaping would change nothing, and the guard would be testing its own double.
        const m = /^label\[for="((?:[^"\\]|\\.)*)"\]$/.exec(sel);
        if (!m) throw new SyntaxError("unparseable selector");
        return wiring.forLabels?.[m[1]!.replace(/\\(["\\])/g, "$1")] ?? [];
      }
      return [];
    },
    getElementById: (id: string): Ctl | null => wiring.byId?.[id] ?? null,
  };
  const win = {
    getComputedStyle: (el: Ctl) => ({ display: el.css.display ?? "block", visibility: el.css.visibility ?? "visible" }),
  };
  const out = new Function("document", "window", `return (${buildWingChoiceAssociationScript([...candidates])});`)(doc, win);
  const sanitized = sanitizeChoiceAssociationCensus(out, candidates);
  expect(sanitized, "the real script must always produce a usable reading").not.toBeNull();
  return { out: out as AssocOut, asked, sanitized: sanitized! };
}

const RADIO = (attrs: Record<string, string>, over: Partial<{ visible: boolean; disabled: boolean; ancestorLabel: Ctl | null; text: string }> = {}): Ctl =>
  new Ctl("INPUT", { type: "radio", ...attrs }, over.text ?? "", over.visible ?? true, over.disabled ?? false, over.ancestorLabel ?? null);

describe("the label-association census — how a control is labelled, never what it says", () => {
  it("derives the name in ARIA precedence order and NAMES the source", () => {
    const labelled = RADIO({ "aria-labelledby": "r1" });
    const ariaLabel = RADIO({ "aria-label": "자체개발" });
    const forLabel = RADIO({ id: "x" });
    const wrapped = RADIO({}, { ancestorLabel: new Ctl("LABEL", {}, "직접입력") });
    const titled = RADIO({ title: "무언가" });
    const bare = RADIO({});
    const { out } = runAssoc([labelled, ariaLabel, forLabel, wrapped, titled, bare], ["자체개발"], {
      byId: { r1: new Ctl("SPAN", {}, "자체개발") },
      forLabels: { x: [new Ctl("LABEL", {}, "자체개발")] },
    });
    expect(out.rows.map((r) => r.nameSource)).toEqual([
      "ARIA_LABELLEDBY",
      "ARIA_LABEL",
      "LABEL_FOR",
      "LABEL_ANCESTOR",
      "TITLE",
      "NONE",
    ]);
    // …and precedence is real: a control with BOTH labelledby and aria-label reports the former.
    const both = RADIO({ "aria-labelledby": "r1", "aria-label": "다른 것" });
    expect(runAssoc([both], [], { byId: { r1: new Ctl("SPAN", {}, "자체개발") } }).out.rows[0]!.nameSource).toBe("ARIA_LABELLEDBY");
  });

  it("reports the candidate MATCH as an index, exact and contained separately", () => {
    const exact = RADIO({ "aria-label": "자체개발" });
    const wrapped = RADIO({ "aria-label": "자체개발 (직접입력)" });
    const neither = RADIO({ "aria-label": "전혀 다른 항목" });
    const { out } = runAssoc([exact, wrapped, neither], ["직접입력", "자체개발"]);
    expect(out.rows[0]).toMatchObject({ exactCandidateIndex: 1, containsCandidateIndex: 1 });
    // The wrapped one matches NO candidate exactly while CONTAINING the first in list order. That pair is the
    // per-control form of the whole-text hypothesis, and it is why both indices are reported.
    expect(out.rows[1]).toMatchObject({ exactCandidateIndex: -1, containsCandidateIndex: 0 });
    expect(out.rows[2]).toMatchObject({ exactCandidateIndex: -1, containsCandidateIndex: -1 });
    expect(out.candidatesCompared).toBe(2);
  });

  it("**groups radios by their shared `name` — the measurement the recon could not make**", () => {
    // The Stage-2 record could only say "no painting fieldset/radiogroup/listbox", and a code comment
    // over-claimed that as "the radios are ungrouped". HTML groups by `name`; this reads it and emits ordinals.
    const a = RADIO({ name: "purposeType" });
    const b = RADIO({ name: "purposeType" });
    const c = RADIO({ name: "other" });
    const d = RADIO({});
    const { out } = runAssoc([a, b, c, d], []);
    expect(out.rows.map((r) => r.groupIndex)).toEqual([0, 0, 1, -1]);
    expect(out.nameGroupCount).toBe(2);
    expect(out.largestNameGroupSize).toBe(2);
    expect(out.ungroupedCount).toBe(1);
  });

  it("the RAW script output carries no page wording at all", () => {
    // The host sanitizer rebuilds every row field-by-field, so an added text field would be dropped there. That
    // is defense in depth, not the contract: the script is what runs inside the page, and a reviewer reading it
    // must be able to see that nothing textual is in its return value. Asserted on the unsanitized output.
    const { out } = runAssoc(
      [RADIO({ name: "g", "aria-label": "자체개발" }), RADIO({ name: "g", "aria-label": "업체를 통한 연동" })],
      ["자체개발"],
    );
    expect(JSON.stringify(out)).not.toMatch(/[가-힣]/);
    // …and it did derive those names — otherwise the assertion above passes for the wrong reason.
    expect(out.rows[0]!.exactCandidateIndex).toBe(0);
    expect(out.rows[1]!.nameSource).toBe("ARIA_LABEL");
    expect(out.rows[1]!.exactCandidateIndex).toBe(-1);
  });

  it("the group NAME never leaves — only its ordinal", () => {
    const { out } = runAssoc([RADIO({ name: "purposeType", id: "secretId" })], []);
    const json = JSON.stringify(out);
    expect(json).not.toContain("purposeType");
    expect(json).not.toContain("secretId");
    expect(out.rows[0]!.groupIndex).toBe(0);
    expect(out.rows[0]!.hasIdAttr).toBe(true);
  });

  it("counts a DUPLICATE label[for] and an UNRESOLVED aria-labelledby reference", () => {
    // Both are real page defects that break the association silently, and both are invisible in a bare name.
    const dup = RADIO({ id: "d" });
    const dangling = RADIO({ "aria-labelledby": "gone here" });
    const { out } = runAssoc([dup, dangling], [], {
      forLabels: { d: [new Ctl("LABEL", {}, "하나"), new Ctl("LABEL", {}, "둘")] },
      byId: { here: new Ctl("SPAN", {}, "존재함") },
    });
    expect(out.rows[0]!.labelForCount).toBe(2);
    expect(out.rows[1]).toMatchObject({ ariaLabelledbyRefCount: 2, ariaLabelledbyResolvedCount: 1 });
  });

  it("buckets the name LENGTH coarsely, and reports `none` for an unlabelled control", () => {
    const rows = runAssoc(
      [RADIO({}), RADIO({ "aria-label": "짧다" }), RADIO({ "aria-label": "중간 정도 길이의 라벨입니다" }), RADIO({ "aria-label": "가".repeat(40) })],
      [],
    ).out.rows;
    expect(rows.map((r) => r.nameLengthBucket)).toEqual(["none", "short", "medium", "long"]);
    for (const r of rows) expect(WING_NAME_LENGTH_BUCKETS as readonly string[]).toContain(r.nameLengthBucket);
  });

  it("excludes non-painting and disabled controls, and counts them as hidden", () => {
    const shown = RADIO({ name: "g" });
    const invisible = RADIO({ name: "g" }, { visible: false });
    const styled = new Ctl("INPUT", { type: "radio", name: "g" }, "", true, false, null, { display: "none" });
    const off = RADIO({ name: "g", "aria-disabled": "true" });
    const { out } = runAssoc([shown, invisible, styled, off], []);
    expect(out.visibleChoiceControlCount).toBe(1);
    expect(out.hiddenChoiceControlCount).toBe(3);
    expect(out.rows).toHaveLength(1);
    // A hidden control must not be counted into the group census either — it never became a row.
    expect(out.largestNameGroupSize).toBe(1);
  });

  it("reports its OWN scan truncation — a census over a prefix is not a census", () => {
    // The host-side `rowsTruncated` was tested; the in-page `scanTruncated` was not. The guard was on the cap
    // one layer away from the one that decides how much of the document was looked at.
    const many = Array.from({ length: 4001 }, () => RADIO({ name: "g" }));
    expect(runAssoc(many, []).out.scanTruncated).toBe(true);
    expect(runAssoc([RADIO({})], []).out.scanTruncated).toBe(false);
  });

  it("excludes a NATIVELY disabled control, not only an aria-disabled one", () => {
    // No fixture ever set the native property, so the `node.disabled === true` half of `enabled()` was unproven
    // for this script — and a native-disabled radio is the likelier of the two on a real form.
    const native = RADIO({ name: "g" });
    (native as unknown as { disabled: boolean }).disabled = true;
    const { out } = runAssoc([RADIO({ name: "g" }), native], []);
    expect(out.visibleChoiceControlCount).toBe(1);
    expect(out.hiddenChoiceControlCount).toBe(1);
  });

  it("reports the ancestor-label association as a COUNT, not only as a name source", () => {
    const wrapped = RADIO({}, { ancestorLabel: new Ctl("LABEL", {}, "직접입력") });
    const bare = RADIO({});
    const rows = runAssoc([wrapped, bare], []).out.rows;
    expect(rows[0]!.ancestorLabelCount).toBe(1);
    expect(rows[1]!.ancestorLabelCount).toBe(0);
  });

  it("pins the length-bucket BOUNDARIES, not just one value per bucket", () => {
    // The fixture lengths sat far from every boundary, so the doc's calibration argument ("a `short` name is a
    // label like 자체개발, a `long` one is a sentence") was pinned by nothing.
    const at = (n: number): string => runAssoc([RADIO({ "aria-label": "가".repeat(n) })], []).out.rows[0]!.nameLengthBucket;
    expect([at(1), at(8), at(9), at(24), at(25)]).toEqual(["short", "short", "medium", "medium", "long"]);
  });

  it("asks for exactly the shipped choice selector", () => {
    const { asked } = runAssoc([RADIO({})], []);
    expect(asked[0]).toBe(CHOICE_SELECTOR);
  });

  it("NEVER reads `checked` — the instrument cannot report a selection even if one existed", () => {
    // The shape census refuses `checked` as a leaked selection, and this run's whole premise is that no purpose
    // has been chosen. A source guard, because the property would be trivially easy to add later.
    const src = buildWingChoiceAssociationScript(["자체개발"]);
    expect(src).not.toContain("checked");
    expect(src).not.toContain(".value");
    for (const forbidden of ["innerHTML", "outerHTML", "innerText", "click(", "screenshot", "placeholder"]) {
      expect(src, forbidden).not.toContain(forbidden);
    }
  });

  it("is ES5-plain", () => {
    const src = buildWingChoiceAssociationScript(["자체개발"]);
    for (const modern of ["=>", "const ", "let ", "...", "??"]) {
      expect(src, modern).not.toContain(modern);
    }
  });

  it("escapes an id before building the label[for] selector", () => {
    // An id is read to FIND the label element. Interpolated raw, a quote in it would break out of the selector
    // and — via the script's own `catch` — turn a page-authored id into a silent zero association.
    const src = buildWingChoiceAssociationScript([]);
    expect(src).toContain("replace(");
    const weird = RADIO({ id: 'a"b' });
    const { out } = runAssoc([weird], [], { forLabels: { 'a"b': [new Ctl("LABEL", {}, "라벨")] } });
    expect(out.rows[0]!.labelForCount).toBe(1);
    expect(out.rows[0]!.nameSource).toBe("LABEL_FOR");
  });
});

describe("sanitizeChoiceAssociationCensus — the record's vocabulary is guaranteed host-side", () => {
  /** Candidate lists of a given size; the sanitizer derives both the clamp bound and the compared count. */
  const CANDS0: string[] = [];
  const CANDS2 = ["자체개발", "직접입력"];
  const CANDS4 = ["자체개발", "자체 개발", "직접입력", "직접 입력"];

  /** The sanitizer is nullable now; these cases all feed it a real object, so the assert is the contract. */
  const san = (r: unknown, c: readonly string[]) => {
    const out = sanitizeChoiceAssociationCensus(r, c);
    expect(out).not.toBeNull();
    return out!;
  };

  const raw = (over: Partial<AssocRow> = {}): Record<string, unknown> => ({
    visibleChoiceControlCount: 2,
    hiddenChoiceControlCount: 10,
    rows: [
      {
        index: 0,
        nameSource: "LABEL_FOR",
        nameLengthBucket: "short",
        exactCandidateIndex: 1,
        containsCandidateIndex: 1,
        hasIdAttr: true,
        labelForCount: 1,
        ancestorLabelCount: 0,
        ariaLabelledbyRefCount: 0,
        ariaLabelledbyResolvedCount: 0,
        groupIndex: 0,
        ...over,
      },
    ],
    nameGroupCount: 1,
    largestNameGroupSize: 2,
    ungroupedCount: 0,
    scanTruncated: false,
  });

  it("clamps a candidate index that points at no candidate", () => {
    // A dangling index reads as a confident identification of nothing — worse than -1, because -1 is honest.
    expect(san(raw({ exactCandidateIndex: 7 }), CANDS2).rows[0]!.exactCandidateIndex).toBe(-1);
    expect(san(raw({ containsCandidateIndex: -3 }), CANDS2).rows[0]!.containsCandidateIndex).toBe(-1);
    expect(san(raw({ exactCandidateIndex: 1 }), CANDS2).rows[0]!.exactCandidateIndex).toBe(1);
    // …and with NO candidates sent, every index must be -1 regardless of what the page returned.
    expect(san(raw({ exactCandidateIndex: 0 }), CANDS0).rows[0]!.exactCandidateIndex).toBe(-1);
  });

  it("forces an unlisted category back into the closed vocabulary", () => {
    const r = san(raw({ nameSource: "사용목적-자체개발", nameLengthBucket: "enormous" }), CANDS2).rows[0]!;
    expect(r.nameSource).toBe("NONE");
    expect(r.nameLengthBucket).toBe("none");
    expect(WING_NAME_SOURCES as readonly string[]).toContain(r.nameSource);
  });

  it("re-derives the row ordinal from position — the page cannot renumber its own rows", () => {
    const two = { ...raw(), rows: [{ ...(raw().rows as AssocRow[])[0]!, index: 99 }, { ...(raw().rows as AssocRow[])[0]!, index: 99 }] };
    expect(san(two, CANDS2).rows.map((r) => r.index)).toEqual([0, 1]);
  });

  it("caps the rows and SAYS it capped them", () => {
    const many = { ...raw(), rows: Array.from({ length: 40 }, () => (raw().rows as AssocRow[])[0]!) };
    const s = san(many, CANDS2);
    expect(s.rows).toHaveLength(32);
    expect(s.rowsTruncated).toBe(true);
    expect(san(raw(), CANDS2).rowsTruncated).toBe(false);
  });

  it("coerces junk counts and reports the candidate count the HOST sent, not the page's claim", () => {
    const junk = { ...raw({ labelForCount: -2, groupIndex: 1.5 }), visibleChoiceControlCount: "many", candidatesCompared: 999 };
    const s = san(junk, CANDS4);
    expect(s.visibleChoiceControlCount).toBe(0);
    expect(s.rows[0]!.labelForCount).toBe(0);
    expect(s.rows[0]!.groupIndex).toBe(-1);
    expect(s.candidatesCompared).toBe(4);
  });

  it("**returns null for an unusable reading — never a census reporting zero controls**", () => {
    // Same defect as the containment sanitizer's: a zeroed census is a COMPLETE reading, and the record's
    // `association: null` would then mean two different things — "the census was not taken" and "the census
    // found nothing". Only the fault distinguishes them, and a silent nothing produced no fault.
    for (const junk of [null, undefined, 7, "census", [], false]) {
      expect(sanitizeChoiceAssociationCensus(junk, CANDS2), String(junk)).toBeNull();
    }
  });

  it("counts only the candidates the comparison actually RAN against", () => {
    // The in-page loop skips a blank candidate (an empty string is contained in every name), so counting it
    // would claim coverage the comparison did not have — while the clamp bound stays the FULL list length, so
    // an index still names the right candidate.
    const withBlank = san(raw({ exactCandidateIndex: 2 }), ["자체개발", "   ", "직접입력"]);
    expect(withBlank.candidatesCompared).toBe(2);
    expect(withBlank.rows[0]!.exactCandidateIndex).toBe(2);
  });
});

/* ══════════════════════════ the fold ══════════════════════════ */

describe("the fold carries hiddenCount and containment — and never invents either", () => {
  const CONT: FixedLabelContainmentReading = {
    exactVisible: 0,
    exactHidden: 2,
    deepestContainsVisible: 1,
    deepestContainsHidden: 0,
    scanTruncated: false,
  };

  it("carries a reported hidden count and its containment through to the row", () => {
    const [t] = interpretWingStage2Recon(["confirm"], [{ targetId: "stage2.confirm.confirm", matchCount: 0, hiddenCount: 2, containment: CONT }]);
    const row = t!.candidates[0]!;
    expect(row.hiddenMatchCount).toBe(2);
    expect(row.containment).toEqual(CONT);
    expect(row.presence).toBe("PRESENT_HIDDEN_ONLY");
  });

  it("**an unreported hidden count stays null — it never becomes a measured zero**", () => {
    // This is the field the Stage-2 sweep dropped entirely, which is why every landed ABSENT is bounded by
    // `absenceBounds.hiddenMatchCountCarried: false`. Carrying it is only an improvement if absent still reads
    // as absent: a 0 here would claim "measured: nothing hidden" on a run that measured no such thing.
    const [t] = interpretWingStage2Recon(["confirm"], [{ targetId: "stage2.confirm.confirm", matchCount: 0 }]);
    expect(t!.candidates[0]!.hiddenMatchCount).toBeNull();
    expect(t!.candidates[0]!.containment).toBeNull();
    expect(t!.candidates[0]!.presence).toBe("NOT_MEASURED");
  });

  it("rejects a junk hidden count rather than recording it", () => {
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const [t] = interpretWingStage2Recon(["confirm"], [{ targetId: "stage2.confirm.confirm", matchCount: 0, hiddenCount: bad }]);
      expect(t!.candidates[0]!.hiddenMatchCount, String(bad)).toBeNull();
    }
    // 0 is a real reading and must survive — the guard rejects junk, not zero.
    const [ok] = interpretWingStage2Recon(["confirm"], [{ targetId: "stage2.confirm.confirm", matchCount: 0, hiddenCount: 0 }]);
    expect(ok!.candidates[0]!.hiddenMatchCount).toBe(0);
  });

  it("a duplicate row whose CONTAINMENT differs is a conflict too, not a last-write-wins", () => {
    // Conflict used to be detected on the count alone, while the optional fields were written unconditionally.
    // Two rows agreeing on the count but disagreeing on what they saw is the same untrustworthy reading.
    const other: FixedLabelContainmentReading = { ...CONT, exactVisible: 5 };
    const [t] = interpretWingStage2Recon(["confirm"], [
      { targetId: "stage2.confirm.confirm", matchCount: 0, containment: CONT },
      { targetId: "stage2.confirm.confirm", matchCount: 0, containment: other },
    ]);
    expect(t!.candidates[0]!.verdict).toBe("NOT_MEASURED");
    expect(t!.candidates[0]!.presence).toBe("NOT_MEASURED");
    // …and an identical repeat is NOT a conflict: a re-reported row that agrees is still one reading.
    const [same] = interpretWingStage2Recon(["confirm"], [
      { targetId: "stage2.confirm.confirm", matchCount: 0, containment: CONT, hiddenCount: 1 },
      { targetId: "stage2.confirm.confirm", matchCount: 0, containment: CONT, hiddenCount: 1 },
    ]);
    expect(same!.candidates[0]!.presence).toBe("PRESENT_HIDDEN_ONLY");
    expect(same!.candidates[0]!.hiddenMatchCount).toBe(1);
  });

  it("a CONFLICTING duplicate row drops the containment too, not just the count", () => {
    // Two different counts for one candidate means the reading is untrustworthy for it. Keeping the containment
    // would dress an untrusted row in evidence and let it claim a presence the count is not entitled to.
    const [t] = interpretWingStage2Recon(["confirm"], [
      { targetId: "stage2.confirm.confirm", matchCount: 0, containment: CONT, hiddenCount: 2 },
      { targetId: "stage2.confirm.confirm", matchCount: 1, containment: CONT, hiddenCount: 2 },
    ]);
    expect(t!.candidates[0]!.verdict).toBe("NOT_MEASURED");
    expect(t!.candidates[0]!.containment).toBeNull();
    expect(t!.candidates[0]!.hiddenMatchCount).toBeNull();
    expect(t!.candidates[0]!.presence).toBe("NOT_MEASURED");
  });
});

/* ══════════════════════════ the purpose-option candidates ══════════════════════════ */

describe("the purpose-option candidates — traceable, frozen, and now two-thirds guesswork", () => {
  it("holds EXACTLY the wording that traces to something on the record", () => {
    // Pinned by value, in order. The failure this prevents is unchanged: a plausible-sounding option label
    // appearing here without a source — invented wording shipped into the live page as an exact-match query,
    // which is the speculative retuning collector/CLAUDE.md §6 forbids. What changed is that two entries now
    // trace to an operator reading the screen instead of to a description of it.
    expect(WING_STAGE2_PURPOSE_OPTION_CANDIDATES.map((c) => [c.id, c.exactText, c.provenance])).toEqual([
      ["purpose_option.self_dev", "자체개발", "PRODUCT_OWNER_FLOW_DESCRIPTION"],
      ["purpose_option.self_dev_spaced", "자체 개발", "MECHANICAL_SPACING_VARIANT"],
      ["purpose_option.direct_input", "직접입력", "PRODUCT_OWNER_FLOW_DESCRIPTION"],
      ["purpose_option.direct_input_spaced", "직접 입력", "MECHANICAL_SPACING_VARIANT"],
      ["purpose_option.open_api", "OPEN API", "OPERATOR_TRANSCRIBED"],
      ["purpose_option.playauto_web_solution", "플레이오토 웹 솔루션", "OPERATOR_TRANSCRIBED"],
    ]);
  });

  it("**still contains no GUESS at either label** — the two new entries are a reading, not a hunch", () => {
    // The previous unit refused to invent the second radio's wording and left `exactCandidateIndex: -1` on the
    // record as the honest finding. The refusal is what this list still enforces; it is now satisfied by a
    // transcription rather than by an absence. The guesses that were declined then must not arrive now.
    const all = WING_STAGE2_PURPOSE_OPTION_CANDIDATES.map((c) => c.exactText).join("|");
    for (const guess of ["업체연동", "업체 연동", "대행", "위탁", "외부"]) {
      expect(all, guess).not.toContain(guess);
    }
  });

  it("every candidate carries a closed provenance, and ONLY a screen reading claims to be transcribed", () => {
    for (const c of WING_STAGE2_PURPOSE_OPTION_CANDIDATES) {
      expect(WING_PURPOSE_CANDIDATE_PROVENANCES as readonly string[]).toContain(c.provenance);
      expect(c.rationale.length).toBeGreaterThan(20);
    }
    // The inverse of the guard this test used to carry. OPERATOR_TRANSCRIBED is reserved for wording a human
    // read off the live screen; before 2026-08-10 nothing qualified and the test asserted nothing claimed it.
    // Now exactly the two transcribed entries do, and re-labelling a flow description as one — laundering an
    // account of WING's copy into an observation of it — is what fails here.
    const transcribed = WING_STAGE2_PURPOSE_OPTION_CANDIDATES.filter((c) => c.provenance === "OPERATOR_TRANSCRIBED");
    expect(transcribed.map((c) => c.exactText)).toEqual(["OPEN API", "플레이오토 웹 솔루션"]);
    for (const c of transcribed) expect(c.rationale).toMatch(/2026-08-10/);
  });

  it("the transcribed pair matches the LENGTH BANDS the previous run measured, in screen order", () => {
    // The one falsifiable check available before the calibration re-runs: 2026-08-09 measured radio 0's derived
    // name in `short` (1–8 characters) and radio 1's in `medium` (9–24), knowing nothing of the strings. A
    // transcription outside those bands would mean a different element, a different screen, or a flipped order.
    //
    // Weaker than it looks, and the weakness is ours: the bands were stated in the request that asked for the
    // transcription, so the reading was not blind to what would satisfy them. It catches a gross error, not a
    // subtle one — and it ties neither string to either control either way.
    const [first, second] = WING_STAGE2_PURPOSE_OPTION_CANDIDATES.filter((c) => c.provenance === "OPERATOR_TRANSCRIBED");
    expect(first!.exactText.length).toBe(8);
    expect(first!.exactText.length).toBeGreaterThanOrEqual(1);
    expect(first!.exactText.length).toBeLessThanOrEqual(8);
    expect(second!.exactText.length).toBe(11);
    expect(second!.exactText.length).toBeGreaterThanOrEqual(9);
    expect(second!.exactText.length).toBeLessThanOrEqual(24);
  });

  it("the transcribed strings are EXACTLY what a browser would compare — NFC, ASCII spaces, no stray trim", () => {
    // Two silent no-match modes that a reader cannot see and a review cannot catch by eye:
    //
    //  - Decomposed Hangul. `플레이오토` typed or pasted from some macOS sources is NFD; it renders identically
    //    and compares unequal against the page's NFC. The script does no normalization, by design — normalizing
    //    would make the record's "exact match" mean something other than exact.
    //  - A non-breaking space. A label copied out of a rendered page routinely carries U+00A0 where the eye
    //    sees a space, and the in-page matcher collapses ASCII whitespace only.
    //
    // Either would produce `exactCandidateIndex: -1` on a page whose label is character-for-character correct —
    // and the run would read as a measured non-match rather than as our own bug.
    for (const c of WING_STAGE2_PURPOSE_OPTION_CANDIDATES.filter((x) => x.provenance === "OPERATOR_TRANSCRIBED")) {
      expect(c.exactText.normalize("NFC"), `${c.id} is not NFC`).toBe(c.exactText);
      expect(c.exactText, `${c.id} carries a non-ASCII space`).not.toMatch(/[\u00a0\u1680\u2000-\u200b\u202f\u205f\u3000]/);
      expect(c.exactText.trim()).toBe(c.exactText);
      expect(c.exactText).not.toMatch(/\s\s/);
    }
    // Pinned by CODE POINT off the SHIPPED value — not off a literal re-typed here, which would only compare a
    // mistake against a copy of itself. This is the assertion a "harmless" re-typing breaks.
    const shipped = (id: string): string => WING_STAGE2_PURPOSE_OPTION_CANDIDATES.find((c) => c.id === id)!.exactText;
    expect([...shipped("purpose_option.open_api")].map((ch) => ch.codePointAt(0))).toEqual([79, 80, 69, 78, 32, 65, 80, 73]);
    expect([...shipped("purpose_option.playauto_web_solution")].map((ch) => ch.codePointAt(0))).toEqual([
      0xd50c, 0xb808, 0xc774, 0xc624, 0xd1a0, 32, 0xc6f9, 32, 0xc194, 0xb8e8, 0xc158,
    ]);
  });

  it("every MECHANICAL_SPACING_VARIANT really is a spacing transform of a flow-description entry", () => {
    // The provenance is described as "the field a reviewer must be able to check mechanically", and this is the
    // one entry in the vocabulary that actually is. Asserting `rationale.length > 20` next to that claim was
    // measuring prose volume.
    const bare = (t: string): string => t.replace(/\s+/g, "");
    const described = WING_STAGE2_PURPOSE_OPTION_CANDIDATES.filter((c) => c.provenance === "PRODUCT_OWNER_FLOW_DESCRIPTION").map((c) => bare(c.exactText));
    const variants = WING_STAGE2_PURPOSE_OPTION_CANDIDATES.filter((c) => c.provenance === "MECHANICAL_SPACING_VARIANT");
    expect(variants.length).toBeGreaterThan(0);
    for (const v of variants) {
      expect(described, `${v.id} is not a spacing transform of any described entry`).toContain(bare(v.exactText));
      // …and it must actually DIFFER in spacing, or it is a duplicate wearing a provenance label.
      expect(described).not.toContain(v.exactText);
    }
  });

  it("no candidate is blank — `candidatesCompared` counts what the comparison ran against", () => {
    for (const c of WING_STAGE2_PURPOSE_OPTION_CANDIDATES) expect(c.exactText.trim().length).toBeGreaterThan(0);
  });

  it("ids are unique, so an index and an id can never disagree about which candidate matched", () => {
    const ids = WING_STAGE2_PURPOSE_OPTION_CANDIDATES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("is DEEP-frozen — the shipped text cannot be rewritten before it reaches the page", () => {
    // `Object.freeze` is shallow and `readonly` is erased at runtime. The Stage-2 candidate set shipped with
    // exactly this hole, and this unit's own test found it: `exactText` was assignable, and that string is
    // handed straight to the live page as an exact-match query.
    expect(Object.isFrozen(WING_STAGE2_PURPOSE_OPTION_CANDIDATES)).toBe(true);
    for (const c of WING_STAGE2_PURPOSE_OPTION_CANDIDATES) {
      expect(Object.isFrozen(c)).toBe(true);
      expect(() => {
        (c as { exactText: string }).exactText = "무엇이든";
      }).toThrow();
    }
  });

  it("PREDICTS the calibration re-run: the real script, the shipped list, a DOM as transcribed", () => {
    // What this unit is actually for. The two strings are only worth a live grant if they turn each row's -1
    // into an index, so the prediction is written down BEFORE the run rather than recognized after it: build a
    // fake Stage-2 exactly as the operator described — two radios, one `name` group, one `label[for]` each,
    // bearing the transcribed text — and run the REAL generated script against the REAL shipped candidate list.
    //
    // If the live run returns anything other than this, the difference is the finding, and it is not
    // renegotiable after the fact. It cannot be a matcher bug: the same matcher produced the expectation.
    const r0 = RADIO({ id: "p0", name: "purpose" });
    const r1 = RADIO({ id: "p1", name: "purpose" });
    const { sanitized } = runAssoc([r0, r1], WING_STAGE2_PURPOSE_OPTION_CANDIDATES.map((c) => c.exactText), {
      forLabels: {
        p0: [new Ctl("LABEL", {}, "OPEN API")],
        p1: [new Ctl("LABEL", {}, "플레이오토 웹 솔루션")],
      },
    });
    expect(sanitized.visibleChoiceControlCount).toBe(2);
    expect(sanitized.nameGroupCount).toBe(1);
    expect(sanitized.largestNameGroupSize).toBe(2);
    expect(sanitized.ungroupedCount).toBe(0);
    expect(sanitized.candidatesCompared).toBe(6);
    expect(sanitized.rows.map((x) => [x.index, x.nameSource, x.nameLengthBucket, x.exactCandidateIndex, x.containsCandidateIndex, x.labelForCount, x.groupIndex])).toEqual([
      [0, "LABEL_FOR", "short", 4, 4, 1, 0],
      [1, "LABEL_FOR", "medium", 5, 5, 1, 0],
    ]);
    // The indices are the whole point, so tie them to the ids rather than leaving 4 and 5 as bare numerals that
    // a reordering of the list would silently re-aim at a different candidate.
    expect(WING_STAGE2_PURPOSE_OPTION_CANDIDATES[sanitized.rows[0]!.exactCandidateIndex]!.id).toBe("purpose_option.open_api");
    expect(WING_STAGE2_PURPOSE_OPTION_CANDIDATES[sanitized.rows[1]!.exactCandidateIndex]!.id).toBe("purpose_option.playauto_web_solution");
    // …and the four flow-description candidates still match NOTHING on that screen. The previous run measured
    // that, and adding two entries must not quietly turn one of them into a hit.
    expect(sanitized.rows.every((x) => x.exactCandidateIndex >= 4)).toBe(true);
  });

  it("the transcribed strings do not COLLIDE with the older candidates in either direction", () => {
    // `exactCandidateIndex` takes the FIRST match, so a new entry that a flow-description entry is a substring
    // of (or vice versa) would make the reported index depend on list order — and the docstring says order
    // carries no claim. Checked, rather than asserted in prose.
    const cs = WING_STAGE2_PURPOSE_OPTION_CANDIDATES.map((c) => c.exactText);
    for (const a of cs) for (const b of cs) {
      if (a === b) continue;
      expect(a.includes(b), `${a} contains ${b} — the first-match rule makes the index order-dependent`).toBe(false);
    }
  });

  it("the blind check fires on an empty or blank-only set, and not on the shipped one", () => {
    expect(wingLabelCalibrationBlind([])).toBe(true);
    expect(wingLabelCalibrationBlind([{ id: "x", exactText: "   ", provenance: "PRODUCT_OWNER_FLOW_DESCRIPTION", rationale: "r" }])).toBe(true);
    expect(wingLabelCalibrationBlind(WING_STAGE2_PURPOSE_OPTION_CANDIDATES)).toBe(false);
  });
});

/* ══════════════════════════ the sweep ══════════════════════════ */

const BASE: WingStructuralCensus = {
  passwordFieldPresent: false,
  submitAffordancePresent: false,
  dialogLikePresent: false,
  choiceControlCount: 2,
  actionControlCount: 3,
  formCount: 2,
  editableTextInputCount: 6,
  readonlyFieldCount: 0,
  listLikeContainerCount: 5,
  markerScanTruncated: false,
  openApiMarkerPresent: true,
  credentialAnchorPresent: true,
};

const CONTAINMENT: FixedLabelContainmentReading = {
  exactVisible: 0,
  exactHidden: 0,
  deepestContainsVisible: 1,
  deepestContainsHidden: 0,
  scanTruncated: false,
};

function deps(over: Partial<WingSelectorRecordDeps> = {}): { d: WingSelectorRecordDeps; calls: string[] } {
  const calls: string[] = [];
  const d: WingSelectorRecordDeps = {
    waitForReady: async () => "ready",
    observeSurface: async () => observeFrom("wing_host", BASE),
    probeTarget: async () => ({ matchCount: 0, canHighlight: false }),
    probeCandidate: async () => {
      calls.push("count");
      return { matchCount: 0, canHighlight: false, hiddenMatchCount: 3 };
    },
    probeContainment: async () => {
      calls.push("containment");
      return CONTAINMENT;
    },
    choiceAssociationCensus: async (c) => {
      calls.push(`association:${c.length}`);
      // A REAL census over a REAL fake DOM, run through the REAL script — so the no-leak assertion downstream
      // has page-authored Korean to catch. A stubbed `rows: []` could not leak anything whatever the script did.
      return runAssoc(
        [
          RADIO({ name: "purposeType", "aria-label": "자체개발" }),
          RADIO({ name: "purposeType", "aria-label": "업체를 통한 연동" }),
        ],
        c,
      ).sanitized;
    },
    choiceControlCensus: async () => {
      calls.push("shapes");
      return sanitizeChoiceControlCensus({ visibleChoiceControlCount: 2, shapes: [], groupContainerCount: 0 });
    },
    ...over,
  };
  return { d, calls };
}

describe("the sweep runs the calibration reads ONLY under the calibration phase", () => {
  it("a RECON run takes neither new measurement", async () => {
    const { d, calls } = deps();
    const r = await runWingSelectorRecord(d, [], { stage2: ["confirm"], stage2Phase: WING_STAGE2_RECON_PHASE });
    expect(calls).not.toContain("containment");
    expect(calls.some((c) => c.startsWith("association"))).toBe(false);
    expect(r.stage2!.calibration).toBe(false);
    expect(r.stage2!.association).toBeNull();
    expect(r.stage2!.purposeOptionCandidateIds).toEqual([]);
    // …but it DOES now carry the hidden count, which is a recon-phase improvement in its own right.
    expect(r.stage2!.targets[0]!.candidates[0]!.hiddenMatchCount).toBe(3);
    expect(r.stage2!.targets[0]!.candidates[0]!.presence).toBe("NOT_MEASURED");
  });

  it("a CALIBRATION run takes both, against the shipped candidate list", async () => {
    const { d, calls } = deps();
    const r = await runWingSelectorRecord(d, [], { stage2: ["confirm"], stage2Phase: WING_STAGE2_LABEL_CALIBRATION_PHASE });
    expect(calls).toContain("containment");
    expect(calls).toContain(`association:${WING_STAGE2_PURPOSE_OPTION_CANDIDATES.length}`);
    expect(r.stage2!.calibration).toBe(true);
    expect(r.stage2!.association).not.toBeNull();
    expect(r.stage2!.purposeOptionCandidateIds).toEqual(WING_STAGE2_PURPOSE_OPTION_CANDIDATES.map((c) => c.id));
    expect(r.stage2!.targets[0]!.candidates[0]!.presence).toBe("PRESENT_NOT_WHOLE_TEXT");
  });

  it("defaults to the RECON phase when the caller states none — never the wider read", async () => {
    const { d, calls } = deps();
    const r = await runWingSelectorRecord(d, [], { stage2: ["confirm"] });
    expect(r.stage2!.phase).toBe(WING_STAGE2_RECON_PHASE);
    expect(calls).not.toContain("containment");
  });

  it("**refuses a calibration with no candidates, BEFORE probing anything**", async () => {
    // The BLIND gate. A census with an empty comparison list would report "matched no candidate" for every
    // control, for a reason about us rather than about WING — and it would look like a finding.
    const { d, calls } = deps();
    const r = await runWingSelectorRecord(d, [], {
      stage2: ["confirm"],
      stage2Phase: WING_STAGE2_LABEL_CALIBRATION_PHASE,
      purposeOptionCandidates: [],
    });
    expect(r.stage2!.calibrationBlind).toBe(WING_LABEL_CALIBRATION_BLIND_REASON);
    expect(calls).toEqual([]);
    expect(r.stage2!.targets).toEqual([]);
    expect(r.stage2!.candidatesMeasured).toBe(0);
  });

  it("**refuses BEFORE the browser launches — the decision, not its source text**", () => {
    // The sweep's gate is what a programmatic caller hits. An operator is about to log in, navigate, and press
    // a real marketplace control, and must learn the instrument is blind before doing any of that.
    //
    // This used to be asserted by slicing `main()`'s source for two substrings, and TWO mutations survived it:
    // deleting the `return` after `process.exitCode = 2` (Chrome launches anyway), and prefixing the condition
    // with `false &&`. The decision is now a pure function taking the candidate list, so both are real tests.
    expect(calibrationLaunchRefusal(true, [])).toContain("No browser launched.");
    expect(calibrationLaunchRefusal(true, [])).toContain(WING_LABEL_CALIBRATION_BLIND_REASON);
    expect(calibrationLaunchRefusal(true, [])).toContain(WING_STAGE2_LABEL_CALIBRATION_PHASE);
    // Not blind, or not a calibration run ⇒ proceed. A gate that refused a recon run would be a different bug.
    expect(calibrationLaunchRefusal(true, WING_STAGE2_PURPOSE_OPTION_CANDIDATES)).toBeNull();
    expect(calibrationLaunchRefusal(false, [])).toBeNull();
  });

  it("main() acts on that refusal and STOPS — the one line a pure function cannot cover", () => {
    // Narrowly scoped on purpose: this pins the `return`, and nothing else. Sliced to the refusal block itself
    // rather than to "somewhere before the launch", because `process.exitCode = 2;\n    return;` appears at
    // several gates in this file and a whole-region search would pass on any of them.
    const cli = SRC("cli/probe-wing-issuance-selectors.ts");
    const at = cli.indexOf("const blindRefusal = calibrationLaunchRefusal(");
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(cli.indexOf("await launchNaverContext"));
    const block = cli.slice(at, cli.indexOf("\n\n", at));
    expect(block).toContain("console.error(blindRefusal);");
    expect(block).toContain("process.exitCode = 2;");
    expect(block).toContain("return;");
  });

  it("a precondition failure still refuses before any calibration read", async () => {
    const { d, calls } = deps({ observeSurface: async () => observeFrom("wing_host", { ...BASE, choiceControlCount: 0 }) });
    const r = await runWingSelectorRecord(d, [], { stage2: ["confirm"], stage2Phase: WING_STAGE2_LABEL_CALIBRATION_PHASE });
    expect(r.stage2!.precondition).toBe("NO_VISIBLE_CHOICE_CONTROL");
    expect(calls).toEqual([]);
    expect(r.stage2!.calibration).toBe(true);
    expect(r.stage2!.calibrationBlind).toBeNull();
  });

  it("**a NULL containment reading is a fault, not a measurement**", async () => {
    // The seam returns null when the page returned nothing usable. Left as a reading it would be absent
    // containment with no fault — indistinguishable from a run that never took the probe — and the row's
    // presence would say NOT_MEASURED while `containmentFaults` said nothing went wrong.
    const { d } = deps({ probeContainment: async () => null });
    const r = await runWingSelectorRecord(d, [], { stage2: ["confirm"], stage2Phase: WING_STAGE2_LABEL_CALIBRATION_PHASE });
    expect(r.stage2!.containmentFaults).toEqual([{ id: "stage2.confirm.confirm", fault: "UNUSABLE_READING" }]);
    expect(r.stage2!.targets[0]!.candidates[0]!.containment).toBeNull();
    expect(r.stage2!.targets[0]!.candidates[0]!.presence).toBe("NOT_MEASURED");
    // The count still landed: the two reads are separate evaluations and one failing must not lose the other.
    expect(r.stage2!.candidatesMeasured).toBe(1);
  });

  it("**a NULL association reading is a fault, not a silent absence**", async () => {
    const { d } = deps({ choiceAssociationCensus: async () => null });
    const r = await runWingSelectorRecord(d, [], { stage2: ["confirm"], stage2Phase: WING_STAGE2_LABEL_CALIBRATION_PHASE });
    expect(r.stage2!.association).toBeNull();
    expect(r.stage2!.associationFault).toBe("UNUSABLE_READING");
  });

  it("a THROWING containment probe faults that candidate without losing its count", async () => {
    const { d } = deps({
      probeContainment: async () => {
        throw new Error("navigated");
      },
    });
    const r = await runWingSelectorRecord(d, [], { stage2: ["confirm"], stage2Phase: WING_STAGE2_LABEL_CALIBRATION_PHASE });
    expect(r.stage2!.containmentFaults).toHaveLength(1);
    expect(r.stage2!.containmentFaults[0]!.id).toBe("stage2.confirm.confirm");
    // The count survived, and its presence is honestly unmeasured rather than a fabricated absence.
    expect(r.stage2!.candidatesMeasured).toBe(1);
    expect(r.stage2!.targets[0]!.candidates[0]!.presence).toBe("NOT_MEASURED");
  });

  it("a THROWING association census is a fault, never a zero-control reading", async () => {
    const { d } = deps({
      choiceAssociationCensus: async () => {
        throw new Error("closed");
      },
    });
    const r = await runWingSelectorRecord(d, [], { stage2: ["confirm"], stage2Phase: WING_STAGE2_LABEL_CALIBRATION_PHASE });
    expect(r.stage2!.association).toBeNull();
    expect(r.stage2!.associationFault).not.toBeNull();
    // `calibration: true` next to `association: null` is what separates "lost it" from "never took it".
    expect(r.stage2!.calibration).toBe(true);
  });

  it("the CLI never passes its own candidate list — production can only send the frozen set", () => {
    // Over the WHOLE of main(), not a 300-character window at the call site. A window that size is defeated by
    // hoisting the option into a variable and spreading it in, which leaves production running every live
    // calibration against an empty list.
    const cli = SRC("cli/probe-wing-issuance-selectors.ts");
    const main = cli.slice(cli.indexOf("async function main()"));
    expect(main).not.toContain("purposeOptionCandidates");
    // …and the injection point exists exactly where it is supposed to: the options type and the sweep default.
    expect(cli.slice(0, cli.indexOf("async function main()")).match(/purposeOptionCandidates/g)?.length).toBe(2);
  });
});

/* ══════════════════════════ the emitted record ══════════════════════════ */

describe("the emitted calibration record", () => {
  async function record() {
    const { d } = deps();
    const r = await runWingSelectorRecord(d, [], { stage2: ["confirm"], stage2Phase: WING_STAGE2_LABEL_CALIBRATION_PHASE });
    return stage2RecordFor(r.stage2)!;
  }

  it("puts every new reading on the wire", async () => {
    // The defect this closes is not hypothetical: the Stage-2 sweep itself was computed and thrown away once,
    // and the suite was green because no test read the emitted record.
    const rec = await record();
    expect(rec.phase).toBe(WING_STAGE2_LABEL_CALIBRATION_PHASE);
    expect(rec.calibration).toBe(true);
    expect(rec.calibrationBlind).toBeNull();
    expect(rec.association).not.toBeNull();
    expect(rec.containmentMeasured).toBe(1);
    expect(rec.containmentFaults).toEqual([]);
    expect(rec.purposeOptionCandidateIds).toEqual(WING_STAGE2_PURPOSE_OPTION_CANDIDATES.map((c) => c.id));
    const row = rec.targets[0]!.candidates[0]!;
    expect(row.hiddenMatchCount).toBe(3);
    expect(row.presence).toBe("PRESENT_NOT_WHOLE_TEXT");
    expect(row.containment).toEqual(CONTAINMENT);
  });

  it("**the candidate ids come from the list that was SENT, not from the module constant**", async () => {
    // The census returns INDICES. An index resolved against a different list than the one that was sent names
    // the wrong candidate — silently, and with full confidence. Asserting the ids equal the shipped constant
    // cannot see that: under the default they are the same list, which is the whole trap.
    const only: WingPurposeOptionCandidate[] = [
      { id: "purpose_option.only", exactText: "자체개발", provenance: "PRODUCT_OWNER_FLOW_DESCRIPTION", rationale: "the single injected candidate" },
    ];
    const { d, calls } = deps();
    const r = await runWingSelectorRecord(d, [], {
      stage2: ["confirm"],
      stage2Phase: WING_STAGE2_LABEL_CALIBRATION_PHASE,
      purposeOptionCandidates: only,
    });
    expect(calls).toContain("association:1");
    expect(stage2RecordFor(r.stage2)!.purposeOptionCandidateIds).toEqual(["purpose_option.only"]);
  });

  it("counts containment SEPARATELY from the candidate count", async () => {
    // Folding them would let a fully-faulted containment pass look like a complete calibration: the counts
    // would still add up, because they would be the same number twice.
    const { d } = deps({
      probeContainment: async () => {
        throw new Error("gone");
      },
    });
    const r = await runWingSelectorRecord(d, [], { stage2: ["confirm"], stage2Phase: WING_STAGE2_LABEL_CALIBRATION_PHASE });
    const rec = stage2RecordFor(r.stage2)!;
    expect(rec.candidatesMeasured).toBe(1);
    expect(rec.containmentMeasured).toBe(0);
  });

  it("main() EMITS the association and the calibration flag, not just the sweep", () => {
    const cli = SRC("cli/probe-wing-issuance-selectors.ts");
    expect(cli).toContain("stage2: stage2RecordFor(result.stage2),");
    expect(cli).toContain("stage2Calibration: result.stage2?.calibration");
    expect(cli).toContain("stage2AssociationRows: result.stage2?.association?.rows.length ?? -1");
  });

  it("carries no page-authored text — only OUR candidate labels and closed categories", async () => {
    const rec = await record();
    const json = JSON.stringify(rec);
    for (const forbidden of ["http", "://", "querySelector", "<", "textContent", "purposeType", "aria-labelledby"]) {
      expect(json, forbidden).not.toContain(forbidden);
    }
    // Every Hangul run in the record must be a string from OUR OWN frozen constants. The allowlist is built
    // from those constants alone — an earlier version derived half of it FROM THE RECORD, so any Hangul that
    // arrived as a candidate `label` allowlisted itself.
    //
    // And the record under test is now produced by the REAL association script over a fake DOM whose controls
    // carry Korean `aria-label`s ("자체개발", "업체를 통한 연동"). A stubbed `rows: []` could not have leaked
    // anything whatever the script did, so this assertion had nothing to catch.
    const ours = new Set<string>([
      ...WING_STAGE2_PURPOSE_OPTION_CANDIDATES.map((c) => c.exactText),
      ...Object.values(WING_STAGE2_RECON_CANDIDATES).flat().map((c) => c.exactText),
    ]);
    const runs = json.match(/[가-힣][가-힣\s().]*/g) ?? [];
    for (const run of runs) {
      expect(ours.has(run), `unexpected Hangul in the record: ${run}`).toBe(true);
    }
    // The page's own wording was in front of the instrument and did not come back.
    expect(json).not.toContain("업체를 통한 연동");
  });
});

/* ══════════════════════════ the phase gate and the manifest ══════════════════════════ */

describe("the calibration phase is gated and described like every other WING phase", () => {
  const P = "SELLEROPS_APPROVAL_PHASE";
  const A = "SELLEROPS_WING_APPROVED_PHASE";
  const CAL = WING_STAGE2_LABEL_CALIBRATION_PHASE;
  const RECON = WING_STAGE2_RECON_PHASE;

  /** A fully-valid calibration prereq input; individual cases override one field. */
  function baseCalibration(): ApprovalPrereqInput {
    const spec = PHASE_SPECS[CAL]!;
    return {
      phase: CAL,
      channel: "COUPANG",
      accountBinding: "operator-owned Coupang WING test account",
      mode: "READ_ONLY",
      apiCenterUrl: WING_DEFAULT_URL,
      cli: spec.cli,
      driver: spec.driver,
      declaredActions: spec.capableActions,
      hotkey: undefined,
      artifactPath: undefined,
      runId: "wt-testrun0001",
      approvalId: "apr-testappr01",
      gitSha: "abc1234",
      surface: "Coupang WING Open API",
      operation: "WING Stage-2 read-only LABEL CALIBRATION",
      maxActions: "1 operator-performed 발급 press + 1 read-only Stage-2 label-calibration session; 0 selections",
    };
  }

  it("arms only when BOTH variables name it, and reports WHICH phase was armed", () => {
    expect(resolveWingStage2Scope({ [P]: CAL, [A]: CAL })).toMatchObject({ requested: true, ok: true, phase: CAL });
  });

  it("**refuses two DIFFERENT Stage-2 phases** — the mismatch this generalization introduced", () => {
    // A calibration run under a recon manifest takes two measurements the operator never read; a recon run
    // under a calibration manifest returns less than the manifest promised. Neither may proceed.
    const a = resolveWingStage2Scope({ [P]: CAL, [A]: RECON });
    expect(a).toMatchObject({ requested: true, ok: false, refusal: "PHASE_APPROVAL_MISMATCH" });
    if (a.requested && !a.ok) expect(a.reason).toContain("measure different things");
    expect(resolveWingStage2Scope({ [P]: RECON, [A]: CAL })).toMatchObject({ ok: false, refusal: "PHASE_APPROVAL_MISMATCH" });
  });

  it("still refuses a one-sided phase", () => {
    expect(resolveWingStage2Scope({ [P]: CAL })).toMatchObject({ ok: false, refusal: "PHASE_APPROVAL_MISMATCH" });
    expect(resolveWingStage2Scope({ [A]: CAL })).toMatchObject({ ok: false, refusal: "PHASE_APPROVAL_MISMATCH" });
  });

  it("is a WING phase, a Stage-2 phase, READ_ONLY, and highlights nothing", () => {
    expect(WING_PHASES).toContain(CAL);
    expect(isWingStage2Phase(CAL)).toBe(true);
    expect(isWingStage2Phase(RECON)).toBe(true);
    expect(isWingStage2Phase("COUPANG_WING_SELECTOR_PROBE")).toBe(false);
    const spec = PHASE_SPECS[CAL]!;
    expect(spec.mode).toBe("READ_ONLY");
    expect(spec.allowsHighlight).toBe(false);
    expect(spec.capableActions).toContain("FIXED_LABEL_CONTAINMENT_PROBE");
    expect(spec.capableActions).toContain("CHOICE_CONTROL_LABEL_ASSOCIATION_CENSUS");
    // …and the RECON phase must NOT have grown them: that is what makes the two separately approvable.
    expect(PHASE_SPECS[RECON]!.capableActions).not.toContain("CHOICE_CONTROL_LABEL_ASSOCIATION_CENSUS");
    expect(PHASE_SPECS[RECON]!.capableActions).not.toContain("FIXED_LABEL_CONTAINMENT_PROBE");
  });

  it("prepares a manifest carrying the Stage-2 scope, and narrowing survives", () => {
    const full = validateApprovalPrerequisites(baseCalibration());
    expect(full.ok).toBe(true);
    if (full.ok) expect(full.manifest.stage2Targets!.slice(0, 6)).toEqual(["purpose", "self_dev", "vendor_info", "vendor_url", "call_ip", "confirm"]);
    const narrow = validateApprovalPrerequisites({ ...baseCalibration(), requestedStage2Targets: ["purpose"] });
    expect(narrow.ok).toBe(true);
    if (narrow.ok) expect(narrow.manifest.stage2Targets).toEqual(["purpose"]);
    // A scope outside the Stage-2 namespace is refused rather than silently widened back to the full set.
    const bad = validateApprovalPrerequisites({ ...baseCalibration(), requestedStage2Targets: ["delete"] });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.cause).toBe("WING_STAGE2_TARGETS_MISMATCH");
  });

  it("the manifest is READ_ONLY, highlights nothing, and reduces the URL to a host category", () => {
    const r = validateApprovalPrerequisites(baseCalibration());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.manifest.phase).toBe(CAL);
    expect(r.manifest.mode).toBe("READ_ONLY");
    expect(r.manifest.allowedActions).not.toContain("HIGHLIGHT_REAL_CONTROL");
    expect(r.manifest.allowedActions).toContain("CHOICE_CONTROL_LABEL_ASSOCIATION_CENSUS");
    expect(r.manifest.apiCenterHost).toBe("wing_host");
    expect(JSON.stringify(r.manifest)).not.toContain("wing.coupang.com");
  });

  it("the operator summary states the two new reads AND that nothing is selected", () => {
    const r = validateApprovalPrerequisites(baseCalibration());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const s = r.manifest.operatorActionSummary!;
    expect(s).toContain("라벨 연결 방식");
    expect(s).toContain("화면의 문구 자체는 기록되지 않습니다");
    expect(s).toContain("목적을 선택하지 않고");
    expect(s).toContain("'확인'(최종 발급)은 절대 누르지 않습니다");
    // It must NOT be the recon's summary — two phases sharing one description is the manifest failing to
    // describe the run, which is what review found when a Stage-2 run announced itself as a highlight proof.
    const recon = validateApprovalPrerequisites({
      ...baseCalibration(),
      phase: RECON,
      driver: PHASE_SPECS[RECON]!.driver,
      declaredActions: PHASE_SPECS[RECON]!.capableActions,
      operation: "WING Stage-2 read-only recon",
      maxActions: "1 operator-performed 발급 press + 1 read-only Stage-2 recon session",
    });
    expect(recon.ok).toBe(true);
    if (recon.ok) expect(recon.manifest.operatorActionSummary).not.toBe(s);
  });

  it("the harness allowlists it in all three scripts", () => {
    // A phase the runtime accepts but the harness refuses cannot reach a manifest at all; a phase the harness
    // writes but the preflight does not recognise reaches one under the wrong branch.
    const tools = (n: string): string => readFileSync(resolve(HERE, "../../../../tools/coupang-local", n), "utf8");
    for (const f of ["wing-probe-bootstrap.sh", "wing-probe-preflight.sh"]) {
      expect(tools(f), f).toContain("COUPANG_WING_STAGE2_LABEL_CALIBRATION");
      // Both scripts must route it through the SHARED Stage-2 predicate, not a fresh `=` comparison that the
      // next Stage-2 phase would have to be added to all over again.
      expect(tools(f), f).toContain("is_stage2_phase");
    }
    expect(tools("wing-probe-selfcheck.sh")).toContain("STAGE2CAL");
  });
});

/* ══════════════════════════ the driver seams ══════════════════════════ */

describe("the driver seams — dedicated, sanitized, and actually reachable", () => {
  /** The page double the Stage-2 census tests use: records what was evaluated, returns one canned reading. */
  function pageReturning(value: unknown): { evaluate: (s: string) => Promise<unknown>; url: () => string; on: () => void; evaluated: string[] } {
    const evaluated: string[] = [];
    return {
      evaluate: async (script: string) => {
        evaluated.push(script);
        return value;
      },
      url: () => "https://wing.coupang.com/",
      on: () => undefined,
      evaluated,
    };
  }

  it("choiceAssociationCensus runs the REAL script and re-sanitizes host-side", async () => {
    // The seam existed for the shape census and no test called it — review found that, and a method nothing
    // invokes is a method whose sanitization has never run.
    const page = pageReturning({
      visibleChoiceControlCount: 2,
      hiddenChoiceControlCount: 10,
      rows: [
        { index: 0, nameSource: "사용목적", nameLengthBucket: "enormous", exactCandidateIndex: 9, containsCandidateIndex: 0, groupIndex: 0, labelForCount: 1 },
      ],
      nameGroupCount: 1,
      largestNameGroupSize: 2,
      ungroupedCount: 0,
      scanTruncated: false,
    });
    const census = (await new CoupangWingIssuanceDriver(page as never).choiceAssociationCensus(["자체개발", "직접입력"]))!;
    expect(census).not.toBeNull();
    expect(census.rows[0]!.nameSource).toBe("NONE");
    expect(census.rows[0]!.nameLengthBucket).toBe("none");
    // 9 is outside a two-candidate list: clamped, not carried.
    expect(census.rows[0]!.exactCandidateIndex).toBe(-1);
    expect(census.rows[0]!.containsCandidateIndex).toBe(0);
    expect(census.candidatesCompared).toBe(2);
    expect(JSON.stringify(census)).not.toContain("사용목적");
    // The evaluated script is the generated association script, carrying OUR candidates and nothing else.
    expect(page.evaluated[0]).toContain('["자체개발","직접입력"]');
  });

  it("probeLabelContainment runs the REAL script and coerces the reading", async () => {
    const page = pageReturning({ exactVisible: 1, exactHidden: "junk", deepestContainsVisible: 2, deepestContainsHidden: -1, scanTruncated: true });
    const r = await new CoupangWingIssuanceDriver(page as never).probeLabelContainment({ candidateQuery: "label", exactText: "자체개발" });
    expect(r).toEqual({ exactVisible: 1, exactHidden: 0, deepestContainsVisible: 2, deepestContainsHidden: 0, scanTruncated: true });
    expect(page.evaluated[0]).toContain("fixed-label-containment");
  });

  it("**both return null when the page returns nothing usable — not a reading of zeros**", async () => {
    // The seam is where this matters most: the driver is the last place that can tell "the page said nothing"
    // from "the page said nothing is there", and downstream only the first is a fault.
    const d = new CoupangWingIssuanceDriver(pageReturning(null) as never);
    expect(await d.choiceAssociationCensus(["자체개발"])).toBeNull();
    expect(await d.probeLabelContainment({ candidateQuery: "label", exactText: "x" })).toBeNull();
  });
});

/* ══════════════════════════ nothing is promoted ══════════════════════════ */

describe("a calibration changes nothing that ships", () => {
  it("neither new instrument can write a selector, tag, or overlay", () => {
    // Asserted over the GENERATED scripts, not their source region. A source slice would have to end at some
    // marker, and the locate script's own docstring — which legitimately discusses `data-aw-target` — sits
    // between the two functions: the guard would have failed for a reason that is about prose, not behaviour.
    const scripts = [
      buildFixedLabelContainmentScript({ candidateQuery: "label", exactText: "자체개발" }),
      buildWingChoiceAssociationScript(["자체개발"]),
    ];
    for (const script of scripts) {
      for (const forbidden of ["setAttribute", "removeAttribute", "data-aw-target", ".click", "dispatchEvent", "submit("]) {
        expect(script, forbidden).not.toContain(forbidden);
      }
    }
  });

  it("the recon module still exports no promotion path, with the calibration surface added", () => {
    // The same guard the Stage-2 recon carries, re-asserted because this unit added exports to that module:
    // nothing here reaches a shipped locator map or writes an attribute.
    //
    // Comment lines are stripped first, per collector/CLAUDE.md §5 — this module's header docstring names
    // `WING_HIGHLIGHT_LABELS` while explaining why editing it would be the forbidden move, and a raw scan
    // fails on the prose that documents the rule.
    const src = SRC("action-window/coupang-wing-label-recon.ts")
      .split("\n")
      .filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l))
      .join("\n");
    for (const forbidden of ["WING_HIGHLIGHT_LABELS", "WING_DELETION_LABELS", "setAttribute"]) {
      expect(src, forbidden).not.toContain(forbidden);
    }
    // …and the strip is not so aggressive that it removes the code: the constants under test are still here.
    expect(src).toContain("WING_STAGE2_PURPOSE_OPTION_CANDIDATES");
  });

  it("the shipped Stage-2 ordering is untouched by this unit", () => {
    // Pinned to the ORDER of the six this unit knew about, not to the literal line: a later unit appends
    // terms-screen targets, and a whole-line pin would force that unit to edit a guard whose subject is
    // "did the calibration reorder anything" — which it did not, and cannot, by appending.
    const src = SRC("action-window/coupang-wing-label-recon.ts");
    expect(src).toContain('"purpose", "self_dev", "vendor_info", "vendor_url", "call_ip", "confirm",');
  });

  it("the landed recon evidence still records its own absence bounds as they were measured", () => {
    // Carrying `hiddenCount` is a capability the NEXT run has. It does not retroactively bound the seven
    // absences already on the record, and flipping this flag would rewrite what that run measured.
    const src = SRC("action-window/coupang-wing-label-recon.ts");
    // BOUNDED to that record. The slice used to run to end-of-file, and this unit appends a FOURTH sibling
    // record after it — so the three strings below could have been satisfied by a different record entirely.
    // Source pins slicing the wrong region are this workstream's recurring failure, and this commit widened
    // the hazard rather than noticing it.
    const from = src.indexOf("export const WING_STAGE2_RECON_EVIDENCE");
    const to = src.indexOf("\n});", from);
    expect(from).toBeGreaterThan(0);
    expect(to).toBeGreaterThan(from);
    const rec = src.slice(from, to);
    expect(rec).not.toContain("WING_STAGE2_LABEL_CALIBRATION_EVIDENCE");
    expect(rec).toContain("countsPaintingMatchesOnly: true,");
    expect(rec).toContain("hiddenMatchCountCarried: false,");
    expect(rec).toContain("candidateScanTruncationReported: false,");
  });
});

/* Kept last: a type-level assertion that the candidate shape has not silently widened. */
const _shape: WingPurposeOptionCandidate | undefined = WING_STAGE2_PURPOSE_OPTION_CANDIDATES[0];
void _shape;

/* ══════════════════════════ the landed calibration evidence ══════════════════════════ */

describe("WING_STAGE2_LABEL_CALIBRATION_EVIDENCE — measured, inferred, and still-unmeasured kept apart", () => {
  const E = WING_STAGE2_LABEL_CALIBRATION_EVIDENCE;

  it("records the run identity by value, and as a DIFFERENT run from the one it refines", () => {
    // Pinned by VALUE, not "different from the other record". On a sibling record that weaker form let a
    // `wingrec_deadbeef0000` through, and review found it a second time after it had already been fixed once.
    expect(E.gitSha).toBe("ce733f78");
    expect(E.runId).toBe("wt-1e2ab6816bcc");
    expect(E.approvalId).toBe("apr-848e2cfd06f2");
    expect(E.recordId).toBe("wingrec_5497afb9eec4");
    expect(E.observedOn).toBe("2026-08-09");
    expect(E.precondition).toBe("OK");
    // All three identity axes must differ — `runId` included, because the cross-run signature agreement below
    // rests on these being two runs and nothing else on the record says so.
    expect(E.recordId).not.toBe(E.refines.recordId);
    expect(E.runId).not.toBe(E.refines.runId);
    expect(E.gitSha).not.toBe(E.refines.gitSha);
  });

  it("records the shape census by value AND ties it to the recon's, since it claims to re-read it", () => {
    // Nothing tied these to the earlier record, so "identical to the recon's" was prose over three unasserted
    // numbers. Three mutations survived here.
    expect(E.visibleChoiceControlCount).toBe(2);
    expect(E.hiddenChoiceControlCount).toBe(10);
    expect(E.groupContainerCount).toBe(0);
    expect(E.visibleChoiceControlCount).toBe(E.refines.visibleChoiceControlCount);
    expect(E.hiddenChoiceControlCount).toBe(E.refines.hiddenChoiceControlCount);
    expect(E.groupContainerCount).toBe(E.refines.groupContainerCount);
    expect(E.visibleShapes).toEqual(E.refines.visibleShapes);
    // The bucket the precondition turned on, so the verdict does not stand in for its own evidence.
    expect(E.choiceControlCountBucket).toBe("few");
  });

  it("records the two radios as ONE name group, with the reading each row actually produced", () => {
    expect(E.nameGroupCount).toBe(1);
    expect(E.largestNameGroupSize).toBe(2);
    expect(E.ungroupedCount).toBe(0);
    expect(E.rows).toHaveLength(2);
    E.rows.forEach((r, i) => {
      // The ordinal is document order and was unasserted — a row could claim any position.
      expect(r.index).toBe(i);
      expect(r.nameSource).toBe("LABEL_FOR");
      expect(r.labelForCount).toBe(1);
      expect(r.ancestorLabelCount).toBe(0);
      expect(r.ariaLabelledbyRefCount).toBe(0);
      expect(r.ariaLabelledbyResolvedCount).toBe(0);
      expect(r.hasIdAttr).toBe(true);
      expect(r.groupIndex).toBe(0);
      // NOT measured, and said so on the record: nothing checked that the label element paints.
      expect(r.labelElementPaintMeasured).toBe(false);
      expect(WING_NAME_LENGTH_BUCKETS as readonly string[]).toContain(r.nameLengthBucket);
      expect(WING_NAME_SOURCES as readonly string[]).toContain(r.nameSource);
    });
    // The two length bands DIFFER — that is the reading, and collapsing them would erase it.
    expect(E.rows[0].nameLengthBucket).toBe("short");
    expect(E.rows[1].nameLengthBucket).toBe("medium");
  });

  it("records the candidate NON-match across the whole set, not a partial sweep", () => {
    expect(E.purposeCandidatesMatched).toBe(0);
    // This read `candidatesCompared === WING_STAGE2_PURPOSE_OPTION_CANDIDATES.length` — "so a fifth candidate
    // cannot leave the record claiming complete coverage" — and the fifth and sixth arrived. The guard was
    // right; the equality was the wrong way to hold it, because a past run cannot own the current set. The
    // record now NAMES its four, and what postdates it is acknowledged here by name.
    expect(E.comparedCandidateIds).toHaveLength(E.candidatesCompared);
    expect(new Set(E.comparedCandidateIds).size).toBe(E.candidatesCompared);
    const shippedIds = WING_STAGE2_PURPOSE_OPTION_CANDIDATES.map((c) => c.id);
    for (const id of E.comparedCandidateIds) expect(shippedIds).toContain(id);
    expect(shippedIds.filter((id) => !(E.comparedCandidateIds as readonly string[]).includes(id))).toEqual([
      // Added 2026-08-10 from the operator's verbatim transcription; this run predates both and compared neither.
      "purpose_option.open_api",
      "purpose_option.playauto_web_solution",
    ]);
    // …and every id it DID compare is a flow-description entry or a spacing variant — never a transcription.
    // Otherwise the record's headline non-match would be reporting a failure to match what the screen says.
    for (const id of E.comparedCandidateIds) {
      expect(WING_STAGE2_PURPOSE_OPTION_CANDIDATES.find((c) => c.id === id)!.provenance).not.toBe("OPERATOR_TRANSCRIBED");
    }
    for (const r of E.rows) {
      expect(r.exactCandidateIndex).toBe(-1);
      expect(r.containsCandidateIndex).toBe(-1);
    }
  });

  it("**does NOT claim the purpose semantics are known** — the whole reason the next unit exists", () => {
    expect(E.purposeOptionSemanticsMeasured).toBe(false);
    // Nor does it name an option. A length band plus a group ordinal is not an identification.
    //
    // Scoped to THIS record's own fields: `refines` embeds the recon record, whose `precedingRefusal.cause`
    // legitimately contains 발급 and is guarded by its own test. Excluding it beats allowlisting a string —
    // a four-item denylist is what let two wording variants through on an earlier unit.
    //
    // The class covers precomposed syllables AND the Jamo blocks: a decomposed 자체개발 is the same leak.
    const HANGUL = /[\uAC00-\uD7A3\u1100-\u11FF\u3130-\u318F\uA960-\uA97F\uD7B0-\uD7FF]/;
    const { refines: _refines, ...own } = E;
    expect(JSON.stringify(own)).not.toMatch(HANGUL);
    // …and the exclusion is narrow: the embedded record is the ONLY source of Hangul in the whole thing.
    expect(JSON.stringify(E)).toMatch(HANGUL);
  });

  it("keeps the flow-description inference INFERRED and untested", () => {
    expect(E.visibleWordingDiffersFromFlowDescription).toEqual({ provenance: "INFERRED", tested: false });
  });

  it("the record's FIELD SET is exactly the declared one — no field may be added to it", () => {
    // The recon record has carried this guard since the denylist beside it let two purpose-option spellings and
    // a page sentence through. This record — the bigger one, and the one holding the signature it is careful not
    // to promote — never got it, and THIS unit is how that showed: `comparedCandidateIds` was added below and
    // nothing objected. A field can be added to a sanitized record silently exactly once.
    const keys = (o: object): string[] => Object.keys(o).sort();
    expect(keys(E)).toEqual([
      "absenceExplanationOutcome", "approvalId", "associationFault", "associationRowsTruncated",
      "associationScanTruncated", "candidates", "candidatesCompared", "candidatesMeasured",
      "candidatesNotMeasured", "captureCount", "choiceControlCountBucket", "comparedCandidateIds",
      "confirmLocated", "containmentFaults", "containmentMeasured", "containmentScanTruncated",
      "credentialAnchorPresent", "gitSha", "groupContainerCount", "hiddenChoiceControlCount",
      "issuedStateReason", "keyCreationRuledOut", "largestNameGroupSize", "nameGroupCount", "observedOn",
      "openApiMarkerPresent", "operatorPressedConfirm", "operatorSelectedPurpose", "precondition", "probeFaults",
      "purposeCandidatesMatched", "purposeOptionSemanticsMeasured", "recordId", "refines", "rows", "runId",
      "shapeCensusBucketsTruncated", "shapeCensusScanTruncated", "signatureStability", "ungroupedCount",
      "visibleChoiceControlCount", "visibleShapes", "visibleWordingDiffersFromFlowDescription",
    ]);
    expect(keys(E.confirmLocated)).toEqual([
      "effectMeasured", "hiddenExactMatchCount", "isFinalIssuanceControl", "pressed", "sig16", "signatureRole",
      "uniquenessScope", "verdict", "visibleExactMatchCount",
    ]);
    expect(keys(E.absenceExplanationOutcome)).toEqual([
      "hypothesis", "notPresentInAnyForm", "presentOnlyInNonPaintingNodes", "verdict",
      "wholeTextMismatchOnPaintingElement",
    ]);
    expect(keys(E.visibleWordingDiffersFromFlowDescription)).toEqual(["provenance", "tested"]);
    expect(keys(E.rows[0])).toEqual([
      "ancestorLabelCount", "ariaLabelledbyRefCount", "ariaLabelledbyResolvedCount", "containsCandidateIndex",
      "exactCandidateIndex", "groupIndex", "hasIdAttr", "index", "labelElementPaintMeasured", "labelForCount",
      "nameLengthBucket", "nameSource",
    ]);
    expect(keys(E.visibleShapes[0])).toEqual(["count", "inputType", "role", "tag"]);
    for (const q of Object.values(E.candidates)) {
      expect(keys(q)).toEqual([
        "deepestContainsHidden", "deepestContainsVisible", "exactHidden", "exactVisible", "hiddenMatchCount",
        "presence",
      ]);
    }
  });

  it("carries the full containment quad per candidate, keyed by OUR candidate ids", () => {
    // The quad is on the record because the summary below is DERIVED from it. Without it the split is a claim
    // about data nobody can see — and the first version of this record got that split backwards.
    const ids = Object.keys(E.candidates);
    // Keys are anchored to the shipped candidate set, so a renamed, misspelled or duplicated key fails. The
    // earlier keying was ad-hoc prose (`purpose_transcribed_sentence`), which also dropped the
    // `operator_reported` marker from an id whose whole point is that it is operator-reported, not measured.
    const shipped = Object.values(WING_STAGE2_RECON_CANDIDATES).flat().map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(shipped).toContain(id);
    // The equality this used to assert broke when the verbatim heading was added on 2026-08-10 — the same
    // past-run-owns-the-current-set mistake as the two coverage counts. A candidate this run never probed has to
    // be named here rather than quietly folded into its quads.
    expect(shipped.filter((id) => !ids.includes(id))).toEqual([
      "stage2.purpose.operator_verbatim",
      // …and the whole TERMS screen, which pressing 확인 revealed on 2026-08-10. This record could not have
      // quads for a screen nobody had reached when it was taken.
      "stage3.terms.heading",
      "stage3.terms.api_agree",
      "stage3.terms.category_agree",
      "stage3.terms.cancel",
      "stage3.terms.issue_final",
    ]);
    // Every recon absence is present here, and so is the one candidate that was not an absence.
    for (const id of E.refines.absentCandidateIds) expect(ids).toContain(id);
    expect(ids).toContain("stage2.confirm.confirm");
    // Each row's presence verdict must agree with its own integers — a transcribed verdict beside its inputs
    // is a place for the two to disagree.
    for (const [id, q] of Object.entries(E.candidates)) {
      expect(WING_STAGE2_PRESENCES as readonly string[]).toContain(q.presence);
      expect(q.presence, id).toBe(wingStage2PresenceFrom({ ...q, scanTruncated: false }));
    }
  });

  it("**derives the miss-cause split from the quads — a swapped verdict cannot preserve the arithmetic**", () => {
    // The defect this closes was mine and it was the central claim: the first draft read causes off the
    // PRESENCE enum, which answers WHERE a label is, not WHY the recon missed it. It credited the whole-text
    // hypothesis to 자체개발 and 직접입력 — whose painting-container count is ZERO, so the matcher was never
    // the reason — while the one candidate the hypothesis does explain, 업체명, reads PRESENT_HIDDEN_ONLY
    // because the fold ranks a hidden whole-text match above a painting partial one.
    //
    // So the test RECOMPUTES the split from the integers instead of re-stating the summary. Counting values
    // per bucket, as the first version did, survives a swap between two candidates: the totals stay intact
    // while the record asserts the opposite of the reading.
    const o = E.absenceExplanationOutcome;
    const causes = E.refines.absentCandidateIds.map((id) => wingStage2MissCause(E.candidates[id]!));
    expect(causes).toHaveLength(7);
    expect(causes.filter((c) => c === "WHOLE_TEXT_MISMATCH_ON_PAINTING_ELEMENT")).toHaveLength(o.wholeTextMismatchOnPaintingElement);
    expect(causes.filter((c) => c === "PRESENT_ONLY_IN_NON_PAINTING_NODES")).toHaveLength(o.presentOnlyInNonPaintingNodes);
    expect(causes.filter((c) => c === "NOT_PRESENT_IN_ANY_FORM")).toHaveLength(o.notPresentInAnyForm);
    // …and the split is total over the recon's seven, with no candidate uncounted.
    expect(o.wholeTextMismatchOnPaintingElement + o.presentOnlyInNonPaintingNodes + o.notPresentInAnyForm).toBe(
      E.refines.absentCandidateIds.length,
    );
    // The hypothesis holds for ONE, and specifically for 업체명 — named by id, not by count.
    expect(o.verdict).toBe("CONFIRMED_FOR_ONE_OF_SEVEN");
    expect(o.hypothesis).toBe(E.refines.absenceExplanation.hypothesis);
    expect(wingStage2MissCause(E.candidates["stage2.vendor_info.baseline"]!)).toBe("WHOLE_TEXT_MISMATCH_ON_PAINTING_ELEMENT");
    for (const id of ["stage2.self_dev.baseline", "stage2.self_dev.direct"]) {
      expect(wingStage2MissCause(E.candidates[id]!), id).toBe("PRESENT_ONLY_IN_NON_PAINTING_NODES");
    }
    // A matched candidate has no miss to explain and must not pad the split.
    expect(wingStage2MissCause(E.candidates["stage2.confirm.confirm"]!)).toBeNull();
  });

  it("records 확인's uniqueness as PAINTING-scoped, with the twenty the recon could not see", () => {
    const c = E.confirmLocated;
    expect(c.visibleExactMatchCount).toBe(1);
    expect(c.hiddenExactMatchCount).toBe(20);
    expect(c.verdict).toBe("UNIQUE");
    expect(c.uniquenessScope).toBe("PAINTING_ELEMENTS_ONLY");
    // …and the summary object agrees with the quad it summarises.
    const q = E.candidates["stage2.confirm.confirm"]!;
    expect(c.visibleExactMatchCount).toBe(q.exactVisible);
    expect(c.hiddenExactMatchCount).toBe(q.exactHidden);
    // Still not promoted, on every axis the sibling record guards.
    expect(c.pressed).toBe(false);
    expect(c.effectMeasured).toBe(false);
    expect(c.signatureRole).toBe("EVIDENCE_ONLY");
    expect(c.isFinalIssuanceControl).toBe("OPERATOR_FLOW_DESCRIPTION_ONLY_NOT_MEASURED");
  });

  it("states the signature agreement as one earlier run, explicitly not established stability", () => {
    expect(E.confirmLocated.sig16).toBe("c1b87128024cdec8");
    // Asserted against the other record rather than restated, so a copy-paste drift in either one fails here.
    expect(E.confirmLocated.sig16).toBe(E.refines.confirmLocated.sig16);
    expect(E.signatureStability).toBe("AGREES_WITH_ONE_EARLIER_RUN_NOT_ESTABLISHED");
    // Captures taken BY THIS RUN. The agreement is with a different run's capture, not a second one here.
    expect(E.captureCount).toBe(1);
    expect(E.refines.captureCount).toBe(1);
    // Two runs agreeing is not established stability; the sibling's caveat is not upgraded from here.
    expect(E.refines.signatureStability).toBe("SINGLE_CAPTURE_NOT_ESTABLISHED");
  });

  it("records a clean sweep as clean, and names each instrument's bound separately", () => {
    expect(E.probeFaults).toBe(0);
    expect(E.containmentFaults).toBe(0);
    expect(E.associationFault).toBeNull();
    expect(E.candidatesMeasured).toBe(Object.keys(E.candidates).length);
    expect(E.candidatesNotMeasured).toBe(0);
    expect(E.containmentMeasured).toBe(Object.keys(E.candidates).length);
    // Three scripts, three caps. The absences are bounded by the CONTAINMENT scan — the earlier draft collapsed
    // all of them into one flag and then reasoned from the census's.
    expect(E.containmentScanTruncated).toBe(false);
    expect(E.shapeCensusScanTruncated).toBe(false);
    expect(E.shapeCensusBucketsTruncated).toBe(false);
    expect(E.associationScanTruncated).toBe(false);
    expect(E.associationRowsTruncated).toBe(false);
  });

  it("carries the signal that EXPLAINS the odd one, not just the odd one", () => {
    // The marker did not fire and the surface still classified as open_api_issuance. That is explained: the
    // classifier accepts either disjunct, and the other one is true. Recording the first while omitting the
    // second, under a note about not being selective, was exactly that.
    expect(E.openApiMarkerPresent).toBe(false);
    expect(E.credentialAnchorPresent).toBe(true);
  });

  it("claims nothing about key creation or the operator's actions beyond what happened", () => {
    expect(E.operatorSelectedPurpose).toBe(false);
    expect(E.operatorPressedConfirm).toBe(false);
    expect(E.keyCreationRuledOut).toBe(false);
    expect(E.issuedStateReason).toBe("NO_DISCRIMINATING_SIGNAL");
  });

  it("does not rewrite the record it refines", () => {
    // A new capability does not retroactively bound an older run. The recon's absences counted painting matches
    // only, its hidden counts were discarded, and its scan reported no truncation — all still true of that run,
    // and precisely why six of its seven absences turn out to be about paint.
    expect(E.refines.absenceBounds).toEqual({
      countsPaintingMatchesOnly: true,
      hiddenMatchCountCarried: false,
      candidateScanTruncationReported: false,
    });
    expect(E.refines.purposeOptionSemanticsMeasured).toBe(false);
    expect(E.refines.absenceExplanation.tested).toBe(false);
    expect(E.refines.confirmLocated.matchCount).toBe(1);
  });

  it("is DEEP-frozen — an evidence record that can be edited at runtime is not evidence", () => {
    expect(Object.isFrozen(E)).toBe(true);
    for (const nested of [E.rows, E.rows[0], E.rows[1], E.candidates, E.confirmLocated, E.visibleShapes,
                          E.absenceExplanationOutcome, E.visibleWordingDiffersFromFlowDescription]) {
      expect(Object.isFrozen(nested)).toBe(true);
    }
    for (const q of Object.values(E.candidates)) expect(Object.isFrozen(q)).toBe(true);
    expect(() => {
      (E.confirmLocated as { visibleExactMatchCount: number }).visibleExactMatchCount = 9;
    }).toThrow();
  });
});
