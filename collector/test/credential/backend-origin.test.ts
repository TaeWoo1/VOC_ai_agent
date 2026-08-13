/**
 * Where the three plaintext secrets are allowed to go. The one boundary on that path, and until review it was
 * not screened at all — `SELLEROPS_BASE_URL` went straight to the POST, and to the `login()` beside it.
 */
import { describe, expect, it } from "vitest";
import {
  backendOriginRefusalMessage,
  screenCredentialBackendOrigin,
} from "../../src/credential/backend-origin";

describe("this machine, and nothing else", () => {
  for (const ok of [
    "http://localhost:8080",
    "http://127.0.0.1:8080",
    "http://[::1]:8080",
    "https://localhost:8443",
    "http://sellerops.localhost",
    "http://backend.test",
    "http://mac.local:8080",
  ]) {
    it(`accepts ${ok}`, () => {
      expect(screenCredentialBackendOrigin(ok).ok).toBe(true);
    });
  }

  for (const [bad, reason] of [
    ["https://evil.example.com", "NOT_LOCAL"],
    ["http://10.0.0.5:8080", "NOT_LOCAL"],
    ["http://localhost.evil.com", "NOT_LOCAL"],
    ["file:///etc/passwd", "NOT_HTTP"],
    ["ftp://localhost", "NOT_HTTP"],
    ["not a url", "UNPARSEABLE"],
    ["", "EMPTY"],
    [undefined, "EMPTY"],
  ] as const) {
    it(`refuses ${String(bad)} with ${reason}`, () => {
      expect(screenCredentialBackendOrigin(bad as string | undefined)).toEqual({ ok: false, reason });
    });
  }

  it("returns the ORIGIN only — a configured path cannot redirect the POST", () => {
    const screened = screenCredentialBackendOrigin("http://localhost:8080/some/path?q=1#f");
    expect(screened).toEqual({ ok: true, origin: "http://localhost:8080" });
  });

  it("`localhost.evil.com` is not loopback — the suffix rule is on the LABEL, not the substring", () => {
    expect(screenCredentialBackendOrigin("http://localhost.evil.com")).toEqual({ ok: false, reason: "NOT_LOCAL" });
  });

  it("the refusal message names the reason and never the configured value", () => {
    const msg = backendOriginRefusalMessage("NOT_LOCAL");
    expect(msg).toContain("NOT_LOCAL");
    expect(msg).not.toContain("evil");
  });
});
