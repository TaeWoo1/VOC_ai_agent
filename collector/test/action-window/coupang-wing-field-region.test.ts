/**
 * The fixed-label REGION census — the instrument that has to run before either of the 2026-08-12 live defects
 * can be fixed without guessing (`확인` ringed over an empty form; step ⑧ anchored on a table header).
 *
 * As with the visibility filter, these cases execute the REAL generated script against a fake DOM rather than
 * skipping under `RUN_INTEGRATION`: a census whose discipline is only asserted in prose is exactly the kind of
 * apparatus this workstream has had to withdraw before.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildFieldRegionCensusScript } from "../../src/action-window/api-issuance-calibration/field-region-inpage";
import {
  FIELD_REGION_ANCESTOR_DEPTH,
  sanitizeFieldRegionCensus,
  type FieldRegionRequest,
} from "../../src/action-window/coupang-wing-field-region";

interface ElInit {
  tag: string;
  text?: string;
  children?: El[];
  attrs?: Record<string, string>;
  value?: string;
  type?: string;
  display?: string;
  rects?: number;
}

class El {
  readonly tagName: string;
  readonly children: El[] = [];
  parentElement: El | null = null;
  readonly value: string;
  private readonly ownText: string;
  private readonly attrs: Map<string, string>;
  private readonly display: string;
  private readonly rects: number;

  constructor(init: ElInit) {
    this.tagName = init.tag.toUpperCase();
    this.ownText = init.text ?? "";
    this.value = init.value ?? "";
    this.attrs = new Map(Object.entries({ ...(init.attrs ?? {}), ...(init.type ? { type: init.type } : {}) }));
    this.display = init.display ?? "block";
    this.rects = init.rects ?? 1;
    for (const c of init.children ?? []) {
      c.parentElement = this;
      this.children.push(c);
    }
  }

  get textContent(): string {
    return this.ownText + this.children.map((c) => c.textContent).join("");
  }
  get childElementCount(): number {
    return this.children.length;
  }
  get nextElementSibling(): El | null {
    const sibs = this.parentElement?.children ?? [];
    const i = sibs.indexOf(this);
    return i >= 0 && i + 1 < sibs.length ? sibs[i + 1]! : null;
  }
  getAttribute(n: string): string | null {
    return this.attrs.has(n) ? this.attrs.get(n)! : null;
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
  descendants(): El[] {
    return this.children.flatMap((c) => [c, ...c.descendants()]);
  }
  querySelectorAll(sel: string): El[] {
    return matchAll(this.descendants(), sel);
  }
  querySelector(sel: string): El | null {
    return this.querySelectorAll(sel)[0] ?? null;
  }
}

/** Enough selector support for the queries this script actually issues — tag lists, and `a[role="button"]`. */
function matchAll(pool: readonly El[], sel: string): El[] {
  const wanted = sel.split(",").map((s) => s.trim());
  return pool.filter((e) =>
    wanted.some((w) => {
      if (w === 'a[role="button"]') return e.tagName === "A" && e.getAttribute("role") === "button";
      return e.tagName === w.toUpperCase();
    }),
  );
}

function runCensus(requests: readonly FieldRegionRequest[], roots: readonly El[]): unknown {
  const all = roots.flatMap((r) => [r, ...r.descendants()]);
  const document = {
    querySelectorAll: (sel: string): El[] => matchAll(all, sel),
    getElementById: (id: string): El | null => all.find((e) => e.getAttribute("id") === id) ?? null,
  };
  const window = { getComputedStyle: (el: El) => el.computedStyle() };
  return new Function("document", "window", `return (${buildFieldRegionCensusScript(requests)});`)(document, window);
}

function census(requests: readonly FieldRegionRequest[], roots: readonly El[]) {
  return sanitizeFieldRegionCensus(runCensus(requests, roots), requests.map((r) => r.id));
}

const DT_QUERY = "label,span,div,dt,th,strong";

/** The vendor form, in the shape the 2026-08-12 sweep measured it: 업체명 read as a `DT`. */
function vendorForm(opts: { vendorValue?: string; urlValue?: string; ipEntries?: number } = {}) {
  return new El({
    tag: "dl",
    children: [
      new El({ tag: "dt", text: "업체명" }),
      new El({ tag: "dd", children: [new El({ tag: "input", type: "text", value: opts.vendorValue ?? "" })] }),
      new El({ tag: "dt", text: "URL" }),
      new El({ tag: "dd", children: [new El({ tag: "input", type: "url", value: opts.urlValue ?? "" })] }),
      new El({ tag: "dt", text: "IP 주소" }),
      new El({
        tag: "dd",
        children: [
          new El({ tag: "input", type: "text", value: "" }),
          new El({ tag: "button", text: "추가" }),
          new El({
            tag: "ul",
            children: new Array(opts.ipEntries ?? 0).fill(0).map(() => new El({ tag: "li", text: "0.0.0.0" })),
          }),
        ],
      }),
    ],
  });
}

const VENDOR_REQ: readonly FieldRegionRequest[] = [
  { id: "vendor_info", candidateQuery: DT_QUERY, exactText: "업체명", readFilled: true },
  { id: "vendor_url", candidateQuery: DT_QUERY, exactText: "URL", readFilled: true },
  { id: "call_ip", candidateQuery: DT_QUERY, exactText: "IP 주소", readFilled: true },
];

describe("the vendor form's structure, as the census reads it", () => {
  it("ties each `DT` label to the `DD` that follows it, and counts its fields", () => {
    const { readings } = census(VENDOR_REQ, [vendorForm()]);
    expect(readings.map((r) => r.id)).toEqual(["vendor_info", "vendor_url", "call_ip"]);
    for (const r of readings) {
      expect(r.visibleCount, r.id).toBe(1);
      expect(r.observedTag, r.id).toBe("DT");
      expect(r.association, r.id).toBe("DT_NEXT_DD");
      expect(r.regionTag, r.id).toBe("DD");
    }
    expect(readings[0]!.textInputCount).toBe(1);
    // The IP region is the one that also carries a control and a list — which is what makes "추가 was pressed"
    // observable at all.
    expect(readings[2]!.buttonCount).toBe(1);
  });

  it("**counts how many fields are non-empty, and never what is in them**", () => {
    const empty = census(VENDOR_REQ, [vendorForm()]);
    expect(empty.readings[0]!.filledTextInputCount).toBe(0);
    expect(empty.readings[1]!.filledTextInputCount).toBe(0);

    const typed = census(VENDOR_REQ, [vendorForm({ vendorValue: "내 회사", urlValue: "https://example.test" })]);
    expect(typed.readings[0]!.filledTextInputCount).toBe(1);
    expect(typed.readings[1]!.filledTextInputCount).toBe(1);
    // The whole census, serialized, contains neither value — the emptiness crossed the boundary and nothing else.
    const dump = JSON.stringify(typed);
    expect(dump).not.toContain("내 회사");
    expect(dump).not.toContain("example.test");
  });

  it("whitespace is not a filled field — a space typed into 업체명 is still empty", () => {
    const { readings } = census(VENDOR_REQ, [vendorForm({ vendorValue: "   " })]);
    expect(readings[0]!.filledTextInputCount).toBe(0);
  });

  it("**counts registered entries** — which is how a pressed 추가 is observable without reading the address", () => {
    expect(census(VENDOR_REQ, [vendorForm()]).readings[2]!.entryRowCount).toBe(0);
    const added = census(VENDOR_REQ, [vendorForm({ ipEntries: 2 })]);
    expect(added.readings[2]!.entryRowCount).toBe(2);
    expect(JSON.stringify(added)).not.toContain("0.0.0.0");
  });

  it("**a value is never read for a candidate that did not ask for it**", () => {
    const noFlag: readonly FieldRegionRequest[] = [{ id: "vendor_info", candidateQuery: DT_QUERY, exactText: "업체명" }];
    const { readings } = census(noFlag, [vendorForm({ vendorValue: "내 회사" })]);
    expect(readings[0]!.textInputCount).toBe(1);
    expect(readings[0]!.filledTextInputCount).toBeUndefined();
  });
});

describe("the credential region's structure, as the census reads it", () => {
  /** The issued screen, in the shape step ⑧ met live: `Access Key` matched a `TH`, so the ring hit a header. */
  const issuedTable = new El({
    tag: "table",
    children: [
      new El({ tag: "thead", children: [new El({ tag: "tr", children: [new El({ tag: "th", text: "Access Key" })] })] }),
      new El({ tag: "tbody", children: [new El({ tag: "tr", children: [new El({ tag: "td", text: "REDACTED-KEY" })] })] }),
    ],
  });

  it("reports the ancestor chain that says the header sits in a table", () => {
    const { readings } = census(
      [{ id: "credentials", candidateQuery: DT_QUERY, exactText: "Access Key" }],
      [issuedTable],
    );
    const r = readings[0]!;
    expect(r.visibleCount).toBe(1);
    expect(r.observedTag).toBe("TH");
    // This chain is the finding: the anchor is a header cell, and the result the seller must copy is elsewhere.
    expect(r.ancestorTags).toEqual(["TR", "THEAD", "TABLE"]);
    expect(r.ancestorTags!.length).toBeLessThanOrEqual(FIELD_REGION_ANCESTOR_DEPTH);
  });

  it("**never reads a credential's value** — the census carries no key material", () => {
    const out = census([{ id: "credentials", candidateQuery: DT_QUERY, exactText: "Access Key" }], [issuedTable]);
    expect(JSON.stringify(out)).not.toContain("REDACTED-KEY");
    expect(out.readings[0]!.filledTextInputCount).toBeUndefined();
  });
});

describe("the sanitizer is the boundary", () => {
  it("drops anything that is not a tag name, a count, or a known association", () => {
    const raw = {
      readings: [
        {
          id: "x",
          visibleCount: 1,
          hiddenCount: 0,
          observedTag: "somebody's name",
          ancestorTags: ["TR", "not a tag", "TABLE"],
          association: "GUESSED_FROM_TEXT",
          regionTag: "DD",
          inputCount: -3,
          textInputCount: 1.5,
          filledTextInputCount: 1,
          leaked: "seller@example.test",
        },
      ],
    };
    const out = sanitizeFieldRegionCensus(raw, ["x"]);
    const r = out.readings[0]!;
    expect(r.observedTag).toBeUndefined();
    expect(r.ancestorTags).toEqual(["TR", "TABLE"]);
    // An unknown association is not passed through as an unknown association — it fails closed to NONE, and a
    // NONE has no region, so no region-shaped claim survives it either.
    expect(r.association).toBe("NONE");
    expect(r.regionTag).toBeUndefined();
    expect(r.inputCount).toBeUndefined();
    expect(r.textInputCount).toBeUndefined();
    expect(JSON.stringify(out)).not.toContain("example.test");
  });

  it("**an unanswered candidate reads as NOT visible** rather than as missing", () => {
    // The calling rule is "is the form ready". A page that does not answer must read as not ready, so every
    // requested id comes back, and a page that answered about something else contributes nothing.
    const out = sanitizeFieldRegionCensus({ readings: [{ id: "other", visibleCount: 1 }] }, ["a", "b"]);
    expect(out.readings.map((r) => r.id)).toEqual(["a", "b"]);
    expect(out.readings.every((r) => r.visibleCount === 0)).toBe(true);
    expect(sanitizeFieldRegionCensus(null, ["a"]).readings[0]).toEqual({ id: "a", visibleCount: 0, hiddenCount: 0 });
  });

  it("a non-unique match carries no structure — two matches identify nothing", () => {
    const out = sanitizeFieldRegionCensus(
      { readings: [{ id: "a", visibleCount: 2, hiddenCount: 1, association: "DT_NEXT_DD", regionTag: "DD" }] },
      ["a"],
    );
    expect(out.readings[0]).toEqual({ id: "a", visibleCount: 2, hiddenCount: 1 });
  });
});

describe("what step ⑧ anchors its ring on", () => {
  it("**frames the credential TABLE, not the header row it used to** — the 2026-08-12 defect", async () => {
    const { WING_HIGHLIGHT_LABELS } = await import("../../src/action-window/coupang-wing-issuance-driver");
    // `tr` resolved to the HEADER row, because the live reading of this label came back `observedTag: "TH"`.
    // The ring framed the words `Access Key` while the panel said to copy three values that were outside it.
    expect(WING_HIGHLIGHT_LABELS.credentials.tagAncestor).toBe("table");
    expect(WING_HIGHLIGHT_LABELS.credentials.tagAncestor).not.toBe("tr");
    // …and the ancestor is guaranteed to exist by the measurement itself: a TH is only a TH inside a table.
    const { readings } = census(
      [
        {
          id: "credentials",
          candidateQuery: WING_HIGHLIGHT_LABELS.credentials.candidateQuery,
          exactText: WING_HIGHLIGHT_LABELS.credentials.exactText,
        },
      ],
      [
        new El({
          tag: "table",
          children: [
            new El({ tag: "thead", children: [new El({ tag: "tr", children: [new El({ tag: "th", text: "Access Key" })] })] }),
          ],
        }),
      ],
    );
    expect(readings[0]!.observedTag).toBe("TH");
    expect(readings[0]!.ancestorTags).toContain("TABLE");
  });

  it("**the credential census never asks for a filled-field count** — nothing here reads the keys", async () => {
    // `readFilled` is opt-in per candidate precisely so this stays checkable rather than remembered.
    const src = readFileSync(resolve(__dirname, "../../src/action-window/coupang-wing-issuance-driver.ts"), "utf8");
    const from = src.indexOf("private async logCredentialRegion");
    const fn = src.slice(from, src.indexOf("\n  /**", from + 10));
    expect(from).toBeGreaterThan(0);
    expect(fn).not.toContain("readFilled");
  });
});

describe("the in-page script's own discipline", () => {
  const src = readFileSync(
    resolve(__dirname, "../../src/action-window/api-issuance-calibration/field-region-inpage.ts"),
    "utf8",
  );

  it("**reads `.value` in exactly one place, and returns a count from it**", () => {
    // The one line that touches a value at all. If a second appears, this file's whole claim needs re-reading.
    const valueReads = src.split("\n").filter((l) => l.includes(".value") && !l.trimStart().startsWith("*"));
    expect(valueReads).toHaveLength(1);
    expect(valueReads[0]).toContain("norm(fields[fi].value).length > 0");
  });

  it("performs no action — it is a census, not a driver", () => {
    for (const forbidden of [".click(", ".focus(", ".submit(", "setAttribute", "dispatchEvent", "innerHTML"]) {
      expect(src, forbidden).not.toContain(forbidden);
    }
  });
});
