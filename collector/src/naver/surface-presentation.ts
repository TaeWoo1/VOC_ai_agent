/**
 * **Should the agent put the review surface in front of the seller — and may it navigate to do so?** Pure.
 *
 * ## Why this is a decision and not just a `goto`
 *
 * The seller presses one button in SellerOps and then has to find the browser window the agent opened. Asking
 * them to hunt for it is asking them to do the one thing this journey exists to remove (product-owner request,
 * 2026-07-26). So a run brings its own window forward, and navigates to the review surface if it has drifted.
 *
 * Both of those are actions on **SellerOps' own browser window**: raising a window and following a public
 * application route. Neither clicks, types, submits, exports or consents, and neither touches a marketplace
 * control — the Action Window fences are about *performing the seller's action on the platform*, which this
 * cannot do. (The import boot already navigates once, at launch, for the same reason.)
 *
 * ## The one thing it must never do
 *
 * **Never navigate away from an authentication screen.** A seller part-way through a NAVER login, a 2FA prompt,
 * or a device-verification step would lose it — and that is indistinguishable, from their side, from SellerOps
 * breaking their login. Auth screens live on a different origin (`nid.naver.com`), so the rule is expressible
 * without reading the page at all: **navigate only when we are already on the surface's own origin.** Off-origin,
 * the window is still raised (so they can see what it is asking for) and the run then fails closed through
 * `prepareSurface` exactly as it does today — `LOGIN_REQUIRED`, which the seller clears themselves.
 *
 * No I/O, no browser, no wall-clock. `null` inputs are answered, not thrown on: a missing URL is a configuration
 * fact, and this must not be the thing that takes a run down.
 */

export interface SurfacePresentation {
  /** Raise SellerOps' own window. Always safe — it performs nothing on the page. */
  focus: boolean;
  /** Navigate to the configured review surface. Only ever the surface URL, never an action endpoint. */
  navigate: boolean;
  /**
   * Why, as a sanitized enum for the log. Never a URL.
   *
   * - `already_there` — the window is on the surface; only raise it.
   * - `drifted` — same origin, different route: the seller (or the app) moved, so go back.
   * - `off_origin` — an auth screen or an unrelated site: raise only, never navigate.
   * - `unconfigured` — no surface URL was supplied; raise only.
   * - `unreadable` — a URL neither side could parse; raise only, and let `prepareSurface` decide.
   */
  reason: "already_there" | "drifted" | "off_origin" | "unconfigured" | "unreadable";
}

/**
 * The origin of a URL, or null when there is no meaningful one.
 *
 * Null covers both an unparseable string AND an **opaque** origin. `new URL("about:blank").origin` does not
 * throw — it returns the string `"null"` — so treating only exceptions as unknown would report a blank tab as
 * "some other site" and log the wrong reason for the right decision. A tab with no origin is a tab whose location
 * we cannot judge, which is exactly what `unreadable` means.
 */
function originOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const origin = new URL(url).origin;
    return origin === "null" || origin === "" ? null : origin;
  } catch {
    return null;
  }
}

/**
 * Decide how to present the surface.
 *
 * @param currentUrl  where SellerOps' own window is now (`page.url()`)
 * @param surfaceUrl  the configured review-surface route, or null/undefined when unset
 */
export function decideSurfacePresentation(
  currentUrl: string | null | undefined,
  surfaceUrl: string | null | undefined,
): SurfacePresentation {
  if (!surfaceUrl) return { focus: true, navigate: false, reason: "unconfigured" };

  const surfaceOrigin = originOf(surfaceUrl);
  const currentOrigin = originOf(currentUrl);
  if (surfaceOrigin === null || currentOrigin === null) {
    // We cannot tell where we are, so we do not move. Raising the window still helps the seller see it, and
    // `prepareSurface` remains the thing that decides whether this page is usable.
    return { focus: true, navigate: false, reason: "unreadable" };
  }
  if (currentOrigin !== surfaceOrigin) {
    // An auth screen or somewhere unrelated. Navigating here could destroy a login in progress.
    return { focus: true, navigate: false, reason: "off_origin" };
  }
  // Prefix rather than equality: the surface is a hash route and a live page legitimately carries extra
  // route state (`…#/review/search?page=2`). Being deeper inside the surface is not drift.
  if ((currentUrl ?? "").startsWith(surfaceUrl)) {
    return { focus: true, navigate: false, reason: "already_there" };
  }
  return { focus: true, navigate: true, reason: "drifted" };
}
