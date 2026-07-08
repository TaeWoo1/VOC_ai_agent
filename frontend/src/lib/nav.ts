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
      { to: "/", label: "홈", icon: "🏠", end: true },
      { to: "/inbox", label: "인박스", icon: "📥" },
      { to: "/inquiries", label: "문의 응답", icon: "✉️" },
      { to: "/orders", label: "주문·매출", icon: "📦" },
      { to: "/issues", label: "상품 이슈", icon: "⚠️" },
      { to: "/operations", label: "리뷰 운영", icon: "🎯" },
      { to: "/reports", label: "리포트", icon: "📄" },
    ],
  },
  {
    heading: "연결·설정",
    items: [
      { to: "/settings/channels", label: "채널 연결", icon: "🔗" },
      { to: "/settings/upload", label: "자료 업로드", icon: "⬆️" },
      { to: "/settings/alerts", label: "연결 알림", icon: "🔔" },
    ],
  },
];

/** The route whose nav item carries the open-alert count badge. */
export const ALERTS_ROUTE = "/settings/alerts";
