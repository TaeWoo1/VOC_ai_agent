/**
 * <b>The seller worlds a scenario runs in — named once, so the same question can be asked of two
 * different shops and the answers compared.</b>
 *
 * Agent Procedure Layer v1 §4. Before this, every suite assembled its own coverage rows, its own inbox
 * and its own review responses inline: eight files held their own `coverageRow(...)` fixture and the
 * axis that actually mattered — what kind of shop this is — was dissolved into them. A defect measured
 * on a clean organisation could therefore not be re-asked of a working one without writing a second
 * file.
 *
 * <b>A world is the SOURCE, never the answer.</b> Each entry seeds only what the backend would have
 * returned; what the product then says is what the scenario asserts.
 */
import type { ChannelCoverageRow, RecentReviewsResponse, ReviewDetailResponse } from "../../src/spring/types";
import type { SeedInquiry } from "../support/FakeSpringClient";
import { coverageRow, allFreshCoverage, freshReviews, inquiries, TODAY } from "../conversation/support";
import { MOLDING } from "../support/operatorFixtures";

export type WorldName = "NO_CHANNEL" | "CONNECTED_NO_DATA" | "WORKING";

export interface WorldFixture {
  readonly name: WorldName;
  readonly coverage: ChannelCoverageRow[];
  readonly inquiries: SeedInquiry[];
  readonly reviews: RecentReviewsResponse | null;
  readonly inbox: { items: never[]; total: number; unansweredInquiries: number } | null;
  /** The exact single-review read, for the rows this world actually holds. */
  readonly reviewDetails: Record<string, ReviewDetailResponse>;
}

/** One review's own row, as `GET /api/reviews/{id}` returns it. */
function reviewDetail(over: Partial<ReviewDetailResponse> & { id: string }): ReviewDetailResponse {
  return {
    sellerAccountId: "acct-cafe24", channelCode: "CAFE24", channelNameKo: "카페24", writtenOn: TODAY,
    rating: 5, negative: false, body: "붙이기 쉽고 깔끔해요", bodyRedacted: false,
    productId: MOLDING.id, productName: MOLDING.name, replyState: "NONE", executableIdentity: "MARKETPLACE",
    triageTier: "ROUTINE", issues: [], ...over,
  };
}

/** What `GET /api/channels/coverage` returns for an org that has connected nothing (measured live). */
function noChannelCoverage(): ChannelCoverageRow[] {
  const off = {
    connected: false, connectionStatus: null, state: "NOT_CONNECTED" as const, rows: 0, openRows: 0,
    routineEnabled: false, lastSuccessfulSyncAt: null, newestObservedAt: null,
  };
  return [
    coverageRow({ channelCode: "NAVER", channelNameKo: "네이버 스마트스토어", dataType: "INQUIRY", ...off }),
    coverageRow({ channelCode: "NAVER", channelNameKo: "네이버 스마트스토어", dataType: "REVIEW", ...off, state: "NOT_SUPPORTED", supported: false }),
    coverageRow({ channelCode: "CAFE24", channelNameKo: "카페24 자사몰", dataType: "INQUIRY", ...off }),
    coverageRow({ channelCode: "CAFE24", channelNameKo: "카페24 자사몰", dataType: "REVIEW", ...off }),
    coverageRow({ channelCode: "COUPANG", channelNameKo: "쿠팡", dataType: "ORDER_SUMMARY", ...off }),
  ];
}

/** Connected everywhere and holding nothing — the morning after the first OAuth consent. */
function connectedEmptyCoverage(): ChannelCoverageRow[] {
  return noChannelCoverage().map((r) => (r.supported
    ? { ...r, connected: true, connectionStatus: "CONNECTED", state: "ZERO" as const, routineEnabled: true }
    : r));
}

function noReviews(coverage: ChannelCoverageRow[]): RecentReviewsResponse {
  return { from: TODAY, to: TODAY, negativeOnly: false, total: 0, items: [], coverage };
}

export const WORLD: Record<WorldName, WorldFixture> = {
  NO_CHANNEL: {
    name: "NO_CHANNEL", coverage: noChannelCoverage(), inquiries: [],
    reviews: noReviews(noChannelCoverage()), inbox: { items: [], total: 0, unansweredInquiries: 0 },
    reviewDetails: {},
  },
  CONNECTED_NO_DATA: {
    name: "CONNECTED_NO_DATA", coverage: connectedEmptyCoverage(), inquiries: [],
    reviews: noReviews(connectedEmptyCoverage()), inbox: { items: [], total: 0, unansweredInquiries: 0 },
    reviewDetails: {},
  },
  // The suite's ordinary seller: connected channels, real inquiries, real reviews.
  WORKING: {
    name: "WORKING", coverage: allFreshCoverage(), inquiries: inquiries(), reviews: null, inbox: null,
    reviewDetails: Object.fromEntries(freshReviews().items.map((r) => [r.id, reviewDetail({
      id: r.id, rating: r.rating, negative: r.negative, body: r.preview ?? "", productId: r.productId ?? MOLDING.id,
      productName: r.productName ?? MOLDING.name, triageTier: r.negative ? "NEEDS_ATTENTION" : "ROUTINE",
    })])),
  },
};
