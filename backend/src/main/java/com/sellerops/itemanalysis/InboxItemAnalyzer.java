package com.sellerops.itemanalysis;

import java.util.UUID;

/**
 * Port for analyzing a single inbox item. The only implementation this slice
 * ships is {@link RuleBasedInboxItemAnalyzer} (deterministic, local, no external
 * call). A future AI/Python adapter can implement this same port behind a flag
 * without touching the service or storage — that swap is an adapter change, not a
 * rewrite.
 *
 * <p>Implementations must be pure: no I/O, no logging of the raw body.
 */
public interface InboxItemAnalyzer {

    Result analyze(SourceItem item);

    /**
     * The minimal, already-loaded view of an inquiry/review the analyzer needs.
     * {@code rating}/{@code negative} apply to reviews; {@code status} to inquiries.
     */
    record SourceItem(
            String sourceType,   // INQUIRY | REVIEW
            UUID sourceId,
            String body,
            Integer rating,      // null for inquiries
            String status,       // UNANSWERED/ANSWERED for inquiries; null for reviews
            boolean negative) {  // review NEGATIVE flag; false for inquiries
    }

    /** Derived analysis. {@code summary} is a PII-safe templated phrase, never the body. */
    record Result(
            String summary,
            String category,
            String sentiment,
            String urgency,
            String recommendedAction,
            String analyzerKind,
            String analyzerName,
            String analyzerVersion) {
    }
}
