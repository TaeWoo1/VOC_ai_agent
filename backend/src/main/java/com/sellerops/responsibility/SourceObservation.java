package com.sellerops.responsibility;

import java.time.Instant;
import java.util.UUID;

/**
 * What one observation of one source established. The constructor enforces the contract the schema also
 * enforces, so a wrong observation fails where it is built rather than at the database:
 * <ul>
 *   <li>{@code NONE} carries no count and always a reason — «확인하지 못함» has no number to misread as 0;</li>
 *   <li>{@code COMPLETE} carries no failure reason.</li>
 * </ul>
 */
public record SourceObservation(
        SourceCompleteness completeness,
        Integer observedCount,
        Integer newCount,
        Integer changedCount,
        SourceFailureReason failureReason,
        IdentityVerdict identityVerdict,
        String recipeVersion,
        Instant observedAt,
        UUID syncJobId,
        String cursorFrom,
        String cursorTo) {

    public SourceObservation {
        if (completeness == null) {
            throw new IllegalArgumentException("an observation always states its completeness");
        }
        if (completeness == SourceCompleteness.NONE) {
            if (observedCount != null || newCount != null || changedCount != null) {
                throw new IllegalArgumentException("a source that was not observed has no count");
            }
            if (failureReason == null) {
                throw new IllegalArgumentException("a source that was not observed says why");
            }
        }
        if (completeness == SourceCompleteness.COMPLETE && failureReason != null) {
            throw new IllegalArgumentException("a complete observation has no failure reason");
        }
        if (identityVerdict == null) {
            identityVerdict = IdentityVerdict.NOT_APPLICABLE;
        }
    }

    static SourceObservation none(SourceFailureReason reason, UUID syncJobId, String recipeVersion) {
        return new SourceObservation(SourceCompleteness.NONE, null, null, null, reason,
                IdentityVerdict.NOT_APPLICABLE, recipeVersion, null, syncJobId, null, null);
    }
}
