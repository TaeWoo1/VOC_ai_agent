import { describe, expect, it } from "vitest";
import { normalizeMallInput } from "./mallId";

describe("normalizeMallInput", () => {
  it("accepts a bare mall id", () => {
    expect(normalizeMallInput("mystore")).toEqual({ ok: true, mallId: "mystore" });
  });

  it("lowercases and trims", () => {
    expect(normalizeMallInput("  MyStore  ")).toEqual({ ok: true, mallId: "mystore" });
  });

  it("accepts a cafe24 host without scheme", () => {
    expect(normalizeMallInput("mystore.cafe24.com")).toEqual({ ok: true, mallId: "mystore" });
  });

  it("accepts a full https store URL with a path", () => {
    expect(normalizeMallInput("https://mystore.cafe24.com/admin")).toEqual({
      ok: true,
      mallId: "mystore",
    });
  });

  it("rejects a non-cafe24 host in a URL as bad_host", () => {
    expect(normalizeMallInput("https://evil.com/mystore")).toEqual({
      ok: false,
      reason: "bad_host",
    });
  });

  it("rejects a non-cafe24 bare host as bad_host", () => {
    expect(normalizeMallInput("mystore.myshop.com")).toEqual({ ok: false, reason: "bad_host" });
  });

  it("rejects empty / whitespace as empty", () => {
    expect(normalizeMallInput("")).toEqual({ ok: false, reason: "empty" });
    expect(normalizeMallInput("   ")).toEqual({ ok: false, reason: "empty" });
    expect(normalizeMallInput(null)).toEqual({ ok: false, reason: "empty" });
  });

  it("rejects a multi-label cafe24 subdomain as malformed (fail-closed, never guesses)", () => {
    expect(normalizeMallInput("a.b.cafe24.com")).toEqual({ ok: false, reason: "malformed" });
  });

  it("rejects a malformed bare label", () => {
    expect(normalizeMallInput("bad_store!")).toEqual({ ok: false, reason: "malformed" });
  });

  it("rejects an unparseable URL as malformed", () => {
    expect(normalizeMallInput("http://")).toEqual({ ok: false, reason: "malformed" });
  });
});
