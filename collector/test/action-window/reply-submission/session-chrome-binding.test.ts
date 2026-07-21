/**
 * Binding and rebinding the composite session identity — including the renamed-shop
 * rebind the dispatching turn named, and the rule that nothing is ever overwritten
 * without the operator having answered THAT question.
 */
import { describe, it, expect } from "vitest";
import { createPendingConnection } from "../../../src/connection/connection";
import { roundTripConnectionRecord } from "../../../src/connection/record";
import type { CollectorConnection } from "../../../src/connection/types";
import type { AccountFingerprintRawSignals } from "../../../src/naver/account-fingerprint-adapter";
import { bindSessionChromeIdentity } from "../../../src/action-window/reply-submission/session-chrome-binding";
import {
  compositeSessionFingerprint,
  verifyChromeIdentity,
} from "../../../src/action-window/reply-submission/session-chrome-identity";

const USER = "seller_alpha";
const SHOP = "알파 스토어";
const RENAMED = "알파 공식 스토어";
const NOW = "2026-07-21T00:00:00.000Z";

const LIVE: AccountFingerprintRawSignals = {
  urlCategory: "seller-center",
  loggedInSignal: true,
  sellerShellSignal: true,
  commerceIdCandidate: null,
  storeUrlPathCandidate: null,
  accountScopeCandidate: null,
};

const fresh = (): CollectorConnection =>
  createPendingConnection({
    connectionId: "conn-1",
    platform: "NAVER_SMARTSTORE",
    userProvidedDisplayName: "my connection",
    now: NOW,
  });

function boundConnection(shop = SHOP): CollectorConnection {
  return {
    ...fresh(),
    boundSessionIdentityFingerprint: compositeSessionFingerprint(USER, shop)!,
    boundShopDisplayName: shop,
    boundSelectorSpecFingerprint: "a".repeat(64),
  };
}

function input(over: Record<string, unknown> = {}) {
  return {
    connection: fresh(),
    observedUserId: USER,
    observedShopName: SHOP,
    intent: "first-time" as const,
    operatorConfirmed: true,
    signals: LIVE,
    selectorSpecFingerprint: "a".repeat(64),
    now: NOW,
    ...over,
  };
}

describe("first-time binding", () => {
  it("stores the composite digest and the shop display name, and nothing else identifying", () => {
    const out = bindSessionChromeIdentity(input());
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.intent).toBe("first-time");
    expect(out.shopDisplayName).toBe(SHOP);
    expect(out.previousShopDisplayName).toBeNull();
    expect(out.connection.boundSessionIdentityFingerprint).toBe(compositeSessionFingerprint(USER, SHOP));
    expect(out.connection.boundShopDisplayName).toBe(SHOP);

    const serialized = JSON.stringify(roundTripConnectionRecord(out.connection));
    // The user id must not survive; the shop name is stored by explicit decision.
    expect(serialized).not.toContain(USER);
    expect(serialized).toContain(SHOP);
  });

  it("produces a binding the SAME verifier then accepts", () => {
    const out = bindSessionChromeIdentity(input());
    if (!out.ok) throw new Error("expected a binding");
    const v = verifyChromeIdentity({
      observedUserId: USER,
      observedShopName: SHOP,
      boundCompositeFingerprint: out.connection.boundSessionIdentityFingerprint,
      boundShopDisplayName: out.connection.boundShopDisplayName,
      currentSelectorSpecFingerprint: out.connection.boundSelectorSpecFingerprint,
      boundSelectorSpecFingerprint: out.connection.boundSelectorSpecFingerprint,
      selectorsCollide: false,
    });
    expect(v.verdict).toBe("MATCH");
  });

  it("refuses to overwrite an existing binding", () => {
    // The operator was asked a first-time question; answering it must not re-point a
    // binding that already exists.
    expect(bindSessionChromeIdentity(input({ connection: boundConnection() }))).toEqual({
      ok: false,
      reason: "already-bound",
    });
  });
});

describe("renamed-shop rebind", () => {
  it("rebinds to the new name and reports what the label used to be", () => {
    const out = bindSessionChromeIdentity(
      input({ connection: boundConnection(), observedShopName: RENAMED, intent: "rebind" }),
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.intent).toBe("rebind");
    expect(out.previousShopDisplayName).toBe(SHOP);
    expect(out.shopDisplayName).toBe(RENAMED);
    expect(out.connection.boundSessionIdentityFingerprint).toBe(
      compositeSessionFingerprint(USER, RENAMED),
    );
  });

  it("refuses a rebind the operator did not confirm", () => {
    expect(
      bindSessionChromeIdentity(
        input({
          connection: boundConnection(),
          observedShopName: RENAMED,
          intent: "rebind",
          operatorConfirmed: false,
        }),
      ),
    ).toEqual({ ok: false, reason: "operator-did-not-confirm" });
  });

  it("refuses a rebind when there is nothing bound to rebind", () => {
    // Otherwise a rebind confirmation would silently perform a first-time bind — a
    // different question than the one the operator answered.
    expect(bindSessionChromeIdentity(input({ intent: "rebind" }))).toEqual({
      ok: false,
      reason: "not-a-rebind-candidate",
    });
  });

  it("a rebind under a DIFFERENT user is still allowed only because the operator said so", () => {
    // The runtime cannot tell "renamed" from "different account" — the digest is one-way.
    // That is precisely why the confirmation is the control, and why the CLI must show
    // both values before asking.
    const out = bindSessionChromeIdentity(
      input({ connection: boundConnection(), observedUserId: "seller_beta", intent: "rebind" }),
    );
    expect(out.ok).toBe(true);
  });
});

describe("every refusal binds nothing", () => {
  it("refuses without an operator confirmation, however good the evidence", () => {
    expect(bindSessionChromeIdentity(input({ operatorConfirmed: false }))).toEqual({
      ok: false,
      reason: "operator-did-not-confirm",
    });
  });

  it("checks the confirmation FIRST, so a refusal is never misattributed", () => {
    expect(
      bindSessionChromeIdentity(input({ operatorConfirmed: false, observedUserId: null })),
    ).toEqual({ ok: false, reason: "operator-did-not-confirm" });
  });

  it.each([
    ["a missing user id", { observedUserId: null }],
    ["a missing shop name", { observedShopName: null }],
    ["a whitespace-only shop name", { observedShopName: "   " }],
    ["a user id with spaces", { observedUserId: "not an id" }],
  ])("refuses %s — there is no partial identity", (_label, over) => {
    expect(bindSessionChromeIdentity(input(over))).toEqual({
      ok: false,
      reason: "identity-unreadable",
    });
  });

  it("refuses a page that is not a logged-in seller center, however confident the operator is", () => {
    expect(
      bindSessionChromeIdentity(input({ signals: { ...LIVE, loggedInSignal: false } })),
    ).toEqual({ ok: false, reason: "not-logged-in" });
    expect(
      bindSessionChromeIdentity(input({ signals: { ...LIVE, urlCategory: "login" } })),
    ).toEqual({ ok: false, reason: "not-logged-in" });
  });

  it("refuses a page whose seller shell is unconfirmed", () => {
    expect(
      bindSessionChromeIdentity(input({ signals: { ...LIVE, sellerShellSignal: false } })),
    ).toEqual({ ok: false, reason: "seller-shell-unconfirmed" });
  });
});
