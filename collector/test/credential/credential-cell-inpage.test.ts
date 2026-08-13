/**
 * **The credential value-cell resolution, executed.** These cases run the REAL generated scripts — the same
 * strings the driver evaluates in the page — against a fake DOM, so the resolution is exercised in CI rather
 * than only read.
 *
 * That matters more here than anywhere else in this codebase: the thing this locator resolves to is a secret, and
 * the failure this workstream keeps repeating is a rule that was reasonable, untested against the real shape, and
 * wrong (`entryRowCount` for a chip; `submitAffordancePresent` for a `<button type=button>`). A locator for a
 * credential cell does not get to be the third one.
 *
 * No jsdom: jsdom has no layout, so every element would read as not painting and every case would pass for the
 * wrong reason.
 */
import { describe, expect, it } from "vitest";
import {
  buildCredentialCellCensusScript,
  buildCredentialCellReadScript,
  buildCredentialRegionScopeScript,
} from "../../src/action-window/api-issuance-calibration/credential-cell-inpage";
import {
  COUPANG_CREDENTIAL_FIELDS,
  COUPANG_CREDENTIAL_FIELD_IDS,
  chooseCredentialRegion,
  credentialCellsResolved,
  sanitizeCredentialCellCensus,
  sanitizeCredentialRegionScope,
} from "../../src/action-window/coupang-wing-credential-cells";

/* ───────────────────────────── a fake DOM with a real tree ───────────────────────────── */

interface ElInit {
  tag: string;
  text?: string;
  value?: string;
  display?: string;
  rects?: number;
}

class El {
  readonly tagName: string;
  readonly children: El[] = [];
  parent: El | null = null;
  private readonly ownText: string;
  value: string | undefined;
  private readonly display: string;
  private readonly rects: number;

  constructor(init: ElInit) {
    this.tagName = init.tag.toUpperCase();
    this.ownText = init.text ?? "";
    this.value = init.value;
    this.display = init.display ?? "block";
    this.rects = init.rects ?? 1;
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
  get nextElementSibling(): El | null {
    const sibs = this.parent?.children ?? [];
    const i = sibs.indexOf(this);
    return i >= 0 && i + 1 < sibs.length ? sibs[i + 1]! : null;
  }
  descendants(): El[] {
    return this.children.flatMap((c) => [c, ...c.descendants()]);
  }
  /** DOM semantics: an element contains itself. The region scope relies on it. */
  contains(other: El): boolean {
    return other === this || this.descendants().includes(other);
  }
  querySelectorAll(sel: string): El[] {
    const wanted = sel.split(",").map((s) => s.trim().toUpperCase());
    return this.descendants().filter((e) => wanted.includes(e.tagName));
  }
  computedStyle(): { display: string; visibility: string } {
    return { display: this.display, visibility: "visible" };
  }
  getClientRects(): unknown[] {
    return new Array(this.rects).fill({});
  }
  getBoundingClientRect(): { width: number; height: number } {
    return { width: 100, height: 20 };
  }
  getAttribute(): string | null {
    return null;
  }
}

function el(init: ElInit): El {
  return new El(init);
}

function run<T>(script: string, root: El): T {
  const all = root.descendants();
  const document = {
    querySelectorAll(sel: string): El[] {
      const wanted = sel.split(",").map((s) => s.trim().toUpperCase());
      return all.filter((e) => wanted.includes(e.tagName));
    },
  };
  const window = { getComputedStyle: (e: El) => e.computedStyle() };
  return new Function("document", "window", `return (${script});`)(document, window) as T;
}

const VENDOR = "V-00099";
const ACCESS = "8f2c1ab4d5e6f70819a2b3c4d5e6f708";
const SECRET = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4";

/**
 * The WING shape as measured: three `<th>` in ONE header row, values in the body row beneath, and the 연동 정보
 * block living in the SAME table (which is why `WING_CREDENTIAL_REGION_EVIDENCE` found no ancestor level holding
 * the keys without the vendor fields).
 */
function wingIssuedTable(opts: { vendor?: string; access?: string; secret?: string; vendorBlock?: boolean } = {}): El {
  const head = el({ tag: "tr" }).add(
    el({ tag: "th", text: "업체코드" }),
    el({ tag: "th", text: "Access Key" }),
    el({ tag: "th", text: "Secret Key" }),
  );
  const body = el({ tag: "tr" }).add(
    el({ tag: "td", text: opts.vendor ?? VENDOR }),
    el({ tag: "td", text: opts.access ?? ACCESS }),
    el({ tag: "td", text: opts.secret ?? SECRET }),
  );
  const table = el({ tag: "table" }).add(el({ tag: "thead" }).add(head), el({ tag: "tbody" }).add(body));
  const root = el({ tag: "div" }).add(table);
  if (opts.vendorBlock !== false) {
    // The seller's own business details, on the same screen — the labels the ring measurement had to exclude.
    root.add(el({ tag: "div" }).add(el({ tag: "dt", text: "업체명" }), el({ tag: "dd", text: "테스트 상호" })));
  }
  return root;
}

function census(root: El): ReturnType<typeof sanitizeCredentialCellCensus> {
  const raw = run<unknown>(buildCredentialCellCensusScript(COUPANG_CREDENTIAL_FIELDS, { readNonEmpty: true }), root);
  return sanitizeCredentialCellCensus(raw, COUPANG_CREDENTIAL_FIELD_IDS);
}

function read(root: El): { ok: boolean; values?: Record<string, string>; reason?: string; id?: string } {
  return run(buildCredentialCellReadScript(COUPANG_CREDENTIAL_FIELDS), root);
}

/* ───────────────────────────── the measured shape ───────────────────────────── */

describe("the column-headed table WING was measured to use", () => {
  it("resolves all three labels to their own value cell, one candidate each", () => {
    const c = census(wingIssuedTable());
    expect(credentialCellsResolved(c, COUPANG_CREDENTIAL_FIELD_IDS)).toMatchObject({ ok: true, reason: "OK" });
    for (const r of c.readings) {
      expect(r).toMatchObject({ association: "TH_COLUMN_TD", candidateCellCount: 1, cellTag: "TD", cellNonEmpty: true });
    }
  });

  it("reads each label's OWN column — not the first cell three times", () => {
    const out = read(wingIssuedTable());
    expect(out.ok).toBe(true);
    expect(out.values).toEqual({ vendor_id: VENDOR, access_key: ACCESS, secret_key: SECRET });
  });

  it("the census carries no value anywhere in what it returns", () => {
    // The whole boundary, in one assertion: serialize everything that crossed it and look for the secrets.
    const serialized = JSON.stringify(census(wingIssuedTable()));
    for (const secret of [VENDOR, ACCESS, SECRET]) expect(serialized).not.toContain(secret);
  });

  it("the census script's own body contains no expression that returns cell text", () => {
    // The census reaches a value only through `cellNonEmpty`, which collapses it to a boolean inside the page.
    // The read terminal is the only one that writes `cellText(...)` into something returned.
    const censusBody = buildCredentialCellCensusScript(COUPANG_CREDENTIAL_FIELDS, { readNonEmpty: true });
    const terminal = censusBody.slice(censusBody.lastIndexOf("var SPECS"));
    expect(terminal).not.toContain("cellText(");
    expect(buildCredentialCellReadScript(COUPANG_CREDENTIAL_FIELDS)).toContain("cellText(");
  });
});

describe("the row-headed shape, which is tried first and cannot fire on a header row", () => {
  it("resolves a `th`/`td` pair beside each other", () => {
    const root = el({ tag: "table" }).add(
      el({ tag: "tr" }).add(el({ tag: "th", text: "업체코드" }), el({ tag: "td", text: VENDOR })),
      el({ tag: "tr" }).add(el({ tag: "th", text: "Access Key" }), el({ tag: "td", text: ACCESS })),
      el({ tag: "tr" }).add(el({ tag: "th", text: "Secret Key" }), el({ tag: "td", text: SECRET })),
    );
    const wrapper = el({ tag: "div" }).add(root);
    for (const r of census(wrapper).readings) expect(r.association).toBe("TH_NEXT_TD");
    expect(read(wrapper).values).toEqual({ vendor_id: VENDOR, access_key: ACCESS, secret_key: SECRET });
  });
});

describe("a value in a readonly input rather than in text", () => {
  it("is read from the field, and the census reports the field count that chose that extraction", () => {
    const head = el({ tag: "tr" }).add(
      el({ tag: "th", text: "업체코드" }),
      el({ tag: "th", text: "Access Key" }),
      el({ tag: "th", text: "Secret Key" }),
    );
    const body = el({ tag: "tr" }).add(
      el({ tag: "td" }).add(el({ tag: "input", value: VENDOR })),
      el({ tag: "td" }).add(el({ tag: "input", value: ACCESS })),
      el({ tag: "td" }).add(el({ tag: "input", value: SECRET })),
    );
    const root = el({ tag: "div" }).add(el({ tag: "table" }).add(head, body));
    for (const r of census(root).readings) expect(r).toMatchObject({ cellInputCount: 1, cellNonEmpty: true });
    expect(read(root).values).toEqual({ vendor_id: VENDOR, access_key: ACCESS, secret_key: SECRET });
  });
});

/* ───────────────────────────── every fail-closed axis ───────────────────────────── */

describe("it refuses rather than guessing", () => {
  it("two body rows: the column resolves TWO candidates, and two is not one", () => {
    const root = wingIssuedTable();
    const tbody = root.querySelectorAll("tbody")[0]!;
    tbody.add(el({ tag: "tr" }).add(el({ tag: "td", text: "X1" }), el({ tag: "td", text: "X2" }), el({ tag: "td", text: "X3" })));
    const c = census(root);
    expect(c.readings.every((r) => r.candidateCellCount === 2)).toBe(true);
    expect(credentialCellsResolved(c, COUPANG_CREDENTIAL_FIELD_IDS)).toMatchObject({ ok: false, reason: "CELL_NOT_UNIQUE" });
    expect(read(root)).toMatchObject({ ok: false, reason: "CELL_NOT_UNIQUE" });
  });

  it("an empty value cell is not a value — the calibration would otherwise certify a locator that reads nothing", () => {
    const root = wingIssuedTable({ secret: "   " });
    const c = census(root);
    expect(c.readings.find((r) => r.id === "secret_key")?.cellNonEmpty).toBe(false);
    expect(credentialCellsResolved(c, COUPANG_CREDENTIAL_FIELD_IDS)).toMatchObject({ ok: false, reason: "CELL_EMPTY", id: "secret_key" });
    expect(read(root)).toMatchObject({ ok: false, reason: "CELL_EMPTY", id: "secret_key" });
  });

  it("a duplicated label matches twice and resolves nothing", () => {
    const root = wingIssuedTable();
    root.add(el({ tag: "span", text: "Access Key" }));
    const c = census(root);
    expect(c.readings.find((r) => r.id === "access_key")?.labelVisibleCount).toBe(2);
    expect(credentialCellsResolved(c, COUPANG_CREDENTIAL_FIELD_IDS)).toMatchObject({ ok: false, reason: "LABEL_NOT_UNIQUE" });
    expect(read(root)).toMatchObject({ ok: false, reason: "LABEL_NOT_UNIQUE" });
  });

  it("a label that paints nowhere is a miss with a hidden count, not a silent zero", () => {
    const root = wingIssuedTable();
    const c = census(root);
    expect(c.readings.every((r) => r.labelVisibleCount === 1)).toBe(true);
    const hiddenRoot = el({ tag: "div" }).add(
      el({ tag: "th", text: "업체코드", display: "none", rects: 0 }),
      el({ tag: "th", text: "Access Key", display: "none", rects: 0 }),
      el({ tag: "th", text: "Secret Key", display: "none", rects: 0 }),
    );
    const hidden = census(hiddenRoot);
    expect(hidden.readings.every((r) => r.labelVisibleCount === 0 && r.labelHiddenCount === 1)).toBe(true);
  });

  it("a label outside any table has no association at all", () => {
    const root = el({ tag: "div" }).add(
      el({ tag: "div", text: "업체코드" }),
      el({ tag: "div", text: "Access Key" }),
      el({ tag: "div", text: "Secret Key" }),
    );
    expect(census(root).readings.every((r) => r.association === "NONE")).toBe(true);
    expect(read(root)).toMatchObject({ ok: false, reason: "NO_ASSOCIATION" });
  });

  it("a cell holding two fields says which one it is not — the extraction has no rule for it", () => {
    const head = el({ tag: "tr" }).add(
      el({ tag: "th", text: "업체코드" }),
      el({ tag: "th", text: "Access Key" }),
      el({ tag: "th", text: "Secret Key" }),
    );
    const body = el({ tag: "tr" }).add(
      el({ tag: "td" }).add(el({ tag: "input", value: VENDOR }), el({ tag: "input", value: "other" })),
      el({ tag: "td", text: ACCESS }),
      el({ tag: "td", text: SECRET }),
    );
    const root = el({ tag: "div" }).add(el({ tag: "table" }).add(head, body));
    expect(credentialCellsResolved(census(root), COUPANG_CREDENTIAL_FIELD_IDS)).toMatchObject({
      ok: false,
      reason: "CELL_SHAPE_AMBIGUOUS",
      id: "vendor_id",
    });
    expect(read(root)).toMatchObject({ ok: false, reason: "CELL_SHAPE_AMBIGUOUS", id: "vendor_id" });
  });

  it("two labels resolving to ONE cell is a collision, marked on both", () => {
    // A single-cell row: every column index past 0 is absent, so only the first label resolves — the collision
    // shape is built directly instead, with two header cells sharing one body cell by index 0.
    const head = el({ tag: "tr" }).add(el({ tag: "th", text: "업체코드" }));
    const head2 = el({ tag: "tr" }).add(el({ tag: "th", text: "Access Key" }));
    const body = el({ tag: "tr" }).add(el({ tag: "td", text: VENDOR }));
    const root = el({ tag: "div" }).add(
      el({ tag: "table" }).add(head, head2, body),
      el({ tag: "span", text: "Secret Key" }),
    );
    const c = census(root);
    const vendor = c.readings.find((r) => r.id === "vendor_id");
    const access = c.readings.find((r) => r.id === "access_key");
    expect(vendor?.cellDuplicate).toBe(true);
    expect(access?.cellDuplicate).toBe(true);
    expect(credentialCellsResolved(c, COUPANG_CREDENTIAL_FIELD_IDS).ok).toBe(false);
    expect(read(root).ok).toBe(false);
  });
});

describe("the whole set has to agree — the defect review found, with its own repro", () => {
  /**
   * The header row carries a trailing `<td>` (a copy button's cell, on a real page). The LAST `<th>`'s next
   * sibling is then a `td`, so `secret_key` resolves row-headed while the other two resolve column-headed — and
   * reads the cell beside it. Every per-field check passed: three unique labels, one candidate each, all
   * non-empty, three DISTINCT strings. The button's label would have been stored as the Secret Key, on an
   * account that then refuses to be overwritten, with the one-shot read already burned.
   */
  function trailingCellTable(): El {
    const head = el({ tag: "tr" }).add(
      el({ tag: "th", text: "업체코드" }),
      el({ tag: "th", text: "Access Key" }),
      el({ tag: "th", text: "Secret Key" }),
      el({ tag: "td", text: "복사" }),
    );
    const body = el({ tag: "tr" }).add(
      el({ tag: "td", text: VENDOR }),
      el({ tag: "td", text: ACCESS }),
      el({ tag: "td", text: SECRET }),
    );
    return el({ tag: "div" }).add(el({ tag: "table" }).add(head, body));
  }

  it("the census shows the mixed shape rather than three clean readings", () => {
    const c = census(trailingCellTable());
    expect(new Set(c.readings.map((r) => r.association)).size).toBe(2);
  });

  it("**it refuses** — ASSOCIATION_MIXED, before any value is taken", () => {
    const root = trailingCellTable();
    expect(credentialCellsResolved(census(root), COUPANG_CREDENTIAL_FIELD_IDS)).toMatchObject({
      ok: false,
      reason: "ASSOCIATION_MIXED",
    });
    expect(read(root)).toMatchObject({ ok: false, reason: "ASSOCIATION_MIXED" });
  });

  it("and the value it WOULD have read is not in the refusal", () => {
    expect(JSON.stringify(read(trailingCellTable()))).not.toContain("복사");
  });

  it("three labels in three different tables is not one credential region", () => {
    const t = (label: string, value: string): El =>
      el({ tag: "table" }).add(el({ tag: "tr" }).add(el({ tag: "th", text: label }), el({ tag: "td", text: value })));
    const root = el({ tag: "div" }).add(t("업체코드", VENDOR), t("Access Key", ACCESS), t("Secret Key", SECRET));
    expect(credentialCellsResolved(census(root), COUPANG_CREDENTIAL_FIELD_IDS)).toMatchObject({
      ok: false,
      reason: "TABLE_MIXED",
    });
    expect(read(root)).toMatchObject({ ok: false, reason: "TABLE_MIXED" });
  });
});

describe("a page too big to scan is refused, not scanned partway", () => {
  it("SCAN_TRUNCATED — the old cap turned 'matched twice' into 'matched once'", () => {
    // The fail-OPEN review demonstrated: past the cap a second matching label was neither counted as visible
    // nor as hidden, so the uniqueness guard read 1 and the first match won.
    const root = wingIssuedTable();
    for (let i = 0; i < 20_001; i++) root.add(el({ tag: "span", text: `filler-${i}` }));
    const c = census(root);
    expect(c.readings.every((r) => r.scanTruncated === true)).toBe(true);
    expect(credentialCellsResolved(c, COUPANG_CREDENTIAL_FIELD_IDS)).toMatchObject({ ok: false, reason: "SCAN_TRUNCATED" });
    expect(read(root)).toMatchObject({ ok: false, reason: "SCAN_TRUNCATED" });
  });
});

describe("the sanitizer is the boundary, not the script's good manners", () => {
  it("drops a value smuggled into any field — none of them has a shape that accepts one", () => {
    const smuggled = sanitizeCredentialCellCensus(
      {
        readings: [
          {
            id: "access_key",
            labelVisibleCount: 1,
            labelHiddenCount: 0,
            labelTag: ACCESS,
            association: "TH_COLUMN_TD",
            candidateCellCount: 1,
            cellTag: ACCESS,
            cellInputCount: 0,
            cellNonEmpty: true,
            extra: SECRET,
          },
        ],
      },
      ["access_key"],
    );
    expect(JSON.stringify(smuggled)).not.toContain(ACCESS);
    expect(JSON.stringify(smuggled)).not.toContain(SECRET);
  });

  it("a reading the page never answered is unresolved, not partially trusted", () => {
    const c = sanitizeCredentialCellCensus({ readings: [] }, COUPANG_CREDENTIAL_FIELD_IDS);
    expect(c.readings).toHaveLength(3);
    expect(credentialCellsResolved(c, COUPANG_CREDENTIAL_FIELD_IDS)).toMatchObject({ ok: false, reason: "LABEL_NOT_UNIQUE" });
  });

  it("an unmeasured input count is not a zero — a census that never answered licenses no extraction", () => {
    const c = sanitizeCredentialCellCensus(
      {
        readings: [
          { id: "access_key", labelVisibleCount: 1, labelHiddenCount: 0, association: "TH_COLUMN_TD", candidateCellCount: 1, cellNonEmpty: true },
        ],
      },
      ["access_key"],
    );
    expect(credentialCellsResolved(c, ["access_key"])).toMatchObject({ ok: false, reason: "CELL_SHAPE_AMBIGUOUS" });
  });
});


/* ─────────────── what the 2026-08-13 calibration refused on, and what the next one has to answer ─────────────── */

const VENDOR_LABELS = [
  { candidateQuery: "label,span,div,dt,th,strong", exactText: "업체명" },
  { candidateQuery: "label,span,div,dt,th,strong", exactText: "IP주소" },
  { candidateQuery: "label,span,div,dt,th,strong", exactText: "URL" },
];

function scope(root: El): ReturnType<typeof sanitizeCredentialRegionScope> {
  return sanitizeCredentialRegionScope(
    run<unknown>(buildCredentialRegionScopeScript(COUPANG_CREDENTIAL_FIELDS, VENDOR_LABELS, 6), root),
  );
}

/**
 * The live shape, as far as the readings describe it: one table, the credential header row + its value row,
 * and a NARROWER `td`-bearing row that covers 업체코드's column index but not the other two. That is the only
 * arrangement consistent with `candidateCellCount` being 2 / 1 / 1, and it is a HYPOTHESIS — which is exactly
 * why the census now reports each candidate's row and width instead of a bare count.
 */
function narrowSecondRowTable(): El {
  const head = el({ tag: "tr" }).add(
    el({ tag: "th", text: "업체코드" }),
    el({ tag: "th", text: "Access Key" }),
    el({ tag: "th", text: "Secret Key" }),
  );
  const values = el({ tag: "tr" }).add(
    el({ tag: "td", text: VENDOR }),
    el({ tag: "td", text: ACCESS }),
    el({ tag: "td", text: SECRET }),
  );
  const narrow = el({ tag: "tr" }).add(el({ tag: "td", text: "연동 정보수정" }));
  return el({ tag: "div" }).add(
    el({ tag: "table" }).add(el({ tag: "thead" }).add(head), el({ tag: "tbody" }).add(values, narrow)),
  );
}

describe("the candidate detail says WHY a column resolved to more than one cell", () => {
  it("reports each candidate's row, section and width — a bare count says nothing", () => {
    const c = census(narrowSecondRowTable());
    const vendor = c.readings.find((r) => r.id === "vendor_id");
    expect(vendor?.candidateCellCount).toBe(2);
    expect(vendor?.labelColumnIndex).toBe(0);
    // The two candidates differ in the one way that explains the count: their rows are different WIDTHS.
    expect(vendor?.candidateCells?.map((x) => x.rowCellCount)).toEqual([3, 1]);
    // …and the other two labels resolve uniquely, because the narrow row does not reach their column.
    expect(c.readings.find((r) => r.id === "access_key")?.candidateCellCount).toBe(1);
    expect(c.readings.find((r) => r.id === "secret_key")?.candidateCellCount).toBe(1);
  });

  it("still REFUSES — the detail explains the ambiguity, it does not resolve it", () => {
    // Nothing here picks the wider row. A rule that did would be written from one screen, which is the move
    // this workstream has twice withdrawn.
    expect(credentialCellsResolved(census(narrowSecondRowTable()), COUPANG_CREDENTIAL_FIELD_IDS)).toMatchObject({
      ok: false,
      reason: "CELL_NOT_UNIQUE",
      id: "vendor_id",
    });
    expect(read(narrowSecondRowTable())).toMatchObject({ ok: false, reason: "CELL_NOT_UNIQUE" });
  });

  it("carries no value in the candidate detail", () => {
    const serialized = JSON.stringify(census(narrowSecondRowTable()));
    for (const secret of [VENDOR, ACCESS, SECRET]) expect(serialized).not.toContain(secret);
  });
});

describe("the region scope — the measurement D1 rests on", () => {
  it("finds the level holding the keys when the vendor block is OUTSIDE the table", () => {
    const root = wingIssuedTable(); // its vendor block is a sibling `div`, not part of the table
    const s = scope(root);
    expect(s.anchorResolved).toBe(true);
    expect(s.resolvedCellCount).toBe(3);
    const clean = chooseCredentialRegion(s, 3);
    expect(clean, "a clean level exists on this shape").not.toBeNull();
    expect(clean!.vendorLabelCount).toBe(0);
    expect(clean!.credentialCellCount).toBe(3);
  });

  it("**answers null when every level that holds the keys also holds the vendor block**", () => {
    // The live shape, modelled from the readings: ONE table holding the credential header + value rows AND a
    // narrow row whose single cell carries the 연동 정보 block. `WING_CREDENTIAL_REGION_EVIDENCE` measured
    // exactly this from the label side (`excludeCount: 2` at TABLE); this scores it from the value side.
    const head = el({ tag: "tr" }).add(
      el({ tag: "th", text: "업체코드" }),
      el({ tag: "th", text: "Access Key" }),
      el({ tag: "th", text: "Secret Key" }),
    );
    const values = el({ tag: "tr" }).add(
      el({ tag: "td", text: VENDOR }),
      el({ tag: "td", text: ACCESS }),
      el({ tag: "td", text: SECRET }),
    );
    const vendorRow = el({ tag: "tr" }).add(
      el({ tag: "td" }).add(
        el({ tag: "span", text: "업체명" }),
        el({ tag: "span", text: "IP주소" }),
        el({ tag: "span", text: "URL" }),
      ),
    );
    const root = el({ tag: "div" }).add(
      el({ tag: "table" }).add(el({ tag: "thead" }).add(head), el({ tag: "tbody" }).add(values, vendorRow)),
    );
    const s = scope(root);
    // 업체코드's column reaches the narrow row too, so only two cells resolve — and the scope says so rather
    // than pretending the anchor is complete.
    expect(s.anchorResolved).toBe(true);
    expect(s.resolvedCellCount).toBe(2);
    // No level holds every credential label AND every resolved value AND none of the vendor labels.
    expect(chooseCredentialRegion(s, 3)).toBeNull();
    // The rows are the evidence for that, not an assertion about it.
    expect(s.rows.some((r) => r.vendorLabelCount > 0)).toBe(true);
  });

  it("carries no value — depths, tag names and three integers", () => {
    const serialized = JSON.stringify(scope(wingIssuedTable()));
    for (const secret of [VENDOR, ACCESS, SECRET]) expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain("cellText");
  });

  it("an unresolvable anchor scores nothing rather than guessing a level", () => {
    const root = el({ tag: "div" }).add(el({ tag: "div", text: "업체코드" }));
    expect(scope(root)).toEqual({ anchorResolved: false, resolvedCellCount: 0, rows: [] });
    expect(chooseCredentialRegion(scope(root), 3)).toBeNull();
  });
});
