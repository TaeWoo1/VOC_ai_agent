/**
 * Opaque artifact reference helper: contract-shaped, deterministic, and one-way — the parts that
 * seed the ref (potentially a filename or run-local marker) can never be recovered or leak through.
 */
import { describe, expect, it } from "vitest";
import { artifactRefFor } from "../../src/action-window/artifact";

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
