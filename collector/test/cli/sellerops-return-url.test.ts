/**
 * Where the walk's last button is allowed to send the seller.
 *
 * This navigation is triggered by a button on a MARKETPLACE page, against a destination read from operator
 * configuration — so it is screened like the WING landing is, and refuses rather than guesses.
 */
import { describe, it, expect } from "vitest";
import {
  SELLEROPS_COUPANG_CONNECT_PATH,
  screenSellerOpsReturnUrl,
} from "../../src/cli/sellerops-return-url";

describe("screenSellerOpsReturnUrl", () => {
  it("accepts the local SellerOps UI and returns the connect route", () => {
    expect(screenSellerOpsReturnUrl("http://localhost:5173")).toEqual({
      ok: true,
      url: `http://localhost:5173${SELLEROPS_COUPANG_CONNECT_PATH}`,
    });
  });

  it("accepts the other spelling of loopback, and a non-default port", () => {
    expect(screenSellerOpsReturnUrl("http://127.0.0.1:4173")).toEqual({
      ok: true,
      url: `http://127.0.0.1:4173${SELLEROPS_COUPANG_CONNECT_PATH}`,
    });
  });

  it("**keeps only the ORIGIN** — nothing configured can ride along in the destination", () => {
    // A path, a query and a fragment on the configured value are all dropped. The route is ours to decide.
    expect(screenSellerOpsReturnUrl("http://localhost:5173/somewhere?next=x#y")).toEqual({
      ok: true,
      url: `http://localhost:5173${SELLEROPS_COUPANG_CONNECT_PATH}`,
    });
  });

  it("**refuses any host that is not this machine**", () => {
    for (const off of ["http://example.com", "https://wing.coupang.com", "http://localhost.evil.com", "http://192.168.1.9:5173"]) {
      expect(screenSellerOpsReturnUrl(off), off).toEqual({ ok: false, reason: "NOT_LOOPBACK" });
    }
  });

  it("refuses a non-http scheme — a browser window is not something to point at file: or javascript:", () => {
    expect(screenSellerOpsReturnUrl("file:///Users/someone/x.html").ok).toBe(false);
    expect(screenSellerOpsReturnUrl("javascript:alert(1)")).toEqual({ ok: false, reason: "NOT_HTTP" });
  });

  it("refuses an empty or unparseable value rather than defaulting to something", () => {
    expect(screenSellerOpsReturnUrl(undefined)).toEqual({ ok: false, reason: "EMPTY" });
    expect(screenSellerOpsReturnUrl("   ")).toEqual({ ok: false, reason: "EMPTY" });
    expect(screenSellerOpsReturnUrl("not a url")).toEqual({ ok: false, reason: "UNPARSEABLE" });
  });

  it("its refusal reasons carry no URL and no host — they are logged", () => {
    const res = screenSellerOpsReturnUrl("https://wing.coupang.com/secret-path");
    expect(res.ok).toBe(false);
    expect(JSON.stringify(res)).not.toContain("coupang");
    expect(JSON.stringify(res)).not.toContain("secret-path");
  });
});
