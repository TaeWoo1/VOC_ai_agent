package com.sellerops.inquiry.draft;

import com.sellerops.knowledge.KnowledgeScope;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;

/**
 * One thing a generated draft was grounded in, bound to the exact draft version.
 *
 * <p>Append-only, like the draft it belongs to: an edit produces a new version with its own evidence
 * rows, so the record of what version 3 was shown cannot be rewritten by what version 4 was shown.
 * The passage TEXT is deliberately not copied — {@code chunkId} points at the seller's own knowledge
 * row, so this table records what was cited rather than becoming a second, diverging copy of it.
 *
 * <p>Carries no customer content and no buyer identity.
 */
@Getter
@Setter
@Entity
@Table(name = "inquiry_draft_evidence")
public class InquiryDraftEvidence {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    @Column(updatable = false, nullable = false)
    private UUID id;

    @Column(name = "org_id", nullable = false)
    private UUID orgId;

    @Column(name = "work_item_id", nullable = false)
    private UUID workItemId;

    @Column(name = "draft_version", nullable = false)
    private int draftVersion;

    /** Position in the order the passages were given to the drafter. Stable, so a citation list is. */
    @Column(name = "ordinal", nullable = false)
    private int ordinal;

    /**
     * What KIND of evidence this is — {@code PRODUCT_KNOWLEDGE} today. Kept as a string rather than
     * an enum column so a later kind (a past answer, a channel policy) does not need a migration to
     * be recordable, and so an unknown value read back is displayable rather than a deserialization
     * failure.
     */
    @Column(name = "kind", nullable = false, length = 40)
    private String kind;

    /** The seller's knowledge document. */
    @Column(name = "source_id")
    private UUID sourceId;

    /** The exact passage within it. */
    @Column(name = "chunk_id")
    private UUID chunkId;

    /** The document's own title, as it was at generation time — what a citation line shows. */
    @Column(name = "title", length = 300)
    private String title;

    /** A human-readable provenance string, e.g. {@code product-knowledge/USAGE:데모 운영자}. */
    @Column(name = "locator", length = 200)
    private String locator;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    /** 판매자가 상품에 대해 쓴 지식. */
    public static final String KIND_PRODUCT_KNOWLEDGE = "PRODUCT_KNOWLEDGE";

    /** 판매자가 회사 단위로 정해 둔 운영 정책. */
    public static final String KIND_ORG_POLICY = "ORG_POLICY";

    /** 판매자가 실제로 하거나 승인한 과거 답변. */
    public static final String KIND_ANSWER_MEMORY = "ANSWER_MEMORY";

    /**
     * 채널이 말해 준 주문의 상태 — <b>검색된 passage가 아니라 그 순간 읽은 사실</b>.
     *
     * <p>다른 셋과 근본적으로 다르다. 그 셋은 판매자가 쓴 문서를 가리키고, 나중에 같은
     * {@code chunk_id}를 다시 열면 초안이 본 그 문장이 그대로 있다. 주문 상태는 그렇지 않다 --
     * 다음 주에 다시 읽으면 다른 값이고, 그것이 정상이다. 그래서 이 행은 문서를 가리키지 않고
     * ({@code source_id}/{@code chunk_id}가 null) locator에 <b>언제 확인한 무엇이었는지</b>를 적는다.
     */
    public static final String KIND_ORDER_FACT = "ORDER_FACT";

    /**
     * The stored kind for a RETRIEVED scope.
     *
     * <p>The two are separate vocabularies on purpose: {@link KnowledgeScope} is what the product
     * reasons in and may be renamed, while these strings are already written into rows that must
     * still read correctly years from now.
     *
     * <p><b>It still throws for the read-only scopes, and {@link #KIND_ORDER_FACT} does not weaken
     * that.</b> The fence was never "ORDER_STATE may not be cited"; it was "ORDER_STATE may not be
     * RETRIEVED" — a corpus of stale copies is the thing that must not exist. An order fact reaches a
     * draft through {@code InquiryOrderFactReader}, carrying its own observation date, and is recorded
     * by a caller that names the kind explicitly. There is no path from a search result to this kind,
     * which is what {@code KnowledgeScopeTest} asserts.
     */
    public static String kindOf(KnowledgeScope scope) {
        return switch (scope) {
            case PRODUCT -> KIND_PRODUCT_KNOWLEDGE;
            case ORG_OPERATIONS -> KIND_ORG_POLICY;
            case PAST_ANSWER -> KIND_ANSWER_MEMORY;
            // Neither is retrievable, so neither can be a citation. Reaching here is a programming
            // error, not a data state, and it fails loudly rather than storing a plausible wrong kind.
            case CHANNEL_FACT, ORDER_STATE ->
                    throw new IllegalArgumentException("not a retrievable scope: " + scope);
        };
    }

    /** The scope behind a stored kind, or null when the row predates this build's vocabulary. */
    public static KnowledgeScope scopeOf(String kind) {
        if (KIND_PRODUCT_KNOWLEDGE.equals(kind)) {
            return KnowledgeScope.PRODUCT;
        }
        if (KIND_ORG_POLICY.equals(kind)) {
            return KnowledgeScope.ORG_OPERATIONS;
        }
        if (KIND_ANSWER_MEMORY.equals(kind)) {
            return KnowledgeScope.PAST_ANSWER;
        }
        if (KIND_ORDER_FACT.equals(kind)) {
            return KnowledgeScope.ORDER_STATE;
        }
        return null;
    }

    /** The seller-facing group for a stored kind; the raw value when it predates this vocabulary. */
    public static String scopeLabelOf(String kind) {
        KnowledgeScope scope = scopeOf(kind);
        return scope == null ? kind : scope.labelKo();
    }

    @PrePersist
    void onCreate() {
        if (createdAt == null) {
            createdAt = Instant.now();
        }
    }
}
