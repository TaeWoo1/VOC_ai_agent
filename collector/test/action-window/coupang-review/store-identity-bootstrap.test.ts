import { describe, expect, it } from "vitest";
import {
  BOOTSTRAP_TTL_MS,
  bootstrapOf,
  StoreIdentityBootstrapStore,
} from "../../../src/action-window/coupang-review/store-identity-bootstrap";
import { assertWingStore } from "../../../src/action-window/coupang-review/wing-store-identity";
import type { WingIdentityReading } from "../../../src/action-window/coupang-review/wing-identity-inpage";

const reading = (values: string[]): WingIdentityReading => ({
  labelHits: values.length,
  distinct: values.length,
  values,
});

/** What the run establishes when the backend had nothing to compare against. */
const bootstrap = (values: string[]) => bootstrapOf(assertWingStore(null, reading(values)), reading(values));

describe("store identity bootstrap — 0 / 1 / many, fail closed", () => {
  it("exactly one well-formed code is a candidate the seller can confirm", () => {
    expect(bootstrap(["A00123456"])).toEqual({ state: "CANDIDATE", value: "A00123456" });
  });

  it("nothing observed falls back to the seller typing it", () => {
    expect(bootstrap([])).toEqual({ state: "NONE" });
  });

  /**
   * Two codes on one screen is an ambiguity this product refuses to guess at, and deliberately does not
   * offer as a choice: a picker would ask the seller to arbitrate something we could not read correctly.
   */
  it("two or more is ambiguous — never a candidate, never a list to choose from", () => {
    expect(bootstrap(["A00123456", "A00999999"])).toEqual({ state: "AMBIGUOUS" });
    expect(bootstrap(["A1AA", "B2BB", "C3CC"])).toEqual({ state: "AMBIGUOUS" });
  });

  it("a token the comparison would refuse to fingerprint is not shown to a seller as their store", () => {
    expect(bootstrap(["a b"])).toEqual({ state: "NONE" });
    expect(bootstrap(["!!"])).toEqual({ state: "NONE" });
  });

  /**
   * The one situation this module is reachable in. A run that HAD an expectation is being compared, and its
   * answer is that comparison — not a new candidate to confirm.
   */
  it("says nothing at all when the backend did state an expectation", () => {
    const matched = assertWingStore("deadbeef", reading(["A00123456"]));
    expect(bootstrapOf(matched, reading(["A00123456"]))).toBeNull();
    const notObserved = assertWingStore("deadbeef", reading([]));
    expect(bootstrapOf(notObserved, reading([]))).toBeNull();
  });
});

describe("the store — short-lived, per slot, newest wins", () => {
  it("expires without being read, so an unconfirmed candidate stops existing", () => {
    let now = 1_000;
    const store = new StoreIdentityBootstrapStore(() => now);
    store.put("slot-a", { state: "CANDIDATE", value: "A00123456" });
    expect(store.peek("slot-a")).toEqual({ state: "CANDIDATE", value: "A00123456" });
    now += BOOTSTRAP_TTL_MS + 1;
    expect(store.peek("slot-a")).toBeNull();
    expect(store.latest()).toBeNull();
  });

  it("is cleared once the seller has confirmed — the raw value stops existing on purpose", () => {
    const store = new StoreIdentityBootstrapStore(() => 0);
    store.put("slot-a", { state: "CANDIDATE", value: "A00123456" });
    store.clear("slot-a");
    expect(store.peek("slot-a")).toBeNull();
  });

  it("keeps one entry per slot and lets the newest run win", () => {
    let now = 0;
    const store = new StoreIdentityBootstrapStore(() => now);
    store.put("slot-a", { state: "CANDIDATE", value: "A00000001" });
    now += 10;
    store.put("slot-a", { state: "AMBIGUOUS" });
    expect(store.peek("slot-a")).toEqual({ state: "AMBIGUOUS" });
    now += 10;
    store.put("slot-b", { state: "CANDIDATE", value: "A00000002" });
    expect(store.latest()).toEqual({ accountSlot: "slot-b", outcome: { state: "CANDIDATE", value: "A00000002" } });
  });

  it("a blank slot is not a key — a run that bound to nothing files nothing", () => {
    const store = new StoreIdentityBootstrapStore(() => 0);
    store.put("", { state: "CANDIDATE", value: "A00123456" });
    expect(store.latest()).toBeNull();
  });
});
