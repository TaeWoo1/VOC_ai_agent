package com.sellerops.reviewimport.dto;

import java.util.List;
import java.util.UUID;

/**
 * A plan with its live segments and coverage rollup — the resumable, honest view of one import.
 *
 * <p>{@code nextSegmentId} is the segment the "continue" ticket would authorize next, chosen by the SAME rule
 * the mint uses ({@code ReviewImportLaunchService.selectNextRemaining}). The frontend displays this rather than
 * re-deriving an ordering of its own, so the segment shown as next is always the segment the ticket authorizes.
 * Null when nothing remains.
 */
public record ReviewImportPlanDetailView(
        ReviewImportPlanView plan,
        List<ReviewImportSegmentView> segments,
        ReviewImportCoverageView coverage,
        UUID nextSegmentId) {
}
