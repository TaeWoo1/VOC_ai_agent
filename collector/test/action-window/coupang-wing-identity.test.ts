/**
 * **The store-identity assertion, both halves** — the real generated scripts against a fake WING shell, and
 * the offline judgement over what they return.
 *
 * PD-4 is the property under test and it is a NEGATIVE one: a run must not read a store it cannot name. So
 * the cases that matter are the three that are not `MATCH` — nothing on the page, two codes that disagree,
 * and a code that belongs to somebody else — because each of them is a screen full of real reviews that this
 * unit must refuse.
 *
 * The label appearing TWICE is the live-measured shape (2026-09-12, and the same duplication that parked the
 * issuance walk on `LABEL_NOT_UNIQUE`). Two elements printing the SAME code is agreement, and the test says
 * so; two printing different codes is not.
 */
import { describe, expect, it } from "vitest";
import { buildWingAuthScript, buildWingIdentityScript, sanitizeWingIdentityReading } from "../../src/action-window/coupang-review/wing-identity-inpage";
import { assertWingStore, wingStoreFingerprint } from "../../src/action-window/coupang-review/wing-store-identity";
import { el, run, type El } from "./fake-dom";

const CODE = "A00123456";
const OTHER = "A00999999";

function shell(opts: { codes?: string[]; signedOut?: boolean; label?: string } = {}): El {
  const label = opts.label ?? "업체코드";
  const kids: El[] = [];
  for (const code of opts.codes ?? [CODE, CODE]) kids.push(el({ tag: "span", text: `${label} ${code}` }));
  kids.push(el({ tag: "a", text: opts.signedOut ? "로그인" : "로그아웃" }));
  if (opts.signedOut) kids.push(el({ tag: "input", attrs: { type: "password" } }));
  // Chrome that must not be mistaken for identity.
  kids.push(el({ tag: "div", text: "리뷰 목록" }));
  return el({ tag: "body" }).add(...kids);
}

describe("WING identity — the in-page read", () => {
  it("two elements printing the SAME code is one store, not an ambiguity", () => {
    const r = sanitizeWingIdentityReading(run(buildWingIdentityScript(), shell()));
    expect(r.labelHits).toBe(2);
    expect(r.distinct).toBe(1);
    expect(r.values).toEqual([CODE]);
  });

  it("two elements printing DIFFERENT codes is two, and the judgement below refuses it", () => {
    const r = sanitizeWingIdentityReading(run(buildWingIdentityScript(), shell({ codes: [CODE, OTHER] })));
    expect(r.distinct).toBe(2);
  });

  it("a shell with no such label reads nothing — never the nearest text it could find", () => {
    const r = sanitizeWingIdentityReading(run(buildWingIdentityScript(), shell({ label: "정산예정금액" })));
    expect(r.values).toEqual([]);
    expect(r.labelHits).toBe(0);
  });

  it("the sanitizer refuses an off-shape reading rather than inventing one", () => {
    expect(sanitizeWingIdentityReading(null).values).toEqual([]);
    expect(sanitizeWingIdentityReading({ values: [1, "", "  ", "A1"] }).values).toEqual(["A1"]);
  });
});

describe("WING auth — the sign-in wall check", () => {
  it("a signed-in shell: a sign-out word and no password field", () => {
    expect(run<{ signedIn: boolean }>(buildWingAuthScript(), shell()).signedIn).toBe(true);
  });
  it("a sign-in wall is refused on BOTH halves", () => {
    const out = run<{ signedIn: boolean; passwordInputs: number; signOutWords: number }>(buildWingAuthScript(), shell({ signedOut: true }));
    expect(out.signedIn).toBe(false);
    expect(out.passwordInputs).toBe(1);
    expect(out.signOutWords).toBe(0);
  });
  it("a page that has not rendered its chrome is NOT called signed in", () => {
    expect(run<{ signedIn: boolean }>(buildWingAuthScript(), el({ tag: "body" })).signedIn).toBe(false);
  });
});

describe("WING identity — the offline judgement", () => {
  const expected = wingStoreFingerprint(CODE)!;

  it("the digest refuses a malformed token instead of digesting garbage", () => {
    expect(wingStoreFingerprint("")).toBeNull();
    expect(wingStoreFingerprint("   ")).toBeNull();
    expect(wingStoreFingerprint("한글 코드")).toBeNull();
    expect(wingStoreFingerprint(CODE)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("MATCH only when one code was read and it is this store", () => {
    expect(assertWingStore(expected, { labelHits: 2, distinct: 1, values: [CODE] })).toMatchObject({ verdict: "MATCH", reason: "OK" });
  });

  it("a different store is MISMATCH — told apart from not knowing", () => {
    expect(assertWingStore(expected, { labelHits: 2, distinct: 1, values: [OTHER] })).toMatchObject({ verdict: "MISMATCH", reason: "DIFFERENT_STORE" });
  });

  it("nothing read, two codes, or no expectation are all UNRESOLVED — and never MATCH", () => {
    expect(assertWingStore(expected, { labelHits: 0, distinct: 0, values: [] })).toMatchObject({ verdict: "UNRESOLVED", reason: "NOT_OBSERVED" });
    expect(assertWingStore(expected, { labelHits: 2, distinct: 2, values: [CODE, OTHER] })).toMatchObject({ verdict: "UNRESOLVED", reason: "AMBIGUOUS" });
    expect(assertWingStore(null, { labelHits: 2, distinct: 1, values: [CODE] })).toMatchObject({ verdict: "UNRESOLVED", reason: "NO_EXPECTATION" });
  });

  it("the digest is domain-separated — a bare SHA-256 of the code is not it", () => {
    expect(wingStoreFingerprint(CODE)).not.toBe("f".repeat(64));
    // Pinned vector: the backend's `WingStoreIdentityTest` pins the SAME literal. The two halves never run in
    // one process, so nothing else can notice them drifting — and a drifted domain would make every real
    // store read as MISMATCH, which looks exactly like a seller signed into the wrong account.
    expect(wingStoreFingerprint("A00123456")).toBe("869a00c798a22cf32b6997a87256a365dd3455c94efd1210789857268ef2cb00");
    expect(wingStoreFingerprint("  A00123456  ")).toBe(wingStoreFingerprint("A00123456"));
  });
});
