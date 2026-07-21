/**
 * The composite seller-center session identity `(userId, shopName)`.
 *
 * The cases the dispatching turn named: exact match, same user with a different shop,
 * the same shop name under a different user, missing/duplicate fields, customer text
 * containing both values, renamed-shop rebind, and account switching before the row
 * outline. Plus the invariant that neither half is usable on its own.
 */
import { describe, it, expect } from "vitest";
import {
  MAX_SHOP_NAME_LENGTH,
  MAX_USER_ID_LENGTH,
  compositeSessionFingerprint,
  mayProceedAfterChromeIdentity,
  normalizeShopName,
  normalizeUserId,
  verifyChromeIdentity,
} from "../../../src/action-window/reply-submission/session-chrome-identity";

const USER = "seller_alpha";
const OTHER_USER = "seller_beta";
const SHOP = "알파 스토어";
const OTHER_SHOP = "베타 스토어";

const bound = (u: string, s: string) => compositeSessionFingerprint(u, s)!;
/** The calibrated selector specs in force; identical on both sides unless a test varies it. */
const SPECS = "a".repeat(64);

function verify(over: Partial<Parameters<typeof verifyChromeIdentity>[0]> = {}) {
  return verifyChromeIdentity({
    observedUserId: USER,
    observedShopName: SHOP,
    boundCompositeFingerprint: bound(USER, SHOP),
    boundShopDisplayName: SHOP,
    currentSelectorSpecFingerprint: SPECS,
    boundSelectorSpecFingerprint: SPECS,
    selectorsCollide: false,
    ...over,
  });
}

describe("composite identity — neither half is usable alone", () => {
  it("needs both fields; either missing yields no fingerprint", () => {
    expect(compositeSessionFingerprint(USER, SHOP)).toMatch(/^[0-9a-f]{64}$/);
    expect(compositeSessionFingerprint(USER, null)).toBeNull();
    expect(compositeSessionFingerprint(null, SHOP)).toBeNull();
    expect(compositeSessionFingerprint("", "")).toBeNull();
  });

  it("SAME USER, DIFFERENT SHOP produces a different identity", () => {
    // A user id alone would match every shop that seller owns — the fail-open shape.
    expect(bound(USER, SHOP)).not.toBe(bound(USER, OTHER_SHOP));
  });

  it("SAME SHOP NAME, DIFFERENT USER produces a different identity", () => {
    // A shop name alone is not unique across sellers and is freely chosen at signup.
    expect(bound(USER, SHOP)).not.toBe(bound(OTHER_USER, SHOP));
  });

  it("cannot be confused by moving characters across the field boundary", () => {
    // The unit separator plus "a user id contains no whitespace" is what guarantees this.
    expect(bound("ab", "c")).not.toBe(bound("a", "bc"));
  });
});

describe("normalization", () => {
  it("collapses whitespace runs so cosmetic spacing is not a rename", () => {
    expect(normalizeShopName("  알파   스토어 ")).toBe("알파 스토어");
    expect(bound(USER, "알파  스토어")).toBe(bound(USER, SHOP));
  });

  it("strips zero-width characters that would otherwise forge a difference", () => {
    expect(normalizeShopName(`알파​ 스토어`)).toBe(SHOP);
    expect(normalizeUserId(`seller​_alpha`)).toBe(USER);
  });

  it("rejects a user id containing whitespace or control characters", () => {
    expect(normalizeUserId("seller alpha")).toBeNull();
    expect(normalizeUserId("selleralpha")).toBeNull();
  });

  it("rejects empty and over-long values on both fields", () => {
    expect(normalizeUserId("   ")).toBeNull();
    expect(normalizeShopName("")).toBeNull();
    expect(normalizeUserId("a".repeat(MAX_USER_ID_LENGTH + 1))).toBeNull();
    expect(normalizeShopName("가".repeat(MAX_SHOP_NAME_LENGTH + 1))).toBeNull();
    // Exactly at the ceiling is still valid.
    expect(normalizeUserId("a".repeat(MAX_USER_ID_LENGTH))).not.toBeNull();
  });
});

describe("verifyChromeIdentity — the three verdicts", () => {
  it("MATCHes the exact pair", () => {
    const v = verify();
    expect(v.verdict).toBe("MATCH");
    expect(v.reason).toBe("ok");
    expect(mayProceedAfterChromeIdentity(v)).toBe(true);
  });

  it("MISMATCHes the same user on a different shop", () => {
    const v = verify({ observedShopName: OTHER_SHOP });
    expect(v.verdict).toBe("MISMATCH");
    expect(v.reason).toBe("composite-differs");
    expect(mayProceedAfterChromeIdentity(v)).toBe(false);
  });

  it("MISMATCHes the same shop name under a different user", () => {
    const v = verify({ observedUserId: OTHER_USER });
    expect(v.verdict).toBe("MISMATCH");
    // The shop name is identical, so a shop-name-only design would have said MATCH here.
    expect(v.observedShopName).toBe(SHOP);
    expect(v.shopNameDiffers).toBe(false);
  });

  it("is UNAVAILABLE — never MISMATCH — when a field is unreadable", () => {
    // Missing evidence and contrary evidence are different facts. Reporting the first as
    // the second trains an operator to wave mismatches through.
    expect(verify({ observedUserId: null }).verdict).toBe("UNAVAILABLE");
    expect(verify({ observedUserId: null }).reason).toBe("user-id-unreadable");
    expect(verify({ observedShopName: null }).reason).toBe("shop-name-unreadable");
    expect(verify({ observedShopName: "   " }).reason).toBe("shop-name-unreadable");
  });

  it("is UNAVAILABLE when nothing is bound yet", () => {
    const v = verify({ boundCompositeFingerprint: null, boundShopDisplayName: null });
    expect(v.verdict).toBe("UNAVAILABLE");
    expect(v.reason).toBe("no-binding");
  });

  it("checks readability BEFORE the binding, so an unreadable page is not blamed on the binding", () => {
    const v = verify({ observedUserId: null, boundCompositeFingerprint: null });
    expect(v.reason).toBe("user-id-unreadable");
  });
});

describe("shopNameDiffers says ONLY that the shop name differs", () => {
  it("is TRUE for a different seller too — it is not evidence of a rename", () => {
    // THE REGRESSION THIS EXISTS FOR: the flag was called `looksLikeRename` and the CLI printed "the user id
    // side is unchanged" on the strength of it — immediately before a permanent, un-undoable write. There is
    // no stored user id (the composite is one-way), so the runtime cannot know that, and here it is false.
    const differentSeller = verify({ observedUserId: OTHER_USER, observedShopName: OTHER_SHOP });
    expect(differentSeller.verdict).toBe("MISMATCH");
    expect(differentSeller.shopNameDiffers).toBe(true);
  });

  it("is FALSE when only the user changed, because the shop name did not", () => {
    expect(verify({ observedUserId: OTHER_USER }).shopNameDiffers).toBe(false);
  });

  it("flags the differing name without acting on it", () => {
    const v = verify({ observedShopName: OTHER_SHOP });
    expect(v.verdict).toBe("MISMATCH");
    // Same user, different shop name than the stored label: the operator is being asked
    // "was it renamed?", not "is this the right account?". It is still a MISMATCH.
    expect(v.shopNameDiffers).toBe(true);
    expect(v.boundShopDisplayName).toBe(SHOP);
    expect(v.observedShopName).toBe(OTHER_SHOP);
    expect(mayProceedAfterChromeIdentity(v)).toBe(false);
  });

  it("does not flag a rename when the stored label is unknown", () => {
    expect(verify({ observedShopName: OTHER_SHOP, boundShopDisplayName: null }).shopNameDiffers).toBe(
      false,
    );
  });
});

describe("customer-controlled text cannot become the identity", () => {
  it("a review body containing BOTH values does not change any verdict", () => {
    // The defence is upstream — the pinned container is resolved structurally and never
    // searched for — but the pure layer must also not care what else exists on the page.
    // It sees only the two extracted fields, so a review reproducing them verbatim is
    // simply never passed in.
    const reviewText = `이 판매자 ${USER} 의 ${SHOP} 에서 샀어요`;
    // Whatever a customer wrote, it is not a user id: it fails the shape check outright.
    expect(normalizeUserId(reviewText)).toBeNull();
    // And a wholesale substitution changes the identity rather than satisfying it.
    const v = verify({ observedUserId: OTHER_USER, observedShopName: reviewText });
    expect(v.verdict).toBe("MISMATCH");
  });

  it("a shop name that merely CONTAINS the bound name is not the bound name", () => {
    const v = verify({ observedShopName: `${SHOP} 공식몰` });
    expect(v.verdict).toBe("MISMATCH");
  });
});

describe("account switching before the row outline", () => {
  it("a re-read after a switch flips MATCH to MISMATCH", () => {
    // The preflight passes, the operator switches account, and the barrier re-read runs
    // the SAME comparison against the SAME binding — which is the whole point of
    // re-reading rather than trusting the preflight.
    const preflight = verify();
    expect(preflight.verdict).toBe("MATCH");

    const atOutline = verify({ observedUserId: OTHER_USER, observedShopName: OTHER_SHOP });
    expect(atOutline.verdict).toBe("MISMATCH");
    expect(mayProceedAfterChromeIdentity(atOutline)).toBe(false);
  });

  it("a re-read that becomes unreadable also stops the run", () => {
    // Losing sight of the identity is not evidence that it is still the right one.
    expect(mayProceedAfterChromeIdentity(verify({ observedShopName: null }))).toBe(false);
  });
});

describe("the selectors are part of the comparison", () => {
  it("is UNAVAILABLE when the calibrated selectors differ from the ones the binding was read through", () => {
    // The same page read through different selectors can yield a different pair, so this
    // is not a mismatch — it is two things that were never comparable. Reporting MISMATCH
    // would send the operator hunting an account problem that does not exist.
    const v = verify({ currentSelectorSpecFingerprint: "b".repeat(64) });
    expect(v.verdict).toBe("UNAVAILABLE");
    expect(v.reason).toBe("selector-source-changed");
  });

  it("is UNAVAILABLE when no selectors are calibrated at all", () => {
    expect(verify({ currentSelectorSpecFingerprint: null }).reason).toBe("no-selectors");
  });

  it("is UNAVAILABLE when both fields would read the same element", () => {
    // A composite of one value with itself looks perfectly stable and identifies nothing.
    expect(verify({ selectorsCollide: true }).reason).toBe("selectors-collide");
  });

  it("checks the source BEFORE the values, so a spec change is never reported as a mismatch", () => {
    const v = verify({
      currentSelectorSpecFingerprint: "b".repeat(64),
      observedUserId: OTHER_USER,
      observedShopName: OTHER_SHOP,
    });
    expect(v.reason).toBe("selector-source-changed");
  });
});

describe("no raw identity survives into the verification result", () => {
  it("carries the shop display names and no digest or user id", () => {
    const v = verify({ observedShopName: OTHER_SHOP });
    const serialized = JSON.stringify(v);
    expect(serialized).not.toContain(USER);
    expect(serialized).not.toContain(bound(USER, SHOP));
    // Shop names ARE carried, by explicit product-owner decision: they are the shop's
    // own public name and they are what makes a rename legible.
    expect(serialized).toContain(SHOP);
  });
});

describe("swapped or duplicated selectors", () => {
  it("refuses when both fields resolve to the same element", () => {
    // A composite of one value with itself looks perfectly stable and identifies nothing,
    // so this is UNAVAILABLE rather than a MATCH on a self-pair.
    expect(verify({ selectorsCollide: true }).verdict).toBe("UNAVAILABLE");
  });

  it("SWAPPED selectors change the identity rather than satisfying it", () => {
    // Calibrating the user-id selector onto the shop element (and vice versa) reads the
    // pair in the wrong order. The composite is order-sensitive, so it cannot match.
    const swapped = verify({ observedUserId: "algo", observedShopName: USER });
    expect(swapped.verdict).toBe("MISMATCH");
    // And a shop name in the user-id slot usually fails the shape check outright.
    expect(verify({ observedUserId: SHOP }).verdict).toBe("UNAVAILABLE");
  });

  it("refuses a pair whose halves are EQUAL, even with selectorsCollide false", () => {
    // The hole `selectorsCollide` cannot see. It intersects selector STRINGS, so two textually different
    // selectors resolving to one element — an operator whose shop-name click lands on the adjacent header
    // account chip — pass it. The result is a composite of one value with itself: perfectly stable,
    // permanently MATCHing, identifying nothing. It would also record the USER ID as the shop display
    // name, the one field this milestone prints and treats as non-sensitive.
    const self = verify({
      observedUserId: "감마상점",
      observedShopName: "감마상점",
      selectorsCollide: false,
      boundCompositeFingerprint: SPECS,
    });
    expect(self.verdict).toBe("UNAVAILABLE");
    expect(self.reason).toBe("identity-not-composite");
    expect(mayProceedAfterChromeIdentity(self)).toBe(false);
  });

  it("cannot even MINT a self-composite digest, so no caller can bind one", () => {
    // Closed at the producer as well as at the verifier: a future caller that bypasses
    // `verifyChromeIdentity` still cannot obtain a fingerprint for a degenerate pair.
    expect(compositeSessionFingerprint("감마상점", "감마상점")).toBeNull();
    expect(compositeSessionFingerprint(USER, USER)).toBeNull();
    expect(compositeSessionFingerprint(USER, SHOP)).not.toBeNull();
  });
});
