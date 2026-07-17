import { afterEach, describe, expect, it, vi } from "vitest";
import { copyText } from "./clipboard";

/**
 * The clipboard seam. Node env (no jsdom): `navigator` is stubbed per-case, because the
 * whole point of this module is what happens when the API is ABSENT — and a jsdom that
 * always provides one could never show it.
 */
describe("copyText", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("copies and reports success", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    await expect(copyText("합성-승인된-답변")).resolves.toEqual({ ok: true });
    expect(writeText).toHaveBeenCalledWith("합성-승인된-답변");
  });

  /**
   * The trap this module exists for: `navigator.clipboard` is [SecureContext], so on the
   * LAN dev origin `vite.config.ts` serves it is undefined rather than blocked. UNAVAILABLE
   * is distinct from DENIED because no retry can fix it — the surface must reveal the text
   * instead of offering a button that will never work.
   */
  it("reports UNAVAILABLE when the origin has no clipboard API", async () => {
    vi.stubGlobal("navigator", {});
    await expect(copyText("합성-승인된-답변")).resolves.toEqual({
      ok: false,
      reason: "UNAVAILABLE",
    });
  });

  it("reports UNAVAILABLE when clipboard exists but writeText does not", async () => {
    vi.stubGlobal("navigator", { clipboard: {} });
    await expect(copyText("합성-승인된-답변")).resolves.toEqual({
      ok: false,
      reason: "UNAVAILABLE",
    });
  });

  /** A refusal a second click can genuinely resolve — so it must not read as UNAVAILABLE. */
  it("reports DENIED when the API refuses", async () => {
    vi.stubGlobal("navigator", {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error("NotAllowedError")) },
    });
    await expect(copyText("합성-승인된-답변")).resolves.toEqual({ ok: false, reason: "DENIED" });
  });

  /** Never claims a copy that did not happen — the operator would paste stale text. */
  it("never reports ok when the write rejects", async () => {
    vi.stubGlobal("navigator", {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error("boom")) },
    });
    const result = await copyText("합성-승인된-답변");
    expect(result.ok).toBe(false);
  });
});
