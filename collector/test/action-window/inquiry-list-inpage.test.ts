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
  resolveInquiryColumnTarget,
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
  /** Where this element paints. The column probe resolves a column geometrically, so this is load-bearing. */
  box?: { left: number; top: number; width: number; height: number };
}

/** A shadow root: queryable like a document, and reachable back to its host — which is how the walk crosses. */
class ShadowRoot {
  readonly children: El[] = [];
  constructor(readonly host: El) {}
  add(...kids: El[]): this {
    for (const k of kids) {
      k.parent = null;
      k.shadowParent = this;
      this.children.push(k);
    }
    return this;
  }
  descendants(): El[] {
    return this.children.flatMap((c) => [c, ...c.descendants()]);
  }
  querySelectorAll(sel: string): El[] {
    return select(this.descendants(), sel);
  }
}

class El {
  readonly tagName: string;
  readonly children: El[] = [];
  parent: El | null = null;
  shadowParent: ShadowRoot | null = null;
  shadowRoot: ShadowRoot | null = null;
  private readonly ownText: string;
  private readonly display: string;
  private readonly rects: number;
  private readonly box: { left: number; top: number; width: number; height: number };
  readonly attributes: { name: string; value: string }[];

  constructor(init: ElInit) {
    this.tagName = init.tag.toUpperCase();
    this.ownText = init.text ?? "";
    this.display = init.display ?? "block";
    this.rects = init.rects ?? 1;
    this.box = init.box ?? { left: 0, top: 0, width: 100, height: 20 };
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
  /** Attaches an open shadow root and returns THIS, so a fixture reads like the markup it stands for. */
  attachShadow(...kids: El[]): this {
    this.shadowRoot = new ShadowRoot(this);
    this.shadowRoot.add(...kids);
    return this;
  }
  get parentElement(): El | null {
    return this.parent;
  }
  /** DOM semantics: a shadow child's `parentNode` is the root, whose `host` is the element it hangs off. */
  get parentNode(): El | ShadowRoot | null {
    return this.parent ?? this.shadowParent;
  }
  get childElementCount(): number {
    return this.children.length;
  }
  /** Light-DOM descendants only — a document query does NOT cross into a shadow root, which is the whole point. */
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
  getBoundingClientRect(): { left: number; top: number; width: number; height: number } {
    return this.box;
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

/**
 * The real WING 고객문의 grid, as the seller described it: 등록일시 · 고객명 · 상품/문의내용 · 문의유형(접수번호) ·
 * 주문번호 · 답변여부, with the receipt number PRINTED as `주문문의 (158846709)` rather than marked up.
 *
 * Laid out with real geometry, because the column is resolved geometrically — a fixture without boxes would
 * pass every column test for the wrong reason.
 */
const COL_X: Record<string, number> = { date: 0, name: 120, body: 240, type: 460, order: 600, state: 740 };
const COL_W = 110;

function wingGrid(
  rows: { receiptNo: string; orderNo: string; buyer: string; body: string; state: string }[],
): El {
  const headerCells = [
    ["등록일시", COL_X.date],
    ["고객명", COL_X.name],
    ["상품/문의내용", COL_X.body],
    ["문의유형(접수번호)", COL_X.type],
    ["주문번호", COL_X.order],
    ["답변여부", COL_X.state],
  ] as const;
  const header = el({ tag: "div", attrs: { class: "hd" }, box: { left: 0, top: 0, width: 860, height: 30 } });
  for (const [text, left] of headerCells) {
    header.add(el({ tag: "span", text, box: { left: left!, top: 0, width: COL_W, height: 30 } }));
  }
  const body = el({ tag: "div", box: { left: 0, top: 0, width: 860, height: 400 } }).add(header);
  rows.forEach((r, i) => {
    const top = 40 + i * 40;
    const cell = (text: string, left: number): El =>
      el({ tag: "span", text, box: { left, top, width: COL_W, height: 30 } });
    body.add(
      el({ tag: "div", attrs: { class: "rw" }, box: { left: 0, top, width: 860, height: 30 } }).add(
        cell("2026-08-01", COL_X.date!),
        cell(r.buyer, COL_X.name!),
        cell(r.body, COL_X.body!),
        cell(`주문문의 (${r.receiptNo})`, COL_X.type!),
        cell(r.orderNo, COL_X.order!),
        cell(r.state, COL_X.state!),
        el({
          tag: "a",
          text: "상세",
          attrs: { href: "/cs/detail" },
          box: { left: COL_X.state! + 60, top, width: 40, height: 30 },
        }),
      ),
    );
  });
  return el({ tag: "div" }).add(body);
}

const HEADERS: InquiryLabelExpectation[] = [
  { id: "typeWithNo", exactText: "문의유형(접수번호)" },
  { id: "receiptNo", exactText: "접수번호" },
];

function gridCensus(root: El, digits = DIGITS) {
  const raw = run<unknown>(buildInquiryListCensusScript(digits, LABELS, HEADERS), root);
  return sanitizeInquiryListCensus(raw, digits, LABELS, HEADERS);
}

describe("the identifier the seller can SEE — matched in the column its header names", () => {
  const GRID = (): El =>
    wingGrid([
      {
        receiptNo: INQUIRY_A,
        orderNo: "31000012345678",
        buyer: "김**",
        body: BUYER_TEXT_A,
        state: "답변완료",
      },
      {
        receiptNo: INQUIRY_B,
        orderNo: "31000087654321",
        buyer: "이**",
        body: BUYER_TEXT_B,
        state: "답변완료",
      },
    ]);

  it("**resolves each DB inquiryId to exactly one row, and to DIFFERENT rows**", () => {
    // This is the mapping the whole unit rests on: onlineInquiries.inquiryId == the printed 접수번호.
    const census = gridCensus(GRID(), [
      { id: "inquiryA", digits: INQUIRY_A },
      { id: "inquiryB", digits: INQUIRY_B },
    ]);

    expect(census.columnProbe.reason).toBe("OK");
    expect(census.columnProbe.headerId).toBe("typeWithNo");
    expect(census.columnProbe.matches.map((m) => m.matchCount)).toEqual([1, 1]);
    // Both resolving to the SAME row would report 1 and 1 too, and would be a broken mapping that looks clean.
    expect(census.columnProbe.distinctRowsMatched).toBe(2);
    expect(resolveInquiryColumnTarget(census, "inquiryA").ok).toBe(true);
  });

  it("reports the row's detail affordance and its answered state, as ids we supplied", () => {
    const census = gridCensus(GRID(), [{ id: "inquiryA", digits: INQUIRY_A }]);

    const match = census.columnProbe.matches[0]!;
    expect(match.hasDetailAffordance).toBe(true);
    expect(match.answeredStateId).toBe("answeredTight");
    // The ROW is one level above the cell — not level 0, which is the cell repeating across the row.
    expect(match.rowLevelDepth).toBe(1);
    // And its sibling count is 3 for TWO inquiries, because the header row is a <div> beside them. Sibling
    // count is a measurement of the markup, not a count of inquiries, and reading it as the latter is exactly
    // the kind of inference this probe exists to keep out of a locator.
    const rowLevel = match.topology!.repeatLevels.find((l) => l.depth === 1)!;
    expect(rowLevel.siblingCount).toBe(3);
    expect(rowLevel.siblingsSharingClassShape).toBe(2);
  });

  it("**an order number is never matched against an inquiry id** — the column scope is the guard", () => {
    // The 주문번호 column holds digit runs too. Without column scoping, an id that happened to coincide would
    // resolve confidently to a row, and "confidently wrong" here means showing a seller another customer's
    // question. Here the order number IS one of our expectations, and it must not be found.
    const census = gridCensus(GRID(), [
      { id: "inquiryA", digits: INQUIRY_A },
      { id: "orderNo", digits: "31000012345678" },
    ]);

    expect(census.columnProbe.matches.find((m) => m.id === "inquiryA")!.matchCount).toBe(1);
    expect(census.columnProbe.matches.find((m) => m.id === "orderNo")!.matchCount).toBe(0);
  });

  it("**a whole-run match** — the printed number is not matched by a prefix of itself", () => {
    const census = gridCensus(GRID(), [{ id: "prefix", digits: INQUIRY_A.slice(0, 5) }]);

    expect(census.columnProbe.matches[0]!.matchCount).toBe(0);
  });

  it("refuses when the header is nowhere on the screen, rather than matching page-wide", () => {
    const root = el({ tag: "div" }).add(
      el({ tag: "div" }).add(el({ tag: "span", text: `주문문의 (${INQUIRY_A})` })),
    );

    const census = gridCensus(root);

    expect(census.columnProbe.reason).toBe("HEADER_NOT_FOUND");
    expect(resolveInquiryColumnTarget(census, "inquiryId")).toEqual({ ok: false, reason: "CENSUS_REFUSED" });
  });

  it("refuses when two headers match — which column is THE column would be a guess", () => {
    const root = GRID();
    root.add(
      el({ tag: "div" }).add(
        el({ tag: "span", text: "문의유형(접수번호)", box: { left: 0, top: 900, width: 100, height: 20 } }),
      ),
    );

    expect(gridCensus(root).columnProbe.reason).toBe("HEADER_AMBIGUOUS");
  });

  it("nothing from the 고객명 or 문의내용 columns reaches the result", () => {
    const census = gridCensus(GRID(), [{ id: "inquiryA", digits: INQUIRY_A }]);

    const wire = JSON.stringify(census);
    for (const secretish of [BUYER_TEXT_A, BUYER_TEXT_B, "김**", "이**", "주문문의", "31000012345678"]) {
      expect(wire, `column probe leaked ${secretish}`).not.toContain(secretish);
    }
  });
});

describe("the scan reaches every document, not just the easy one", () => {
  it("**finds a list rendered inside an open shadow root**", () => {
    // A document-level query stops at a shadow boundary. A component-rendered list is invisible to it — the
    // same blind spot as scanning only the top frame, one layer in, and it yields the same confident zero.
    const host = el({ tag: "inquiry-list" }).attachShadow(
      el({ tag: "div", attrs: { class: "row", "data-inquiry-no": INQUIRY_A } }).add(
        el({ tag: "span", text: "답변완료" }),
      ),
      el({ tag: "div", attrs: { class: "row", "data-inquiry-no": INQUIRY_B } }).add(
        el({ tag: "span", text: "답변완료" }),
      ),
    );
    const root = el({ tag: "div" }).add(el({ tag: "main" }).add(host));

    const census = censusOf(root);

    expect(census.shadowRootsFound).toBe(1);
    const anchor = census.anchors.find((m) => m.id === "inquiryId")!;
    expect(anchor.matchCount).toBe(1);
    // And the repeat walk crosses the boundary via the host rather than stopping dead at it.
    expect(anchor.topology!.repeatLevels[0]!.siblingCount).toBe(2);
    expect(census.labelCounts.find((l) => l.id === "answeredTight")!.elementCount).toBe(2);
  });

  it("counts the shadow roots it descended into, so a future zero can be read honestly", () => {
    const root = el({ tag: "div" }).add(
      el({ tag: "x-a" }).attachShadow(el({ tag: "span", text: "hello" })),
      el({ tag: "x-b" }).attachShadow(el({ tag: "span", text: "world" })),
    );

    expect(censusOf(root).shadowRootsFound).toBe(2);
  });
});

describe("a zero match is made interpretable, instead of being left ambiguous", () => {
  it("**reports the LENGTHS of the ids the screen does carry**, so a miss is not two findings at once", () => {
    // The live screen matched neither identifier while 113 elements carried digits in allowlisted attributes.
    // "The screen carries no machine id" and "the screen carries an id of a different KIND than ours" both
    // arrive as matchCount 0, and they lead to completely different next steps. Lengths tell them apart —
    // and a length distribution identifies nothing and no one.
    const root = el({ tag: "div" }).add(
      el({ tag: "div" }).add(
        el({ tag: "a", attrs: { href: "/cs/inquiries/9912345678901234" } }),
        el({ tag: "a", attrs: { href: "/page/2" } }),
        el({ tag: "div", attrs: { "data-seq": "77" } }),
      ),
    );

    const census = censusOf(root);

    expect(census.anchors.find((m) => m.id === "inquiryId")!.matchCount).toBe(0);
    expect(census.anchorDigitRunLengths).toEqual([1, 2, 16]);
  });

  it("a repeat level reports the id lengths it carries, so the row's own id space is visible", () => {
    const census = censusOf(
      divGridInquiryList([
        { inquiryId: INQUIRY_A, text: BUYER_TEXT_A, status: "답변완료" },
        { inquiryId: INQUIRY_B, text: BUYER_TEXT_B, status: "답변완료" },
      ]),
    );

    const level = census.anchors.find((m) => m.id === "inquiryId")!.topology!.repeatLevels[0]!;
    expect(level.digitRunLengths).toEqual([INQUIRY_A.length]);
  });

  it("**a fixed platform word is an anchor too** — the structure around it is measured the same way", () => {
    // When the screen does not carry OUR identifier, this is what is left: a word we supplied ourselves.
    // Two leaves saying it inside two identically shaped siblings IS the row structure, found without
    // reading anything a buyer wrote.
    const census = censusOf(
      divGridInquiryList([
        { inquiryId: INQUIRY_A, text: BUYER_TEXT_A, status: "답변완료" },
        { inquiryId: INQUIRY_B, text: BUYER_TEXT_B, status: "답변완료" },
        { inquiryId: "158900001", text: "세 번째", status: "미답변" },
      ]),
    );

    const answered = census.labelCounts.find((l) => l.id === "answeredTight")!;
    expect(answered.elementCount).toBe(2);
    expect(answered.hitsSharingRepeatShape).toBe(2);
    // The chain reads outward: the status sits in a cell that repeats twice inside a row that repeats three
    // times. Three identically shaped siblings for three inquiries on screen — that is the row level.
    expect(answered.topology!.repeatLevels.map((l) => l.siblingCount)).toEqual([2, 3]);
    const rowLevel = answered.topology!.repeatLevels[1]!;
    // And the row it landed in carries a 9-digit number — the shape of the id WING would target by.
    expect(rowLevel.digitRunLengths).toContain(INQUIRY_A.length);
  });

  it("two hits in unrelated corners are not a row structure", () => {
    // A filter tab and a legend can both say 미답변 while no inquiry does. Shape agreement is what separates
    // "these are rows" from "these are page furniture", and a count alone cannot.
    const root = el({ tag: "div" }).add(
      el({ tag: "nav" }).add(el({ tag: "span", text: "미답변" })),
      el({ tag: "footer" }).add(el({ tag: "p", text: "미답변 건은 24시간 내 처리" })),
    );

    const census = censusOf(root);

    const unanswered = census.labelCounts.find((l) => l.id === "unansweredTight")!;
    expect(unanswered.elementCount).toBe(2);
    expect(unanswered.sharedRepeatLevel).toBeNull();
    expect(unanswered.hitsSharingRepeatShape).toBe(0);
  });

  it("**hits agree on a repeat even when one sits a wrapper deeper**", () => {
    // The first version compared only each hit's innermost level and scored 1-of-2 for hits that plainly did
    // share an outer repeat — one of them was nested one level further in. Agreement is about the chain.
    const rows = el({ tag: "div" });
    rows.add(
      el({ tag: "div", attrs: { class: "row" } }).add(el({ tag: "span", text: "답변완료" })),
      el({ tag: "div", attrs: { class: "row" } }).add(
        el({ tag: "div" }).add(el({ tag: "em" }).add(el({ tag: "span", text: "답변완료" }))),
      ),
    );

    const census = censusOf(el({ tag: "div" }).add(rows));

    const answered = census.labelCounts.find((l) => l.id === "answeredTight")!;
    expect(answered.elementCount).toBe(2);
    expect(answered.sharedRepeatLevel!.tagName).toBe("DIV");
    expect(answered.sharedRepeatLevel!.siblingCount).toBe(2);
    expect(answered.hitsSharingRepeatShape).toBe(2);
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

    expect(census.labelCounts.map((l) => [l.id, l.elementCount])).toEqual([
      ["answeredTight", 0],
      ["answeredSpaced", 2],
      ["unansweredTight", 1],
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

  it("**`textContent` is read in exactly ONE function**, and every caller reduces it to a count", () => {
    // The probe now compares text in two ways — against fixed platform words, and against our own identifiers
    // in one column. Both go through a single reader, which is what keeps "where does page text enter this
    // script" answerable by looking at one line instead of auditing every branch.
    const body = buildInquiryListCensusScript(DIGITS, LABELS, HEADERS);
    const code = body
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("/*") && !l.trimStart().startsWith("*"))
      .join("\n");
    const reads = code.split("textContent").length - 1;
    expect(reads, "textContent must be read only inside textOf").toBe(1);
    const readLine = code.split("\n").find((l) => l.includes("textContent"))!;
    expect(readLine).toContain("function textOf");
    // Every use of that reader ends in a containment test or a digit-run extraction — never an assignment
    // into something returned. `indexOf` and `.match(` are the only two shapes allowed to follow it.
    for (const use of code.split("\n").filter((l) => l.includes("textOf(") && !l.includes("function textOf"))) {
      expect(use, `textOf used without reducing it: ${use.trim()}`).toMatch(/indexOf\(|\.match\(/);
    }
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
      { reason: "OK", elementsScanned: -1, shadowRootsFound: 0, elementsWithAnchorAttributes: 0 },
      // More elements carrying anchors than elements scanned is incoherent; reconciling it invents a reading.
      { reason: "OK", elementsScanned: 1, shadowRootsFound: 0, elementsWithAnchorAttributes: 5 },
      // A count the scan could not produce is not a count.
      { reason: "OK", elementsScanned: 1, elementsWithAnchorAttributes: 1 },
    ]) {
      expect(sanitizeInquiryListCensus(bad, DIGITS, LABELS).reason).not.toBe("OK");
    }
  });

  it("**the page cannot introduce a string of its own** into the result", () => {
    const raw = {
      reason: "OK",
      elementsScanned: 40,
      shadowRootsFound: 0,
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
      shadowRootsFound: 0,
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
      shadowRootsFound: 0,
      elementsWithAnchorAttributes: 9,
      anchors: [{ id: "inquiryId", matchCount: 1 }],
      labelCounts: [],
    };

    // Defaulting the absent one to 0 would read as "not on this screen" — a different fact.
    expect(sanitizeInquiryListCensus(raw, DIGITS, LABELS).reason).toBe("UNREADABLE");
  });
});
