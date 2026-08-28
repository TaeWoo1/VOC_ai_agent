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
import type { DraftArtifact, ToneHint } from "./contract";
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

export class DraftPreparer {
  constructor(
    private readonly client: Pick<SpringClient, "generateDraftFor" | "getInquiryDetail">,
    private readonly review?: Pick<ReviewSpringClient, "getReviewReplyPrep" | "saveReviewDraft" | "recordReviewTriage">,
  ) {}

  async prepare(target: DraftTarget, tone: ToneHint | null, artifactId: string): Promise<DraftArtifact> {
    // A tone variant is checked against the head it replaces — read before generating, since the
    // generate call appends atomically and the previous head is gone from the detail afterwards.
    const previous = tone ? await this.headOf(target.workItemId) : null;
    const view: GeneratedDraftView = await this.client.generateDraftFor(target.workItemId, tone);
    const draft = view.draft;
    if (tone && previous && draft) {
      const diff = envelopeDiff(extractEnvelope(previous.comments), extractEnvelope(draft.comments));
      if (diff.length > 0) {
        log("conversation_draft_refused", { objectKind: "INQUIRY", tone, families: diff.join(",") });
        return this.inquiryArtifact(target, view, previous, tone, artifactId, envelopeRefusal(diff));
      }
    }
    return this.inquiryArtifact(target, view, draft, tone, artifactId, null);
  }

  private async headOf(workItemId: string): Promise<{ version: number; contentFingerprint: string; comments: string } | null> {
    try {
      const detail = await this.client.getInquiryDetail(workItemId);
      return detail.draft ? { version: detail.draft.version, contentFingerprint: detail.draft.contentFingerprint, comments: detail.draft.comments } : null;
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
  async prepareReview(target: ReviewDraftTarget, tone: ToneHint | null, artifactId: string): Promise<DraftArtifact> {
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
