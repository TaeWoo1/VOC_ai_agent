// @vitest-environment jsdom
// The channel row's way into the 상품평 record: when it appears, what it says, and the two ways it
// is allowed to change. Layout cannot be measured in jsdom, so the responsiveness check is
// structural — the row's actions wrap, and nothing hides the entry at a breakpoint.
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ChannelList } from "./ChannelList";
import type {
  ChannelResponse,
  ConnectionStatusView,
  SellerAccountResponse,
} from "../../lib/types";

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => vi.fn() };
});

const COUPANG: ChannelResponse = {
  id: "coupang-ch",
  code: "COUPANG",
  nameKo: "쿠팡",
  status: "AVAILABLE",
  dataBadges: [],
  lastSyncedAt: null,
  actionLabel: "관리",
  support: {
    fileUploadSupported: false,
    fileUploadDataTypes: [],
    autoCollectSupported: true,
    autoCollectDataTypes: ["ORDER_SUMMARY"],
    connectionCheckSupported: true,
    credentialSetupSupported: true,
  },
} as ChannelResponse;

const NAVER: ChannelResponse = { ...COUPANG, id: "naver-ch", code: "NAVER", nameKo: "네이버" };

const ACCOUNT: SellerAccountResponse = {
  id: "acc-cp",
  channelId: "coupang-ch",
  channelNameKo: "쿠팡",
  alias: null,
  connectionStatus: "CONNECTED",
  lastSyncedAt: "2026-08-15T00:00:00Z",
  fileUpload: false,
};

function health(over: Partial<ConnectionStatusView> = {}): ConnectionStatusView {
  return {
    sellerAccountId: "acc-cp",
    state: "CONNECTED",
    lastSuccessAt: "2026-08-15T00:00:00Z",
    consecutiveFailures: 0,
    lastError: null,
    lastSyncedAt: "2026-08-15T00:00:00Z",
    nextScheduledAt: null,
    expiry: null,
    ...over,
  } as ConnectionStatusView;
}

function renderList(options: {
  channels?: ChannelResponse[];
  accounts?: SellerAccountResponse[];
  health?: ConnectionStatusView;
  reviewCounts?: Map<string, number>;
} = {}) {
  return render(
    <MemoryRouter>
      <ChannelList
        channels={options.channels ?? [COUPANG]}
        accounts={options.accounts ?? [ACCOUNT]}
        health={new Map([["acc-cp", options.health ?? health()]])}
        statusLoading={false}
        reviewCounts={options.reviewCounts}
        onNotice={vi.fn()}
      />
    </MemoryRouter>,
  );
}

describe("ChannelList — the 상품평 entry", () => {
  it("appears on a review-record channel with an account, carrying the count", () => {
    renderList({ reviewCounts: new Map([["acc-cp", 22]]) });
    expect(screen.getByRole("link", { name: "쿠팡 상품평 22개 보기" })).toHaveAttribute(
      "href",
      "/reviews/acc-cp",
    );
  });

  it("names the channel to a screen reader, and still reads the count on screen", () => {
    renderList({ reviewCounts: new Map([["acc-cp", 22]]) });
    const link = screen.getByRole("link", { name: "쿠팡 상품평 22개 보기" });
    // WCAG 2.5.3: the accessible name must contain the visible label, so this prefixes, never replaces.
    expect(link).toHaveTextContent("상품평 22개 보기");
  });

  it("appears without a count when none was supplied", () => {
    renderList();
    expect(screen.getByRole("link", { name: "쿠팡 상품평 보기" })).toBeInTheDocument();
  });

  it("is absent on a channel that keeps no record, even with a connected account", () => {
    // The account is present ON PURPOSE. With `accounts: []` this assertion would hold whatever the
    // channel predicate said, and deleting `hasReviewRecord(...)` from the row would break no test.
    renderList({
      channels: [{ ...NAVER, code: "GMARKET", nameKo: "G마켓" }],
      accounts: [{ ...ACCOUNT, id: "acc-gm", channelId: "naver-ch", channelNameKo: "G마켓" }],
    });
    expect(screen.getByRole("button", { name: "연결 관리" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /상품평|리뷰/ })).toBeNull();
  });

  it("speaks the product's word on NAVER — 리뷰, not Coupang's 상품평", () => {
    renderList({
      channels: [NAVER],
      accounts: [{ ...ACCOUNT, id: "acc-nv", channelId: "naver-ch", channelNameKo: "네이버" }],
      reviewCounts: new Map([["acc-nv", 3]]),
    });
    expect(screen.getByRole("link", { name: "네이버 리뷰 3개 보기" })).toHaveAttribute(
      "href",
      "/reviews/acc-nv",
    );
  });

  it("is the row's loud action while the connection is healthy", () => {
    renderList({ reviewCounts: new Map([["acc-cp", 22]]) });
    // `solid` — the record is where a connected seller is going; 연결 관리 is how it got there.
    expect(screen.getByRole("link", { name: "쿠팡 상품평 22개 보기" }).className).toContain(
      "bg-brand-700",
    );
  });

  it("steps back when collection is failing, without going away", () => {
    renderList({
      reviewCounts: new Map([["acc-cp", 22]]),
      health: health({ consecutiveFailures: 2, lastError: "AUTH" }),
    });
    const link = screen.getByRole("link", { name: "쿠팡 상품평 22개 보기" });
    // Still there — the 상품평 collected before the break are still the seller's. Just not the
    // brightest thing on a row that is asking to be repaired.
    expect(link).toBeInTheDocument();
    expect(link.className).not.toContain("bg-brand-700");
    expect(screen.getByRole("button", { name: "재연결·테스트" })).toBeInTheDocument();
  });

  it("wraps on a narrow row instead of hiding at a breakpoint", () => {
    renderList({ reviewCounts: new Map([["acc-cp", 22]]) });
    const link = screen.getByRole("link", { name: "쿠팡 상품평 22개 보기" });
    const actions = link.parentElement!;
    // Both actions sit in one wrapping group: at a narrow width they fall under the row's text
    // rather than being clipped or pushed off the edge.
    expect(actions.className).toContain("flex-wrap");
    expect(actions).toContainElement(screen.getByRole("button", { name: "연결 관리" }));
    // Nothing in the chain from the entry up to the row is display-toggled by viewport width —
    // the one failure this unit exists to prevent is a way in that is present but unseen.
    for (let node: HTMLElement | null = link; node; node = node.parentElement) {
      for (const cls of node.className.split(/\s+/)) {
        expect(cls).not.toMatch(/^(?:\w+:)?(?:hidden|invisible|sr-only)$/);
      }
      if (node.tagName === "LI") break;
    }
  });
});
