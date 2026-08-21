package com.sellerops.inquirysignal;

import com.sellerops.itemanalysis.ItemAnalysisCategories;
import com.sellerops.reviewissue.InquiryAskKind;
import com.sellerops.reviewissue.IssueSeverity;
import com.sellerops.reviewissue.IssueSignature;

/**
 * What one inquiry is about: a topic the product already names, and what the customer is asking.
 *
 * <p><b>Composed from two existing vocabularies rather than a third new one.</b> The topic is an
 * {@link ItemAnalysisCategories} value — the same set {@code item_analyses.category} stores and the
 * same set the screens filter on — and the ask is an {@link InquiryAskKind}. The key it produces
 * ({@code 제품정보:규격}) is shaped exactly like a review's {@code IssueSignature} key
 * ({@code 배송:지연}), so {@code customer_memory_entries.signature_key} holds one kind of value and the
 * repeated-inquiry aggregation needed no change at all.
 *
 * <p><b>{@link #FALLBACK_TOPIC} can never appear here.</b> {@code 기타} is the analyzer's "we looked
 * and it fits nothing", and a signature built on it would let a classification gap become a pattern —
 * measured on real data as a 1,777-occurrence "repeat" that was really every unclassifiable inquiry.
 * Construction refuses it.
 */
public record InquirySignature(String topic, InquiryAskKind ask) {

    public static final String FALLBACK_TOPIC = ItemAnalysisCategories.FALLBACK;

    public InquirySignature {
        if (topic == null || topic.isBlank()) {
            throw new IllegalArgumentException("topic은 비어 있을 수 없습니다.");
        }
        if (FALLBACK_TOPIC.equals(topic.strip())) {
            throw new IllegalArgumentException(
                    "기타는 분류 실패를 뜻하므로 signature의 topic이 될 수 없습니다.");
        }
        if (!ItemAnalysisCategories.SUPPORTED.contains(topic.strip())) {
            throw new IllegalArgumentException("topic이 닫힌 어휘 밖입니다: " + topic);
        }
        if (ask == null) {
            throw new IllegalArgumentException("ask는 비어 있을 수 없습니다.");
        }
        topic = topic.strip();
    }

    /** {@code 제품정보:규격} — the same shape a review signature key has. Fits {@code varchar(96)}. */
    public String signatureKey() {
        return topic + ":" + ask.labelKo();
    }

    /** Operator-facing label, e.g. {@code 제품정보 규격}. Vocabulary only, never a customer sentence. */
    public String titleKo() {
        return topic + " " + ask.labelKo();
    }

    public IssueSeverity severity() {
        return ask.severity();
    }

    /**
     * The review-side shape, so an inquiry signature can flow through code written for
     * {@link IssueSignature} without that code learning a second type.
     */
    public IssueSignature asIssueSignature() {
        return new IssueSignature(topic, ask.labelKo(), ask.severity());
    }
}
