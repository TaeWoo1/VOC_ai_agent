import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { connectionProfileDirFor, dedicatedProfileIdFor } from "../../src/agent/progressive-reconnect";
import type { SanitizedAccountRef } from "../../src/agent/progressive-reconnect";

const BASE = "/tmp/collector/.profile";
const acct = (connectionId: string): SanitizedAccountRef => ({
  connectionId,
  boundStoreFingerprintHash: null,
  fingerprintSourceCategory: null,
});

describe("connectionProfileDirFor — the single shared ESM profile resolver", () => {
  it("resolves to `${base}/${dedicatedProfileIdFor(id)}` (same leaf the local-agent path uses)", () => {
    const dir = connectionProfileDirFor(BASE, "esm-live-g0");
    expect(dir).toBe(resolve(BASE, dedicatedProfileIdFor(acct("esm-live-g0"))));
    // The leaf is the existing, unchanged `esm-agent-<24 hex>` format.
    expect(dedicatedProfileIdFor(acct("esm-live-g0"))).toMatch(/^esm-agent-[0-9a-f]{24}$/);
  });

  it("preserves the existing dedicatedProfileIdFor output EXACTLY (no hash/leaf change)", () => {
    // Frozen expectation — a regression here means the G0 profile leaf moved and the live session is lost.
    expect(dedicatedProfileIdFor(acct("esm-live-g0"))).toBe("esm-agent-53b946f1c770dddb0b83890d");
    expect(connectionProfileDirFor(BASE, "esm-live-g0")).toBe(resolve(BASE, "esm-agent-53b946f1c770dddb0b83890d"));
  });

  it("is deterministic: the same connectionId resolves identically across calls", () => {
    expect(connectionProfileDirFor(BASE, "conn-A")).toBe(connectionProfileDirFor(BASE, "conn-A"));
  });

  it("two different connectionIds resolve to different profiles", () => {
    expect(connectionProfileDirFor(BASE, "conn-A")).not.toBe(connectionProfileDirFor(BASE, "conn-B"));
  });

  it("profile identity is a function of connectionId ONLY (never marketplace / loginMode / capture kind)", () => {
    // The resolver takes only (base, connectionId) — there is no channel/marketplace/loginMode/kind input,
    // so the SAME id always yields the SAME dir no matter what the caller's marketplace or capture kind is.
    const forGmarket = connectionProfileDirFor(BASE, "esm-live-g0");
    const forAuction = connectionProfileDirFor(BASE, "esm-live-g0");
    expect(forGmarket).toBe(forAuction);
  });

  it("keeps unsafe / traversal input out of the filesystem name (hashed leaf, stays under base)", () => {
    const dir = connectionProfileDirFor(BASE, "../../../etc/passwd");
    expect(dir.startsWith(resolve(BASE) + "/")).toBe(true);
    // Only the sanitized `esm-agent-<hex>` leaf — no `..`, no separators from the raw id.
    expect(dir).toBe(resolve(BASE, dedicatedProfileIdFor(acct("../../../etc/passwd"))));
    expect(/esm-agent-[0-9a-f]{24}$/.test(dir)).toBe(true);
    expect(dir.includes("etc/passwd")).toBe(false);
  });
});
