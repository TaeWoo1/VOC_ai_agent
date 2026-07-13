import { describe, it, expect } from "vitest";
import { NAV_GROUPS, ALERTS_ROUTE } from "./nav";
import { isNavIconName } from "../components/icons/NavIcon";

describe("nav model", () => {
  it("keeps the frontstage/backstage groups and every route in order", () => {
    expect(NAV_GROUPS.map((g) => g.heading)).toEqual(["운영", "연결·설정"]);
    const routes = NAV_GROUPS.flatMap((g) => g.items.map((i) => i.to));
    expect(routes).toEqual([
      "/",
      "/inbox",
      "/inquiries",
      "/orders",
      "/issues",
      "/operations",
      "/reports",
      "/settings/channels",
      "/settings/upload",
      "/settings/alerts",
    ]);
    expect(routes).toContain(ALERTS_ROUTE);
  });

  it("exact-match highlights only the home route", () => {
    const ends = NAV_GROUPS.flatMap((g) => g.items)
      .filter((i) => i.end)
      .map((i) => i.to);
    expect(ends).toEqual(["/"]);
  });

  it("resolves every nav item's icon key to a real NavIcon (emoji→SVG migration)", () => {
    for (const item of NAV_GROUPS.flatMap((g) => g.items)) {
      expect(isNavIconName(item.icon)).toBe(true);
    }
  });
});
