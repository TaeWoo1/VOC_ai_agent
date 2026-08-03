import { describe, expect, it } from "vitest";
import {
  CTA_DEMO_LABEL,
  CTA_DIAGNOSIS_LABEL,
  DEMO_ENTRY_PATH,
  diagnosisFormUrl,
} from "./publicCta";

describe("public CTA contract", () => {
  it("fixes the two public CTA labels", () => {
    expect(CTA_DIAGNOSIS_LABEL).toBe("무료 운영 진단 받기");
    expect(CTA_DEMO_LABEL).toBe("데모 화면 보기");
  });

  it("sends the demo CTA to the demo-flagged login", () => {
    expect(DEMO_ENTRY_PATH).toBe("/login?demo=1");
  });
});

describe("diagnosisFormUrl — fails closed", () => {
  it("accepts an absolute https form URL", () => {
    expect(diagnosisFormUrl("https://tally.so/r/abc123")).toBe("https://tally.so/r/abc123");
  });

  it("accepts http (self-hosted / staging forms)", () => {
    expect(diagnosisFormUrl("http://forms.example.test/x")).toBe("http://forms.example.test/x");
  });

  it("trims surrounding whitespace", () => {
    expect(diagnosisFormUrl("  https://example.test/f  ")).toBe("https://example.test/f");
  });

  for (const missing of [undefined, "", "   "]) {
    it(`returns null for a missing value (${JSON.stringify(missing)})`, () => {
      expect(diagnosisFormUrl(missing)).toBeNull();
    });
  }

  it("returns null for a relative path (not an absolute URL)", () => {
    expect(diagnosisFormUrl("/diagnosis")).toBeNull();
  });

  it("returns null for a non-http(s) scheme", () => {
    // A public page must never turn a misconfigured env var into a clickable script link.
    expect(diagnosisFormUrl("javascript:alert(1)")).toBeNull();
    expect(diagnosisFormUrl("data:text/html,<h1>x</h1>")).toBeNull();
    expect(diagnosisFormUrl("mailto:someone@example.test")).toBeNull();
  });

  it("returns null for a non-string value", () => {
    expect(diagnosisFormUrl(undefined)).toBeNull();
  });
});
