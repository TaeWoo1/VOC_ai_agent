import { describe, it, expect } from "vitest";
import {
  decideImportBoot,
  importBootRefusalMessage,
  parseImportConsent,
  NO_IMPORT_CONSENT,
  type ImportConsentRecord,
} from "../../src/runtime/production-import-gate";

const consented: ImportConsentRecord = {
  importEnabled: true,
  acceptedAt: "2026-07-28T00:00:00.000Z",
  acceptedVersion: "1.0.0",
};

describe("parseImportConsent — fail-closed", () => {
  it("absent/blank/corrupt → consent off", () => {
    expect(parseImportConsent(null)).toEqual(NO_IMPORT_CONSENT);
    expect(parseImportConsent("")).toEqual(NO_IMPORT_CONSENT);
    expect(parseImportConsent("{bad")).toEqual(NO_IMPORT_CONSENT);
    expect(parseImportConsent("{}").importEnabled).toBe(false);
  });

  it("reads an explicit importEnabled:true", () => {
    expect(parseImportConsent(JSON.stringify(consented)).importEnabled).toBe(true);
  });
});

describe("decideImportBoot — production path (no dev flag)", () => {
  const prod = { NODE_ENV: "production" } as NodeJS.ProcessEnv;

  it("hosts import with recorded consent and NO flags", () => {
    expect(decideImportBoot([], prod, consented)).toEqual({ host: true, via: "production_consent" });
  });

  it("fails closed without consent", () => {
    expect(decideImportBoot([], prod, NO_IMPORT_CONSENT)).toEqual({ host: false, reason: "CONSENT_MISSING" });
  });

  it("refuses on a non-interactive / scheduled host even in production (no seated human)", () => {
    for (const key of ["CI", "SELLEROPS_SCHEDULED", "SELLEROPS_HEADLESS_AGENT"]) {
      const env = { NODE_ENV: "production", [key]: "1" } as NodeJS.ProcessEnv;
      expect(decideImportBoot([], env, consented)).toEqual({ host: false, reason: "NON_INTERACTIVE" });
    }
  });

  it("refuses when another carrier flag is present", () => {
    expect(decideImportBoot(["--dev-action-window-reply"], prod, consented)).toEqual({
      host: false,
      reason: "CARRIER_CONFLICT",
    });
  });
});

describe("decideImportBoot — dev path unchanged (flags still required)", () => {
  const dev = {} as NodeJS.ProcessEnv;

  it("not requested → NOT_REQUESTED", () => {
    expect(decideImportBoot([], dev, NO_IMPORT_CONSENT)).toEqual({ host: false, reason: "NOT_REQUESTED" });
  });

  it("dev import flag WITHOUT the live-approval flag is refused (dev gate)", () => {
    expect(decideImportBoot(["--action-window-initial-review-import"], dev, NO_IMPORT_CONSENT)).toEqual({
      host: false,
      reason: "DEV_GATE_REFUSED",
    });
  });

  it("both dev flags → hosts via dev_flags", () => {
    expect(
      decideImportBoot(
        ["--action-window-initial-review-import", "--i-understand-this-opens-live-naver"],
        dev,
        NO_IMPORT_CONSENT,
      ),
    ).toEqual({ host: true, via: "dev_flags" });
  });

  it("consent does NOT bypass the dev gate off production", () => {
    // In dev, even with a consent record, the flag gate governs — consent is a production concept.
    expect(decideImportBoot([], dev, consented)).toEqual({ host: false, reason: "NOT_REQUESTED" });
  });
});

describe("importBootRefusalMessage", () => {
  it("is null for the ordinary non-import boot and Korean copy otherwise", () => {
    expect(importBootRefusalMessage("NOT_REQUESTED")).toBeNull();
    expect(importBootRefusalMessage("CONSENT_MISSING")).toContain("동의");
    expect(importBootRefusalMessage("NON_INTERACTIVE")).toContain("로그인");
  });
});
