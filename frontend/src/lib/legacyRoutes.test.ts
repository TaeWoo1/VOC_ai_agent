import { describe, expect, it } from "vitest";
import { LEGACY_REDIRECTS, resolveLegacyTarget } from "./legacyRoutes";
import { NAV_ITEMS } from "./nav.v2";

describe("legacy redirects — the mapping", () => {
  it("covers every pre-v2 path the old IA exposed", () => {
    expect(LEGACY_REDIRECTS.map((r) => r.from)).toEqual([
      "/issues",
      "/operations",
      "/operations/current",
      "/settings/channels",
      "/settings/channels/:accountId",
      "/settings/upload",
      "/settings/review-import",
      "/channels",
      "/channels/:accountId",
      "/upload",
      "/alerts",
      "/connect/channels/:accountId/reviews",
    ]);
  });

  it("no longer redirects /inquiries — it is the 문의 destination of the workflow IA", () => {
    expect(LEGACY_REDIRECTS.map((r) => r.from)).not.toContain("/inquiries");
    expect(NAV_ITEMS.map((item) => item.to)).toContain("/inquiries");
  });

  it("never redirects to another legacy path", () => {
    // A redirect chain is a bug waiting for the day the first hop is deleted.
    const legacyPaths = new Set(LEGACY_REDIRECTS.map((r) => r.from));
    for (const redirect of LEGACY_REDIRECTS) {
      expect(legacyPaths.has(redirect.to), `${redirect.from} → ${redirect.to}`).toBe(false);
    }
  });

  it("declares each source once", () => {
    const sources = LEGACY_REDIRECTS.map((r) => r.from);
    expect(new Set(sources).size).toBe(sources.length);
  });

  it("sends the parameterless targets to real destinations", () => {
    // Nav destinations plus the routes deliberately kept off the primary IA (App.tsx).
    const navRoutes = new Set([...NAV_ITEMS.map((item) => item.to), "/memory", "/reports", "/inbox"]);
    const topLevelTargets = LEGACY_REDIRECTS.filter((r) => !r.to.includes(":")).map((r) => r.to);
    // Every target is either a nav destination or a sub-route beneath one.
    for (const target of topLevelTargets) {
      const owned = navRoutes.has(target) || [...navRoutes].some((route) =>
        route !== "/" && target.startsWith(`${route}/`),
      );
      expect(owned, `${target} belongs to no v2 destination`).toBe(true);
    }
  });
});

describe("legacy redirects — target resolution", () => {
  function find(from: string) {
    const redirect = LEGACY_REDIRECTS.find((r) => r.from === from);
    if (!redirect) {
      throw new Error(`no legacy redirect declared for ${from}`);
    }
    return redirect;
  }

  it("resolves a plain path", () => {
    expect(resolveLegacyTarget(find("/issues"))).toBe("/memory");
    expect(resolveLegacyTarget(find("/operations"))).toBe("/connect/imports");
    expect(resolveLegacyTarget(find("/alerts"))).toBe("/settings/alerts");
  });

  it("substitutes route params so deep links survive", () => {
    expect(resolveLegacyTarget(find("/channels/:accountId"), { accountId: "acct-1" })).toBe(
      "/connect/channels/acct-1",
    );
    expect(
      resolveLegacyTarget(find("/settings/channels/:accountId"), { accountId: "acct-9" }),
    ).toBe("/connect/channels/acct-9");
    expect(
      resolveLegacyTarget(find("/connect/channels/:accountId/reviews"), { accountId: "acct-3" }),
    ).toBe("/reviews/acct-3");
  });

  it("carries the query string only where it is declared", () => {
    expect(resolveLegacyTarget(find("/upload"), {}, "?channelId=abc")).toBe(
      "/connect/upload?channelId=abc",
    );
    expect(resolveLegacyTarget(find("/settings/upload"), {}, "?channelId=abc")).toBe(
      "/connect/upload?channelId=abc",
    );
    // Not declared → dropped, so a stale filter cannot ride along to an unrelated screen.
    expect(resolveLegacyTarget(find("/issues"), {}, "?q=1")).toBe("/memory");
  });

  it("drops a missing param rather than emitting a literal ':name'", () => {
    expect(resolveLegacyTarget(find("/channels/:accountId"), {})).toBe("/connect/channels/");
  });
});
