package com.sellerops.inquiry.queue;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.common.DataOrigin;
import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.inquiry.queue.dto.InquiryQueueItem;
import com.sellerops.inquiry.queue.dto.InquiryQueueResponse;
import com.sellerops.inquiry.workitem.InquiryWorkItem;
import com.sellerops.inquiry.workitem.InquiryWorkItemPhase;
import com.sellerops.inquiry.workitem.InquiryWorkItemRepository;
import com.sellerops.product.OperatorProductName;
import com.sellerops.product.ProductRepository;
import java.util.HashMap;
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
 *
 * <p><b>Operational means REAL.</b> This is the queue an item is worked from, approved in, and
 * ultimately sent from, so a manufactured row here is a fixture in the path of a marketplace write.
 * {@link InquiryWorkItemWriter} refuses to open one, and this read drops any that predates that
 * refusal — two independent fences, because the writer's only protects rows collected after it
 * shipped.
 *
 * <p>The {@code realDataOnly} Hibernate filter does NOT cover this read, and the reason is worth
 * stating: the inquiries are loaded by {@code findAllById}, and a Hibernate filter does not apply to
 * {@code findById}. Relying on it here would have looked like protection while providing none. The
 * check below is explicit for that reason.
 *
 * <p>This is not a history fence. Debug, audit and dismissal-review paths read inquiries directly and
 * still see everything they saw before; only the actionable queue is narrowed.
 *
 * <p><b>Every narrowing predicate is in the query, not here.</b> Both the REAL/ACTIVE gate and the
 * answered-elsewhere gate are clauses of {@code findOperationalByOrgIdAndPhase}, so the page's
 * {@code totalElements} is a count of the rows this method returns. A predicate applied to the
 * fetched page instead would produce a queue that shows 9 and paginates 12 — which is what the
 * answered-elsewhere rule did for one package, and what Chat-first Agent Shell Completion v1 §4
 * closed. The one remaining Java filter below is a null guard, not a narrowing: it drops a row whose
 * inquiry disappeared between the two statements rather than rendering it blank.
 */
@Service
public class InquiryQueueService {

    /** Bound the page size so a caller can never request an unbounded page. */
    static final int MAX_PAGE_SIZE = 100;

    private final InquiryWorkItemRepository workItems;
    private final InquiryRepository inquiries;
    private final ChannelRepository channels;
    private final ProductRepository products;
    private final com.sellerops.identity.ExecutableIdentityResolver identity;

    @org.springframework.beans.factory.annotation.Autowired
    public InquiryQueueService(InquiryWorkItemRepository workItems, InquiryRepository inquiries,
                               ChannelRepository channels, ProductRepository products,
                               com.sellerops.identity.ExecutableIdentityResolver identity) {
        this.workItems = workItems;
        this.inquiries = inquiries;
        this.channels = channels;
        this.products = products;
        this.identity = identity;
    }

    /** Without a resolver every row reads {@code NONE} — the fail-closed identity. Test wiring. */
    public InquiryQueueService(InquiryWorkItemRepository workItems, InquiryRepository inquiries,
                               ChannelRepository channels, ProductRepository products) {
        this(workItems, inquiries, channels, products,
                com.sellerops.identity.ExecutableIdentityResolver.unresolved());
    }

    public InquiryQueueResponse queue(UUID orgId, InquiryWorkItemPhase phase, int page, int size) {
        int safeSize = Math.min(Math.max(size, 1), MAX_PAGE_SIZE);
        int safePage = Math.max(page, 0);
        Pageable pageable = PageRequest.of(safePage, safeSize, Sort.by(Sort.Direction.DESC, "createdAt"));

        Page<InquiryWorkItem> workItemPage = workItems.findOperationalByOrgIdAndPhase(orgId, phase, pageable);

        // Load the referenced inquiries in one query, then project in page order.
        List<UUID> inquiryIds = workItemPage.map(InquiryWorkItem::getInquiryId).getContent();
        Map<UUID, Inquiry> byId = inquiries.findAllById(inquiryIds).stream()
                .filter(InquiryQueueService::isOperational)
                .collect(Collectors.toMap(Inquiry::getId, Function.identity()));

        // Channels and products for the page, each in one query. The alternative — resolving per row —
        // is 20 lookups for a 20-row page, and the queue is the screen an operator sits on.
        Map<UUID, Channel> channelsById = channels
                .findAllById(byId.values().stream().map(Inquiry::getChannelId).distinct().toList())
                .stream().collect(Collectors.toMap(Channel::getId, Function.identity()));
        Map<UUID, String> productNames = products
                .findAllById(byId.values().stream().map(Inquiry::getProductId)
                        .filter(java.util.Objects::nonNull).distinct().toList())
                .stream().collect(HashMap::new,
                        (m, p) -> m.put(p.getId(), OperatorProductName.displayNameOrNull(p)), HashMap::putAll);

        // One provenance pass for the page — the resolver groups its reads per account.
        Map<UUID, com.sellerops.identity.ExecutableIdentity> identities = identity.forInquiries(orgId, byId.values());

        List<InquiryQueueItem> content = workItemPage.getContent().stream()
                // A work item whose inquiry is not operational is dropped, not rendered blank: a row
                // with a null status and no title would still be a clickable task.
                .filter(w -> byId.containsKey(w.getInquiryId()))
                .map(w -> toItem(w, byId.get(w.getInquiryId()), channelsById, productNames,
                        identities.getOrDefault(w.getInquiryId(), com.sellerops.identity.ExecutableIdentity.NONE)))
                .toList();

        return new InquiryQueueResponse(content, workItemPage.getNumber(), workItemPage.getSize(),
                workItemPage.getTotalElements(), workItemPage.getTotalPages());
    }

    /**
     * Whether this inquiry may appear as actionable work — the seller's own data, and nothing the
     * product manufactured about itself. Absence of the row (a deleted inquiry) is not operational
     * either, so a missing id never renders.
     */
    private static boolean isOperational(Inquiry inquiry) {
        return inquiry != null && inquiry.getDataOrigin() == DataOrigin.REAL;
    }

    private static InquiryQueueItem toItem(InquiryWorkItem workItem, Inquiry inquiry,
                                           Map<UUID, Channel> channelsById,
                                           Map<UUID, String> productNames,
                                           com.sellerops.identity.ExecutableIdentity executableIdentity) {
        // inquiry is always present (FK-consistent), but stay null-safe on the read.
        String status = inquiry == null ? null : inquiry.getStatus();
        String title = inquiry == null ? null : inquiry.getTitle();
        var receivedAt = inquiry == null ? null : inquiry.getReceivedAt();
        Channel channel = channelsById.get(workItem.getChannelId());
        UUID productId = inquiry == null ? null : inquiry.getProductId();
        // A product id that points at ingest's shared bucket is not a product. OperatorProductName
        // already knows the shapes of "no name is actually known"; a row that showed the bucket's name
        // would tell the operator this inquiry is about a product called "(미지정 상품)".
        String productName = productId == null ? null : productNames.get(productId);
        return new InquiryQueueItem(
                workItem.getId(),
                workItem.getInquiryId(),
                workItem.getSellerAccountId(),
                workItem.getChannelId(),
                channel == null ? null : channel.getCode(),
                channel == null ? null : channel.getNameKo(),
                productName == null ? null : productId,
                productName,
                workItem.getPhase().name(),
                status,
                title,
                receivedAt,
                inquiry == null ? null : inquiry.getSourceSubtype(),
                executableIdentity.name());
    }
}
