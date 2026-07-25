package com.sellerops.reviewimport.dto;

import java.util.List;

/** A plan with its live segments and coverage rollup — the resumable, honest view of one import. */
public record ReviewImportPlanDetailView(
        ReviewImportPlanView plan,
        List<ReviewImportSegmentView> segments,
        ReviewImportCoverageView coverage) {
}
