// Navigation model for the product surface.
//
// ONE model, three renderers. The desktop side nav, the mobile bottom tabs, and the "더보기"
// drawer all derive from `NAV_GROUPS` — the mobile surfaces select from it rather than declaring
// their own lists, so the three IAs cannot drift apart.
//
// The IA is workflow-centric, not channel-centric (product assembly, 2026-08-17 —
// `docs/product_assembly_ia_v1.md` §3): 운영 answers "오늘 내가 확인하거나 조치할 일은 무엇인가?"
// as 홈 / 리뷰 / 문의 / 주문, and 연결·설정 is where data comes from. A channel is a filter or a
// capability inside those screens, never a destination of its own.
//
// Deliberately absent from the menu: `/agent` (an action offered inside the operations screens,
// not a destination), `/memory` and `/reports` (kept as routes, reached from 홈 and 설정, out of the
// primary IA until the home/today-inbox unit decides their place), and every per-channel page
// (`/connect/channels/:accountId`, the connect wizards) — those are reached from 채널 연결.

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
      { to: "/", label: "홈", short: "홈", icon: "home", end: true },
      { to: "/reviews", label: "리뷰", short: "리뷰", icon: "review" },
      { to: "/inquiries", label: "문의", short: "문의", icon: "mail" },
      { to: "/orders", label: "주문", short: "주문", icon: "orders" },
    ],
  },
  {
    heading: "연결·설정",
    items: [
      { to: "/connect", label: "채널 연결", short: "연결", icon: "link" },
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
 * route) make the five-tab bar. The four are the daily 운영 destinations; 채널 연결 and 설정 are
 * setup work and live in the drawer.
 */
export const MOBILE_TAB_ROUTES = ["/", "/reviews", "/inquiries", "/orders"] as const;

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
