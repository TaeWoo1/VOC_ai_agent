/**
 * The safe-allowlist WING `유효기간` (validity-period) reader — the PURE sanitizer + the ALLOWLIST + the
 * SOURCE GUARD proving the reader can only ever emit a date, never a key.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  WING_SAFE_READ_ALLOWLIST,
  WING_VALIDITY_LABELS,
  buildValidityDateExtractScript,
  sanitizeValidityDate,
} from "../../../src/action-window/coupang-renewal/wing-validity-reader";

const HERE = dirname(fileURLToPath(import.meta.url));
const READER = resolve(HERE, "../../../src/action-window/coupang-renewal/wing-validity-reader.ts");

/** Strip block comments and comment/JSDoc lines so prose mentioning a forbidden token never trips the guard. */
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

const ISO = /^\d{4}-\d{2}-\d{2}$/;

describe("wing-validity-reader — sanitizeValidityDate returns a sanitized ISO date or null", () => {
  it.each([
    ["2027-03-15", "2027-03-15"],
    ["2027. 03. 15", "2027-03-15"], // WING's dotted-with-spaces form
    ["2027.3.15", "2027-03-15"],
    ["2027/03/15", "2027-03-15"],
    ["2027년 3월 15일", "2027-03-15"], // Korean form (일 suffix ignored)
    ["유효기간 2027-03-15 까지", "2027-03-15"], // embedded in the row text
    ["2028-02-29", "2028-02-29"], // leap year — valid
  ])("parses %s → %s", (raw, expected) => {
    expect(sanitizeValidityDate(raw)).toBe(expected);
  });

  it.each([
    ["", "empty"],
    ["N/A", "no date"],
    ["곧 만료", "prose, no date"],
    ["2027-13-40", "out-of-range month + day"],
    ["2027-02-29", "Feb 29 in a non-leap year"],
    ["2027-00-10", "zero month"],
    ["2027-05-00", "zero day"],
    ["20270315", "no separators"],
  ])("rejects %s (%s) → null", (raw) => {
    expect(sanitizeValidityDate(raw)).toBeNull();
  });

  it("returns null for a missing / non-string value", () => {
    expect(sanitizeValidityDate(null)).toBeNull();
    expect(sanitizeValidityDate(undefined)).toBeNull();
    // @ts-expect-error — a number is not a valid input; it must fail closed, not coerce.
    expect(sanitizeValidityDate(20270315)).toBeNull();
  });

  it("NEVER emits anything but an ISO date or null — even for KEY-shaped tokens the output is never the input", () => {
    const keyShaped = [
      "AKIAIOSFODNN7EXAMPLE", // Access Key id shape
      "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", // Secret Key shape
      "9f8a7b6c5d4e3f2a1b0c", // hex vendor-code shape
      "abcdef0123456789abcdef0123456789", // long hex
      "1234-5678-9012-3456", // card-ish digits
    ];
    for (const token of keyShaped) {
      const out = sanitizeValidityDate(token);
      // Structurally the output can ONLY be a valid ISO date or null — never the secret itself, never letters.
      expect(out === null || ISO.test(out)).toBe(true);
      expect(out).not.toBe(token);
    }
  });
});

describe("wing-validity-reader — the ALLOWLIST names 유효기간/date as the ONLY thing read", () => {
  it("WING_SAFE_READ_ALLOWLIST allows exactly the 유효기간 label and a date output", () => {
    expect(WING_SAFE_READ_ALLOWLIST.label).toBe("유효기간");
    expect(WING_SAFE_READ_ALLOWLIST.reads).toBe("date");
    expect(WING_SAFE_READ_ALLOWLIST.outputShape).toBe("YYYY-MM-DD|null");
    // The allowlist never names a key label/value.
    const asText = JSON.stringify(WING_SAFE_READ_ALLOWLIST);
    for (const key of ["Access Key", "Secret Key", "업체코드"]) expect(asText).not.toContain(key);
  });

  it("WING_VALIDITY_LABELS is exactly the fixed 유효기간 anchor", () => {
    expect([...WING_VALIDITY_LABELS]).toEqual(["유효기간"]);
  });
});

describe("wing-validity-reader — SOURCE GUARD: forbids reading any key label/value; only the date is read", () => {
  const code = codeOnly(READER);
  const inPage = buildValidityDateExtractScript();

  it("never names a KEY label (so the extract can never query an Access/Secret/업체코드 region)", () => {
    for (const key of ["Access Key", "Secret Key", "업체코드", "accessKey", "secretKey", "vendorId"]) {
      expect(code, key).not.toContain(key);
      expect(inPage, key).not.toContain(key);
    }
  });

  it("never reads a field value / attribute / clipboard / screenshot / raw DOM", () => {
    for (const token of [
      ".inputValue(",
      ".value",
      ".innerHTML",
      ".outerHTML",
      ".getAttribute(",
      "clipboard",
      "readText(",
      ".screenshot(",
      "page.content(",
      ".content(",
      ".setInputFiles(",
    ]) {
      expect(code, token).not.toContain(token);
      expect(inPage, token).not.toContain(token);
    }
  });

  it("never clicks / types / submits / re-issues", () => {
    for (const token of [".click(", ".type(", ".fill(", ".press(", ".submit(", ".selectOption(", "dispatchEvent"]) {
      expect(code, token).not.toContain(token);
      expect(inPage, token).not.toContain(token);
    }
  });

  it("reads ONLY the allowlisted 유효기간 date — the single textContent read, anchored on the fixed label", () => {
    // The one allowlisted read: textContent, present in the in-page extract, anchored on the 유효기간 label.
    expect(inPage).toContain(".textContent");
    expect(inPage).toContain("유효기간");
    expect(code).toContain("WING_SAFE_READ_ALLOWLIST");
    // Only a date-shaped token leaves the page: the extract returns `{ raw: ... }`, then Node sanitizes it.
    expect(inPage).toContain("raw:");
    expect(code).toContain("sanitizeValidityDate");
  });
});
