package com.sellerops.knowledge.spine.adapter;

import com.sellerops.attention.triage.ReviewTriage;
import com.sellerops.attention.triage.TriageDisposition;
import com.sellerops.common.MarkupText;
import com.sellerops.common.VocPreviewSanitizer;
import com.sellerops.knowledge.KnowledgeText;
import com.sellerops.knowledge.spine.KnowledgeAuthority;
import com.sellerops.knowledge.spine.KnowledgeEntry;
import com.sellerops.knowledge.spine.KnowledgeSpineScope;
import com.sellerops.knowledge.spine.SourceRef;
import com.sellerops.knowledge.spine.SpineSourceType;
import com.sellerops.review.Review;
import com.sellerops.review.triage.ReviewTriageTier;
import com.sellerops.review.triage.feedback.SellerCorrectionState;
import com.sellerops.review.triage.feedback.TriageCorrection;
import jakarta.persistence.EntityManager;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Component;

/**
 * <b>What the seller decided about this product's reviews</b> — a review's processing decision, and the times
 * the seller overruled the system's own reading of a review.
 *
 * <p><b>A decision is not a rule.</b> The entry states one decision on one review, in a closed sentence of ours
 * («이 상품의 별점 2점 리뷰에 대한 판매자 판단: 「지켜보기」»), and nothing here generalises it, learns a
 * threshold from it or edits a policy with it. It is evidence the next judgement may be shown.
 *
 * <p>Only the seller's own acts: a triage decision whose actor is {@code SELLER:…}, and a correction that still
 * STANDS (a withdrawn one is a trail entry, not the company's word). PRODUCT scope only — a decision is about a
 * review of a product. The review is matched on and never returned.
 */
@Component
public class SellerDecisionAdapter implements KnowledgeSourceAdapter {

    /** Decisions read per kind, newest first — the RECENT part of 「최근 판매자 판단」. */
    static final int MAX_DECISIONS = 50;

    private final EntityManager em;

    public SellerDecisionAdapter(EntityManager em) {
        this.em = em;
    }

    @Override
    public List<Indexed> read(UUID orgId, UUID productId) {
        if (productId == null) {
            return List.of();
        }
        List<Indexed> entries = new ArrayList<>();
        em.createQuery("""
                        select t, r from ReviewTriage t, Review r
                        where t.orgId = :orgId and r.orgId = :orgId and r.id = t.reviewId and r.productId = :productId
                          and t.decidedBy like 'SELLER:%'
                        order by t.decidedAt desc
                        """, Object[].class)
                .setParameter("orgId", orgId)
                .setParameter("productId", productId)
                .setMaxResults(MAX_DECISIONS)
                .getResultList()
                .forEach(row -> entries.add(decision((ReviewTriage) row[0], (Review) row[1])));
        em.createQuery("""
                        select c, r from TriageCorrection c, Review r
                        where c.orgId = :orgId and r.orgId = :orgId and r.id = c.reviewId and r.productId = :productId
                          and c.state = :standing
                        order by c.correctedAt desc
                        """, Object[].class)
                .setParameter("orgId", orgId)
                .setParameter("productId", productId)
                .setParameter("standing", SellerCorrectionState.STANDING)
                .setMaxResults(MAX_DECISIONS)
                .getResultList()
                .forEach(row -> entries.add(correction((TriageCorrection) row[0], (Review) row[1])));
        return entries;
    }

    private static Indexed decision(ReviewTriage triage, Review review) {
        String text = "이 상품의 " + ratingWords(review) + "리뷰에 대한 판매자 판단: 「"
                + dispositionKo(triage.getDisposition()) + "」";
        return new Indexed(new KnowledgeEntry(SpineSourceType.REVIEW_DECISION + ":" + triage.getId(),
                SpineSourceType.REVIEW_DECISION, KnowledgeSpineScope.PRODUCT, review.getProductId(), null,
                KnowledgeAuthority.RECENT_SELLER_DECISION, "리뷰 처리 판단", text, triage.getDecidedAt(),
                "판매자 판단 · 리뷰 처리",
                List.of(new SourceRef(SourceRef.Kind.REVIEW_TRIAGE, triage.getId(), triage.getDisposition().name()),
                        SourceRef.of(SourceRef.Kind.REVIEW, review.getId()))),
                searchable(review, text));
    }

    private static Indexed correction(TriageCorrection correction, Review review) {
        String text = "이 상품의 " + ratingWords(review) + "리뷰에 대해 판매자가 시스템 판단을 고쳤습니다: "
                + (correction.getShownTier() == null ? "" : "「" + tierKo(correction.getShownTier()) + "」 → ")
                + "「" + tierKo(correction.getCorrectedTier()) + "」";
        return new Indexed(new KnowledgeEntry(SpineSourceType.TRIAGE_CORRECTION + ":" + correction.getId(),
                SpineSourceType.TRIAGE_CORRECTION, KnowledgeSpineScope.PRODUCT, review.getProductId(), null,
                KnowledgeAuthority.RECENT_SELLER_DECISION, "리뷰 판단 정정", text, correction.getCorrectedAt(),
                "판매자 판단 · 시스템 판단 정정",
                List.of(new SourceRef(SourceRef.Kind.TRIAGE_CORRECTION, correction.getId(),
                                correction.getCorrectedTier().name()),
                        SourceRef.of(SourceRef.Kind.REVIEW, review.getId()))),
                searchable(review, text));
    }

    private static String searchable(Review review, String text) {
        String body = VocPreviewSanitizer.redactFullBody(MarkupText.toPlainText(review.getBody())).text();
        return KnowledgeText.normalize(body == null ? "" : body) + KnowledgeText.normalize(text);
    }

    private static String ratingWords(Review review) {
        return review.getRating() == null ? "" : "별점 " + review.getRating() + "점 ";
    }

    static String dispositionKo(TriageDisposition disposition) {
        return switch (disposition) {
            case RESPONSE_NEEDED -> "대응 필요";
            case MONITOR -> "지켜보기";
            case NO_ACTION -> "조치 없음";
        };
    }

    static String tierKo(ReviewTriageTier tier) {
        return switch (tier) {
            case NEEDS_ATTENTION -> "확인 필요";
            case WATCH -> "지켜보기";
            case FYI -> "참고";
        };
    }
}
