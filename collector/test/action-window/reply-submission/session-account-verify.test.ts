/**
 * Session seller/store verification — the mandatory preflight.
 *
 * The cases the dispatching turn named: account match, account mismatch, unavailable identity, and account
 * switching between preflight and outline. Plus the ones that make those meaningful: a registry that cannot
 * resolve to one connection, a bound source that is simply not on the page today (which must NOT read as a
 * mismatch), and the invariant that nothing identity-bearing survives into the result.
 */
import { describe, it, expect } from "vitest";
import { fingerprintHash } from "../../../src/connection/connection";
import { sellerAccountFingerprint } from "../../../src/connection/seller-account-fingerprint";
import type { CollectorConnection } from "../../../src/connection/types";
import type { AccountFingerprintRawSignals } from "../../../src/naver/account-fingerprint-adapter";
import {
  assertAccountUnchanged,
  mayProceedToReviewLookup,
  observedCategories,
  verifySessionAccount,
} from "../../../src/action-window/reply-submission/session-account-verify";

const ACCOUNT = "11111111-2222-3333-4444-555555555555";
const OTHER_ACCOUNT = "99999999-8888-7777-6666-555555555555";
const STORE_TOKEN = "channelNo=100200300";
const OTHER_STORE_TOKEN = "channelNo=900800700";

/** A store token and a SellerOps alias that would be obvious if either ever leaked. */
const ALIAS = "OPERATOR_ALIAS_CANARY";

function connection(over: Partial<CollectorConnection> = {}): CollectorConnection {
  return {
    connectionId: "conn-1",
    platform: "NAVER_SMARTSTORE",
    profileName: "naver-conn-1",
    connectionStatus: "CONNECTED",
    boundStoreFingerprintHash: fingerprintHash(STORE_TOKEN),
    fingerprintSourceCategory: "commerce-id",
    boundSellerAccountFingerprint: sellerAccountFingerprint(ACCOUNT),
    boundSessionIdentityFingerprint: null,
    boundShopDisplayName: null,
    boundSelectorSpecFingerprint: null,
    userProvidedDisplayName: ALIAS,
    createdAt: "2026-07-20T00:00:00.000Z",
    lastVerifiedAt: "2026-07-20T00:00:00.000Z",
    lastExportAttemptAt: null,
    lastExportResult: null,
    reauthRequiredReason: null,
    ...over,
  };
}

function signals(over: Partial<AccountFingerprintRawSignals> = {}): AccountFingerprintRawSignals {
  return {
    urlCategory: "seller-center",
    loggedInSignal: true,
    sellerShellSignal: true,
    commerceIdCandidate: STORE_TOKEN,
    storeUrlPathCandidate: null,
    accountScopeCandidate: null,
    ...over,
  };
}

describe("verifySessionAccount — the four verdicts", () => {
  it("MATCHes when the open store digests to the bound fingerprint", () => {
    const v = verifySessionAccount({
      sellerAccountId: ACCOUNT,
      connections: [connection()],
      signals: signals(),
    });
    expect(v.verdict).toBe("MATCH");
    expect(v.reason).toBe("ok");
    expect(v.connectionId).toBe("conn-1");
    expect(v.displayName).toBe(ALIAS);
    expect(mayProceedToReviewLookup(v)).toBe(true);
  });

  it("MISMATCHes when a different store is open under the same account", () => {
    const v = verifySessionAccount({
      sellerAccountId: ACCOUNT,
      connections: [connection()],
      signals: signals({ commerceIdCandidate: OTHER_STORE_TOKEN }),
    });
    expect(v.verdict).toBe("MISMATCH");
    expect(v.reason).toBe("fingerprint-differs");
    expect(mayProceedToReviewLookup(v)).toBe(false);
  });

  it("NEEDS_BINDING when no connection is linked to this seller account", () => {
    const v = verifySessionAccount({
      sellerAccountId: OTHER_ACCOUNT,
      connections: [connection()],
      signals: signals(),
    });
    expect(v.verdict).toBe("NEEDS_BINDING");
    expect(v.reason).toBe("no-connection-for-account");
    // No connection resolved, so nothing about one may be reported.
    expect(v.connectionId).toBeNull();
    expect(v.displayName).toBeNull();
  });

  it("NEEDS_BINDING when the connection exists but no store is bound to it yet", () => {
    const v = verifySessionAccount({
      sellerAccountId: ACCOUNT,
      connections: [
        connection({ boundStoreFingerprintHash: null, fingerprintSourceCategory: null }),
      ],
      signals: signals(),
    });
    expect(v.verdict).toBe("NEEDS_BINDING");
    expect(v.reason).toBe("store-not-bound");
  });
});

describe("verifySessionAccount — every uncertainty fails CLOSED, and none of them reads as a mismatch", () => {
  it("UNAVAILABLE when the bound source category is simply not on the page today", () => {
    // The connection was bound from a commerce id; this page only offers a url path. That is MISSING
    // evidence, not CONTRARY evidence — calling it MISMATCH would train the operator to ignore mismatches.
    const v = verifySessionAccount({
      sellerAccountId: ACCOUNT,
      connections: [connection()],
      signals: signals({ commerceIdCandidate: null, storeUrlPathCandidate: "/some/store/path" }),
    });
    expect(v.verdict).toBe("UNAVAILABLE");
    expect(v.reason).toBe("bound-category-absent");
  });

  it("UNAVAILABLE when the session is not a seller-center context", () => {
    // The CLI derives `loggedInSignal` from the URL class, so in production these two conjuncts always
    // agree; the url-category case below is the one that can actually arise. The first is kept because
    // `verifySessionAccount` is a shared pure function and other callers may set them independently.
    expect(
      verifySessionAccount({
        sellerAccountId: ACCOUNT,
        connections: [connection()],
        signals: signals({ loggedInSignal: false }),
      }).reason,
    ).toBe("not-logged-in");

    expect(
      verifySessionAccount({
        sellerAccountId: ACCOUNT,
        connections: [connection()],
        signals: signals({ urlCategory: "login" }),
      }).reason,
    ).toBe("not-logged-in");
  });

  it("UNAVAILABLE when the seller shell is unconfirmed, even with a perfectly matching token", () => {
    const v = verifySessionAccount({
      sellerAccountId: ACCOUNT,
      connections: [connection()],
      signals: signals({ sellerShellSignal: false }),
    });
    expect(v.verdict).toBe("UNAVAILABLE");
    expect(v.reason).toBe("seller-shell-unconfirmed");
  });

  it("UNAVAILABLE, naming no connection, when two connections claim the same account", () => {
    const v = verifySessionAccount({
      sellerAccountId: ACCOUNT,
      connections: [connection(), connection({ connectionId: "conn-2" })],
      signals: signals(),
    });
    expect(v.verdict).toBe("UNAVAILABLE");
    expect(v.reason).toBe("multiple-connections-for-account");
    // Naming one of them would be exactly the guess this fails closed to avoid.
    expect(v.connectionId).toBeNull();
  });

  it("UNAVAILABLE on a malformed account id rather than digesting whatever it was handed", () => {
    for (const bad of ["", "   ", "has space", "x".repeat(65), "line\nbreak"]) {
      const v = verifySessionAccount({
        sellerAccountId: bad,
        connections: [connection()],
        signals: signals(),
      });
      expect(v.verdict, `for ${JSON.stringify(bad)}`).toBe("UNAVAILABLE");
      expect(v.reason).toBe("malformed-account-id");
    }
  });

  // The verifier stays category-generic even though the guided session only ever produces `commerce-id`.
  // NOTE: this branch is not reachable through the guided CLI — a `cli/connection.ts` binding never writes
  // `boundSellerAccountFingerprint`, so such a connection is never linked to an account and dies earlier at
  // `no-connection-for-account` (scope §4.1). It is kept because `verifySessionAccount` is a shared pure
  // function, and because category-awareness is what stops a missing source reading as a mismatch.
  it("is category-aware: the same live page verifies against a url-path binding and not a commerce-id one", () => {
    const path = "/store/canary-path";
    const urlPathBound = connection({
      boundStoreFingerprintHash: fingerprintHash(path),
      fingerprintSourceCategory: "store-url-path",
    });
    const live = signals({ commerceIdCandidate: null, storeUrlPathCandidate: path });

    expect(verifySessionAccount({ sellerAccountId: ACCOUNT, connections: [urlPathBound], signals: live }).verdict).toBe(
      "MATCH",
    );
    // Same page, a commerce-id binding: the bound source is absent, so UNAVAILABLE — never MISMATCH.
    expect(verifySessionAccount({ sellerAccountId: ACCOUNT, connections: [connection()], signals: live }).reason).toBe(
      "bound-category-absent",
    );
  });
});

describe("verifySessionAccount — nothing identity-bearing survives into the result", () => {
  it("carries no store token, no digest, and no account id in any field", () => {
    const v = verifySessionAccount({
      sellerAccountId: ACCOUNT,
      connections: [connection()],
      signals: signals(),
    });
    const serialized = JSON.stringify(v);
    for (const secret of [
      ACCOUNT,
      STORE_TOKEN,
      "100200300",
      fingerprintHash(STORE_TOKEN),
      sellerAccountFingerprint(ACCOUNT)!,
    ]) {
      expect(serialized, `leaked ${secret.slice(0, 12)}…`).not.toContain(secret);
    }
    // The operator's own alias is the ONE free-form string allowed through, by design.
    expect(serialized).toContain(ALIAS);
  });

  it("reports which candidate slots the page populated, as categories only", () => {
    expect(observedCategories(signals())).toEqual(["commerce-id"]);
    expect(
      observedCategories(signals({ storeUrlPathCandidate: "/p", accountScopeCandidate: "  " })),
    ).toEqual(["commerce-id", "store-url-path"]);
    expect(observedCategories(signals({ commerceIdCandidate: null }))).toEqual([]);
  });
});

/** Wrap a verification as an observation; `chosenKey` defaults to the key the fixtures all read from. */
const obs = (v: ReturnType<typeof verifySessionAccount>, chosenKey: string | null = "channelNo") => ({
  verification: v,
  chosenKey,
});

describe("assertAccountUnchanged — the account switching between preflight and outline", () => {
  const preflight = verifySessionAccount({
    sellerAccountId: ACCOUNT,
    connections: [connection()],
    signals: signals(),
  });

  it("passes when the same connection still matches from the same source", () => {
    const again = verifySessionAccount({
      sellerAccountId: ACCOUNT,
      connections: [connection()],
      signals: signals(),
    });
    expect(assertAccountUnchanged(obs(preflight), obs(again))).toEqual({ ok: true });
  });

  it("fails closed when the operator switched to a different store mid-session", () => {
    const switched = verifySessionAccount({
      sellerAccountId: ACCOUNT,
      connections: [connection()],
      signals: signals({ commerceIdCandidate: OTHER_STORE_TOKEN }),
    });
    expect(switched.verdict).toBe("MISMATCH");
    expect(assertAccountUnchanged(obs(preflight), obs(switched))).toEqual({ ok: false, reason: "verdict-changed" });
  });

  it("fails closed when the identity merely became unreadable mid-session", () => {
    // Losing sight of the store is not evidence that it is still the right one.
    const blind = verifySessionAccount({
      sellerAccountId: ACCOUNT,
      connections: [connection()],
      signals: signals({ commerceIdCandidate: null }),
    });
    expect(blind.verdict).toBe("UNAVAILABLE");
    expect(assertAccountUnchanged(obs(preflight), obs(blind)).ok).toBe(false);
  });

  it("fails closed when a different connection answers for the account", () => {
    const other = verifySessionAccount({
      sellerAccountId: ACCOUNT,
      connections: [connection({ connectionId: "conn-9" })],
      signals: signals(),
    });
    expect(other.verdict).toBe("MATCH");
    expect(assertAccountUnchanged(obs(preflight), obs(other))).toEqual({ ok: false, reason: "connection-changed" });
  });

  it("fails closed when the second verdict was read from a DIFFERENT live field", () => {
    // The check with real teeth. Both reads MATCH the same connection from the same bound category, so every
    // other comparison passes — only the live key differs, meaning the two verdicts are not the same
    // observation. `boundSourceCategory` comes from the stored record and is near-constant within a run, so
    // without this the drift check would be nearly vacuous in the real flow.
    const same = verifySessionAccount({
      sellerAccountId: ACCOUNT,
      connections: [connection()],
      signals: signals(),
    });
    expect(assertAccountUnchanged(obs(preflight, "channelNo"), obs(same, "mallNo"))).toEqual({
      ok: false,
      reason: "evidence-changed",
    });
  });

  it("fails closed when the two verdicts rest on a different BOUND source", () => {
    const path = "/store/canary-path";
    const bySource = verifySessionAccount({
      sellerAccountId: ACCOUNT,
      connections: [
        connection({
          boundStoreFingerprintHash: fingerprintHash(path),
          fingerprintSourceCategory: "store-url-path",
        }),
      ],
      signals: signals({ commerceIdCandidate: null, storeUrlPathCandidate: path }),
    });
    expect(bySource.verdict).toBe("MATCH");
    expect(assertAccountUnchanged(obs(preflight), obs(bySource))).toEqual({ ok: false, reason: "source-changed" });
  });
});
