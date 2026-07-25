/**
 * Bringing the review surface to the seller — and the one case where it must refuse.
 *
 * The seller presses one button in SellerOps and should not then have to hunt for the browser window the agent
 * opened (product-owner request, 2026-07-26). So a run raises its own window and, if the page has drifted off the
 * review surface, goes back to it.
 *
 * The refusal is what these tests mostly exist for: **never navigate away from an off-origin page.** A NAVER
 * login, a 2FA prompt or a device check lives on a different origin, and a seller who loses one part-way through
 * cannot tell that apart from SellerOps breaking their login.
 */
import { describe, expect, it } from "vitest";
import { decideSurfacePresentation } from "../../src/naver/surface-presentation";

const SURFACE = "https://sell.smartstore.naver.com/#/review/search";

describe("decideSurfacePresentation", () => {
  it("only raises the window when it is already on the surface", () => {
    expect(decideSurfacePresentation(SURFACE, SURFACE)).toEqual({
      focus: true,
      navigate: false,
      reason: "already_there",
    });
  });

  /** Deeper inside the surface is not drift — a live hash route legitimately carries extra state. */
  it("treats extra route state on the surface as being there", () => {
    const deeper = `${SURFACE}?page=2`;
    expect(decideSurfacePresentation(deeper, SURFACE).navigate).toBe(false);
    expect(decideSurfacePresentation(deeper, SURFACE).reason).toBe("already_there");
  });

  /** The case the request is about: the seller (or the app) moved, so a new run puts them back. */
  it("navigates back when the window has drifted elsewhere on the same site", () => {
    expect(decideSurfacePresentation("https://sell.smartstore.naver.com/#/home/dashboard", SURFACE)).toEqual({
      focus: true,
      navigate: true,
      reason: "drifted",
    });
  });

  /**
   * The refusal. Raising the window still helps — the seller can see what is being asked of them — but
   * navigating would destroy an authentication in progress, and `prepareSurface` is what then reports
   * `LOGIN_REQUIRED` for them to clear.
   */
  it.each([
    ["a NAVER login", "https://nid.naver.com/nidlogin.login"],
    ["a device verification", "https://nid.naver.com/login/ext/deviceConfirm"],
    ["somewhere unrelated", "https://example.com/"],
    ["a different marketplace", "https://sell.other.co.kr/#/review/search"],
  ])("raises but never navigates away from %s", (_label, current) => {
    const decision = decideSurfacePresentation(current, SURFACE);
    expect(decision.focus).toBe(true);
    expect(decision.navigate).toBe(false);
    expect(decision.reason).toBe("off_origin");
  });

  /** A configuration fact must not be the thing that takes a run down. */
  it("raises only when no surface URL is configured", () => {
    for (const surface of [null, undefined, ""]) {
      const decision = decideSurfacePresentation(SURFACE, surface);
      expect(decision, String(surface)).toEqual({ focus: true, navigate: false, reason: "unconfigured" });
    }
  });

  /** "We cannot tell where we are" is not a reason to move. */
  it.each([["about:blank", "about:blank"], ["empty", ""], ["garbage", "not a url"], ["null", null]])(
    "raises only when the current location is unreadable (%s)",
    (_label, current) => {
      const decision = decideSurfacePresentation(current, SURFACE);
      expect(decision.navigate).toBe(false);
      expect(decision.reason).toBe("unreadable");
    },
  );

  /** Focus is always safe: it performs nothing on the page. There is no branch where it is withheld. */
  it("always raises the window, whatever else it decides", () => {
    for (const current of [SURFACE, "https://nid.naver.com/x", "about:blank", null]) {
      expect(decideSurfacePresentation(current, SURFACE).focus, String(current)).toBe(true);
    }
  });
});

describe("the presentation module performs nothing on the page", () => {
  /**
   * A source guard rather than a behavioural test: the property is "this module CANNOT act", and a pure decision
   * function has no way to demonstrate the absence of a capability it never imported.
   */
  it("is pure — no browser, no navigation, no clicking", async () => {
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("../../src/naver/surface-presentation.ts", import.meta.url), "utf8"),
    );
    const code = source
      .split("\n")
      .filter((line) => {
        const t = line.trim();
        return !t.startsWith("*") && !t.startsWith("//") && !t.startsWith("/*");
      })
      .join("\n");
    for (const forbidden of ["playwright", "page.", "goto", ".click(", "bringToFront", "import "]) {
      expect(code, forbidden).not.toContain(forbidden);
    }
  });
});
