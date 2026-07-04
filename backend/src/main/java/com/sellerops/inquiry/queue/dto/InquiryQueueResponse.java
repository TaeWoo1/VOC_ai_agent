package com.sellerops.inquiry.queue.dto;

import java.util.List;

/**
 * A page of the seller inquiry work queue: the sanitized {@code content} rows plus
 * flat pagination metadata (a small stable shape, not the framework {@code Page}
 * serialization).
 */
public record InquiryQueueResponse(
        List<InquiryQueueItem> content,
        int page,
        int size,
        long totalElements,
        int totalPages) {
}
