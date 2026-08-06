/**
 * Source guard for the LIVE `CoupangWingIssuanceDriver` (and its gated CLI).
 *
 * The driver lives OUTSIDE `coupang-issuance/` precisely because it legitimately runs `.evaluate` for the census
 * / overlay / read-only tagging — so the pure `coupang-issuance/` strict guard stays intact and is NOT touched.
 * This guard mirrors the NAVER issuance-driver boundary: it ALLOWS `.evaluate(` / `setAttribute`, but still
 * forbids EVERY click/type/submit/issue and EVERY field-VALUE read (incl. the Access Key / Secret Key / 업체코드).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const DRIVER = resolve(HERE, "../../../src/action-window/coupang-wing-issuance-driver.ts");
const CLI = resolve(HERE, "../../../src/cli/run-coupang-wing-issuance-live.ts");

/** Strip block comments and comment/JSDoc lines so prose mentioning a forbidden token never trips. */
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

/** No way to act on a WING control — the SELLER clicks (incl. pressing 발급); the driver observes + annotates. */
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
  ".value", // a bare read (`node.value`) OR a write (`x.value =`) — both forbidden.
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

/** No way to navigate the seller's own dedicated window. */
const NO_NAV_TOKENS = [".goBack(", ".goForward(", ".reload(", "waitForNavigation", "window.open"] as const;

describe("CoupangWingIssuanceDriver — source guard (no click/type/submit/issue, no value read)", () => {
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

  it("never navigates at all — it reads wherever the seller went (no .goto)", () => {
    expect(code).not.toContain(".goto(");
  });

  it("ALLOWS the observation/annotation primitives it legitimately needs (evaluate + overlay)", () => {
    expect(code).toContain("evaluate");
    expect(code).toContain("mountOverlay");
  });

  it("locates by the VALUE-FREE fixed-label locate script (never a text/attribute read in the driver itself)", () => {
    // The driver delegates location to the audited `buildFixedLabelLocateScript` (guarded separately for
    // value-free OUTPUT). The driver source itself contains NO text/attribute read.
    expect(code).toContain("buildFixedLabelLocateScript");
    expect(code).not.toContain("el.childElementCount");
    expect(code).not.toContain("IN_PAGE_SIG_FACTORY");
  });

  it("treats reach_open_api and return as guidance-only — fixed synthetic signatures, never queried controls", () => {
    expect(code).toContain("REACH_OPEN_API_GUIDANCE_SIG");
    expect(code).toContain("RETURN_GUIDANCE_SIG");
  });

  it("marks its fixed-label candidates LIVE_DOM_CALIBRATION_PENDING (a NEVER-run scaffold, not calibrated)", () => {
    expect(code).toContain("LIVE_DOM_CALIBRATION_PENDING");
  });
});

describe("run-coupang-wing-issuance-live CLI — source guard (gated, no click/type/submit, no value read)", () => {
  const code = codeOnly(CLI);

  it.each(NO_ACTION_TOKENS)("never contains %s", (token) => {
    expect(code).not.toContain(token);
  });

  it.each(NO_VALUE_READ_TOKENS)("never reads a field value / clipboard / screenshot (%s)", (token) => {
    expect(code).not.toContain(token);
  });

  it.each(NO_NAV_TOKENS)("never re-navigates the seller's window (%s)", (token) => {
    expect(code).not.toContain(token);
  });

  it("navigates exactly ONCE — to the pre-screened URL only", () => {
    expect(code.split("page.goto(").length - 1).toBe(1);
  });

  it("is gated on the explicit live-run approval flag and fails closed on a bad URL before launch", () => {
    expect(code).toContain("hasLiveRunApproval");
    expect(code).toContain("screenWingUrl");
    // main() runs only when invoked directly — inert on import.
    expect(code).toContain("import.meta.url === pathToFileURL(process.argv[1]).href");
    // Reads the operator-owned WING URL env, never a NAVER one.
    expect(code).toContain("COUPANG_WING_URL");
  });
});
