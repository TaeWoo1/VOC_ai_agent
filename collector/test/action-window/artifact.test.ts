/**
 * Opaque artifact reference helper: contract-shaped, deterministic, and one-way — the parts that
 * seed the ref (potentially a filename or run-local marker) can never be recovered or leak through.
 */
import { describe, expect, it } from "vitest";
import { ARTIFACT_REF_SHAPE, artifactRefFor } from "../../src/action-window/artifact";

describe("artifactRefFor", () => {
  it("produces a contract-shaped opaque 16-hex ref", () => {
    expect(artifactRefFor(["run_1", "download", "1"])).toMatch(/^[0-9a-f]{16}$/);
  });

  it("is deterministic for the same parts and distinct for different parts", () => {
    expect(artifactRefFor(["a", "b"])).toBe(artifactRefFor(["a", "b"]));
    expect(artifactRefFor(["a", "b"])).not.toBe(artifactRefFor(["a", "c"]));
    // The array form is unambiguous: ["ab"] and ["a","b"] are different artifacts.
    expect(artifactRefFor(["ab"])).not.toBe(artifactRefFor(["a", "b"]));
  });

  it("never echoes any part of a sensitive seed into the ref", () => {
    const ref = artifactRefFor(["리뷰내역_2026-07-09.xlsx", "/Users/seller/Downloads"]);
    expect(ref).toMatch(/^[0-9a-f]{16}$/);
    expect(ref).not.toContain("xlsx");
    expect(ref).not.toContain("Users");
  });
});

describe("ARTIFACT_REF_SHAPE — the single source of truth every consumer validates against", () => {
  it("accepts a freshly minted ref", () => {
    expect(ARTIFACT_REF_SHAPE.test(artifactRefFor(["run_1", "download", "1"]))).toBe(true);
    expect(ARTIFACT_REF_SHAPE.test("0123456789abcdef")).toBe(true);
  });

  it("rejects wrong length, wrong case, non-hex, and non-opaque names", () => {
    expect(ARTIFACT_REF_SHAPE.test("0123456789abcde")).toBe(false); // 15 chars
    expect(ARTIFACT_REF_SHAPE.test("0123456789abcdef0")).toBe(false); // 17 chars
    expect(ARTIFACT_REF_SHAPE.test("0123456789ABCDEF")).toBe(false); // uppercase
    expect(ARTIFACT_REF_SHAPE.test("0123456789abcdeg")).toBe(false); // non-hex
    expect(ARTIFACT_REF_SHAPE.test("report.xlsx")).toBe(false); // a filename, never a ref
    expect(ARTIFACT_REF_SHAPE.test("")).toBe(false);
  });

  it("is stateless — no g/y flag, so repeated .test() calls do not drift", () => {
    expect(ARTIFACT_REF_SHAPE.global).toBe(false);
    expect(ARTIFACT_REF_SHAPE.sticky).toBe(false);
    const ref = artifactRefFor(["x"]);
    expect(ARTIFACT_REF_SHAPE.test(ref)).toBe(true);
    expect(ARTIFACT_REF_SHAPE.test(ref)).toBe(true);
  });
});
