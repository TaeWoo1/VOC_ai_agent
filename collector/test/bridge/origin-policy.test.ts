import { describe, it, expect } from "vitest";
import { isOriginAllowed, normalizeOrigin, parseAllowedOrigins } from "../../src/bridge/origin-policy";

describe("origin policy", () => {
  const allowed = ["https://app.sellerops.example", "http://localhost:5173"];

  it("allows an exactly-listed origin", () => {
    expect(isOriginAllowed("https://app.sellerops.example", allowed)).toBe(true);
    expect(isOriginAllowed("http://localhost:5173", allowed)).toBe(true);
  });

  it("rejects an unlisted origin", () => {
    expect(isOriginAllowed("https://evil.example", allowed)).toBe(false);
    expect(isOriginAllowed("http://localhost:6006", allowed)).toBe(false);
  });

  it("rejects a missing/empty origin (never ambient-trusts)", () => {
    expect(isOriginAllowed(undefined, allowed)).toBe(false);
    expect(isOriginAllowed(null, allowed)).toBe(false);
    expect(isOriginAllowed("", allowed)).toBe(false);
  });

  it("NEVER honors a wildcard entry", () => {
    expect(isOriginAllowed("https://anything.example", ["*"])).toBe(false);
    expect(isOriginAllowed("https://anything.example", ["*", "https://app.sellerops.example"])).toBe(false);
    expect(isOriginAllowed("https://app.sellerops.example", ["*", "https://app.sellerops.example"])).toBe(true);
  });

  it("normalizes and drops default ports / trailing slashes", () => {
    expect(normalizeOrigin("https://app.sellerops.example/")).toBe("https://app.sellerops.example");
    expect(normalizeOrigin("https://app.sellerops.example:443")).toBe("https://app.sellerops.example");
    expect(normalizeOrigin("not a url")).toBeNull();
  });

  it("parses an allow-list env value and strips blanks + wildcards", () => {
    expect(parseAllowedOrigins("http://localhost:5173, https://app.example  *")).toEqual([
      "http://localhost:5173",
      "https://app.example",
    ]);
    expect(parseAllowedOrigins(undefined)).toEqual([]);
    expect(parseAllowedOrigins("*")).toEqual([]);
  });
});
