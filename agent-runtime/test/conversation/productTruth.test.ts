/**
 * <b>Product Self-Knowledge Truth Closure v1 — the truth model, per operating object and per channel.</b>
 *
 * Manual owner QA (2026-09-07) produced seven product sentences that were each grounded in a line of the
 * fact sheet and wrong as stated. Every one widened the same way: a fact the sheet held per channel, per
 * object, or as a CAPABILITY came back as a claim about the whole product in the present tense.
 *
 * These assertions are about the FACTS, never about a sentence a model wrote. The model is a vendor and
 * asserting what it will say is asserting the vendor's mood; what this repository controls is what it is
 * given, which of those lines exist, and that none of them says more than its source.
 */
import { describe, expect, it } from "vitest";
import type { ChannelCapabilityOverview, ChannelCoverageRow, CollectionPostureView } from "../../src/spring/types";
import type { ChannelCapabilitySources } from "../../src/operator/capability/ChannelCapability";
import { SUPPORT_REASON, supportOf } from "../../src/operator/capability/ChannelCapability";
import { channelObjectTruths, runtimeCollectionFact, sellerCollectionFact } from "../../src/operator/capability/ProductTruth";
import { sellerReadinessOf } from "../../src/operator/capability/SellerReadiness";
import { TOOL_CAPABILITIES } from "../../src/operator/tools/ToolReachability";
import { STRUCTURAL_FACTS, productFactSheet } from "../../src/operator/capability/ProductFactSheet";

const ALL_TOOLS = TOOL_CAPABILITIES.map((r) => r.tool);

const row = (
  channelCode: string, channelNameKo: string, dataType: string,
  supported: boolean, connected = false, routineEnabled = false,
): ChannelCoverageRow => ({
  channelCode, channelNameKo, dataType, state: connected ? "ZERO" : "NOT_CONNECTED", supported,
  verificationStatus: null, connected, connectionStatus: null, routineEnabled, routinePausedBy: null,
  lastSuccessfulSyncAt: null, rows: 0, openRows: null, newestObservedAt: null,
});

const COVERAGE: readonly ChannelCoverageRow[] = [
  row("NAVER", "네이버 스마트스토어", "INQUIRY", true),
  row("NAVER", "네이버 스마트스토어", "REVIEW", false),
  row("NAVER", "네이버 스마트스토어", "ORDER_SUMMARY", true),
  row("COUPANG", "쿠팡", "INQUIRY", true),
  row("COUPANG", "쿠팡", "REVIEW", false),
  row("COUPANG", "쿠팡", "ORDER_SUMMARY", true),
];

type DataTypeRow = ChannelCapabilityOverview["dataTypes"][number];

const dt = (
  dataType: string, supported: boolean,
  extra: Partial<Omit<DataTypeRow, "dataType" | "supported">> = {},
): DataTypeRow => ({
  dataType, label: null, supported,
  verificationStatus: supported ? "CONFIRMED" : "UNSUPPORTED",
  acquisitionPaths: [],
  declaredSupport: supported ? "SUPPORTED" : "UNSUPPORTED",
  declaredVerificationStatus: supported ? "CONFIRMED" : "UNSUPPORTED",
  ...extra,
});

const overview = (
  dataTypes: DataTypeRow[], background: DataTypeRow[] = [],
  scopes: Array<{ code: string; label: string }> = [],
): ChannelCapabilityOverview => ({
  channelCode: "X", channelNameKo: null, connectorClass: "API", autoCollectSupported: true,
  dataTypes, unsupportedScopes: scopes, backgroundDataTypes: background,
});

const sources = (o: ChannelCapabilityOverview | null): ChannelCapabilitySources => ({
  overview: o, transports: null, publish: null, reviewChannel: null, localAgent: "UNKNOWN",
});

describe("a capability is never stated more strongly than its weakest source", () => {
  it("the two sources agreeing and proven is the only SUPPORTED", () => {
    const verdict = supportOf("NAVER", "INQUIRY", sources(overview([dt("INQUIRY", true)])));
    expect(verdict.support).toBe("SUPPORTED");
    expect(verdict.reason).toBeNull();
  });

  it("a divergence between the live connector and the reference table is PARTIAL, either way round", () => {
    // The two divergences that are live in this repository today: Coupang PRODUCT is CONFIRMED in the
    // table and NEEDS_VERIFICATION in the connector; Coupang INQUIRY is the other way round. Picking the
    // stronger of two disagreeing sources states a capability nobody proved, and picking the weaker
    // erases rows the product is holding — so neither is picked.
    const tableSaysYes = supportOf("COUPANG", "PRODUCT",
      sources(overview([], [dt("PRODUCT", false, { declaredSupport: "SUPPORTED" })])));
    const connectorSaysYes = supportOf("COUPANG", "INQUIRY",
      sources(overview([dt("INQUIRY", true, { declaredSupport: "UNSUPPORTED" })])));

    for (const verdict of [tableSaysYes, connectorSaysYes]) {
      expect(verdict.support).toBe("PARTIAL");
      expect(verdict.reason).toBe(SUPPORT_REASON.SOURCE_DIVERGENCE);
    }
    // Both words survive for the diagnostic, so a divergence can be read back without a second call.
    expect(tableSaysYes.live).toBe("UNSUPPORTED");
    expect(tableSaysYes.declared).toBe("SUPPORTED");
  });

  it("a divergence on the VERIFICATION word is a divergence too, independently of the boolean", () => {
    // Live today: Coupang INQUIRY is supported in both sources, and the table still says
    // NEEDS_VERIFICATION while the connector says CONFIRMED — a live proof promoted one and not the
    // other. Taking the connector's word is picking the stronger of two disagreeing sources.
    const verdict = supportOf("COUPANG", "INQUIRY", sources(overview([
      dt("INQUIRY", true, { verificationStatus: "CONFIRMED", declaredVerificationStatus: "NEEDS_VERIFICATION" }),
    ])));
    expect(verdict.support).toBe("PARTIAL");
    expect(verdict.reason).toBe(SUPPORT_REASON.SOURCE_DIVERGENCE);
    // Agreeing on CONFIRMED is still the only SUPPORTED.
    expect(supportOf("COUPANG", "INQUIRY", sources(overview([
      dt("INQUIRY", true, { verificationStatus: "CONFIRMED", declaredVerificationStatus: "CONFIRMED" }),
    ]))).support).toBe("SUPPORTED");
  });

  it("served but unproven is PARTIAL, and a type nobody answered is UNKNOWN rather than unsupported", () => {
    const unproven = supportOf("CAFE24", "PRODUCT",
      sources(overview([], [dt("PRODUCT", true,
        { verificationStatus: "NEEDS_VERIFICATION", declaredVerificationStatus: "NEEDS_VERIFICATION" })])));
    expect(unproven.support).toBe("PARTIAL");
    expect(unproven.reason).toBe(SUPPORT_REASON.NEEDS_VERIFICATION);

    const unread = supportOf("NAVER", "PRODUCT", sources(null));
    expect(unread.support).toBe("UNKNOWN");
    expect(unread.reason).toBe(SUPPORT_REASON.UNREAD);
  });

  it("no API but a registered seller path is PARTIAL, not NOT_SUPPORTED — the rows exist", () => {
    const exported = supportOf("NAVER", "REVIEW", sources(overview([
      dt("REVIEW", false, {
        acquisitionPaths: [{ method: "EXPORT", verificationStatus: "LIVE_PROVEN", recurrence: "SELLER_REPEATED" }],
      }),
    ])));
    expect(exported.support).toBe("PARTIAL");
    expect(exported.reason).toBe(SUPPORT_REASON.NON_API_PATH_ONLY);

    const nothing = supportOf("NAVER", "REVIEW", sources(overview([dt("REVIEW", false)])));
    expect(nothing.support).toBe("NOT_SUPPORTED");
    expect(nothing.reason).toBe(SUPPORT_REASON.NO_PATH);
  });
});

describe("all four operating objects get a per-channel answer", () => {
  const truths = () => channelObjectTruths("NAVER", "네이버 스마트스토어", sources(overview(
    [dt("ORDER_SUMMARY", true), dt("REVIEW", false), dt("INQUIRY", true)],
    [dt("PRODUCT", true)],
  )), false);

  it("PRODUCT is one of them, read from the background list the badge row does not carry", () => {
    // The hole this closes: PRODUCT was absent from the coverage table, the capability overview, the
    // acquisition registry and the routine types — so one of the four operating objects was asserted at
    // product level with nothing to check it against on any channel.
    const product = truths().find((t) => t.object === "PRODUCT")!;
    expect(product.support.support).toBe("SUPPORTED");
    expect(product.acquisition).toBe("AUTOMATIC");
  });

  it("ORDER gets an acquisition row and no execution row", () => {
    const order = truths().find((t) => t.object === "ORDER")!;
    expect(order.acquisition).toBe("AUTOMATIC");
    // A product and an order have no reply anywhere; saying so once as a product fact is both shorter
    // and more honest than six per-channel rows repeating it.
    expect(order.execution).toBe("READ_ONLY");
    const keys = productFactSheet(
      { registeredTools: ALL_TOOLS, actionClasses: ["READ"], readiness: sellerReadinessOf(COVERAGE), coverage: COVERAGE },
      truths(),
    ).map((f) => f.key);
    expect(keys).toContain("NAVER.ORDER.ACQUISITION");
    expect(keys).not.toContain("NAVER.ORDER.EXECUTION");
    expect(keys).not.toContain("NAVER.PRODUCT.EXECUTION");
  });

  it("every fact carries a stable key and no key is used twice", () => {
    const facts = productFactSheet(
      { registeredTools: ALL_TOOLS, actionClasses: ["READ"], readiness: sellerReadinessOf(COVERAGE), coverage: COVERAGE },
      truths(),
    );
    expect(facts.every((f) => f.key.length > 0 && f.text.length > 0)).toBe(true);
    expect(new Set(facts.map((f) => f.key)).size).toBe(facts.length);
    expect(facts.map((f) => f.key)).toContain("NAVER.REVIEW.ACQUISITION");
    expect(facts.map((f) => f.key)).toContain("PRODUCT.APPROVAL_BOUNDARY");
  });
});

describe("「할 수 있다」 and 「하고 있다」 are three different facts", () => {
  const truths = channelObjectTruths("CAFE24", "카페24 자사몰",
    sources(overview([dt("INQUIRY", true)])), true);
  const sheet = (coverage: readonly ChannelCoverageRow[] | null, posture: CollectionPostureView | null) =>
    productFactSheet(
      { registeredTools: ALL_TOOLS, actionClasses: ["READ"], readiness: sellerReadinessOf(coverage), coverage, posture },
      truths,
    );
  const textOf = (facts: ReturnType<typeof sheet>, key: string) => facts.find((f) => f.key === key)!.text;

  it("a channel capability is stated in the potential mood, never the present tense", () => {
    // 「자동으로 가져옵니다」 was a present-tense claim built from a capability word, and it was false in
    // the deployment that produced the QA — whose scheduler bean does not exist.
    const line = textOf(sheet(COVERAGE, null), "CAFE24.INQUIRY.ACQUISITION");
    expect(line).toContain("자동으로 가져올 수 있습니다");
    expect(line).not.toContain("자동으로 가져옵니다");
  });

  it("the runtime layer says UNKNOWN when the read failed, and idle when nothing ticks", () => {
    expect(runtimeCollectionFact(null)).toContain("확인하지 못했습니다");
    expect(runtimeCollectionFact({ schedulerRunning: false, routineProvisioning: false }))
      .toContain("정기 수집을 실행하고 있지 않아");
    expect(runtimeCollectionFact({ schedulerRunning: true, routineProvisioning: true }))
      .toContain("정기적으로 다시 확인하도록 실행되고 있습니다");
  });

  it("the present tense needs all three layers — the runtime AND this seller", () => {
    const connected = [row("CAFE24", "카페24 자사몰", "INQUIRY", true, true, true)];
    expect(sellerCollectionFact(connected, { schedulerRunning: true, routineProvisioning: true }))
      .toContain("정기적으로 다시 확인하고 있어");
    // Same seller, same schedule row — but nothing is ticking. This combination is live today, and it
    // is how 「정기적으로 다시 확인하고 있어」 could be said while the scheduler bean did not exist.
    expect(sellerCollectionFact(connected, { schedulerRunning: false, routineProvisioning: false }))
      .toContain("자동으로 다시 확인하고 있는 채널은 없습니다");
    expect(sellerCollectionFact(connected, null)).toContain("자동으로 다시 확인하고 있는 채널은 없습니다");
  });

  it("a seller with nothing connected is told the collection state too, not left to infer it", () => {
    // The old rule returned NOTHING when no channel was connected, which left 「자동」 unqualified for the
    // one seller who most needs it: the one deciding whether to connect.
    const facts = sheet(COVERAGE, { schedulerRunning: false, routineProvisioning: false });
    expect(textOf(facts, "SELLER.COLLECTION")).toContain("지금 자동으로 가져오고 있는 자료는 없습니다");
    expect(facts.some((f) => f.key === "RUNTIME.COLLECTION")).toBe(true);
  });

  it("no fact names a configuration key or an internal token", () => {
    const facts = sheet(COVERAGE, { schedulerRunning: false, routineProvisioning: false });
    for (const fact of facts) {
      expect(fact.text, fact.key).not.toMatch(/sellerops|scheduler|self-pilot|enabled|[A-Z][A-Z0-9]*_[A-Z0-9_]+/i);
    }
  });
});

describe("the conversation lane and the product's execution are different claims", () => {
  const cafe24 = (executionEnabled: boolean) => channelObjectTruths("CAFE24", "카페24 자사몰", {
    overview: overview([dt("INQUIRY", true)]),
    transports: [{ channelCode: "CAFE24", sourceSubtype: null, transport: "DIRECT_API", reasonKo: null, evidence: null }],
    publish: { executionEnabled, replyAdapterChannelCodes: executionEnabled ? ["CAFE24"] : [] },
    reviewChannel: null, localAgent: "UNKNOWN",
  }, true).find((t) => t.object === "INQUIRY")!;

  it("an approved answer this deployment can post is DIRECT_WITH_APPROVAL", () => {
    expect(cafe24(true).execution).toBe("DIRECT_WITH_APPROVAL");
  });

  it("an audited route this deployment has not enabled hands the last step to the seller", () => {
    const truth = cafe24(false);
    expect(truth.execution).toBe("SELLER_FINAL_SUBMIT");
    expect(truth.executionReason).toBe("EXECUTION_DISABLED");
  });

  it("the invariant is stated as an approval boundary, never as a product-wide read-only claim", () => {
    const facts = productFactSheet(
      { registeredTools: ALL_TOOLS, actionClasses: ["READ"], readiness: sellerReadinessOf(COVERAGE), coverage: COVERAGE },
      [cafe24(true)],
    );
    const boundary = facts.find((f) => f.key === "PRODUCT.APPROVAL_BOUNDARY")!.text;
    expect(boundary).toContain("확인하시기 전에는 하지 않습니다");
    expect(boundary).toContain("채널과 대상에 따라 다릅니다");
    // The sentence that made a seller read the whole product as read-only.
    for (const fact of facts) {
      expect(fact.text, fact.key).not.toContain("직접 채널에 보내거나 고치는 일은 없습니다");
    }
    // The lane's own boundary survives, and it says which lane it is about.
    expect(facts.find((f) => f.key === "PRODUCT.CONVERSATION_BOUNDARY")!.text).toContain("이 대화 창구에서는");
  });
});

describe("a marketplace with no seller reply feature is not offered a copy route", () => {
  const coupangReview = (connected: boolean) => channelObjectTruths("COUPANG", "쿠팡", sources(overview(
    [dt("REVIEW", false, {
      acquisitionPaths: [{ method: "ACTION_WINDOW", verificationStatus: "LIVE_PROVEN", recurrence: "SELLER_REPEATED" }],
    })],
    [],
    [{ code: "REVIEW_API", label: "리뷰 API 없음 (쿠팡 미제공)" },
      { code: "REVIEW_REPLY", label: "판매자 리뷰 답글 기능 없음 (쿠팡 미제공)" }],
  )), connected).find((t) => t.object === "REVIEW")!;

  it("the channel fact is known before anyone connects, and it is NOT_SUPPORTED rather than unknown", () => {
    expect(coupangReview(false).execution).toBe("NOT_SUPPORTED");
    expect(coupangReview(true).execution).toBe("NOT_SUPPORTED");
  });

  it("and the registered marketplace gap is what makes it knowable — without it, UNKNOWN", () => {
    // The state before this package: no `REVIEW_REPLY` gap, so an unconnected Coupang review verdict
    // fail-closes to CAPABILITY_UNKNOWN and reads 「연결하신 뒤에 확인해 드릴 수 있습니다」 — about a
    // limitation the marketplace has published, said to the seller deciding whether to connect. The
    // assertion above is only load-bearing because this one is red without the gap.
    const withoutGap = channelObjectTruths("COUPANG", "쿠팡", sources(overview(
      [dt("REVIEW", false, {
        acquisitionPaths: [{ method: "ACTION_WINDOW", verificationStatus: "LIVE_PROVEN", recurrence: "SELLER_REPEATED" }],
      })],
      [],
      [{ code: "REVIEW_API", label: "리뷰 API 없음 (쿠팡 미제공)" }],
    )), false).find((t) => t.object === "REVIEW")!;
    expect(withoutGap.execution).toBe("UNKNOWN");
  });

  it("its acquisition is still true — collected by the seller's own action", () => {
    expect(coupangReview(false).acquisition).toBe("GUIDED_HUMAN_ACTION");
    expect(coupangReview(false).support.support).toBe("PARTIAL");
  });

  it("the sheet never puts it in the 「초안을 준비해 드리고」 group", () => {
    const facts = productFactSheet(
      { registeredTools: ALL_TOOLS, actionClasses: ["READ"], readiness: sellerReadinessOf(COVERAGE), coverage: COVERAGE },
      [coupangReview(true)],
    );
    const line = facts.find((f) => f.key === "COUPANG.REVIEW.EXECUTION")!.text;
    expect(line).toContain("답변 초안도 준비하지 않습니다");
    expect(line).not.toContain("마지막 단계는 판매자님이 하십니다");
  });
});

describe("the hand-written facts are four, and they no longer contradict each other", () => {
  it("the count is pinned so that growing it is a decision", () => {
    expect(STRUCTURAL_FACTS).toHaveLength(4);
    expect(new Set(STRUCTURAL_FACTS.map((f) => f.key)).size).toBe(4);
  });

  it("the data boundary names what is actually read, and stops denying the seller's own knowledge", () => {
    const boundary = STRUCTURAL_FACTS.find((f) => f.key === "PRODUCT.DATA_BOUNDARY")!.text;
    const draft = STRUCTURAL_FACTS.find((f) => f.key === "PRODUCT.DRAFT_BASIS")!.text;
    // The old sentence said 「채널 밖의 정보는 보지 않습니다」 while the line above it said drafts are
    // written from the seller's own registered answer bases — which is not a channel. One payload,
    // two sentences, in contradiction, and the false half is the one a seller would act on.
    expect(boundary).not.toContain("채널 밖의");
    expect(draft).toContain("등록해 두신 답변 기준");
    expect(boundary).toContain("답변 기준");
    // The one boundary that IS true and is the reason the sentence exists.
    expect(boundary).toContain("다른 회사의 자료는 보지 않습니다");
    // Nothing wider than the retrievable scopes this repository actually has.
    expect(boundary).not.toMatch(/인터넷|웹|검색 엔진|외부 자료/);
  });
});
