/**
 * **Turning a binding into a target** — and refusing, in one way, everything that is not one.
 *
 * The load-bearing test here is the partial answer. A target that matched on fewer fields the emptier it got
 * would, at its emptiest, match every row on the page — and the run would ring one of the seller's buyers'
 * reviews at random. So a response missing any field is not a weaker target; it is no target.
 */
import { describe, expect, it, vi } from "vitest";
import {
  fetchReviewLocateTarget,
  parseTarget,
} from "../../src/action-window/coupang-review/review-locate-target-client";

const REF = "a1b2c3d4e5f60718";
const BASE = "http://127.0.0.1:8080";
const TOKEN = "jwt";

const WIRE = {
  channelCode: "COUPANG",
  productId: "15411270785",
  vendorItemId: "81234567890",
  writtenOn: "2026-08-11",
  rating: 5,
  bodyFingerprint: "f".repeat(64),
};

function respond(body: unknown, ok = true, status = 200): typeof fetch {
  return vi.fn(async () => ({
    ok,
    status,
    json: async () => body,
  })) as unknown as typeof fetch;
}

describe("review locate target client", () => {
  it("resolves the wire shape into exactly what the matcher compares", async () => {
    const target = await fetchReviewLocateTarget(BASE, TOKEN, REF, respond(WIRE));

    expect(target).toEqual({
      productId: "15411270785",
      vendorItemId: "81234567890",
      writtenOn: "2026-08-11",
      rating: 5,
      bodyFingerprint: "f".repeat(64),
    });
  });

  /** The token is a single-use secret: it goes in the body, never in a path a proxy log would keep. */
  it("spends the binding with a POST that carries it in the body", async () => {
    const fetchImpl = respond(WIRE);
    await fetchReviewLocateTarget(BASE, TOKEN, REF, fetchImpl);

    const [url, init] = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]!;
    expect(url).toBe(`${BASE}/api/agent/review-locate-targets`);
    expect(url).not.toContain(REF);
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ locateRef: REF });
  });

  it("treats a row with no option id as a target that simply does not narrow on one", async () => {
    const target = await fetchReviewLocateTarget(BASE, TOKEN, REF, respond({ ...WIRE, vendorItemId: null }));

    expect(target?.vendorItemId).toBeNull();
  });

  it.each([
    ["no product", { ...WIRE, productId: null }],
    ["no date", { ...WIRE, writtenOn: null }],
    ["a date that is not one", { ...WIRE, writtenOn: "2026-8-1" }],
    ["no rating", { ...WIRE, rating: null }],
    ["a rating off the scale", { ...WIRE, rating: 9 }],
    ["no fingerprint", { ...WIRE, bodyFingerprint: null }],
    ["a fingerprint of the wrong shape", { ...WIRE, bodyFingerprint: "abc" }],
    ["an option id that is not a string", { ...WIRE, vendorItemId: 42 }],
  ])("refuses a partial target: %s", (_label, body) => {
    expect(parseTarget(body)).toBeNull();
  });

  it("refuses a malformed binding before it reaches the network", async () => {
    const fetchImpl = respond(WIRE);
    expect(await fetchReviewLocateTarget(BASE, TOKEN, "not-a-ref", fetchImpl)).toBeNull();
    expect((fetchImpl as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(0);
  });

  /** Spent, expired, another tenant's, or a backend that is down — one answer, because one repair. */
  it("answers null to every refusal", async () => {
    expect(await fetchReviewLocateTarget(BASE, TOKEN, REF, respond(null, false, 404))).toBeNull();
    expect(await fetchReviewLocateTarget(BASE, TOKEN, REF, respond(null, false, 400))).toBeNull();
    const thrower = vi.fn(async () => {
      throw new Error("connect ECONNREFUSED 127.0.0.1:8080");
    }) as unknown as typeof fetch;
    expect(await fetchReviewLocateTarget(BASE, TOKEN, REF, thrower)).toBeNull();
  });

  it("answers null to a 200 that is not JSON", async () => {
    const notJson = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected token < in JSON at position 0");
      },
    })) as unknown as typeof fetch;

    expect(await fetchReviewLocateTarget(BASE, TOKEN, REF, notJson)).toBeNull();
  });
});
