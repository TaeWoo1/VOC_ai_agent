import { describe, expect, it } from "vitest";
import {
  ALERTS_ROUTE,
  MOBILE_TABS,
  MOBILE_TAB_ROUTES,
  NAV_GROUPS,
  NAV_ITEMS,
} from "./nav.v2";
import { isNavIconName } from "../components/icons/NavIcon";

describe("nav.v2 — structure", () => {
  it("declares the two product altitudes, in order", () => {
    expect(NAV_GROUPS.map((group) => group.heading)).toEqual(["운영", "연결·설정"]);
  });

  it("declares the v2 destinations, in order", () => {
    expect(NAV_ITEMS.map((item) => item.to)).toEqual([
      "/",
      "/inbox",
      "/memory",
      "/orders",
      "/reports",
      "/connect",
      "/settings",
    ]);
  });

  it("labels every destination in seller language", () => {
    expect(NAV_ITEMS.map((item) => item.label)).toEqual([
      "운영 홈",
      "고객 인박스",
      "고객운영 메모리",
      "주문·매출",
      "리포트",
      "채널·자료 연결",
      "설정",
    ]);
  });

  it("exact-match highlights only the home route", () => {
    expect(NAV_ITEMS.filter((item) => item.end).map((item) => item.to)).toEqual(["/"]);
  });

  it("resolves every icon key to a real icon, never the fallback dot", () => {
    for (const item of NAV_ITEMS) {
      expect(isNavIconName(item.icon), `${item.label} → ${item.icon}`).toBe(true);
    }
  });

  it("points the alert surface at a route the nav can reach", () => {
    expect(ALERTS_ROUTE).toBe("/settings/alerts");
    expect(ALERTS_ROUTE.startsWith("/settings")).toBe(true);
  });
});

describe("nav.v2 — the operations agent is not a destination", () => {
  it("has no /agent entry", () => {
    // The agent is an action offered inside 운영 홈 / 인박스 / 메모리, not a menu item. Its route
    // still exists; promoting it back to the nav is a product decision, not a nav edit.
    expect(NAV_ITEMS.map((item) => item.to)).not.toContain("/agent");
    expect(NAV_ITEMS.map((item) => item.label)).not.toContain("운영 에이전트");
  });
});

describe("nav.v2 — mobile derives from the same model", () => {
  it("uses four tab destinations plus a 더보기 trigger", () => {
    expect(MOBILE_TAB_ROUTES).toEqual(["/", "/inbox", "/memory", "/connect"]);
    expect(MOBILE_TABS).toHaveLength(4);
  });

  it("never re-declares a tab — every tab is the side-nav item itself", () => {
    for (const tab of MOBILE_TABS) {
      expect(NAV_ITEMS).toContain(tab);
    }
  });

  it("keeps 주문·매출 out of the tab bar", () => {
    expect(MOBILE_TABS.map((tab) => tab.to)).not.toContain("/orders");
  });

  it("gives every destination a short label for the narrow bar", () => {
    for (const item of NAV_ITEMS) {
      expect(item.short, `${item.label} has no short label`).toBeTruthy();
      expect((item.short as string).length).toBeLessThanOrEqual(4);
    }
  });
});
