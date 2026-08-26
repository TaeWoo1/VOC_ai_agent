package com.sellerops.inquiry.draft.dto;

import com.sellerops.inquiry.reply.dto.ReplyDraftView;
import java.util.List;
import java.util.UUID;

/**
 * The result of asking for one reply draft: what was written, what it was grounded in, and — when
 * nothing was written — which basis is missing.
 *
 * <p><b>{@code draft} may be null, and that is a real answer.</b> Since 2026-08-26 a draft is
 * produced only when current evidence applies to the question. In
 * {@code AnswerBasisState.NO_ANSWER_BASIS} the screen shows 「답변 기준이 필요합니다」 and the seller
 * writes the reply themselves; SellerOps does not compose a fluent paragraph that commits to nothing
 * in order to have something in the box.
 *
 * <p><b>Answer basis and operational state are different questions</b> (product-owner, 2026-08-27).
 * {@code answerBasis} says what the EVIDENCE supports; {@code unavailableMessage} says whether the
 * machinery ran. A vendor timeout on a fully grounded question used to be reported as
 * {@code NO_ANSWER_BASIS}, which told a seller their library was missing something when it was not.
 *
 * <p>{@code draft.version} and {@code draft.contentFingerprint} are the pair an approval will later
 * bind to. They are returned here so the screen that shows the draft is showing the exact version it
 * would send, rather than a preview that a subsequent read might resolve differently.
 *
 * @param draft            the saved append-only version, or null when none was written
 * @param authorKind       {@code MODEL}, or null when nothing was written
 * @param knowledgeState   which of the four library states the retrieval reached
 * @param knowledgeNote    that state as the one sentence shown above the draft
 * @param answerBasis      {@code GROUNDED} / {@code NEEDS_CLARIFICATION} / {@code NO_ANSWER_BASIS} —
 *                         the projection of {@code knowledgeState} and the spec applicability
 * @param answerBasisNote  that state as the sentence a seller reads
 * @param answerBasisAction what the seller could do about a missing basis, or null
 * @param productId        the canonical product the retrieval was scoped to, or null
 * @param evidence         the passages actually put in front of the drafter, in order
 * @param unavailableMessage why no draft exists for an OPERATIONAL reason — the day's AI budget,
 *                         the capability being off, a vendor that did not answer, or a 상세페이지
 *                         read that failed. <b>Its presence changes what the screen may say.</b>
 *                         Not having looked successfully is not the same as having looked and found
 *                         nothing, so when this is set the screen shows the operational sentence and
 *                         must NOT show 「답변 기준이 필요합니다」 — that sentence belongs to the one
 *                         case where retrieval actually settled with no usable evidence
 */
public record GeneratedDraftView(ReplyDraftView draft, String authorKind, String knowledgeState,
                                 String knowledgeNote, String answerBasis, String answerBasisNote,
                                 String answerBasisAction, UUID productId,
                                 List<DraftEvidenceView> evidence, String unavailableMessage) {
}
