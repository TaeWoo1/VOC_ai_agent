/**
 * **The 고객문의 list census, executed.** These run the REAL generated script — the same string the driver
 * evaluates in the page — against a fake DOM.
 *
 * The property worth the most here is an absence: a buyer's words must not be able to leave the page. That is
 * asserted two ways, because either alone is weak. Structurally, the emitted body must read `textContent` in
 * exactly one place and reduce it to a boolean there. Behaviourally, a page whose rows are full of distinctive
 * buyer text must produce a census in which none of it appears — including in the attribute names, which are
 * the one string-shaped thing that does travel.
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
 * Enough selector grammar for the census: comma lists, `*`, `[attr]`, `TAG[attr]`, and one level of descendant
 * (`table tr`). A fake that cannot express a selector silently answers "no elements", which is the shape of a
 * green test over a broken rule — so anything unrecognised throws instead.
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
  { id: "answered", exactText: "답변완료" },
  { id: "unanswered", exactText: "미답변" },
];

/** One list row: an id-bearing link, the buyer's text, and a status word. */
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

function censusOf(root: El, digits = DIGITS, labels = LABELS) {
  const raw = run<unknown>(buildInquiryListCensusScript(digits, labels), root);
  return sanitizeInquiryListCensus(raw, digits, labels);
}

/* ───────────────────────────── the cases ───────────────────────────── */

describe("the 고객문의 list census counts rows without reading them", () => {
  it("finds the one row carrying the inquiry id, and names the attribute it came from", () => {
    const census = censusOf(
      wingInquiryList([
        row({ inquiryId: INQUIRY_A, productId: PRODUCT, text: BUYER_TEXT_A, status: "답변완료" }),
        row({ inquiryId: INQUIRY_B, productId: PRODUCT, text: BUYER_TEXT_B, status: "미답변" }),
      ]),
    );

    expect(census.reason).toBe("OK");
    expect(census.containerKind).toBe("TABLE");
    expect(census.rowCount).toBe(2);
    const inquiryMatch = census.digitMatches.find((m) => m.id === "inquiryId")!;
    expect(inquiryMatch.rowMatchCount).toBe(1);
    // The name is what lets the next unit build a locator from a measurement instead of a guess.
    expect(inquiryMatch.matchedAttributeNames).toContain("href");
    expect(resolveInquiryTarget(census, "inquiryId")).toEqual({ ok: true, expectationId: "inquiryId" });
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
    expect(census.digitMatches.find((m) => m.id === "productId")!.rowMatchCount).toBe(2);
    expect(resolveInquiryTarget(census, "productId")).toEqual({ ok: false, reason: "TARGET_AMBIGUOUS" });
  });

  it("reports zero when the page carries no id — refuting the approach rather than working around it", () => {
    const census = censusOf(
      wingInquiryList([
        row({ inquiryId: "", productId: undefined, text: BUYER_TEXT_A, status: "답변완료", detail: false }),
      ]),
    );

    expect(census.rowsWithDigits).toBe(0);
    expect(census.digitMatches.find((m) => m.id === "inquiryId")!.rowMatchCount).toBe(0);
    expect(resolveInquiryTarget(census, "inquiryId")).toEqual({ ok: false, reason: "TARGET_NOT_FOUND" });
    // And no fallback to matching the buyer's text exists to be reached for.
    expect(JSON.stringify(census)).not.toContain(BUYER_TEXT_A);
  });

  it("**a digit run must match whole** — a prefix targets a different inquiry silently", () => {
    const census = censusOf(
      wingInquiryList([row({ inquiryId: INQUIRY_A, text: BUYER_TEXT_A, status: "답변완료" })]),
      [{ id: "prefix", digits: INQUIRY_A.slice(0, 4) }],
      [],
    );

    expect(census.digitMatches[0]!.rowMatchCount).toBe(0);
  });

  it("counts answered and unanswered rows from fixed platform words we supply", () => {
    const census = censusOf(
      wingInquiryList([
        row({ inquiryId: INQUIRY_A, text: BUYER_TEXT_A, status: "답변완료" }),
        row({ inquiryId: INQUIRY_B, text: BUYER_TEXT_B, status: "미답변" }),
        row({ inquiryId: "158900001", text: "세 번째 문의", status: "미답변" }),
      ]),
    );

    expect(census.labelCounts).toEqual([
      { id: "answered", rowCount: 1 },
      { id: "unanswered", rowCount: 2 },
    ]);
  });

  it("counts which rows offer a way into a detail view", () => {
    const census = censusOf(
      wingInquiryList([
        row({ inquiryId: INQUIRY_A, text: BUYER_TEXT_A, status: "답변완료" }),
        row({ inquiryId: INQUIRY_B, text: BUYER_TEXT_B, status: "미답변", detail: false }),
      ]),
    );

    expect(census.rowsWithDetailAffordance).toBe(1);
  });

  it("a hidden template row is not a row the seller can be pointed at", () => {
    const hidden = row({ inquiryId: INQUIRY_A, text: BUYER_TEXT_A, status: "답변완료" });
    const template = new El({ tag: "tr", display: "none" });
    const census = censusOf(wingInquiryList([hidden, template]));

    expect(census.rowCount).toBe(1);
  });
});

describe("nothing a buyer wrote can leave the page", () => {
  it("no row text appears anywhere in the census, for any expectation", () => {
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
    expect(reads, "textContent must be read only inside hasLabel").toBe(1);
    // And that one read is inside the boolean-returning helper, never assigned to a returned field.
    const hasLabelLine = code.split("\n").find((l) => l.includes("textContent"))!;
    expect(hasLabelLine).toContain("function hasLabel");
    expect(hasLabelLine).toContain("indexOf");
  });

  it("the census never returns an attribute VALUE, only names", () => {
    const census = censusOf(
      wingInquiryList([row({ inquiryId: INQUIRY_A, productId: PRODUCT, text: BUYER_TEXT_A, status: "답변완료" })]),
    );

    const wire = JSON.stringify(census);
    // The href that matched carried a path; the path must not travel with the name.
    expect(wire).not.toContain("/tenants/");
    expect(wire).toContain("href");
  });

  it("attribute names do not travel when the target is ambiguous", () => {
    const census = censusOf(
      wingInquiryList([
        row({ inquiryId: INQUIRY_A, productId: PRODUCT, text: BUYER_TEXT_A, status: "답변완료" }),
        row({ inquiryId: INQUIRY_B, productId: PRODUCT, text: BUYER_TEXT_B, status: "미답변" }),
      ]),
    );

    // With 2 matches the names describe several rows, so they would mislead whoever builds the locator.
    expect(census.digitMatches.find((m) => m.id === "productId")!.matchedAttributeNames).toEqual([]);
  });
});

describe("the census fails closed rather than reporting a partial reading", () => {
  it("refuses when rows appear under more than one container kind", () => {
    const root = wingInquiryList([row({ inquiryId: INQUIRY_A, text: BUYER_TEXT_A, status: "답변완료" })]);
    root.add(el({ tag: "ul" }).add(el({ tag: "li", text: "다른 목록" })));

    const census = censusOf(root);

    // "Which list is THE list" is not a question this may guess at.
    expect(census.reason).toBe("CONTAINER_AMBIGUOUS");
    expect(resolveInquiryTarget(census, "inquiryId")).toEqual({ ok: false, reason: "CENSUS_REFUSED" });
  });

  it("refuses an empty screen rather than reporting zero rows as a clean reading", () => {
    expect(censusOf(el({ tag: "div" })).reason).toBe("NO_ROWS");
  });

  it("a resolution against a refused census never claims a target", () => {
    for (const reason of ["NO_ROWS", "CONTAINER_AMBIGUOUS", "SCAN_TRUNCATED", "UNREADABLE"] as const) {
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
      { reason: "OK", containerKind: "TABLE", rowCount: -1 },
      { reason: "OK", containerKind: "SOMETHING_NEW", rowCount: 1 },
      // A container of NONE with rows counted is incoherent; reconciling it would invent a reading.
      { reason: "OK", containerKind: "NONE", rowCount: 3, rowsWithDigits: 0, rowsWithDetailAffordance: 0 },
    ]) {
      expect(sanitizeInquiryListCensus(bad, DIGITS, LABELS).reason).not.toBe("OK");
    }
  });

  it("**the page cannot introduce a string of its own** into the result", () => {
    const raw = {
      reason: "OK",
      containerKind: "TABLE",
      rowCount: 1,
      rowsWithDigits: 1,
      rowsWithDetailAffordance: 1,
      // A hostile page answering with ids we never asked about, and a value shaped like a name.
      digitMatches: [
        { id: "inquiryId", rowMatchCount: 1, matchedAttributeNames: ["href", "/tenants/seller-cs/1", ""] },
        { id: "productId", rowMatchCount: 0 },
        { id: "somethingElse", rowMatchCount: 9 },
      ],
      labelCounts: [
        { id: "answered", rowCount: 1 },
        { id: "unanswered", rowCount: 0 },
        { id: "injected", rowCount: 7 },
      ],
    };

    const census = sanitizeInquiryListCensus(raw, DIGITS, LABELS);

    // Only the expectations the CALLER supplied come back, and the path-shaped "name" is dropped.
    expect(census.digitMatches.map((m) => m.id)).toEqual(["inquiryId", "productId"]);
    expect(census.digitMatches[0]!.matchedAttributeNames).toEqual(["href"]);
    expect(census.labelCounts.map((l) => l.id)).toEqual(["answered", "unanswered"]);
    expect(JSON.stringify(census)).not.toContain("somethingElse");
    expect(JSON.stringify(census)).not.toContain("injected");
  });

  it("a missing count for a requested expectation is UNREADABLE, not a zero", () => {
    const raw = {
      reason: "OK",
      containerKind: "TABLE",
      rowCount: 1,
      rowsWithDigits: 1,
      rowsWithDetailAffordance: 1,
      digitMatches: [{ id: "inquiryId", rowMatchCount: 1 }],
      labelCounts: [],
    };

    // Defaulting the absent one to 0 would read as "not on this screen" — a different fact.
    expect(sanitizeInquiryListCensus(raw, DIGITS, LABELS).reason).toBe("UNREADABLE");
  });
});
