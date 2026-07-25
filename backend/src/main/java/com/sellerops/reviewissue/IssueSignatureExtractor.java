package com.sellerops.reviewissue;

import java.util.List;

/**
 * Seam between "a review body" and "issue signatures". Exists as a port so the semantic step can be
 * replaced without touching the Issue Memory, aggregation, change-detection, lifecycle or report
 * layers built on top of it — the same shape as {@code InboxItemAnalyzer} and
 * {@code ReviewReplyProposalProvider}, both of which already gate their implementation behind a
 * {@code sellerops.*.provider} flag.
 *
 * <p><b>Why the port matters more than today's implementation.</b> The pipeline this serves
 * (opinion units → signature → issue memory → verify → UNKNOWN → periodic clustering) is the
 * documented answer to the failure recorded in {@code contracts/review-eval/naver/v1/RUBRIC.md}:
 * surface-form rigidity, not vocabulary breadth. The deterministic implementation here delivers the
 * <i>structural</i> half of that answer (per-unit analysis) and honestly cannot deliver the
 * semantic half. When the semantic half is authorized, it arrives as another implementation of this
 * interface — not a rewrite.
 *
 * <p><b>Provenance is not optional.</b> {@link #kind()} and {@link #version()} are stored on every
 * issue, because a future extractor emits finer signatures and therefore different keys. Its issues
 * must be able to coexist with these rather than silently redefining what an existing issue means.
 */
public interface IssueSignatureExtractor {

    /** Provenance kind stored on {@code review_issues.extractor_kind}, e.g. {@code RULE_BASED}. */
    String kind();

    /** Provenance version stored on {@code review_issues.extractor_version}. */
    String version();

    /**
     * Split {@code body} into opinion units and classify each one. Returns one entry per unit, in
     * reading order, so that {@link ExtractedUnit#ordinal()} matches the stored
     * {@code unit_ordinal}. A blank body yields an empty list rather than one empty unit.
     */
    List<ExtractedUnit> extract(String body);

    /**
     * One opinion unit's verdict. Exactly one of {@code signature} / {@code unknownReason} is
     * present — enforced here rather than trusted, because a unit that is both attached to an issue
     * and sitting in the UNKNOWN pen would be double-counted in every rollup.
     *
     * <p>Carries no unit text: extraction is where customer content stops.
     */
    record ExtractedUnit(int ordinal, IssueSignature signature, UnknownReason unknownReason) {

        public ExtractedUnit {
            if (ordinal < 0) {
                throw new IllegalArgumentException("ordinal은 0 이상이어야 합니다.");
            }
            if ((signature == null) == (unknownReason == null)) {
                throw new IllegalArgumentException(
                        "signature와 unknownReason 중 정확히 하나만 있어야 합니다.");
            }
        }

        public static ExtractedUnit matched(int ordinal, IssueSignature signature) {
            return new ExtractedUnit(ordinal, signature, null);
        }

        public static ExtractedUnit unknown(int ordinal, UnknownReason reason) {
            return new ExtractedUnit(ordinal, null, reason);
        }

        public boolean isMatched() {
            return signature != null;
        }
    }
}
