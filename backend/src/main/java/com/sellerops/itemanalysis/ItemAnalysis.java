package com.sellerops.itemanalysis;

import com.sellerops.common.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;

/**
 * Persisted analysis of a single inbox item (an inquiry or a review), referenced
 * polymorphically via {@code (sourceType, sourceId)}. Every stored field is
 * derived metadata: the {@code summary} is a PII-safe templated phrase, never a
 * customer-text excerpt — the raw body stays only in {@code inquiries}/{@code reviews}.
 * Provenance is explicit: {@code analyzerKind=RULE_BASED} marks this as rule-based,
 * not AI-generated; {@code modelName}/{@code promptVersion} stay null until a real
 * AI provider fills them.
 */
@Getter
@Setter
@Entity
@Table(name = "item_analyses")
public class ItemAnalysis extends BaseEntity {

    @Column(name = "org_id", nullable = false)
    private UUID orgId;

    /** INQUIRY or REVIEW. */
    @Column(name = "source_type", nullable = false)
    private String sourceType;

    /** Id of the underlying inquiry or review row. */
    @Column(name = "source_id", nullable = false)
    private UUID sourceId;

    /** PII-safe templated phrase (e.g. "배송 관련 부정 리뷰"). Never the raw body. */
    @Column(nullable = false)
    private String summary;

    @Column(nullable = false)
    private String category;

    /** POSITIVE | NEUTRAL | NEGATIVE. */
    @Column(nullable = false)
    private String sentiment;

    /** LOW | NORMAL | HIGH. */
    @Column(nullable = false)
    private String urgency;

    @Column(name = "recommended_action", nullable = false)
    private String recommendedAction;

    /** RULE_BASED — honest method marker. */
    @Column(name = "analyzer_kind", nullable = false)
    private String analyzerKind;

    @Column(name = "analyzer_name", nullable = false)
    private String analyzerName;

    @Column(name = "analyzer_version", nullable = false)
    private String analyzerVersion;

    /** Reserved for a future AI provider; null for rule-based analysis. */
    @Column(name = "model_name")
    private String modelName;

    /** Reserved for a future AI provider; null for rule-based analysis. */
    @Column(name = "prompt_version")
    private String promptVersion;

    /** Snapshot hash of the analyzed body; reserved for future re-analysis-on-change. */
    @Column(name = "source_content_hash")
    private String sourceContentHash;
}
