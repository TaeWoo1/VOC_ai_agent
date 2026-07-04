package com.sellerops.inquiry.queue;

import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.inquiry.queue.dto.InquiryQueueItem;
import com.sellerops.inquiry.queue.dto.InquiryQueueResponse;
import com.sellerops.inquiry.workitem.InquiryWorkItem;
import com.sellerops.inquiry.workitem.InquiryWorkItemPhase;
import com.sellerops.inquiry.workitem.InquiryWorkItemRepository;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;

/**
 * Read side of the seller inquiry work queue: an org-scoped, phase-filtered, paged
 * projection over {@link InquiryWorkItem} joined to its {@link Inquiry}. Every read
 * is bounded to the caller's org (tenant isolation) and yields only sanitized
 * {@link InquiryQueueItem} rows (no buyer identity, no raw body).
 */
@Service
public class InquiryQueueService {

    /** Bound the page size so a caller can never request an unbounded page. */
    static final int MAX_PAGE_SIZE = 100;

    private final InquiryWorkItemRepository workItems;
    private final InquiryRepository inquiries;

    public InquiryQueueService(InquiryWorkItemRepository workItems, InquiryRepository inquiries) {
        this.workItems = workItems;
        this.inquiries = inquiries;
    }

    public InquiryQueueResponse queue(UUID orgId, InquiryWorkItemPhase phase, int page, int size) {
        int safeSize = Math.min(Math.max(size, 1), MAX_PAGE_SIZE);
        int safePage = Math.max(page, 0);
        Pageable pageable = PageRequest.of(safePage, safeSize, Sort.by(Sort.Direction.DESC, "createdAt"));

        Page<InquiryWorkItem> workItemPage = workItems.findByOrgIdAndPhase(orgId, phase, pageable);

        // Load the referenced inquiries in one query, then project in page order.
        List<UUID> inquiryIds = workItemPage.map(InquiryWorkItem::getInquiryId).getContent();
        Map<UUID, Inquiry> byId = inquiries.findAllById(inquiryIds).stream()
                .collect(Collectors.toMap(Inquiry::getId, Function.identity()));

        List<InquiryQueueItem> content = workItemPage.getContent().stream()
                .map(w -> toItem(w, byId.get(w.getInquiryId())))
                .toList();

        return new InquiryQueueResponse(content, workItemPage.getNumber(), workItemPage.getSize(),
                workItemPage.getTotalElements(), workItemPage.getTotalPages());
    }

    private static InquiryQueueItem toItem(InquiryWorkItem workItem, Inquiry inquiry) {
        // inquiry is always present (FK-consistent), but stay null-safe on the read.
        String status = inquiry == null ? null : inquiry.getStatus();
        String title = inquiry == null ? null : inquiry.getTitle();
        var receivedAt = inquiry == null ? null : inquiry.getReceivedAt();
        return new InquiryQueueItem(
                workItem.getId(),
                workItem.getInquiryId(),
                workItem.getSellerAccountId(),
                workItem.getChannelId(),
                workItem.getPhase().name(),
                status,
                title,
                receivedAt);
    }
}
