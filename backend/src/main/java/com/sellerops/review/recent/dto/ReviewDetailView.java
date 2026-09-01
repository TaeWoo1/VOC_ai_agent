package com.sellerops.review.recent.dto;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * ONE review, read exactly — the object behind 「이 리뷰 자세히 봐줘」.
 *
 * <p><b>Why an exact read exists at all.</b> Until Agent Object v1 the conversation could anchor a
 * review and then answer nothing about it: the only review reads were a window list and an org-wide
 * issue list, so a follow-up on the anchored review either widened to the whole product (measured
 * 2026-09-01: 「이 리뷰는 어떤 상품 문제야?」 answered with that product's most recent ★5) or said
 * nothing. A demonstrative that names one object must be answerable from that object.
 *
 * <p><b>{@code body} is the redacted FULL text</b> ({@code VocPreviewSanitizer.redactFullBody}), not the
 * 60-character list preview: the question is what this customer wrote. {@code bodyRedacted} says whether
 * a span was replaced, so a reader knows they are reading a redaction. The caller bounds it again before
 * it reaches a model or a transcript.
 *
 * <p><b>{@code issues} is what this review is already evidence FOR</b> — the repeated problems the
 * extractor tied it to, org-scoped, bounded. It is the only honest answer to 「왜 이런 리뷰가 나왔을까」
 * that stays on this review: a count over the product would be a different claim about different rows.
 */
public record ReviewDetailView(
        UUID id,
        UUID sellerAccountId,
        String channelCode,
        String channelNameKo,
        LocalDate writtenOn,
        Integer rating,
        boolean negative,
        String body,
        boolean bodyRedacted,
        UUID productId,
        String productName,
        String replyState,
        /** {@code MARKETPLACE} | {@code NONE} — see {@code RecentReviewItemView.executableIdentity}. */
        String executableIdentity,
        /** {@code NEEDS_ATTENTION} | {@code WATCH} | {@code FYI} — the product's own triage word. */
        String triageTier,
        List<ReviewIssueRefView> issues) {

    /** One repeated problem this review is recorded as evidence for. Never a quote — a title and a rank. */
    public record ReviewIssueRefView(UUID issueId, String title, String severity, LocalDate occurredOn) {
    }
}
