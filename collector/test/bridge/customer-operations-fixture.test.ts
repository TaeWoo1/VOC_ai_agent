/**
 * **The owned surface stays owned, and stays synthetic.**
 *
 * The scheduled proof rests on one claim: the page a job opens unattended belongs to this repository and holds
 * nothing of a seller's. These assertions pin that claim, and pin the three datasets the unattended acceptance
 * needs — because «unchanged» and «changed» are only meaningful if the fixture can actually be both.
 */
import { describe, expect, it } from "vitest";
import {
  FIXTURE_ADDED_REF,
  FIXTURE_ITEM_STATES,
  fixtureItems,
  isFixtureDataset,
  renderCustomerOperationsFixture,
} from "../../src/bridge/customer-operations-fixture";

describe("the owned fixture — the recipe's contract", () => {
  it("declares itself, so no other page can be read as an empty one", () => {
    expect(renderCustomerOperationsFixture("initial")).toContain('data-co-surface="customer-operations-fixture"');
  });

  it("prints every item as a ref and a closed state word", () => {
    const html = renderCustomerOperationsFixture("initial");
    for (const item of fixtureItems("initial")) {
      expect(html).toContain(`data-co-item="${item.ref}"`);
      expect(html).toContain(`data-co-state="${item.state}"`);
      expect(FIXTURE_ITEM_STATES).toContain(item.state);
    }
  });
});

describe("the owned fixture — the three unattended runs are distinguishable", () => {
  it("unchanged is the same reading as initial", () => {
    expect(fixtureItems("unchanged")).toEqual(fixtureItems("initial"));
    expect(renderCustomerOperationsFixture("unchanged").replace(/data-co-dataset="[a-z]+"/, ""))
      .toBe(renderCustomerOperationsFixture("initial").replace(/data-co-dataset="[a-z]+"/, ""));
  });

  it("changed adds exactly one item, and names which", () => {
    const before = fixtureItems("initial").map((i) => i.ref);
    const after = fixtureItems("changed").map((i) => i.ref);
    expect(after.filter((ref) => !before.includes(ref))).toEqual([FIXTURE_ADDED_REF]);
    expect(before.filter((ref) => !after.includes(ref))).toEqual([]);
  });

  it("refuses a dataset name it does not publish", () => {
    for (const bad of ["marketplace", "", null, 1, "INITIAL"]) expect(isFixtureDataset(bad)).toBe(false);
    for (const ok of ["initial", "unchanged", "changed"]) expect(isFixtureDataset(ok)).toBe(true);
  });
});

describe("the owned fixture — nothing of a seller's is on it", () => {
  const html = ["initial", "unchanged", "changed"]
    .map((d) => renderCustomerOperationsFixture(d as "initial"))
    .join("\n");

  it("names no marketplace", () => {
    for (const token of ["coupang", "naver", "cafe24", "smartstore", "wing", "쿠팡", "네이버", "카페24"]) {
      expect(html.toLowerCase(), `fixture names ${token}`).not.toContain(token.toLowerCase());
    }
  });

  it("carries no script, no network and no storage", () => {
    for (const token of ["<script", "fetch(", "XMLHttpRequest", "localStorage", "sessionStorage", "http://", "https://"]) {
      expect(html, `fixture contains ${token}`).not.toContain(token);
    }
  });

  it("says in the seller's language that it holds no real data", () => {
    expect(html).toContain("실제 고객·주문·상품 정보는 들어 있지 않습니다");
  });
});
