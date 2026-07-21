/**
 * Choosing a store identity from read-only evidence: precedence, the within-key conflict rule, the value
 * shape, and the untrusted-page parsing of the in-page probe result.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ACCOUNT_ID_KEYS,
  ACCOUNT_ID_VALUE_PATTERN,
  MAX_ACCOUNT_ID_HITS,
  chooseAccountIdentity,
  type AccountIdHit,
} from "../../../src/action-window/reply-submission/session-account-identity";
import {
  MAX_PROBE_HITS,
  inPageAccountIdentityProbe,
  parseAccountProbeResult,
} from "../../../src/action-window/reply-submission/session-account-probe-inpage";

/** The one key the product owner has pinned as store-discriminating for these fixtures. */
const PINNED = "channelNo";

describe("chooseAccountIdentity — only the PINNED key may carry identity", () => {
  it("uses the pinned key, not whichever key happens to rank highest", () => {
    const { chosen, evidence } = chooseAccountIdentity({
      hits: [
        { key: "sellerNo", value: "555" },
        { key: "channelNo", value: "100200300" },
      ],
      pinnedKey: PINNED,
    });
    expect(chosen).toEqual({ sourceCategory: "commerce-id", token: "channelNo=100200300", key: "channelNo" });
    expect(evidence.chosenKey).toBe("channelNo");
    // Both survive as evidence even though only one was chosen.
    expect(evidence.keysPresent).toEqual(["channelNo", "sellerNo"]);
  });

  it("chooses NOTHING when no key is pinned, however clean the evidence looks", () => {
    // THE REGRESSION THIS EXISTS FOR: with a precedence list over an UNVERIFIED key set, a page whose real
    // store key is absent would happily bind a build-time constant like `channelId: "default"` — identical
    // across every store the operator owns, so a permanent false MATCH. A key is eligible only once it is
    // shown to DISCRIMINATE between stores, and one run cannot show that. So the runtime refuses to pick.
    const { chosen, evidence } = chooseAccountIdentity({
      hits: [{ key: "channelId", value: "default" }],
      pinnedKey: null,
    });
    expect(chosen).toBeNull();
    expect(evidence.pinnedKey).toBeNull();
    // The evidence is still reported — that is what makes the next decision possible.
    expect(evidence.keysPresent).toEqual(["channelId"]);
  });

  it("chooses nothing when the pinned key is absent, rather than substituting another", () => {
    const { chosen } = chooseAccountIdentity({
      hits: [{ key: "mallNo", value: "100200300" }],
      pinnedKey: PINNED,
    });
    expect(chosen).toBeNull();
  });

  it("ignores a pinned key that is not in the allow-list", () => {
    const { chosen } = chooseAccountIdentity({
      hits: [{ key: "channelNo", value: "100200300" }],
      pinnedKey: "notAnIdKey",
    });
    expect(chosen).toBeNull();
  });

  it("keeps two keys holding the same number distinguishable", () => {
    const a = chooseAccountIdentity({ hits: [{ key: "channelNo", value: "77" }], pinnedKey: "channelNo" });
    const b = chooseAccountIdentity({ hits: [{ key: "mallNo", value: "77" }], pinnedKey: "mallNo" });
    // Without the key in the token these would digest identically and one store could stand in for another.
    expect(a.chosen!.token).not.toBe(b.chosen!.token);
  });

  it("chooses nothing when there is nothing to choose", () => {
    const { chosen, evidence } = chooseAccountIdentity({ hits: [], pinnedKey: PINNED });
    expect(chosen).toBeNull();
    expect(evidence.chosenSourceCategory).toBeNull();
  });
});

describe("chooseAccountIdentity — ambiguity is dropped, never resolved by picking", () => {
  it("drops a key that appears with two different values", () => {
    const { chosen, evidence } = chooseAccountIdentity({
      hits: [
        { key: "channelNo", value: "111" },
        { key: "channelNo", value: "222" },
      ],
      pinnedKey: PINNED,
    });
    expect(chosen).toBeNull();
    expect(evidence.keysConflicting).toEqual(["channelNo"]);
    expect(evidence.keysPresent).toEqual([]);
  });

  it("refuses the WHOLE read when any key conflicts, instead of falling through to another key", () => {
    // THE REGRESSION THIS EXISTS FOR (and an earlier test of mine asserted the opposite as correct):
    // store A emits channelNo=A and mallNo=A; the operator switches to store B, which emits only
    // channelNo=B. Dropping just the conflicting key let precedence return mallNo=A — binding or matching
    // STORE A while the operator looks at store B. A page showing two identities cannot be read at all.
    const { chosen, evidence } = chooseAccountIdentity({
      hits: [
        { key: "channelNo", value: "A_STORE" },
        { key: "mallNo", value: "A_STORE" },
        { key: "channelNo", value: "B_STORE" },
      ],
      pinnedKey: "mallNo",
    });
    expect(chosen).toBeNull();
    expect(evidence.keysConflicting).toEqual(["channelNo"]);
  });

  it("ignores keys outside the allow-list and values that are not id-shaped", () => {
    const { chosen } = chooseAccountIdentity({
      hits: [
        { key: "notAnIdKey", value: "100200300" },
        { key: "channelNo", value: "a store name with spaces" },
        { key: "mallNo", value: "" },
        { key: "storeNo", value: "x".repeat(41) },
      ],
      pinnedKey: PINNED,
    });
    expect(chosen).toBeNull();
  });

  it("pins the value shape", () => {
    expect(ACCOUNT_ID_VALUE_PATTERN.test("100200300")).toBe(true);
    expect(ACCOUNT_ID_VALUE_PATTERN.test("abc_DEF-123")).toBe(true);
    expect(ACCOUNT_ID_VALUE_PATTERN.test("a")).toBe(false);
    expect(ACCOUNT_ID_VALUE_PATTERN.test("has space")).toBe(false);
    expect(ACCOUNT_ID_VALUE_PATTERN.test("store.name")).toBe(false);
  });

  it("does not spend the evidence budget on repetition", () => {
    // A review list repeating ONE store's id on every row is redundant, not ambiguous. The cap counts
    // DISTINCT pairs, so this must still resolve cleanly.
    const repeated = Array.from({ length: MAX_ACCOUNT_ID_HITS * 3 }, () => ({
      key: "channelNo",
      value: "100200300",
    }));
    const { chosen, evidence } = chooseAccountIdentity({ hits: repeated, pinnedKey: PINNED });
    expect(chosen?.token).toBe("channelNo=100200300");
    expect(evidence.hitsTruncated).toBe(false);
  });

  it("refuses when distinct evidence overflows the cap, instead of answering from a sliced view", () => {
    // THE REGRESSION THIS EXISTS FOR: an earlier version sliced the raw hit list BEFORE detecting
    // conflicts. Fill the budget with one store's ids, then let a second store's id arrive last — the
    // sliced version returned a confident token for the first store while the second was open.
    const flood = [
      ...Array.from({ length: MAX_ACCOUNT_ID_HITS }, (_, i) => ({ key: "channelNo", value: `A${i}` })),
      { key: "channelNo", value: "B_THE_OTHER_STORE" },
    ];
    const { chosen, evidence } = chooseAccountIdentity({ hits: flood, pinnedKey: PINNED });
    expect(chosen).toBeNull();
    expect(evidence.hitsTruncated).toBe(true);
  });
});

describe("chooseAccountIdentity — there is NO url-path fallback, on purpose", () => {
  // A seller center's path is identical for every store the operator owns, so binding it would produce a
  // fingerprint that matches EVERY store — a silent, permanent false MATCH that a store switch would sail
  // through. A missing key fails closed; a store-agnostic path would fail OPEN.
  //
  // These are SOURCE assertions on purpose. Behavioural tests cannot express "a source that no longer
  // exists": with the input field removed there is nothing to feed, so every behavioural version passes
  // vacuously and would keep passing if the fallback were reintroduced.
  const source = readFileSync(
    resolve(__dirname, "../../../src/action-window/reply-submission/session-account-identity.ts"),
    "utf8",
  );
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");

  it("constructs no identity from a url path or an account scope", () => {
    expect(code).not.toContain("store-url-path");
    expect(code).not.toContain("account-scope");
    expect(code).not.toContain("urlPath");
  });

  it("has exactly one construction site, and it is commerce-id", () => {
    // Literal assignments only — the interface's own `sourceCategory:` declaration is not a construction.
    const constructions = code.match(/sourceCategory: "/g) ?? [];
    expect(constructions).toHaveLength(1);
    expect(code).toContain('sourceCategory: "commerce-id"');
  });

  it("emits commerce-id or nothing, for every input shape", () => {
    const cases: AccountIdHit[][] = [
      [],
      [{ key: "channelNo", value: "100200300" }],
      [{ key: "notAnIdKey", value: "anything" }],
      [{ key: "mallNo", value: "AB-99" }],
    ];
    const produced = cases.map(
      (hits) => chooseAccountIdentity({ hits, pinnedKey: PINNED }).chosen?.sourceCategory ?? null,
    );
    // Not a vacuous sweep: the pinned-key case must actually produce an identity.
    expect(produced.filter((c) => c === "commerce-id").length).toBeGreaterThanOrEqual(1);
    expect(produced.every((c) => c === null || c === "commerce-id")).toBe(true);
  });
});

describe("chooseAccountIdentity — truncation ANYWHERE upstream refuses", () => {
  it("refuses when an upstream stage says it discarded evidence, even with a clean hit set", () => {
    // THE REGRESSION THIS EXISTS FOR: the per-body cap, the in-page walk ceilings and the session scan
    // budget all drop evidence BEFORE this function sees it — and a cap drops a SECOND store's id first.
    // Without threading truncation in, a sliced view produced a confident token and the barrier drift check
    // saw nothing change, because the contradicting evidence never arrived.
    const clean = [{ key: "channelNo", value: "100200300" }];
    expect(chooseAccountIdentity({ hits: clean, pinnedKey: PINNED }).chosen?.token).toBe("channelNo=100200300");

    const truncated = chooseAccountIdentity({ hits: clean, evidenceTruncated: true, pinnedKey: PINNED });
    expect(truncated.chosen).toBeNull();
    expect(truncated.evidence.hitsTruncated).toBe(true);
  });
});

describe("parseAccountProbeResult — the page is untrusted", () => {
  it("accepts a well-formed payload", () => {
    const parsed = parseAccountProbeResult(
      JSON.stringify({
        hits: [{ key: "channelNo", value: "1" }],
        truncated: false,
        rootsWalked: 2,
        rootLabels: ["__NEXT_DATA__", "inline-json"],
      }),
    );
    expect(parsed).toEqual({
      hits: [{ key: "channelNo", value: "1" }],
      truncated: false,
      rootsWalked: 2,
      rootLabels: ["__NEXT_DATA__", "inline-json"],
    });
  });

  it("returns null on anything unparseable", () => {
    expect(parseAccountProbeResult("not json")).toBeNull();
    expect(parseAccountProbeResult(null)).toBeNull();
    expect(parseAccountProbeResult(42)).toBeNull();
  });

  it("degrades to truncated rather than trusting a malformed shape", () => {
    expect(parseAccountProbeResult(JSON.stringify({ hits: "nope" }))?.truncated).toBe(true);
    // Non-hit entries are dropped, and dropping them is itself reported.
    const mixed = parseAccountProbeResult(
      JSON.stringify({ hits: [{ key: "channelNo", value: "1" }, { key: 5 }, "x"], truncated: false }),
    );
    expect(mixed?.hits).toEqual([{ key: "channelNo", value: "1" }]);
    expect(mixed?.truncated).toBe(true);
  });

  it("caps the hit list", () => {
    const parsed = parseAccountProbeResult(
      JSON.stringify({
        hits: Array.from({ length: MAX_PROBE_HITS + 10 }, () => ({ key: "channelNo", value: "1" })),
        truncated: false,
      }),
    );
    expect(parsed?.hits.length).toBe(MAX_PROBE_HITS);
    expect(parsed?.truncated).toBe(true);
  });
});

describe("inPageAccountIdentityProbe — the source it ships", () => {
  const source = inPageAccountIdentityProbe();

  it("embeds the allow-list and nothing else identity-shaped", () => {
    for (const key of ACCOUNT_ID_KEYS) expect(source).toContain(key);
  });

  it("applies the SAME value shape the caller enforces, so its budget is not spent on discards", () => {
    // Divergence here would report a truncated view of a page we actually read in full — and truncation
    // fails the run closed, so an over-strict or over-loose in-page filter costs real runs.
    expect(source).toContain(ACCOUNT_ID_VALUE_PATTERN.source);
  });

  it("is ASCII-only, so no marketplace text can ride along in the payload", () => {
    // eslint-disable-next-line no-control-regex
    expect(source).toMatch(/^[\x00-\x7f]*$/);
  });

  it("reaches into the DOM exactly once, and only for JSON script tags", () => {
    // Structural rather than name-based: the previous guard listed forbidden identifiers and was defeated by
    // a rename. The probe may query the DOM for parseable JSON and for nothing else — that single selector is
    // what keeps customer-written page text out of every downstream gate.
    // Counting two API NAMES was defeated by reading `document.body.outerHTML`. So the constraint is the
    // whole reach: the probe may touch `document` exactly once, and that once must be the JSON-script query.
    const documentUses = source.match(/\bdocument\b/g) ?? [];
    expect(documentUses).toHaveLength(1);
    // `ld+json` is deliberately NOT read: distinguishing it needed an attribute reader, which this very
    // guard forbids, and an SEO blob could never have counted as trusted evidence anyway.
    expect(source).toContain(`document.querySelectorAll('script[type="application/json"]')`);
    expect(source).not.toContain("ld+json");
    // textContent is legitimate for a JSON script body — once — and no other text-reaching API is.
    expect((source.match(/textContent/g) ?? []).length).toBe(1);
    for (const api of ["innerText", "innerHTML", "outerHTML", "getAttribute", "nodeValue", "getElementsBy"]) {
      expect(source, `probe reaches page text via ${api}`).not.toContain(api);
    }
  });

  it("never reads or writes anything but parsed JSON state", () => {
    for (const forbidden of [
      "innerText",
      "document.cookie",
      "localStorage",
      "sessionStorage",
      ".click(",
      ".focus(",
      "setAttribute",
      "removeAttribute",
      "innerHTML",
      "fetch(",
      "XMLHttpRequest",
    ]) {
      expect(source, `probe touches ${forbidden}`).not.toContain(forbidden);
    }
  });
});
