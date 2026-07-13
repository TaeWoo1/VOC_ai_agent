// Shared navigation model for the Product Shell. Both the desktop sidebar and the
// mobile drawer render from this ONE source so the two IAs never drift.
//
// Two groups mirror the frontstage/backstage split (Frontend Spec §5): 운영 =
// daily seller operations (frontstage), 연결·설정 = connection/collection tools
// (backstage). Labels are the current production labels (Product Shell slice does
// not rename pages); the group headings are the approved structural labels.

export interface NavItem {
  to: string;
  label: string;
  /** Icon key resolved to an inline SVG by <NavIcon> (components/icons/NavIcon).
   *  An unknown key renders a neutral fallback, never a raw string. */
  icon: string;
  /** Exact-match highlight (only the home route). */
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
      { to: "/", label: "홈", icon: "home", end: true },
      { to: "/inbox", label: "인박스", icon: "inbox" },
      { to: "/inquiries", label: "문의 응답", icon: "mail" },
      { to: "/orders", label: "주문·매출", icon: "orders" },
      { to: "/issues", label: "상품 이슈", icon: "issue" },
      { to: "/operations", label: "리뷰 운영", icon: "review" },
      { to: "/reports", label: "리포트", icon: "report" },
    ],
  },
  {
    heading: "연결·설정",
    items: [
      { to: "/settings/channels", label: "채널 연결", icon: "link" },
      { to: "/settings/upload", label: "자료 업로드", icon: "upload" },
      { to: "/settings/alerts", label: "연결 알림", icon: "bell" },
    ],
  },
];

/** The route whose nav item carries the open-alert count badge. */
export const ALERTS_ROUTE = "/settings/alerts";

/** Curated bottom-tab-bar destinations for mobile (md:hidden). A short-labeled
 *  subset of the same frontstage routes — NOT a new IA (Frontend Spec §6). The
 *  full menu ("더보기") is rendered by the bar itself as a drawer trigger, so it is
 *  not a route entry here. The 알림 tab carries the same open-alert badge as the
 *  sidebar (ALERTS_ROUTE). */
export const MOBILE_TABS: NavItem[] = [
  { to: "/", label: "홈", icon: "home", end: true },
  { to: "/orders", label: "주문", icon: "orders" },
  { to: "/operations", label: "리뷰", icon: "review" },
  { to: ALERTS_ROUTE, label: "알림", icon: "bell" },
];
