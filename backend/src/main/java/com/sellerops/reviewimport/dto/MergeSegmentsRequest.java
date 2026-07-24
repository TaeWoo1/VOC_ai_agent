package com.sellerops.reviewimport.dto;

import jakarta.validation.constraints.NotEmpty;
import java.util.List;
import java.util.UUID;

/** Merge adjacent not-yet-run segments of one plan into a single segment spanning their whole range. */
public record MergeSegmentsRequest(@NotEmpty List<UUID> segmentIds) {
}
