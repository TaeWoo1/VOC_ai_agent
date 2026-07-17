package com.sellerops.attention.reply;

import java.util.UUID;

/**
 * The review-drafting seam: given one review's operator-visible context, suggest a reply the
 * operator can start from.
 *
 * <p>The provider only SUGGESTS. It never saves, never approves, never sends, and never sees
 * more than the redacted body handed to it. Its output is offered to a human who rewrites or
 * discards it at will; nothing it returns is persisted by anyone but that human's own save.
 *
 * <p><b>This provider emits a BODY, and that is a deliberate departure from
 * {@code InquiryProposalProvider} — the one place this slice extends its precedent rather
 * than copying it.</b> That interface's Javadoc says "the raw reply body is deliberately NOT
 * part of this slice — only the coarse {@code summaryCategory}", and for inquiries that was
 * right: the seller was going to type the answer regardless, so a category was the whole
 * value a rule engine could honestly add. Here the deliverable IS text on a clipboard. A
 * category alone would leave the operator with a blank box and a label, which is not
 * preparation. So the seam returns a category AND a first draft of the body.
 *
 * <p>What does not change is honesty about where the text came from. The shipped
 * implementation is deterministic and keyword-driven ({@link RuleBasedReviewReplyProvider}),
 * reports {@code providerKind=RULE_BASED}, and is gated by
 * {@code sellerops.reply.review.provider} — the same flag shape as
 * {@code sellerops.analysis.item.provider}, with {@code ai} reserved and unimplemented. A
 * future AI adapter would implement this same interface and report its own kind/name/version;
 * until one is separately authorized, no LLM is reachable from here.
 *
 * <p>The UI must label the suggestion 규칙 기반 and must not present it as an authored reply
 * (Frontend Spec §10.3). It is a starting point, and the operator is the author.
 */
public interface ReviewReplyProposalProvider {

    /** Suggest a reply for one review. Never throws for ordinary content — see {@link Suggestion}. */
    Suggestion suggest(ReviewReplyContext context);

    /**
     * The operator-visible view handed to a provider.
     *
     * <p>{@code redactedBody} is the review body AFTER {@code VocPreviewSanitizer}, never the
     * raw column: a provider is the last place that needs unredacted customer text, and
     * handing it the raw body would put PII in the one component most likely to grow an
     * external call later. {@code rating} is the review's own star rating, or null when the
     * source carried none.
     *
     * <p>Carries no customer identity, no order/product identifier, and no channel-side id —
     * a suggestion is derived from what the customer said, not from who they are.
     */
    record ReviewReplyContext(UUID orgId, UUID reviewId, String redactedBody, Integer rating) {
    }

    /**
     * A suggested reply plus its provenance.
     *
     * <p>{@code body} is the suggested text. {@code category} is the coarse reason it was
     * chosen, so the surface can say why this template and not another. The provenance triple
     * is reported, never assumed by the caller — it is what makes a later AI adapter
     * distinguishable in the response rather than silently substituted.
     */
    record Suggestion(String body, String category, String providerKind, String providerName,
                      String providerVersion) {
    }
}
