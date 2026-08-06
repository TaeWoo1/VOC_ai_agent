/**
 * Source guard for the LIVE `CoupangWingRenewalDriver` scaffold.
 *
 * The driver lives OUTSIDE `coupang-renewal/` precisely because it legitimately runs `.evaluate` for the census /
 * overlay / read-only tagging — so the pure `coupang-renewal/` strict guard stays intact. This guard mirrors the
 * issuance-driver boundary: it ALLOWS `.evaluate` / `setAttribute`, but still forbids EVERY click/type/submit/
 * re-issue and EVERY field-VALUE read. The ONE value it may surface — the `유효기간` date — is delegated to the
 * audited `wing-validity-reader`, so the driver's own source contains no text/value read.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const DRIVER = resolve(HERE, "../../../src/action-window/coupang-wing-renewal-driver.ts");

function codeOnly(path: string): string {
  const raw = readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  return raw
    .split("\n")
    .filter((l) => {
      const t = l.trim();
      return !t.startsWith("//") && !t.startsWith("*");
    })
    .join("\n");
}

/** No way to act on a WING control — the SELLER clicks (incl. pressing 재발급); the driver observes + annotates. */
const NO_ACTION_TOKENS = [
  ".click(",
  ".dblclick(",
  ".tap(",
  ".hover(",
  ".type(",
  ".fill(",
  ".press(",
  ".check(",
  ".uncheck(",
  ".selectOption(",
  ".setInputFiles(",
  ".keyboard",
  "dispatchEvent",
  ".submit(",
  'waitForEvent("download"',
  "waitForEvent('download'",
] as const;

/** No way to read a field value, text, clipboard, or screenshot — the credential is never read. */
const NO_VALUE_READ_TOKENS = [
  ".inputValue(",
  ".value",
  ".textContent",
  ".innerText",
  ".innerHTML",
  ".outerHTML",
  ".getAttribute(",
  ".getProperty(",
  ".getProperties(",
  "page.content(",
  "clipboard",
  "readText(",
  ".screenshot(",
] as const;

const NO_NAV_TOKENS = [".goBack(", ".goForward(", ".reload(", "waitForNavigation", "window.open", ".goto("] as const;

describe("CoupangWingRenewalDriver — source guard (no click/type/submit/re-issue, no value read)", () => {
  const code = codeOnly(DRIVER);

  it.each(NO_ACTION_TOKENS)("never contains %s", (token) => {
    expect(code).not.toContain(token);
  });

  it.each(NO_VALUE_READ_TOKENS)("never reads a field value / clipboard / screenshot (%s)", (token) => {
    expect(code).not.toContain(token);
  });

  it.each(NO_NAV_TOKENS)("never navigates the seller's window (%s)", (token) => {
    expect(code).not.toContain(token);
  });

  it("ALLOWS the observation/annotation primitives it legitimately needs (evaluate + overlay + fixed-label locate)", () => {
    expect(code).toContain("evaluate");
    expect(code).toContain("mountOverlay");
    expect(code).toContain("buildFixedLabelLocateScript");
  });

  it("treats reach_open_api and return as guidance-only — fixed synthetic signatures, never queried controls", () => {
    expect(code).toContain("REACH_OPEN_API_GUIDANCE_SIG");
    expect(code).toContain("RETURN_GUIDANCE_SIG");
  });

  it("marks its fixed-label candidates LIVE_DOM_CALIBRATION_PENDING (a NEVER-run scaffold, not calibrated)", () => {
    expect(code).toContain("LIVE_DOM_CALIBRATION_PENDING");
    // The two NEW candidate WING labels this unit introduces — proposed, unproven.
    expect(code).toContain("유효기간");
    expect(code).toContain("재발급");
  });

  it("the ONLY value it surfaces is the 유효기간 date, delegated to the audited allowlisted reader", () => {
    expect(code).toContain("readValidityDate");
    expect(code).toContain("sanitizeValidityDate");
    expect(code).toContain("buildValidityDateExtractScript");
  });
});
