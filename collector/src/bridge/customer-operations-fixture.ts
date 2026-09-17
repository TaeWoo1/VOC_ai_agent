/**
 * **The surface a scheduled run is allowed to look at: one Reviewnary owns.**
 *
 * The Scheduled Aside proof needs a page that a job can open with nobody watching. It must not be a
 * marketplace — not the seller's real store under a read-only promise, but a page this repository writes,
 * serves on loopback, and can change on demand so «nothing changed» and «this exact thing changed» are
 * distinguishable observations rather than assertions about someone else's website.
 *
 * <b>What this page is.</b> Deterministic, synthetic, generic. No marketplace HTML, trademark, seller data,
 * customer sentence, credential or copied platform content — the same rule `action-window/fixture.ts` states
 * for its own fixture, restated here because this one is served over HTTP rather than injected into a page.
 * The items are opaque refs and a closed state word; there is nothing on it worth protecting, which is what
 * makes it safe to read unattended.
 *
 * <b>The contract with the recipe.</b> `data-co-surface` on the root says «this is the page we own» — the
 * recipe refuses to report an empty reading without it, so pointing the job at any other page yields
 * SURFACE_UNREADABLE instead of «0 items». Each row carries `data-co-item` (a stable ref) and `data-co-state`.
 */

/** A state word the fixture may print. Closed: the recipe reads these and nothing else. */
export const FIXTURE_ITEM_STATES = ["NEW", "SETTLED"] as const;
export type FixtureItemState = (typeof FIXTURE_ITEM_STATES)[number];

export interface FixtureItem {
  readonly ref: string;
  readonly state: FixtureItemState;
}

/**
 * The three datasets the unattended acceptance needs, by name:
 * `initial` — first read, everything is new;
 * `unchanged` — byte-identical to `initial`, so a second run must find no new item;
 * `changed` — `initial` plus exactly one added item, so a third run must find exactly that one.
 */
export type FixtureDataset = "initial" | "unchanged" | "changed";

const INITIAL: readonly FixtureItem[] = Object.freeze([
  { ref: "co-0001", state: "NEW" },
  { ref: "co-0002", state: "SETTLED" },
  { ref: "co-0003", state: "SETTLED" },
]);

/** The one item that separates `changed` from `initial`. Named so a test can assert the exact difference. */
export const FIXTURE_ADDED_REF = "co-0004" as const;

export function fixtureItems(dataset: FixtureDataset): readonly FixtureItem[] {
  if (dataset === "changed") {
    return Object.freeze([...INITIAL, { ref: FIXTURE_ADDED_REF, state: "NEW" } as FixtureItem]);
  }
  // `unchanged` is deliberately the SAME list as `initial` — a second read of an unmoved surface.
  return INITIAL;
}

export function isFixtureDataset(value: unknown): value is FixtureDataset {
  return value === "initial" || value === "unchanged" || value === "changed";
}

/** Escaped even though every value here is ours: a page that only escapes untrusted input escapes nothing. */
function attr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * The page, as a whole document. No script, no network, no storage: a scheduled browser job opens it, reads
 * attributes, and closes it. Nothing on this page can do anything to the machine that renders it.
 */
export function renderCustomerOperationsFixture(dataset: FixtureDataset): string {
  const rows = fixtureItems(dataset)
    .map(
      (item) =>
        `<li data-co-item="${attr(item.ref)}" data-co-state="${attr(item.state)}">` +
        `<span class="ref">${attr(item.ref)}</span> <span class="state">${attr(item.state)}</span></li>`,
    )
    .join("\n      ");
  return `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <title>고객 운영 점검용 화면</title>
    <style>
      body { font: 14px system-ui, sans-serif; margin: 24px; color: #1f2933; }
      ul { list-style: none; padding: 0; }
      li { padding: 6px 0; border-bottom: 1px solid #e4e7eb; }
      .state { color: #616e7c; }
    </style>
  </head>
  <body data-co-surface="customer-operations-fixture" data-co-dataset="${attr(dataset)}">
    <h1>고객 운영 점검용 화면</h1>
    <p>이 화면은 Reviewnary가 만든 점검용 화면입니다. 실제 고객·주문·상품 정보는 들어 있지 않습니다.</p>
    <ul>
      ${rows}
    </ul>
  </body>
</html>
`;
}
