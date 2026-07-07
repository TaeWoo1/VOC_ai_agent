import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveCaptureConnectionProfile } from "../../src/cli/esm-capture-connection";
import { connectionProfileDirFor, dedicatedProfileIdFor } from "../../src/agent/progressive-reconnect";
import type { SanitizedAccountRef } from "../../src/agent/progressive-reconnect";

const BASE = "/tmp/collector/.profile";
const acct = (connectionId: string): SanitizedAccountRef => ({
  connectionId,
  boundStoreFingerprintHash: null,
  fingerprintSourceCategory: null,
});

const esmDescriptor = (over: Record<string, unknown> = {}): string =>
  JSON.stringify([
    {
      connectionId: "esm-live-g0",
      channel: "ESM",
      loginMode: "ESM_PLUS",
      autoReconnectConsent: true,
      autoSubmitConsent: false,
      assistedReconnectConsent: true,
      autoReconnectCapability: "ASSISTED_ONLY",
      ...over,
    },
  ]);

describe("resolveCaptureConnectionProfile — connection-explicit ESM capture profile", () => {
  it("a runnable ESM connection resolves to the SAME profile as the local-agent reconnect path", () => {
    const r = resolveCaptureConnectionProfile({ connectionsRaw: esmDescriptor(), connectionId: "esm-live-g0", profileBaseDir: BASE });
    expect(r.ok).toBe(true);
    if (r.ok) {
      // Identical to what local-agent-progressive-service now derives (same shared resolver + leaf).
      expect(r.profileDir).toBe(connectionProfileDirFor(BASE, "esm-live-g0"));
      expect(r.profileDir).toBe(resolve(BASE, dedicatedProfileIdFor(acct("esm-live-g0"))));
    }
  });

  it("profile identity is independent of a marketplace field on the descriptor", () => {
    const plain = resolveCaptureConnectionProfile({ connectionsRaw: esmDescriptor(), connectionId: "esm-live-g0", profileBaseDir: BASE });
    const withMarket = resolveCaptureConnectionProfile({
      connectionsRaw: esmDescriptor({ marketplace: "AUCTION" }),
      connectionId: "esm-live-g0",
      profileBaseDir: BASE,
    });
    expect(plain.ok && withMarket.ok).toBe(true);
    if (plain.ok && withMarket.ok) expect(plain.profileDir).toBe(withMarket.profileDir);
  });

  it("profile identity is independent of loginMode", () => {
    const a = resolveCaptureConnectionProfile({ connectionsRaw: esmDescriptor({ loginMode: "ESM_PLUS" }), connectionId: "esm-live-g0", profileBaseDir: BASE });
    const b = resolveCaptureConnectionProfile({ connectionsRaw: esmDescriptor({ loginMode: "GMARKET" }), connectionId: "esm-live-g0", profileBaseDir: BASE });
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) expect(a.profileDir).toBe(b.profileDir);
  });

  it("profile identity is independent of capture kind (the resolver has no kind input)", () => {
    // The resolver is keyed on connectionId only; a REVIEW vs INQUIRY capture reuses the same connection profile.
    const first = resolveCaptureConnectionProfile({ connectionsRaw: esmDescriptor(), connectionId: "esm-live-g0", profileBaseDir: BASE });
    const second = resolveCaptureConnectionProfile({ connectionsRaw: esmDescriptor(), connectionId: "esm-live-g0", profileBaseDir: BASE });
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) expect(first.profileDir).toBe(second.profileDir);
  });

  it("fails closed on an unknown connection id (no profile, no implicit fallback)", () => {
    const r = resolveCaptureConnectionProfile({ connectionsRaw: esmDescriptor(), connectionId: "does-not-exist", profileBaseDir: BASE });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("connection-not-found");
    // No `.profile/esm` default is ever returned.
    expect(JSON.stringify(r).includes("profileDir")).toBe(false);
  });

  it("fails closed on an empty connection id", () => {
    const r = resolveCaptureConnectionProfile({ connectionsRaw: esmDescriptor(), connectionId: "", profileBaseDir: BASE });
    expect(r.ok).toBe(false);
  });

  it("fails closed on a non-ESM channel (NAVER is BROWSER but not ESM)", () => {
    const naver = JSON.stringify([
      { connectionId: "naver-1", channel: "NAVER", loginMode: "ESM_PLUS", autoReconnectConsent: true, autoSubmitConsent: false, assistedReconnectConsent: true },
    ]);
    const r = resolveCaptureConnectionProfile({ connectionsRaw: naver, connectionId: "naver-1", profileBaseDir: BASE });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("channel-not-esm");
  });

  it("fails closed on a non-BROWSER channel (CAFE24 API is not a browser capture connection)", () => {
    const cafe = JSON.stringify([{ connectionId: "cafe-1", channel: "CAFE24" }]);
    const r = resolveCaptureConnectionProfile({ connectionsRaw: cafe, connectionId: "cafe-1", profileBaseDir: BASE });
    expect(r.ok).toBe(false);
  });

  it("fails closed on an invalid descriptor", () => {
    const r = resolveCaptureConnectionProfile({ connectionsRaw: "{ not json", connectionId: "esm-live-g0", profileBaseDir: BASE });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("descriptor-invalid");
  });
});
