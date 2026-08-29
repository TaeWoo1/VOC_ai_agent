/**
 * The PREPARE steps the conversation lane makes — a reply draft, through the product's own path.
 *
 * <b>Outside the Operator tool registry on purpose.</b> The registry is 100% READ and a structural test
 * keeps it that way; a draft is a PREPARE (an append-only version the backend saves, moving nothing
 * toward a channel), and it happens only on the seller's explicit sentence (`requestedAction =
 * PREPARE_INQUIRY_DRAFT`), never on a plan the runtime chose for itself. The backend methods this
 * file reaches are `generateDraftFor` (inquiries) and the review reply seam's `getReviewReplyPrep` +
 * `saveReviewDraft` (reviews) — the same two calls the review screen makes to prepare a draft.
 * Approval, execution and verification stay in the screens' Human Approval paths and are not
 * imported here — `conversationWriteFence.test.ts` says so.
 *
 * <b>The tone is a style override, never a fact.</b> It travels as one closed token; the backend applies
 * it to the org's answer style and keeps the facts section of the model's turn byte-identical (the
 * backend lane's `AnswerStyleDraftTest` pins that). This file checks the OUTPUT independently: the
 * factual envelope (numbers, dates, promises, policy assertions — `factualEnvelope.ts`) of the tone
 * variant must equal the previous head's, or the variant is refused and the message says so. A
 * refused inquiry variant still exists as an append-only version on the backend (the generate call is
 * atomic); it is simply not the one the conversation stands on. A refused review variant is never
 * saved — the check runs before the PUT.
 *
 * <b>Review drafts are the product's own suggestion.</b> The reply seam's `suggestion.body` is the
 * rule-based reply the review screen offers; a tone hint cannot be forwarded to it (the seam takes
 * none), so a tone follow-up re-prepares the same suggestion and the envelope check is what proves
 * the facts did not move. Nothing here invents review text.
 */
import { randomUUID } from "node:crypto";
import type { SpringClient } from "../spring/SpringClient";
import type { ReviewSpringClient } from "../spring/ReviewSpringClient";
import type { GeneratedDraftView } from "../spring/types";
import type { DraftArtifact, DraftEvidenceSummary, ToneHint } from "./contract";
import { ENVELOPE_FAMILY_LABEL, envelopeDiff, extractEnvelope } from "./factualEnvelope";
import type { FactualEnvelope } from "./factualEnvelope";
import { log } from "../log";

export interface DraftTarget {
  readonly workItemId: string;
  readonly inquiryId: string;
  readonly channelCode: string | null;
  readonly channelNameKo: string | null;
  readonly productId: string | null;
  readonly productName: string | null;
}

export interface ReviewDraftTarget {
  readonly reviewId: string;
  readonly accountId: string;
  readonly actionRef: string;
  readonly channelCode: string | null;
  readonly channelNameKo: string | null;
  readonly productId: string | null;
  readonly productName: string | null;
}

/** The seller-facing refusal when a tone variant moved a fact. Deterministic; names the families that moved. */
export function envelopeRefusal(diff: ReadonlyArray<keyof FactualEnvelope>): string {
  const families = diff.map((d) => ENVELOPE_FAMILY_LABEL[d]).join("·");
  return `말투를 바꾼 초안에서 ${families}이(가) 달라져 채택하지 않았습니다. 이전 초안을 그대로 둡니다.`;
}

/** The seller's words for each lane, in the order the draft screen lists them. */
const LANE_ORDER = ["상품 정보", "운영 정책", "과거 답변", "주문 상태"] as const;

/**
 * How many passages each lane put in front of the drafter — counts by the backend's own `scopeLabel`,
 * never the passage text (Knowledge Context v1-A). A lane the backend does not know is kept, last.
 */
export function evidenceSummaryOf(evidence: unknown): DraftEvidenceSummary[] {
  const counts = new Map<string, number>();
  for (const row of Array.isArray(evidence) ? evidence : []) {
    const label = row && typeof row === "object" && typeof (row as { scopeLabel?: unknown }).scopeLabel === "string"
      ? (row as { scopeLabel: string }).scopeLabel : null;
    if (!label) continue;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const rank = (label: string) => { const i = LANE_ORDER.indexOf(label as typeof LANE_ORDER[number]); return i < 0 ? LANE_ORDER.length : i; };
  return [...counts.entries()].sort((a, b) => rank(a[0]) - rank(b[0])).map(([scopeLabel, count]) => ({ scopeLabel, count }));
}

function headFrom(detail: Awaited<ReturnType<SpringClient["getInquiryDetail"]>> | null): { version: number; contentFingerprint: string; comments: string } | null {
  return detail?.draft ? { version: detail.draft.version, contentFingerprint: detail.draft.contentFingerprint, comments: detail.draft.comments } : null;
}

export class DraftPreparer {
  constructor(
    private readonly client: Pick<SpringClient, "generateDraftFor" | "getInquiryDetail" | "proposeInquiry">,
    private readonly review?: Pick<ReviewSpringClient, "getReviewReplyPrep" | "saveReviewDraft" | "recordReviewTriage">,
  ) {}

  async prepare(target: DraftTarget, tone: ToneHint | null, artifactId: string): Promise<DraftArtifact> {
    return (await this.prepareWithView(target, tone, artifactId)).artifact;
  }

  /**
   * The same PREPARE, returning the backend's view beside the artifact — for a caller that needs a
   * field the artifact does not carry (the legacy lanes' `ComposerDraftProvider` needs the saved
   * version's title so an unedited approval binds to the head instead of re-saving it).
   */
  async prepareWithView(
    target: DraftTarget, tone: ToneHint | null, artifactId: string,
  ): Promise<{ readonly artifact: DraftArtifact; readonly view: GeneratedDraftView }> {
    // The product's own draft path is propose → generate: a draft version is saved only on a PROPOSED
    // work item, and an OPEN one is moved there by the same proposal step the inquiry screen uses
    // (a local row, never a marketplace call). Found on the throwaway QA org (Acceptance Closure): the
    // Demo Org never showed it because its open inquiries have no answer basis and save nothing.
    const detail = await this.detailOf(target.workItemId);
    if (detail?.phase === "OPEN") {
      await this.client.proposeInquiry(target.workItemId);
      log("conversation_inquiry_proposed", { objectKind: "INQUIRY" });
    }
    // A tone variant is checked against the head it replaces — read before generating, since the
    // generate call appends atomically and the previous head is gone from the detail afterwards.
    const previous = tone ? headFrom(detail) : null;
    const view: GeneratedDraftView = await this.client.generateDraftFor(target.workItemId, tone);
    const draft = view.draft;
    if (tone && previous && draft) {
      const diff = envelopeDiff(extractEnvelope(previous.comments), extractEnvelope(draft.comments));
      if (diff.length > 0) {
        log("conversation_draft_refused", { objectKind: "INQUIRY", tone, families: diff.join(",") });
        return { artifact: this.inquiryArtifact(target, view, previous, tone, artifactId, envelopeRefusal(diff)), view };
      }
    }
    return { artifact: this.inquiryArtifact(target, view, draft, tone, artifactId, null), view };
  }

  private async detailOf(workItemId: string): Promise<Awaited<ReturnType<SpringClient["getInquiryDetail"]>> | null> {
    try {
      return await this.client.getInquiryDetail(workItemId);
    } catch {
      return null;
    }
  }

  private inquiryArtifact(
    target: DraftTarget, view: GeneratedDraftView,
    draft: { version: number; contentFingerprint: string; comments: string } | null, tone: ToneHint | null,
    artifactId: string, refusal: string | null,
  ): DraftArtifact {
    return {
      artifactId,
      type: "DRAFT",
      objectKind: "INQUIRY",
      title: view.unavailableMessage
        ? "초안을 준비하지 못했습니다"
        : draft ? "답변 초안" : "답변 기준이 필요합니다",
      workItemId: target.workItemId,
      inquiryId: target.inquiryId,
      channelCode: target.channelCode,
      channelNameKo: target.channelNameKo,
      version: draft?.version ?? null,
      contentFingerprint: draft?.contentFingerprint ?? null,
      comments: draft?.comments ?? null,
      authorKind: view.authorKind,
      answerBasis: view.answerBasis ?? view.draft?.answerBasis ?? null,
      answerBasisNote: view.answerBasisNote ?? view.draft?.answerBasisNote ?? null,
      knowledgeState: view.knowledgeState,
      evidenceCount: Array.isArray(view.evidence) ? view.evidence.length : 0,
      evidenceSummary: evidenceSummaryOf(view.evidence),
      companyContextUsed: view.companyContextUsed === true,
      productId: view.productId ?? target.productId,
      productName: target.productName,
      unavailableMessage: view.unavailableMessage,
      // A refused variant keeps the previous head and says why; the tone it did NOT take is not stamped.
      tone: refusal ? null : tone,
      to: `/inquiries/${target.inquiryId}`,
      ...(refusal ? { note: refusal } : {}),
    };
  }

  /**
   * A review reply draft through the review screen's own seam: read the prep (suggestion + head), then
   * save the suggestion as the next append-only version. Returns null-versioned when the seam refuses.
   */
  async prepareReview(
    target: ReviewDraftTarget, tone: ToneHint | null, artifactId: string,
    capability?: { readonly execution: string; readonly reason: string | null } | null,
  ): Promise<DraftArtifact> {
    const base = (unavailable: string | null, body: string | null, version: number | null, fingerprint: string | null, note?: string): DraftArtifact => ({
      artifactId, type: "DRAFT", objectKind: "REVIEW",
      title: unavailable ? "초안을 준비하지 못했습니다" : "리뷰 답글 초안",
      accountId: target.accountId, actionRef: target.actionRef,
      workItemId: target.reviewId, inquiryId: target.actionRef,
      channelCode: target.channelCode, channelNameKo: target.channelNameKo,
      version, contentFingerprint: fingerprint, comments: body,
      authorKind: body ? "RULE_SUGGESTION" : null, answerBasis: null, answerBasisNote: null, knowledgeState: null,
      evidenceCount: 0, productId: target.productId, productName: target.productName,
      unavailableMessage: unavailable, tone: note ? null : tone, to: "/reviews",
      ...(note ? { note } : {}),
    });
    if (!this.review) return base("이 배포에서는 리뷰 답글 초안을 준비할 수 없습니다.", null, null, null);
    // Acceptance Closure §10, defence in depth: a channel with no reply flow (Coupang), or one whose flow
    // could not be read, gets no draft here whatever the caller decided. Only a switched-off deployment
    // of an audited lane (`EXECUTION_DISABLED`) may still draft — the seller copies it.
    if (capability && capability.execution === "NOT_SUPPORTED" && capability.reason !== "EXECUTION_DISABLED") {
      return base("이 채널에서는 리뷰 답글을 등록할 수 없어 초안을 준비하지 않았습니다.", null, null, null);
    }
    if ((target.channelCode ?? "").toUpperCase() === "COUPANG") {
      return base("쿠팡에서는 판매자가 리뷰에 직접 답글을 남기는 기능을 지원하지 않습니다.", null, null, null);
    }
    let prep;
    try {
      prep = await this.review.getReviewReplyPrep(target.accountId, target.actionRef);
    } catch {
      return base("리뷰 답글 준비 정보를 읽지 못했습니다.", null, null, null);
    }
    // 「이 리뷰 답변해줘」 is the seller's triage decision: the reply seam saves drafts only for a review marked
    // 대응 필요, so the decision is recorded (a local row, never a marketplace call) and the prep re-read once.
    if (!prep.capabilities.canSave && prep.triageDisposition !== "RESPONSE_NEEDED" && !prep.draft
        && typeof this.review.recordReviewTriage === "function") {
      try {
        await this.review.recordReviewTriage(target.accountId, target.actionRef, { commandId: randomUUID(), disposition: "RESPONSE_NEEDED" });
        prep = await this.review.getReviewReplyPrep(target.accountId, target.actionRef);
        log("conversation_review_triaged", { disposition: "RESPONSE_NEEDED", canSave: prep.capabilities.canSave });
      } catch {
        return base("이 리뷰를 답변 대상으로 기록하지 못했습니다.", null, null, null);
      }
    }
    const body = prep.suggestion?.body?.trim() ?? "";
    if (body.length === 0) return base("이 리뷰에 대한 답글 제안이 없습니다.", null, null, null);
    if (!prep.capabilities.canSave) {
      // An approved head cannot be edited; a review outside RESPONSE_NEEDED has no draft to prepare.
      return prep.draft
        ? base(null, prep.draft.body, prep.draft.version, prep.draft.contentFingerprint, "이미 준비된 초안이 있어 그대로 둡니다.")
        : base("이 리뷰는 지금 답글 초안을 준비할 수 없는 상태입니다.", null, null, null);
    }
    if (tone && prep.draft) {
      const diff = envelopeDiff(extractEnvelope(prep.draft.body), extractEnvelope(body));
      if (diff.length > 0) {
        log("conversation_draft_refused", { objectKind: "REVIEW", tone, families: diff.join(",") });
        return base(null, prep.draft.body, prep.draft.version, prep.draft.contentFingerprint, envelopeRefusal(diff));
      }
    }
    try {
      const saved = await this.review.saveReviewDraft(target.accountId, target.actionRef, { body, baseVersion: prep.draft?.version ?? 0 });
      // A tone request that produced the very same text is not a tone change: the review suggestion is the
      // product's own sentence, so say that instead of announcing a rewrite that did not happen.
      const unchanged = tone != null && prep.draft != null && saved.contentFingerprint === prep.draft.contentFingerprint;
      return unchanged
        ? base(null, saved.body, saved.version, saved.contentFingerprint, "리뷰 답글은 제품이 제안한 문장 그대로라 말투를 바꾸지 못했습니다. 내용은 그대로입니다.")
        : base(null, saved.body, saved.version, saved.contentFingerprint);
    } catch {
      return base("리뷰 답글 초안을 저장하지 못했습니다.", null, null, null);
    }
  }
}
