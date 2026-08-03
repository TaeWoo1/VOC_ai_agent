// Navigation model for the v2 product surface.
//
// ONE model, three renderers. The desktop side nav, the mobile bottom tabs, and the "더보기"
// drawer all derive from `NAV_GROUPS` — the mobile surfaces select from it rather than declaring
// their own lists, so the three IAs cannot drift apart.
//
// Two groups mirror the product's two altitudes: 운영 is the daily customer-operations work,
// 연결·설정 is the setup and maintenance that is visited when something needs connecting or fixing.
//
// `/agent` is deliberately absent. The operations agent is not a destination in the v2 product —
// it is an action offered inside 운영 홈 / 인박스 / 메모리. Its route still exists; its menu entry
// does not.

export interface NavItem {
  to: string;
  label: string;
  /** Short label for the mobile tab bar, where the full label will not fit. */
  short?: string;
  /** Icon key resolved by `<NavIcon>`; an unknown key renders a neutral dot, never raw text. */
  icon: string;
  /** Exact-match highlight. Only the home route needs it. */
  end?: boolean;
}

export interface NavGroup {
  heading: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    heading: "운영",
    items: [
      { to: "/", label: "운영 홈", short: "홈", icon: "home", end: true },
      { to: "/inbox", label: "고객 인박스", short: "인박스", icon: "inbox" },
      { to: "/memory", label: "고객운영 메모리", short: "메모리", icon: "memory" },
      { to: "/orders", label: "주문·매출", short: "주문", icon: "orders" },
      { to: "/reports", label: "리포트", short: "리포트", icon: "report" },
    ],
  },
  {
    heading: "연결·설정",
    items: [
      { to: "/connect", label: "채널·자료 연결", short: "연결", icon: "link" },
      { to: "/settings", label: "설정", short: "설정", icon: "settings" },
    ],
  },
];

/** Every nav item, flattened. */
export const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((group) => group.items);

/** The route whose surface carries the open connection-alert count. */
export const ALERTS_ROUTE = "/settings/alerts";

/**
 * Mobile bottom-tab destinations, in order. Four routes plus a "더보기" trigger (which is not a
 * route) make the five-tab bar. 주문·매출 is intentionally not a tab: it is operating context,
 * not a daily destination, and a five-destination bar leaves no room for the drawer trigger.
 */
export const MOBILE_TAB_ROUTES = ["/", "/inbox", "/memory", "/connect"] as const;

/** Derived, never re-declared — a tab is the same item the side nav renders. */
export const MOBILE_TABS: NavItem[] = MOBILE_TAB_ROUTES.map((route) => {
  const item = NAV_ITEMS.find((candidate) => candidate.to === route);
  if (!item) {
    // A tab route with no nav entry would ship a bar button that leads somewhere the menu does
    // not know about. Fail at module load rather than render a phantom destination.
    throw new Error(`MOBILE_TAB_ROUTES references an unknown nav route: ${route}`);
  }
  return item;
});
