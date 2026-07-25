package com.sellerops.reviewimport.dto;

import jakarta.validation.constraints.NotEmpty;
import java.time.LocalDate;
import java.util.List;

/**
 * Split a segment into contiguous shorter child ranges that exactly tile the parent. Used to recover a
 * failed or suspected-truncated segment at finer granularity; dedup makes the re-export overlap-safe.
 */
public record SplitSegmentRequest(@NotEmpty List<Child> children) {

    public record Child(LocalDate start, LocalDate end) {
    }
}
