/**
 * ReviewOps' ANCHORED path — the review the seller is standing on, read exactly.
 *
 * <b>The defect this closes.</b> A review could be anchored (clicked, or named from a row this
 * conversation drew) and then nothing could be said about it: the review reads were a window list and
 * an org-wide issue list, so 「이 리뷰 자세히 봐줘」 either came back as a list re-print or — when the
 * demonstrative was allowed to resolve to the review's PRODUCT — as that product's most recent review,
 * a ★5 under a question about a ★1 (measured live 2026-09-01, reverted the same day). A demonstrative
 * that names ONE object must be answered from that object.
 *
 * <b>Exactly one read, and it is about this review.</b> `get_review_detail` returns the review's own
 * closed facts, the customer's redacted sentence, and the repeated problems this review is already
 * recorded as evidence for. Nothing here scans, groups, or counts the product's other rows — a
 * follow-up that WANTS the product's rows says so and gets the ordinary product path, named.
 *
 * <b>The widening, when it happens, is named.</b> 「비슷한 리뷰도 있어?」 is answered by the rows read
 * with this review's product — the plan's own `reviewIntent=ROWS` decides that, as it always has — and
 * the sentence says it is the same product's reviews, never 「이 리뷰」.
 */
import type { EvidenceRef, Finding, SpecialistResult } from "../state/OperatorState";
import type { NeedState } from "../plan/InvestigationPlan";
import type { SpecialistInput } from "./specialistInput";
import type { ReviewOpsResult } from "./reviewOps";
import type { ReviewDetailArtifact } from "../../conversation/contract";
import type { ReviewDetailResponse, ChannelCapabilityOverview } from "../../spring/types";
import type { ChannelCapabilityRead } from "../tools/OperatorTools";
import { OPERATOR_TOOL } from "../tools/OperatorTools";
import { attemptTool } from "../failure/SpecialistOutcome";
import { capabilityOf } from "../capability/ChannelCapability";
import { eventRange } from "../scope/EvidenceTime";
import { excerpt } from "../wording/sellerWording";
import { log } from "../../log";

/** The review this turn is standing on, or null. Read from the anchor — never from the sentence. */
export function anchoredReviewId(input: SpecialistInput): string | null {
  const object = input.selectedObject ?? null;
  return object?.kind === "REVIEW" ? object.id : null;
}

/** 「★1 · 쿠팡 · 2026-08-20 · 논슬립 주방 매트」 — the row's own closed facts, in one line. */
export function reviewLine(view: ReviewDetailResponse): string {
  const parts: string[] = [];
  if (view.rating != null) parts.push(`★${view.rating}`);
  if (view.channelNameKo ?? view.channelCode) parts.push(view.channelNameKo ?? view.channelCode!);
  if (view.writtenOn) parts.push(`${view.writtenOn} 작성`);
  if (view.productName) parts.push(view.productName);
  return parts.join(" · ");
}

/**
 * What this review is already evidence for, as one sentence — or the honest absence.
 *
 * <b>Absence is not a diagnosis.</b> A review no extractor tied to a repeated problem is a review this
 * product has nothing further to say about; inventing a cause from the rating would be the assistant
 * writing the customer's reason for them.
 */
export function issueSentence(view: ReviewDetailResponse): string {
  if (view.issues.length === 0) {
    return "이 리뷰는 아직 반복 문제로 묶이지 않았습니다 — 같은 내용이 더 쌓이면 반복 문제로 올라옵니다.";
  }
  const titles = view.issues.map((i) => `「${i.title}」`).join(" · ");
  return view.issues.length === 1
    ? `이 리뷰는 ${titles} 문제의 근거로 기록돼 있습니다.`
    : `이 리뷰는 반복 문제 ${view.issues.length}건(${titles})의 근거로 기록돼 있습니다.`;
}

/** What can be done with this review at its channel today. UNKNOWN when the capability read did not answer. */
export type ReviewReplyCapability = ReviewDetailArtifact["replyCapability"];

export const REPLY_SENTENCE: Readonly<Record<ReviewReplyCapability, string>> = {
  DRAFTABLE: "답글 초안이 필요하시면 말씀해 주세요 — 준비만 해 두고, 등록은 확인하신 뒤에 하시면 됩니다.",
  NOT_SUPPORTED: "이 채널은 판매자가 리뷰에 답글을 남기는 기능을 지원하지 않습니다.",
  UNKNOWN: "이 채널에서 답글을 남길 수 있는지는 지금 확인하지 못했습니다.",
};

export async function readSelectedReview(input: SpecialistInput, reviewId: string): Promise<ReviewOpsResult> {
  const { registry, budget, evidence, allowedTools } = input;
  const needId = input.needs[0]!.id;
  const pending = (reason: string): ReviewOpsResult => ({
    specialist: "REVIEW_OPS", findings: [], evidence: [], coverage: [],
    needStates: input.needs.map((n) => ({ id: n.id, status: "PENDING" as const, evidenceIds: [] })),
    note: reason,
  });
  if (!budget.spend("tool")) {
    return pending("리뷰를 읽기 전에 예산이 끝났습니다.");
  }
  const attempt = await attemptTool(
    { specialist: "REVIEW_OPS", tool: OPERATOR_TOOL.GET_REVIEW_DETAIL, needId },
    () => registry.invoke<ReviewDetailResponse | null>(OPERATOR_TOOL.GET_REVIEW_DETAIL, { reviewId }, allowedTools),
  );
  if (!attempt.ok || !attempt.value) {
    // Never described from the anchor's own fields: an anchor holds ids and a channel code, and a card
    // built from those would be this runtime describing a review it failed to read.
    return {
      ...pending("선택하신 리뷰를 읽지 못했습니다."),
      ...(attempt.ok ? {} : { failures: [attempt.failure], terminal: "FAILED" as const }),
    };
  }
  const view = attempt.value;

  const replyCapability = await replyCapabilityOf(input, view, needId);
  const refs: EvidenceRef[] = [];
  const findings: Finding[] = [];
  const ref = evidence.add({
    kind: "REVIEW",
    sourceTool: OPERATOR_TOOL.GET_REVIEW_DETAIL,
    args: { reviewId },
    locator: {
      label: "선택한 리뷰",
      count: 1,
      ...(view.channelCode ? { channelCode: view.channelCode } : {}),
      ...(view.productId ? { productId: view.productId } : {}),
      ...(view.productName ? { productName: view.productName } : {}),
      ...(view.rating != null ? { rating: view.rating } : {}),
    },
    // The review's own date — event time, never the read's.
    events: view.writtenOn ? eventRange(view.writtenOn, view.writtenOn) : null,
    coverage: "COVERED",
    provenance: "reviews/detail:exact",
  });
  refs.push(ref);
  findings.push({
    findingId: `f-${ref.evidenceId}`,
    specialist: "REVIEW_OPS",
    statement: `${reviewLine(view)} 리뷰입니다. ${issueSentence(view)}`,
    evidenceIds: [ref.evidenceId],
    confidence: "NEEDS_REVIEW",
    verdict: null,
    surfaceLink: "/reviews",
    needId,
  });

  const artifact: ReviewDetailArtifact = {
    artifactId: `a-review-${view.id}`,
    type: "REVIEW_DETAIL",
    title: "선택한 리뷰",
    reviewId: view.id,
    channelCode: view.channelCode,
    channelNameKo: view.channelNameKo,
    writtenOn: view.writtenOn,
    rating: view.rating,
    negative: view.negative,
    productId: view.productId,
    productName: view.productName,
    // Bounded here, not by the endpoint: the same excerpt rule every customer sentence in this
    // conversation passes through, and it is stripped again before the turn is persisted.
    body: view.body ? excerpt(view.body) : null,
    ...(view.bodyRedacted ? { bodyRedacted: true } : {}),
    issues: view.issues.map((i) => ({
      issueId: i.issueId, title: i.title, severity: i.severity, to: `/memory/${i.issueId}`,
    })),
    replyCapability,
    to: "/reviews",
  };

  log("review_detail", {
    reviewId, issues: view.issues.length, rating: view.rating ?? -1,
    channel: view.channelCode ?? "NONE", replyCapability, terminal: "OK",
  });
  return {
    specialist: "REVIEW_OPS",
    findings,
    evidence: refs,
    coverage: [],
    failures: [],
    terminal: "OK",
    artifacts: [artifact],
    note: REPLY_SENTENCE[replyCapability],
    needStates: input.needs.map((n) => ({
      id: n.id,
      status: "SATISFIED" as const,
      evidenceIds: [ref.evidenceId],
      coverage: "COVERED" as const,
      // One object, read whole: there is nothing about THIS review this answer did not see.
      complete: true,
      settledBy: "REVIEW_OPS" as const,
    })),
  } satisfies SpecialistResult & { needStates: readonly NeedState[] };
}

/**
 * Can the seller reply to this review at its channel?
 *
 * The same resolver every other execution decision uses, over the same capability read. A read that
 * fails or is unauthorized leaves `UNKNOWN` — the answer then says it did not check, which is a
 * different sentence from 「지원하지 않습니다」 and the only honest one.
 */
async function replyCapabilityOf(
  input: SpecialistInput, view: ReviewDetailResponse, needId: string,
): Promise<ReviewReplyCapability> {
  const code = (view.channelCode ?? "").toUpperCase();
  if (!code || !input.budget.spend("tool")) {
    return "UNKNOWN";
  }
  const attempt = await attemptTool(
    { specialist: "REVIEW_OPS", tool: OPERATOR_TOOL.GET_CHANNEL_EXECUTION_CAPABILITY, needId },
    () => input.registry.invoke<ChannelCapabilityRead>(
      OPERATOR_TOOL.GET_CHANNEL_EXECUTION_CAPABILITY, { channel: code }, input.allowedTools,
    ),
  );
  if (!attempt.ok || !attempt.value.overview) {
    return "UNKNOWN";
  }
  const overview: ChannelCapabilityOverview = attempt.value.overview;
  const verdict = capabilityOf({ channelCode: code, dataType: "REVIEW", objectKind: "REVIEW" }, {
    overview, transports: attempt.value.transports, publish: attempt.value.publish,
    reviewChannel: attempt.value.reviewChannel, localAgent: input.localAgent ?? "UNKNOWN",
  });
  return verdict.execution === "NOT_SUPPORTED" ? "NOT_SUPPORTED" : "DRAFTABLE";
}
