package com.sellerops.review.draft.dto;

import com.sellerops.attention.reply.dto.ReviewReplyDraftView;
import com.sellerops.inquiry.draft.dto.DraftEvidenceView;
import java.util.List;

/**
 * The result of asking for one grounded review reply draft (Grounded Review Drafting v1).
 *
 * <p><b>A draft is always written — and that is the one place this lane deliberately differs from the
 * inquiry lane.</b> An inquiry with no basis gets no draft at all, because the customer asked a
 * question and a fluent paragraph that answers nothing is worse than an empty box. A review asked
 * nothing. Thanking a customer and acknowledging what they said is a complete, honest, publishable
 * reply on its own, and the seller's own template is exactly that sentence. So the floor here is the
 * template, the lift is the evidence, and {@code answerBasis} says which one the seller is reading.
 *
 * <p>{@code evidence} is what was actually put in front of the drafter, in order — never a list of
 * what was searched. On a {@code NO_ANSWER_BASIS} draft it is empty, and that is the honest report:
 * no model was called, so nothing was shown to one.
 *
 * @param draft            the saved append-only version — never null, see above
 * @param authorKind       {@code MODEL} when a model wrote this text, {@code RULE} when the org's
 *                         template did. The seller is entitled to know which
 * @param answerBasis      {@code GROUNDED} or {@code NO_ANSWER_BASIS}. {@code NEEDS_CLARIFICATION}
 *                         is not reachable here: it means «ask the customer which 규격», and a public
 *                         reply to a review that asked nothing has no one to ask
 * @param answerBasisNote  that state as the sentence the seller reads
 * @param evidence         the passages the drafter was shown, in order; empty on the template floor
 * @param knowledgeGaps    what to register so the next draft can say more, as closed structures
 * @param templateCategory which template key supplied the wording floor and the style
 * @param templateSource   {@code ORG} when this company's own saved wording was used,
 *                         {@code DEFAULT} when reviewnary's shipped wording was
 * @param unavailableMessage why a grounded draft was not written even though evidence existed — the
 *                         day's AI budget, the capability being off, a vendor that did not answer, a
 *                         forbidden phrase, or an unsupported promise. <b>An operational fact, never
 *                         a statement about the seller's knowledge</b>, which is why it is a separate
 *                         field from {@code answerBasis} exactly as it is on the inquiry lane
 */
public record GeneratedReviewDraftView(ReviewReplyDraftView draft, String authorKind,
                                       String answerBasis, String answerBasisNote,
                                       List<DraftEvidenceView> evidence,
                                       List<ReviewKnowledgeGapView> knowledgeGaps,
                                       String templateCategory, String templateSource,
                                       String unavailableMessage) {
}
