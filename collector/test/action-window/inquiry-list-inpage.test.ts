/**
 * **The 고객문의 anchor probe, executed.** These run the REAL generated script — the same string the driver
 * evaluates in the page — against a fake DOM.
 *
 * Two properties are worth the most here, and both are absences.
 *
 * **Buyer text cannot leave the page.** Asserted structurally (the emitted body reads `textContent` in exactly
 * one place and reduces it to a boolean there) and behaviourally (a page full of distinctive buyer text yields
 * a census containing none of it).
 *
 * **The row tag is never assumed.** The version this replaces defined a row as `tr`/`li`/`[role=row]` and, on
 * the real WING screen, confidently measured the navigation instead — 54 rows, zero ids, and zero occurrences
 * of both status words on a screen showing two answered inquiries. So there is a test here for a page whose
 * inquiries are plain `<div>`s with no table, no list, and no row role: the previous design could not see it at
 * all, and this one must find it without being told what to look for.
 *
 * No jsdom: jsdom has no layout, so every element would read as not painting and every case would pass for the
 * wrong reason.
 */
import { describe, expect, it } from "vitest";
import { buildInquiryListCensusScript } from "../../src/action-window/api-issuance-calibration/inquiry-list-inpage";
import {
  resolveInquiryTarget,
  sanitizeInquiryListCensus,
  type InquiryDigitExpectation,
  type InquiryLabelExpectation,
} from "../../src/action-window/coupang-wing-inquiry-list";

/* ───────────────────────────── a fake DOM with a real tree ───────────────────────────── */

interface ElInit {
  tag: string;
  text?: string;
  attrs?: Record<string, string>;
  display?: string;
  rects?: number;
}

class El {
  readonly tagName: string;
  readonly children: El[] = [];
  parent: El | null = null;
  private readonly ownText: string;
  private readonly display: string;
  private readonly rects: number;
  readonly attributes: { name: string; value: string }[];

  constructor(init: ElInit) {
    this.tagName = init.tag.toUpperCase();
    this.ownText = init.text ?? "";
    this.display = init.display ?? "block";
    this.rects = init.rects ?? 1;
    this.attributes = Object.entries(init.attrs ?? {}).map(([name, value]) => ({ name, value }));
  }

  add(...kids: El[]): this {
    for (const k of kids) {
      k.parent = this;
      this.children.push(k);
    }
    return this;
  }

  get textContent(): string {
    return this.ownText + this.children.map((c) => c.textContent).join("");
  }
  get parentElement(): El | null {
    return this.parent;
  }
  get childElementCount(): number {
    return this.children.length;
  }
  descendants(): El[] {
    return this.children.flatMap((c) => [c, ...c.descendants()]);
  }
  ancestors(): El[] {
    return this.parent ? [this.parent, ...this.parent.ancestors()] : [];
  }
  /** DOM semantics: an element contains itself. The innermost-match rule relies on it. */
  contains(other: El): boolean {
    return other === this || this.descendants().includes(other);
  }
  querySelectorAll(sel: string): El[] {
    return select(this.descendants(), sel);
  }
  hasAttribute(name: string): boolean {
    return this.attributes.some((a) => a.name === name);
  }
  getAttribute(name: string): string | null {
    return this.attributes.find((a) => a.name === name)?.value ?? null;
  }
  computedStyle(): { display: string; visibility: string } {
    return { display: this.display, visibility: this.display === "hidden" ? "hidden" : "visible" };
  }
  getClientRects(): unknown[] {
    return new Array(this.rects).fill({});
  }
  getBoundingClientRect(): { width: number; height: number } {
    return { width: 100, height: 20 };
  }
}

/**
 * Enough selector grammar for the probe: comma lists, `*`, `[attr]`, `TAG[attr]`, and one level of descendant.
 * A fake that cannot express a selector silently answers "no elements", which is the shape of a green test over
 * a broken rule — so anything unrecognised throws instead.
 */
function select(els: El[], sel: string): El[] {
  const out: El[] = [];
  for (const part of sel.split(",").map((s) => s.trim())) {
    if (part === "*") {
      out.push(...els);
      continue;
    }
    const words = part.split(/\s+/);
    if (words.length === 2) {
      const [ancestorTag, descendantTag] = words as [string, string];
      out.push(
        ...els.filter(
          (e) =>
            e.tagName === descendantTag.toUpperCase() &&
            e.ancestors().some((a) => a.tagName === ancestorTag.toUpperCase()),
        ),
      );
      continue;
    }
    const attrMatch = /^([a-zA-Z]*)\[([a-zA-Z-]+)(?:=([^\]]+))?\]$/.exec(part);
    if (attrMatch) {
      const [, tag, name, value] = attrMatch;
      out.push(
        ...els.filter(
          (e) =>
            (!tag || e.tagName === tag.toUpperCase()) &&
            e.hasAttribute(name!) &&
            (value === undefined || e.getAttribute(name!) === value),
        ),
      );
      continue;
    }
    if (/^[a-zA-Z]+$/.test(part)) {
      out.push(...els.filter((e) => e.tagName === part.toUpperCase()));
      continue;
    }
    throw new Error(`fake DOM cannot express selector: ${part}`);
  }
  return [...new Set(out)];
}

function el(init: ElInit): El {
  return new El(init);
}

function run<T>(script: string, root: El): T {
  const all = root.descendants();
  const document = {
    querySelectorAll(sel: string): El[] {
      return select(all, sel);
    },
  };
  const window = { getComputedStyle: (e: El) => e.computedStyle() };
  return new Function("document", "window", `return (${script});`)(document, window) as T;
}

/* ───────────────────────────── the fixtures ───────────────────────────── */

/** The two real inquiry ids the live proof collected, and a product id shared by both. */
const INQUIRY_A = "158421449";
const INQUIRY_B = "158846709";
const PRODUCT = "15411270785";

/** Buyer-authored text, deliberately distinctive so a leak would be unmistakable in an assertion. */
const BUYER_TEXT_A = "언제쯤 배송되는지 알려주세요 급합니다";
const BUYER_TEXT_B = "색상이 사진과 다른데 교환 가능한가요";

const DIGITS: InquiryDigitExpectation[] = [
  { id: "inquiryId", digits: INQUIRY_A },
  { id: "productId", digits: PRODUCT },
];
const LABELS: InquiryLabelExpectation[] = [
  { id: "answeredTight", exactText: "답변완료" },
  { id: "answeredSpaced", exactText: "답변 완료" },
  { id: "unansweredTight", exactText: "미답변" },
];

/** One table-shaped row: an id-bearing link, the buyer's text, and a status word. */
function row(opts: {
  inquiryId?: string;
  productId?: string;
  text: string;
  status: string;
  detail?: boolean;
}): El {
  const cells = [
    el({ tag: "td", attrs: opts.productId ? { "data-product-id": opts.productId } : {} }),
    el({ tag: "td", text: opts.text }),
    el({ tag: "td", text: opts.status }),
  ];
  if (opts.detail !== false) {
    cells[0]!.add(
      el({
        tag: "a",
        text: "상세",
        attrs: { href: `/tenants/seller-cs/inquiries/${opts.inquiryId ?? ""}` },
      }),
    );
  }
  return el({ tag: "tr" }).add(...cells);
}

function wingInquiryList(rows: El[]): El {
  return el({ tag: "div" }).add(el({ tag: "table" }).add(el({ tag: "tbody" }).add(...rows)));
}

/**
 * The same screen with NO table, NO list, and NO row role — inquiries as bare `<div>`s, the way a modern SPA
 * renders them. The previous design could not see this page at all.
 */
function divGridInquiryList(rows: { inquiryId: string; text: string; status: string }[]): El {
  const body = el({ tag: "div", attrs: { class: "inq-body" } });
  for (const r of rows) {
    body.add(
      el({ tag: "div", attrs: { class: "inq-row", "data-inquiry-no": r.inquiryId } }).add(
        el({ tag: "div", attrs: { class: "inq-cell" }, text: r.text }),
        el({ tag: "div", attrs: { class: "inq-cell" }, text: r.status }),
        el({ tag: "button", text: "답변하기" }),
      ),
    );
  }
  return el({ tag: "div" }).add(body);
}

function censusOf(root: El, digits = DIGITS, labels = LABELS) {
  const raw = run<unknown>(buildInquiryListCensusScript(digits, labels), root);
  return sanitizeInquiryListCensus(raw, digits, labels);
}

/* ───────────────────────────── the cases ───────────────────────────── */

describe("the anchor leads, and the row shape comes back as a finding", () => {
  it("finds the one element carrying the inquiry id, and measures the repeat chain above it", () => {
    const census = censusOf(
      wingInquiryList([
        row({ inquiryId: INQUIRY_A, productId: PRODUCT, text: BUYER_TEXT_A, status: "답변완료" }),
        row({ inquiryId: INQUIRY_B, productId: PRODUCT, text: BUYER_TEXT_B, status: "미답변" }),
      ]),
    );

    expect(census.reason).toBe("OK");
    const anchor = census.anchors.find((m) => m.id === "inquiryId")!;
    expect(anchor.matchCount).toBe(1);
    expect(anchor.topology!.matchedTagName).toBe("A");
    // The KIND travels; the href itself never does.
    expect(anchor.topology!.attributeKinds).toEqual(["HREF"]);

    // A <td> repeats across the row and a <tr> repeats down the table. BOTH are reported — deciding which one
    // is "the row" from inside a probe is exactly the guess that failed against the real screen.
    const tags = anchor.topology!.repeatLevels.map((l) => l.tagName);
    expect(tags).toEqual(["TD", "TR"]);
    const rowLevel = anchor.topology!.repeatLevels.find((l) => l.tagName === "TR")!;
    expect(rowLevel.siblingCount).toBe(2);
    expect(rowLevel.hasDetailAffordance).toBe(true);

    const resolution = resolveInquiryTarget(census, "inquiryId");
    expect(resolution.ok).toBe(true);
  });

  it("**finds a div-shaped list that has no table, no li, and no row role**", () => {
    // The regression that cost a live sitting: the previous probe defined a row as tr/li/[role=row], found 54
    // of them on the real screen, and reported zero ids and zero status words — it had measured the navigation.
    const census = censusOf(
      divGridInquiryList([
        { inquiryId: INQUIRY_A, text: BUYER_TEXT_A, status: "답변완료" },
        { inquiryId: INQUIRY_B, text: BUYER_TEXT_B, status: "답변완료" },
        { inquiryId: "158900001", text: "세 번째 문의", status: "미답변" },
      ]),
    );

    const anchor = census.anchors.find((m) => m.id === "inquiryId")!;
    expect(anchor.matchCount).toBe(1);
    expect(anchor.topology!.matchedTagName).toBe("DIV");
    expect(anchor.topology!.attributeKinds).toEqual(["DATA"]);

    const level = anchor.topology!.repeatLevels[0]!;
    expect(level.tagName).toBe("DIV");
    // Three inquiries on screen, three identically shaped siblings — that is what identifies the row level.
    expect(level.siblingCount).toBe(3);
    expect(level.siblingsSharingClassShape).toBe(3);
    expect(level.classTokenCount).toBe(1);
    expect(level.hasDetailAffordance).toBe(true);
    expect(resolveInquiryTarget(census, "inquiryId").ok).toBe(true);
  });

  it("**looks in href / id / data-* and nowhere else**", () => {
    // A page can carry the number in a title, a value, an aria-label, or its text. None of those are structural
    // anchors, and reading them widens the boundary for no targeting benefit.
    const root = el({ tag: "div" }).add(
      el({ tag: "div" }).add(
        el({ tag: "span", attrs: { title: INQUIRY_A }, text: INQUIRY_A }),
        el({ tag: "input", attrs: { value: INQUIRY_A } }),
        el({ tag: "span", attrs: { "aria-label": INQUIRY_A } }),
      ),
    );

    const census = censusOf(root);

    expect(census.elementsWithAnchorAttributes).toBe(0);
    expect(census.anchors.find((m) => m.id === "inquiryId")!.matchCount).toBe(0);
    expect(resolveInquiryTarget(census, "inquiryId")).toEqual({ ok: false, reason: "TARGET_NOT_FOUND" });
  });

  it("**refuses a product id that matches several rows** rather than picking one", () => {
    const census = censusOf(
      wingInquiryList([
        row({ inquiryId: INQUIRY_A, productId: PRODUCT, text: BUYER_TEXT_A, status: "답변완료" }),
        row({ inquiryId: INQUIRY_B, productId: PRODUCT, text: BUYER_TEXT_B, status: "미답변" }),
      ]),
    );

    // A product id matches every inquiry on that product. Falling back to it would turn "the one inquiry"
    // into "some inquiry about the right product", which reads identically in a log and is wrong.
    expect(census.anchors.find((m) => m.id === "productId")!.matchCount).toBe(2);
    expect(resolveInquiryTarget(census, "productId")).toEqual({ ok: false, reason: "TARGET_AMBIGUOUS" });
  });

  it("**a digit run must match whole** — a prefix targets a different inquiry silently", () => {
    const census = censusOf(
      wingInquiryList([row({ inquiryId: INQUIRY_A, text: BUYER_TEXT_A, status: "답변완료" })]),
      [{ id: "prefix", digits: INQUIRY_A.slice(0, 4) }],
      [],
    );

    expect(census.anchors[0]!.matchCount).toBe(0);
  });

  it("an id inside a link nested in a matching row counts ONCE, as the innermost", () => {
    // Otherwise a <tr> and the <a> inside it would read as two matches — a false ambiguity refusal on a page
    // that actually identifies the inquiry exactly once.
    const inner = el({ tag: "a", attrs: { href: `/cs/inquiries/${INQUIRY_A}` } });
    const outer = el({ tag: "tr", attrs: { "data-inquiry-id": INQUIRY_A } }).add(el({ tag: "td" }).add(inner));
    const sibling = el({ tag: "tr", attrs: { "data-inquiry-id": INQUIRY_B } });
    const census = censusOf(
      el({ tag: "div" }).add(el({ tag: "table" }).add(el({ tag: "tbody" }).add(outer, sibling))),
    );

    const anchor = census.anchors.find((m) => m.id === "inquiryId")!;
    expect(anchor.matchCount).toBe(1);
    expect(anchor.topology!.matchedTagName).toBe("A");
  });

  it("the page's own navigation does not become a false match", () => {
    const root = wingInquiryList([
      row({ inquiryId: INQUIRY_A, text: BUYER_TEXT_A, status: "답변완료" }),
      row({ inquiryId: INQUIRY_B, text: BUYER_TEXT_B, status: "미답변" }),
    ]);
    root.add(
      el({ tag: "ul" }).add(
        el({ tag: "li" }).add(el({ tag: "a", text: "주문관리", attrs: { href: "/orders/12345" } })),
        el({ tag: "li" }).add(el({ tag: "a", text: "상품관리", attrs: { href: "/products/6789" } })),
      ),
    );

    const census = censusOf(root);

    // Navigation carries digits — it just never carries THIS inquiry's number.
    expect(census.elementsWithAnchorAttributes).toBeGreaterThan(2);
    expect(resolveInquiryTarget(census, "inquiryId").ok).toBe(true);
  });

  it("one match with nothing repeating around it is not a target", () => {
    // A detail page carries the id too. There is no row there to point at, and pretending otherwise would send
    // the guided run to highlight a page.
    const root = el({ tag: "div" }).add(
      el({ tag: "section" }).add(el({ tag: "a", attrs: { href: `/cs/inquiries/${INQUIRY_A}` } })),
    );

    const census = censusOf(root);

    expect(census.anchors.find((m) => m.id === "inquiryId")!.matchCount).toBe(1);
    expect(census.anchors.find((m) => m.id === "inquiryId")!.topology!.repeatLevels).toEqual([]);
    expect(resolveInquiryTarget(census, "inquiryId")).toEqual({ ok: false, reason: "TARGET_TOPOLOGY_UNKNOWN" });
  });
});

describe("the status wording is measured, not guessed", () => {
  it("**several spellings are counted separately**, so one run settles which the screen uses", () => {
    // The first calibration supplied one spelling per state and came back with zero of both — which left "the
    // wording differs" and "the scan never reached the list" indistinguishable, at the cost of a live sitting.
    const census = censusOf(
      divGridInquiryList([
        { inquiryId: INQUIRY_A, text: BUYER_TEXT_A, status: "답변 완료" },
        { inquiryId: INQUIRY_B, text: BUYER_TEXT_B, status: "답변 완료" },
        { inquiryId: "158900001", text: "세 번째", status: "미답변" },
      ]),
    );

    expect(census.labelCounts).toEqual([
      { id: "answeredTight", elementCount: 0 },
      { id: "answeredSpaced", elementCount: 2 },
      { id: "unansweredTight", elementCount: 1 },
    ]);
  });

  it("a status word is counted on the leaf that renders it, not on every ancestor", () => {
    // Counting ancestors too would report a row, its container, and the page body as three answered inquiries.
    const census = censusOf(
      wingInquiryList([row({ inquiryId: INQUIRY_A, text: BUYER_TEXT_A, status: "답변완료" })]),
    );

    expect(census.labelCounts.find((l) => l.id === "answeredTight")!.elementCount).toBe(1);
  });
});

describe("nothing a buyer wrote can leave the page", () => {
  it("no page text appears anywhere in the census, for any expectation", () => {
    const census = censusOf(
      wingInquiryList([
        row({ inquiryId: INQUIRY_A, productId: PRODUCT, text: BUYER_TEXT_A, status: "답변완료" }),
        row({ inquiryId: INQUIRY_B, productId: PRODUCT, text: BUYER_TEXT_B, status: "미답변" }),
      ]),
    );

    const wire = JSON.stringify(census);
    for (const secretish of [BUYER_TEXT_A, BUYER_TEXT_B, "언제쯤", "교환", "상세"]) {
      expect(wire, `census leaked ${secretish}`).not.toContain(secretish);
    }
    // The ids DO travel — they are ours, from our own database, and they are the whole targeting mechanism.
    expect(wire).toContain("inquiryId");
  });

  it("**`textContent` is read in exactly one place**, and reduced to a boolean there", () => {
    const body = buildInquiryListCensusScript(DIGITS, LABELS);
    const code = body
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("/*") && !l.trimStart().startsWith("*"))
      .join("\n");
    const reads = code.split("textContent").length - 1;
    expect(reads, "textContent must be read only inside countLabel").toBe(1);
    // And that one read is a fixed-literal containment test, never assigned to a returned field.
    const readLine = code.split("\n").find((l) => l.includes("textContent"))!;
    expect(readLine).toContain("indexOf(literal)");
  });

  it("the census returns no attribute VALUE and no class name — only kinds and counts", () => {
    const census = censusOf(
      divGridInquiryList([
        { inquiryId: INQUIRY_A, text: BUYER_TEXT_A, status: "답변완료" },
        { inquiryId: INQUIRY_B, text: BUYER_TEXT_B, status: "답변완료" },
      ]),
    );

    const wire = JSON.stringify(census);
    expect(wire).not.toContain("inq-row");
    expect(wire).not.toContain("inq-body");
    expect(wire).not.toContain("data-inquiry-no");
    expect(wire).toContain("DATA");
  });

  it("topology does not travel when the target is ambiguous", () => {
    const census = censusOf(
      wingInquiryList([
        row({ inquiryId: INQUIRY_A, productId: PRODUCT, text: BUYER_TEXT_A, status: "답변완료" }),
        row({ inquiryId: INQUIRY_B, productId: PRODUCT, text: BUYER_TEXT_B, status: "미답변" }),
      ]),
    );

    // With 2 matches a topology describes one of two places, so it would mislead whoever builds the locator.
    expect(census.anchors.find((m) => m.id === "productId")!.topology).toBeNull();
  });
});

describe("the census fails closed rather than reporting a partial reading", () => {
  it("refuses an empty document rather than reporting zero as a clean reading", () => {
    expect(censusOf(el({ tag: "div" })).reason).toBe("NO_ELEMENTS");
  });

  it("a resolution against a refused census never claims a target", () => {
    for (const reason of ["NO_ELEMENTS", "SCAN_TRUNCATED", "UNREADABLE"] as const) {
      const census = sanitizeInquiryListCensus({ reason }, DIGITS, LABELS);
      expect(resolveInquiryTarget(census, "inquiryId")).toEqual({ ok: false, reason: "CENSUS_REFUSED" });
    }
  });

  it("the sanitizer refuses anything it cannot re-derive, and invents no expectation", () => {
    for (const bad of [
      null,
      undefined,
      "OK",
      { reason: "OK" },
      { reason: "OK", elementsScanned: -1, elementsWithAnchorAttributes: 0 },
      // More elements carrying anchors than elements scanned is incoherent; reconciling it invents a reading.
      { reason: "OK", elementsScanned: 1, elementsWithAnchorAttributes: 5 },
    ]) {
      expect(sanitizeInquiryListCensus(bad, DIGITS, LABELS).reason).not.toBe("OK");
    }
  });

  it("**the page cannot introduce a string of its own** into the result", () => {
    const raw = {
      reason: "OK",
      elementsScanned: 40,
      elementsWithAnchorAttributes: 9,
      anchors: [
        {
          id: "inquiryId",
          matchCount: 1,
          topology: {
            // A hostile page answering with a value shaped like a tag, and kinds we never allowlisted.
            matchedTagName: "/tenants/seller-cs/1",
            attributeKinds: ["HREF", "TITLE", BUYER_TEXT_A],
            ancestorDepthScanned: 3,
            repeatLevels: [
              { depth: 1, tagName: "TR", siblingCount: 2, siblingsSharingClassShape: 2, classTokenCount: 1 },
              // A level claiming more shape-sharing siblings than siblings is dropped, not repaired.
              { depth: 2, tagName: "DIV", siblingCount: 2, siblingsSharingClassShape: 9, classTokenCount: 0 },
            ],
          },
        },
        { id: "productId", matchCount: 0 },
        { id: "somethingElse", matchCount: 9 },
      ],
      labelCounts: [
        { id: "answeredTight", elementCount: 1 },
        { id: "answeredSpaced", elementCount: 0 },
        { id: "unansweredTight", elementCount: 0 },
        { id: "injected", elementCount: 7 },
      ],
    };

    const census = sanitizeInquiryListCensus(raw, DIGITS, LABELS);

    // Only the expectations the CALLER supplied come back.
    expect(census.anchors.map((m) => m.id)).toEqual(["inquiryId", "productId"]);
    expect(census.labelCounts.map((l) => l.id)).toEqual(["answeredTight", "answeredSpaced", "unansweredTight"]);
    // A path-shaped tag name is not a tag name, so the whole topology drops rather than half-travelling.
    expect(census.anchors[0]!.topology).toBeNull();
    const wire = JSON.stringify(census);
    expect(wire).not.toContain("somethingElse");
    expect(wire).not.toContain("injected");
    expect(wire).not.toContain("TITLE");
    expect(wire).not.toContain(BUYER_TEXT_A);
  });

  it("an incoherent repeat level drops without taking the good ones with it", () => {
    const raw = {
      reason: "OK",
      elementsScanned: 40,
      elementsWithAnchorAttributes: 9,
      anchors: [
        {
          id: "inquiryId",
          matchCount: 1,
          topology: {
            matchedTagName: "A",
            attributeKinds: ["HREF"],
            ancestorDepthScanned: 4,
            repeatLevels: [
              { depth: 1, tagName: "TD", siblingCount: 3, siblingsSharingClassShape: 3, classTokenCount: 0 },
              // A "repeat" of one is not a repeat.
              { depth: 2, tagName: "TR", siblingCount: 1, siblingsSharingClassShape: 1, classTokenCount: 0 },
            ],
          },
        },
        { id: "productId", matchCount: 0 },
      ],
      labelCounts: [
        { id: "answeredTight", elementCount: 1 },
        { id: "answeredSpaced", elementCount: 0 },
        { id: "unansweredTight", elementCount: 0 },
      ],
    };

    const census = sanitizeInquiryListCensus(raw, DIGITS, LABELS);

    expect(census.anchors[0]!.topology!.repeatLevels.map((l) => l.tagName)).toEqual(["TD"]);
    expect(resolveInquiryTarget(census, "inquiryId").ok).toBe(true);
  });

  it("a missing count for a requested expectation is UNREADABLE, not a zero", () => {
    const raw = {
      reason: "OK",
      elementsScanned: 40,
      elementsWithAnchorAttributes: 9,
      anchors: [{ id: "inquiryId", matchCount: 1 }],
      labelCounts: [],
    };

    // Defaulting the absent one to 0 would read as "not on this screen" — a different fact.
    expect(sanitizeInquiryListCensus(raw, DIGITS, LABELS).reason).toBe("UNREADABLE");
  });
});
