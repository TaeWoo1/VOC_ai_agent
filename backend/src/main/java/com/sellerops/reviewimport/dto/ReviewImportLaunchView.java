package com.sellerops.reviewimport.dto;

import com.sellerops.reviewimport.ReviewImportLaunch;
import java.time.LocalDate;
import java.util.UUID;

/**
 * A guided-run authorization, as the FRONTEND sees it.
 *
 * <p>Richer than what the runtime is given ({@code ReviewImportLaunchScopeView}): the frontend already owns
 * the plan/segment identity for the account it is displaying, so withholding those ids here would buy no
 * privacy and would only stop the UI from linking a run to the segment it advances.
 */
public record ReviewImportLaunchView(
        String launchRef,
        String kind,
        String status,
        UUID planId,
        UUID segmentId,
        /** The dates the guided run will ask the seller to select (segment runs only). */
        LocalDate requiredStart,
        LocalDate requiredEnd,
        LocalDate discoveredStart,
        LocalDate discoveredEnd,
        String rangeEvidence) {

    public static ReviewImportLaunchView from(ReviewImportLaunch t, LocalDate requiredStart, LocalDate requiredEnd) {
        return new ReviewImportLaunchView(
                t.getLaunchRef(), t.getKind().name(), t.getStatus().name(),
                t.getPlanId(), t.getSegmentId(),
                requiredStart, requiredEnd,
                t.getDiscoveredStart(), t.getDiscoveredEnd(),
                t.getRangeEvidence() == null ? null : t.getRangeEvidence().name());
    }
}
