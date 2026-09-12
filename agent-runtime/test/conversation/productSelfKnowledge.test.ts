/**
 * <b>What reviewnary says about itself — and what it refuses to say.</b>
 *
 * Manual owner QA, 2026-09-07. The measurements these assertions stand on are in
 * `src/operator/capability/ProductSelfKnowledge.ts`; what is pinned here is the DERIVATION, because
 * every sentence in that file is a claim about this deployment and each one has a source that can go
 * missing.
 */
import { describe, expect, it } from "vitest";
import type { ChannelCoverageRow } from "../../src/spring/types";
import type { SellerReadiness } from "../../src/operator/capability/SellerReadiness";
import { sellerReadinessOf } from "../../src/operator/capability/SellerReadiness";
import { OPERATOR_TOOL } from "../../src/operator/tools/OperatorTools";
import { TOOL_CAPABILITIES } from "../../src/operator/tools/ToolReachability";
import { EXECUTION_REASON } from "../../src/operator/capability/ChannelCapability";
import {
  CAPABILITY_ASPECTS, afterConnectAnswer, capabilityAspectOf, channelActionAnswer, channelActionFacts,
  channelOffers, fallbackAspect, overviewAnswer, shortenRepeat, supportedChannelsAnswer,
} from "../../src/operator/capability/ProductSelfKnowledge";

const ALL_TOOLS = TOOL_CAPABILITIES.map((r) => r.tool);

const row = (
  channelCode: string, channelNameKo: string, dataType: string, supported: boolean, connected = false,
): ChannelCoverageRow => ({
  channelCode, channelNameKo, dataType, state: connected ? "ZERO" : "NOT_CONNECTED", supported,
  verificationStatus: null, connected, connectionStatus: null, routineEnabled: false, routinePausedBy: null,
  lastSuccessfulSyncAt: null, rows: 0, openRows: null, newestObservedAt: null,
});

/** A deployment offering three channels, one of which has no review path — the shipped shape. */
const COVERAGE: readonly ChannelCoverageRow[] = [
  row("NAVER", "네이버 스마트스토어", "INQUIRY", true),
  row("NAVER", "네이버 스마트스토어", "REVIEW", false),
  row("NAVER", "네이버 스마트스토어", "ORDER_SUMMARY", true),
  row("CAFE24", "카페24 자사몰", "INQUIRY", true),
  row("CAFE24", "카페24 자사몰", "REVIEW", true),
  row("COUPANG", "쿠팡", "INQUIRY", true),
];

const inputs = (coverage: readonly ChannelCoverageRow[] | null) => ({
  registeredTools: ALL_TOOLS, actionClasses: ["READ" as const],
  readiness: sellerReadinessOf(coverage), coverage,
});

describe("supported channels come from the coverage table, never from a list in a file", () => {
  it("names every channel this deployment offers, with what each one actually holds", () => {
    const answer = supportedChannelsAnswer(inputs(COVERAGE));

    expect(answer.headline).toContain("네이버 스마트스토어 · 카페24 자사몰 · 쿠팡");
    // NAVER declares no review path here, so it is not promised reviews — the line is per channel and
    // per type, which is the whole reason the answer is derived rather than written.
    expect(answer.lines.find((l) => l.startsWith("네이버"))).not.toContain("리뷰");
    expect(answer.lines.find((l) => l.startsWith("카페24"))).toContain("리뷰");
    // The question 「어떤 채널을 지원해?」 is never answered by asking which channel.
    expect(answer.headline).not.toContain("어느 채널에 대한 질문인지");
  });

  it("a coverage read that failed claims nothing about channels", () => {
    const answer = supportedChannelsAnswer(inputs(null));

    expect(answer.headline).toContain("확인하지 못했습니다");
    expect(answer.lines).toEqual([]);
  });

  it("the particle follows the noun it is attached to", () => {
    // 주문 ends in a consonant and 리뷰 does not; a fixed 「를」 printed 「문의 · 주문를」 live.
    const answer = supportedChannelsAnswer(inputs(COVERAGE));
    expect(answer.lines.some((l) => l.includes("주문를"))).toBe(false);
    expect(answer.lines.some((l) => l.includes("주문을 가져옵니다"))).toBe(true);
  });
});

describe("what happens after connecting is the loop this runtime actually runs", () => {
  it("describes the steps and the write boundary, and offers the one action", () => {
    const answer = afterConnectAnswer(inputs(COVERAGE));

    // Truth Closure v1 §4: step 1 states what the CHANNEL allows, not what is happening — the
    // deployment's posture and this seller's connection are said by their own facts, once each.
    expect(answer.lines.some((l) => l.includes("정기적으로 가져올 수 있습니다"))).toBe(true);
    expect(answer.lines.some((l) => l.includes("이 대화 창구에서는"))).toBe(true);
    expect(answer.link?.to).toBe("/connect");
    // 「연결부터 하세요」 answers a different question and must not stand in for this one.
    expect(answer.headline).not.toContain("연결하는 것부터");
  });

  it("a named channel narrows the answer to what THAT channel offers", () => {
    const offer = channelOffers(COVERAGE).find((o) => o.code === "NAVER")!;
    const answer = afterConnectAnswer(inputs(COVERAGE), { offer, facts: null });

    expect(answer.headline).toContain("네이버 스마트스토어 연결");
    // This deployment's NAVER row declares no review path, so its loop does not promise review work.
    expect(answer.lines.some((l) => l.includes("리뷰에서 반복되는 문제"))).toBe(false);
    expect(answer.lines.some((l) => l.includes("답변이 필요한 문의"))).toBe(true);
  });
});

describe("a channel's capability is read, and 「모른다」 is not said as 「안 된다」", () => {
  const facts = (reviewSupported: boolean, connected = false) => channelActionFacts("CAFE24", "카페24 자사몰", {
    overview: {
      channelCode: "CAFE24", channelNameKo: "카페24 자사몰", connectorClass: null, autoCollectSupported: true,
      dataTypes: [
        { dataType: "INQUIRY", label: null, supported: true, verificationStatus: "AUDITED", acquisitionPaths: [] },
        { dataType: "REVIEW", label: null, supported: reviewSupported, verificationStatus: "AUDITED", acquisitionPaths: [] },
      ],
      unsupportedScopes: [],
    },
    transports: [{ channelCode: "CAFE24", sourceSubtype: null, transport: "DIRECT_API", reasonKo: null, evidence: null }],
    publish: { executionEnabled: true, replyAdapterChannelCodes: ["CAFE24"] } as never,
    reviewChannel: null, localAgent: "UNKNOWN",
  }, connected);

  it("an execution verdict with no source says it will be confirmed, not that it is impossible", () => {
    const answer = channelActionAnswer([facts(true)], sellerReadinessOf(COVERAGE));

    // The review-reply verdict is read from a CONNECTED account; before connection there is no source,
    // and the resolver fail-closes to NOT_SUPPORTED / CAPABILITY_UNKNOWN. Printing that as 「안 됩니다」
    // would make the product understate itself to the one seller deciding whether to connect.
    const reviewSend = answer.lines.find((l) => l.includes("리뷰 답글 보내기"))!;
    expect(reviewSend).toContain("연결하신 뒤에 확인해 드릴 수 있습니다");
    expect(reviewSend).not.toContain("길이 없어");
    // The inquiry transport IS audited and wired, so that one is a real promise — and it names the
    // approval, because that is what makes it true (Truth Closure v1 §5).
    const inquirySend = answer.lines.find((l) => l.includes("문의 답변 보내기"))!;
    expect(inquirySend).toContain("승인하시면");
    expect(inquirySend).toContain("채널에 등록하고");
  });

  it("a channel with no path for a type says so, per type", () => {
    const answer = channelActionAnswer([facts(false)], sellerReadinessOf(COVERAGE));
    expect(answer.lines.find((l) => l.includes("리뷰 가져오기"))).toContain("아직 가져올 경로가 없습니다");
    expect(answer.lines.find((l) => l.includes("문의 가져오기"))).toContain("자동으로 가져올 수 있습니다");
  });

  it("names the reasons apart — a channel that cannot, and a verdict not yet read", () => {
    // The two reasons the wording depends on both exist in the resolver's own vocabulary.
    expect(EXECUTION_REASON.CHANNEL_UNSUPPORTED).not.toEqual(EXECUTION_REASON.CAPABILITY_UNKNOWN);
  });

  it("an unread verdict on a CONNECTED channel does not blame the connection", () => {
    // Live on the connected Demo organisation: 「쿠팡은 어디까지 가능해?」 answered 「연결하신 뒤에 확인해
    // 드릴 수 있습니다」 to a shop whose 쿠팡 has been connected for months.
    const answer = channelActionAnswer([facts(true, true)], sellerReadinessOf(COVERAGE));
    const reviewSend = answer.lines.find((l) => l.includes("리뷰 답글 보내기"))!;
    expect(reviewSend).not.toContain("연결하신 뒤에");
    expect(reviewSend).toContain("확인하지 못했습니다");
  });

  it("a path this deployment has not enabled names the copy route, not a flag and not the connection", () => {
    const disabled = channelActionFacts("CAFE24", "카페24 자사몰", {
      overview: null,
      transports: [{ channelCode: "CAFE24", sourceSubtype: null, transport: "DIRECT_API", reasonKo: null, evidence: null }],
      publish: { executionEnabled: false, replyAdapterChannelCodes: [] } as never,
      reviewChannel: null, localAgent: "UNKNOWN",
    }, true);
    const line = channelActionAnswer([disabled], sellerReadinessOf(COVERAGE))
      .lines.find((l) => l.includes("문의 답변 보내기"))!;
    // The route runs through the seller's own hands, and the sentence says whose the last step is —
    // it no longer prescribes «복사», because for a guided channel the last step is a button press.
    expect(line).toContain("마지막 단계는 판매자님이 하십니다");
    // The seller's remedy is not connecting, and no internal word for the switch appears.
    expect(line).not.toContain("연결하신 뒤에");
    expect(line.toLowerCase()).not.toContain("execution");
  });

  it("across channels a shared fact is said once", () => {
    const two = [facts(true), channelActionFacts("COUPANG", "쿠팡", {
      overview: null, transports: null, publish: null, reviewChannel: null, localAgent: "UNKNOWN",
    })];
    const lines = channelActionAnswer(two, sellerReadinessOf(COVERAGE)).lines;
    // Twelve per-channel rows, ten of them repeats, was the live shape. One line per distinct fact.
    expect(lines.length).toBeLessThan(12);
    expect(lines.some((l) => l.includes("모든 채널에서"))).toBe(true);
  });

  it("two source subtypes that agree answer for the channel; two that disagree do not", () => {
    const naver = (second: string) => channelActionFacts("NAVER", "네이버 스마트스토어", {
      overview: null,
      transports: [
        { channelCode: "NAVER", sourceSubtype: "NAVER_PRODUCT_QNA", transport: "DIRECT_API", reasonKo: null, evidence: null },
        { channelCode: "NAVER", sourceSubtype: "NAVER_CUSTOMER_INQUIRY", transport: second, reasonKo: null, evidence: null },
      ],
      publish: { executionEnabled: true, replyAdapterChannelCodes: ["NAVER"] } as never,
      reviewChannel: null, localAgent: "UNKNOWN",
    }, true);
    const lineOf = (f: ReturnType<typeof naver>) =>
      channelActionAnswer([f], sellerReadinessOf(COVERAGE)).lines.find((l) => l.includes("문의 답변 보내기"))!;

    expect(lineOf(naver("DIRECT_API"))).toContain("채널에 등록하고");
    // Disagreeing subtypes stay unknown: the per-object lane refuses to pick one for a reason, and
    // this answer must not pick one either.
    expect(lineOf(naver("UNSUPPORTED"))).not.toContain("채널에 등록하고");
  });

  it("an unread coverage table produces no channel claims at all", () => {
    expect(channelActionAnswer([], sellerReadinessOf(null)).lines).toEqual([]);
  });
});

describe("a fact is said once — per fact", () => {
  const NO_CHANNEL: SellerReadiness = sellerReadinessOf(COVERAGE);
  const CONNECTED: SellerReadiness =
    { kind: "WORKING", connected: ["카페24 자사몰"], connectable: [], delegable: ["INQUIRY", "REVIEW"] };

  it("a repeat while nothing is connected is NOT the same sentence with the card removed", () => {
    const first = afterConnectAnswer(inputs(COVERAGE));
    const again = shortenRepeat(first, NO_CHANNEL);

    expect(again.lines).toEqual([]);
    expect(again.headline).not.toBe(first.headline);
    expect(again.link?.to).toBe("/connect");
  });

  it("a repeat for a connected seller moves to the day's work", () => {
    const again = shortenRepeat(overviewAnswer(inputs(COVERAGE)), CONNECTED);
    expect(again.headline).toContain("이미 연결돼 있습니다");
    expect(again.chips[0]).toBe("내가 해야 할 일 정리해줘");
  });
});

describe("the aspect axis", () => {
  it("accepts exactly the eleven the planner is offered, and nothing else", () => {
    expect([...CAPABILITY_ASPECTS]).toEqual([
      "PRODUCT_OVERVIEW", "SUPPORTED_CHANNELS", "AFTER_CONNECT", "CHANNEL_ACTION", "HOW_TO_CONNECT",
      // v18 (2026-09-08). Both were arriving as a null aspect, and null widens: the runtime sent every
      // layer of the reviewed ledger and the conversation floor refused the request outright.
      "PRODUCT_DIFFERENCE", "FUTURE_DIRECTION",
      // v19 (2026-09-08). Manual QA watched 「지금 자동으로 가져오고 있어?」 answer with a product
      // catalogue and 「내가 매일 들어와야 해?」 answer with today's inquiry count — both true about the
      // store, neither the question asked.
      "COLLECTION_STATE", "DAILY_OPERATION",
      // v21 (2026-09-08). Both planned as PRODUCT_OVERVIEW and arrived at 79 fact lines against a
      // floor of 80 — correct answers one ledger addition away from silently reverting.
      "TEAM_ACCESS", "SECURITY_AND_DATA",
    ]);
    // Half-convergence, stated: `AgentPlanPrompt.CAPABILITY_ASPECTS` pins the same eleven on the backend
    // side and its own test asserts the prompt offers each. A value added on one side only is dropped
    // here — the failure direction is the fallback, never a token the runtime cannot read.
    for (const a of CAPABILITY_ASPECTS) expect(capabilityAspectOf(a)).toBe(a);
    expect(capabilityAspectOf("NOT_AN_ASPECT")).toBeNull();
    expect(capabilityAspectOf(null)).toBeNull();
  });

  it("a plan with no aspect reproduces the behaviour that predates the field", () => {
    const NO_CHANNEL = sellerReadinessOf(COVERAGE);
    expect(fallbackAspect(true, false, NO_CHANNEL)).toBe("CHANNEL_ACTION");
    expect(fallbackAspect(false, false, NO_CHANNEL)).toBe("PRODUCT_OVERVIEW");
    // The old rule exactly: a second capability question with nothing connected was the next step.
    expect(fallbackAspect(false, true, NO_CHANNEL)).toBe("HOW_TO_CONNECT");
    expect(fallbackAspect(false, true, { kind: "WORKING", connected: ["카페24 자사몰"], connectable: [], delegable: [] }))
      .toBe("PRODUCT_OVERVIEW");
  });
});

describe("the overview is still derived from the catalogue", () => {
  it("loses a domain when the tool that serves it is gone", () => {
    const without = overviewAnswer({
      ...inputs(COVERAGE),
      registeredTools: ALL_TOOLS.filter((n) => n !== OPERATOR_TOOL.GET_REVIEW_DETAIL),
    });
    expect(without.lines.some((l) => l.includes("리뷰 하나를 고르시면"))).toBe(false);
  });
});
