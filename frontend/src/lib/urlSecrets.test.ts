// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { captureUrlSecrets, takeUrlSecret } from "./urlSecrets";

afterEach(() => sessionStorage.clear());

/** docs/service_readiness_v1.md §2-1 (review B1): a URL-borne one-time secret leaves the address bar before any vendor starts. */
describe("captureUrlSecrets", () => {
  it("moves ?token= / ?code= into sessionStorage and rewrites the URL, keeping the other params", () => {
    history.replaceState(null, "", "/reset-password?token=ONE-TIME&x=1#frag");
    expect(captureUrlSecrets()).toBe(true);
    expect(location.pathname + location.search + location.hash).toBe("/reset-password?x=1#frag");
    expect(takeUrlSecret("token")).toBe("ONE-TIME");
    expect(takeUrlSecret("token")).toBeNull(); // taken once
    history.replaceState(null, "", "/auth/callback?code=C1");
    captureUrlSecrets();
    expect(location.search).toBe("");
    expect(takeUrlSecret("code")).toBe("C1");
  });

  it("does nothing on a URL without a secret, and does not hand a secret to another path", () => {
    history.replaceState(null, "", "/product?utm_source=x");
    expect(captureUrlSecrets()).toBe(false);
    expect(location.search).toBe("?utm_source=x");
    history.replaceState(null, "", "/reset-password?token=T");
    captureUrlSecrets();
    history.replaceState(null, "", "/login");
    expect(takeUrlSecret("token")).toBeNull();
  });
});
