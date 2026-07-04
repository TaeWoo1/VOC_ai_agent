/**
 * Pure offline tests for the scoped seller → manufacturer DataGrant evaluation.
 *
 * Focus: an active in-scope grant allows; a revoked or time-expired grant denies every future access; each
 * scope axis (party, channel, product, signal kind) is enforced; seller-private fields are denied unless
 * explicitly granted. Time is always the caller-supplied `referenceTimeMs` — no wall-clock read.
 */

import { describe, it, expect } from "vitest";

import { evaluateGrant, type GrantAccessRequest } from "../../src/work/data-grant";
import { grant } from "./fixtures";

function req(overrides: Partial<GrantAccessRequest> = {}): GrantAccessRequest {
  return { sellerId: "seller-1", manufacturerId: "maker-1", channel: "NAVER", productId: "prod-1", signalKind: "cs_inquiry", needsSellerPrivateFields: false, ...overrides };
}

describe("evaluateGrant", () => {
  it("allows an in-scope, active, in-window access", () => {
    expect(evaluateGrant(grant(), req(), 1_000)).toEqual({ allowed: true });
  });

  it("denies when there is no grant", () => {
    expect(evaluateGrant(null, req(), 1_000)).toEqual({ allowed: false, reason: "NO_GRANT" });
  });

  it("denies a wrong seller / wrong manufacturer", () => {
    expect(evaluateGrant(grant(), req({ sellerId: "seller-2" }), 1_000)).toEqual({ allowed: false, reason: "WRONG_SELLER" });
    expect(evaluateGrant(grant(), req({ manufacturerId: "maker-2" }), 1_000)).toEqual({ allowed: false, reason: "WRONG_MANUFACTURER" });
  });

  it("denies a revoked grant regardless of time or scope", () => {
    expect(evaluateGrant(grant({ revoked: true }), req(), 1_000)).toEqual({ allowed: false, reason: "REVOKED" });
  });

  it("enforces the validity window [notBeforeMs, notAfterMs) against the reference time", () => {
    const g = grant({ notBeforeMs: 100, notAfterMs: 200 });
    expect(evaluateGrant(g, req(), 150)).toEqual({ allowed: true }); // inside
    expect(evaluateGrant(g, req(), 100)).toEqual({ allowed: true }); // lower bound inclusive
    expect(evaluateGrant(g, req(), 50)).toEqual({ allowed: false, reason: "NOT_YET_VALID" });
    expect(evaluateGrant(g, req(), 200)).toEqual({ allowed: false, reason: "EXPIRED" }); // upper bound exclusive
    expect(evaluateGrant(g, req(), 999)).toEqual({ allowed: false, reason: "EXPIRED" });
  });

  it("enforces each scope axis: channel, product, signal kind", () => {
    expect(evaluateGrant(grant(), req({ channel: "ESM" }), 1_000)).toEqual({ allowed: false, reason: "CHANNEL_OUT_OF_SCOPE" });
    expect(evaluateGrant(grant(), req({ productId: "prod-9" }), 1_000)).toEqual({ allowed: false, reason: "PRODUCT_OUT_OF_SCOPE" });
    expect(evaluateGrant(grant(), req({ productId: null }), 1_000)).toEqual({ allowed: false, reason: "PRODUCT_OUT_OF_SCOPE" });
    expect(evaluateGrant(grant(), req({ signalKind: "claim" }), 1_000)).toEqual({ allowed: false, reason: "SIGNAL_KIND_OUT_OF_SCOPE" });
  });

  it("an ALL-products grant covers any product (including an unspecified one)", () => {
    const g = grant({}, { productIds: "ALL" });
    expect(evaluateGrant(g, req({ productId: "anything" }), 1_000)).toEqual({ allowed: true });
    expect(evaluateGrant(g, req({ productId: null }), 1_000)).toEqual({ allowed: true });
  });

  it("denies seller-private fields unless the grant explicitly includes them", () => {
    expect(evaluateGrant(grant(), req({ needsSellerPrivateFields: true }), 1_000)).toEqual({ allowed: false, reason: "SELLER_PRIVATE_NOT_GRANTED" });
    const withPrivate = grant({}, { includeSellerPrivateFields: true });
    expect(evaluateGrant(withPrivate, req({ needsSellerPrivateFields: true }), 1_000)).toEqual({ allowed: true });
  });
});
