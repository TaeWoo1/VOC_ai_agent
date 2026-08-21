package com.sellerops.customermemory;

import com.sellerops.attention.AttentionCoverage;
import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.common.PiiMasker;
import com.sellerops.customermemory.dto.CustomerMemoryHitView;
import com.sellerops.customermemory.dto.CustomerMemorySearchView;
import com.sellerops.inquiry.reply.InquiryReplyDraft;
import com.sellerops.inquiry.reply.InquiryReplyDraftRepository;
import com.sellerops.inquiry.workitem.InquiryWorkItem;
import com.sellerops.inquiry.workitem.InquiryWorkItemRepository;
import com.sellerops.product.Product;
import com.sellerops.product.ProductRepository;
import com.sellerops.product.dto.SignalCoverageView;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Recall: given a customer problem, what have we seen and said before.
 *
 * <p><b>The cue is derived, not typed.</b> The only entry point a caller normally uses names an
 * INQUIRY id and the cue is read from that inquiry's own index entry. This is on purpose: it means a
 * customer's words never travel as a query string, never reach a log line, and never reach a URL. The
 * explicit-cue form takes closed-vocabulary values only, and there is no free-text parameter anywhere
 * on this service — a search box over customer text is precisely what scope lock v1.12 did NOT open.
 *
 * <p><b>Past answers are resolved here, not stored.</b> A hit's {@code answer} is read at read time
 * from {@code inquiry_reply_drafts} through {@link PiiMasker}, the same way 대표 고객 표현 is re-derived
 * rather than duplicated into the issue memory. So the index cannot drift from the answers, and
 * deleting a draft removes it from recall for free.
 */
@Service
public class CustomerMemoryQueryService {

    /** Ceiling on returned precedents. A recall that returns twenty is not context, it is a list. */
    public static final int MAX_HITS = 10;

    private final CustomerMemoryEntryRepository entries;
    private final CustomerMemoryRetriever retriever;
    private final InquiryWorkItemRepository workItems;
    private final InquiryReplyDraftRepository drafts;
    private final ProductRepository products;
    private final ChannelRepository channels;

    public CustomerMemoryQueryService(CustomerMemoryEntryRepository entries,
                                      CustomerMemoryRetriever retriever,
                                      InquiryWorkItemRepository workItems,
                                      InquiryReplyDraftRepository drafts,
                                      ProductRepository products,
                                      ChannelRepository channels) {
        this.entries = entries;
        this.retriever = retriever;
        this.workItems = workItems;
        this.drafts = drafts;
        this.products = products;
        this.channels = channels;
    }

    /**
     * Recall precedents for one inquiry, using that inquiry's own indexed cue.
     *
     * <p>An inquiry that is not in the index yet (collected before this index existed, or whose
     * follow-up failed) yields an empty result with an UNCERTAIN coverage verdict — not an error, and
     * emphatically not an empty result that reads as "nothing like this ever happened".
     */
    @Transactional(readOnly = true)
    public CustomerMemorySearchView recallForInquiry(UUID orgId, UUID inquiryId, int limit) {
        Optional<CustomerMemoryEntry> self =
                entries.findByOrgIdAndEntryKindAndSourceId(orgId, CustomerMemoryKind.INQUIRY, inquiryId);
        if (self.isEmpty()) {
            return new CustomerMemorySearchView(null, null, List.of(), notIndexed(orgId));
        }
        CustomerMemoryEntry cueRow = self.get();
        return search(orgId, cueRow.getSignatureKey(), cueRow.getTopic(), cueRow.getProductId(),
                inquiryId, limit);
    }

    /** Recall by an explicit closed-vocabulary cue. No free text, by construction. */
    @Transactional(readOnly = true)
    public CustomerMemorySearchView search(UUID orgId, String signatureKey, String topic, UUID productId,
                                           UUID excludeSourceId, int limit) {
        int cap = Math.min(Math.max(limit <= 0 ? MAX_HITS : limit, 1), MAX_HITS);
        var cue = new CustomerMemoryRetriever.RetrievalCue(signatureKey, topic, productId);
        List<CustomerMemoryEntry> hits = retriever.retrieve(orgId, cue, excludeSourceId, cap);

        Map<UUID, String> productNames = productNames(hits);
        Map<UUID, String> channelCodes = channelCodes(hits);

        List<CustomerMemoryHitView> views = new ArrayList<>();
        for (CustomerMemoryEntry e : hits) {
            views.add(new CustomerMemoryHitView(
                    e.getEntryKind().name(),
                    e.getSourceId(),
                    e.getProductId(),
                    e.getProductId() == null ? null : productNames.get(e.getProductId()),
                    e.getChannelId() == null ? null : channelCodes.get(e.getChannelId()),
                    e.getTopic(),
                    e.getSignatureKey(),
                    e.getSeverity(),
                    e.getOccurredOn(),
                    e.isAnswered(),
                    e.getEntryKind() == CustomerMemoryKind.INQUIRY ? answerFor(e.getSourceId()) : null,
                    retriever.kind(),
                    retriever.version()));
        }
        return new CustomerMemorySearchView(signatureKey, topic, List.copyOf(views), coverage(orgId));
    }

    /**
     * The approved reply for a past inquiry, masked — or null.
     *
     * <p>The CURRENT (highest-version) draft is the answer: the draft table is append-only, so the head
     * is what an operator last stood behind. A work item with no draft yields null rather than an empty
     * string, because "we answered with nothing" and "we have no record of the answer" are different
     * facts and a model given the first would happily imitate it.
     */
    private String answerFor(UUID inquiryId) {
        return workItems.findByInquiryId(inquiryId)
                .map(InquiryWorkItem::getId)
                .flatMap(drafts::findTopByWorkItemIdOrderByVersionDesc)
                .map(InquiryReplyDraft::getComments)
                .filter(c -> !c.isBlank())
                .map(PiiMasker::maskText)
                .orElse(null);
    }

    /**
     * Whether the index can answer for this org at all.
     *
     * <p>An org with an empty index is the honest UNCERTAIN case — every inquiry looks brand new
     * because nothing was ever indexed, which is the retrieval-shaped version of the false calm the
     * attention surface already guards. Reuses {@link AttentionCoverage} rather than minting a second
     * coverage vocabulary.
     */
    private SignalCoverageView coverage(UUID orgId) {
        long inquiries = entries.countByOrgIdAndEntryKind(orgId, CustomerMemoryKind.INQUIRY);
        long reviews = entries.countByOrgIdAndEntryKind(orgId, CustomerMemoryKind.REVIEW);
        long unlinked = entries.countByOrgIdAndEntryKindAndProductIdIsNull(orgId, CustomerMemoryKind.INQUIRY)
                + entries.countByOrgIdAndEntryKindAndProductIdIsNull(orgId, CustomerMemoryKind.REVIEW);
        long indexed = inquiries + reviews;
        AttentionCoverage verdict = indexed == 0
                ? AttentionCoverage.UNCERTAIN_UNSUPPORTED_CHANNEL
                : AttentionCoverage.COVERED;
        return new SignalCoverageView(SignalCoverageView.CUSTOMER_MEMORY, verdict, indexed, unlinked,
                retriever.kind() + ":" + retriever.version());
    }

    /** Coverage for "this inquiry itself is not in the index" — distinct from "the index is empty". */
    private SignalCoverageView notIndexed(UUID orgId) {
        SignalCoverageView base = coverage(orgId);
        return new SignalCoverageView(base.signal(), AttentionCoverage.UNCERTAIN_UNSUPPORTED_CHANNEL,
                base.linked(), base.unlinked(), base.provenance());
    }

    private Map<UUID, String> productNames(List<CustomerMemoryEntry> hits) {
        Set<UUID> ids = hits.stream().map(CustomerMemoryEntry::getProductId)
                .filter(java.util.Objects::nonNull)
                .collect(Collectors.toCollection(LinkedHashSet::new));
        if (ids.isEmpty()) {
            return Map.of();
        }
        // Org-scoped lookup: reviews.product_id is a bare FK, so an id off a row is not proof of
        // same-org ownership (ProductRepository.findAllByOrgIdAndIdIn says so at length).
        UUID orgId = hits.get(0).getOrgId();
        return products.findAllByOrgIdAndIdIn(orgId, ids).stream()
                .collect(Collectors.toMap(Product::getId, Product::getName, (a, b) -> a));
    }

    private Map<UUID, String> channelCodes(List<CustomerMemoryEntry> hits) {
        Set<UUID> ids = hits.stream().map(CustomerMemoryEntry::getChannelId)
                .filter(java.util.Objects::nonNull)
                .collect(Collectors.toCollection(LinkedHashSet::new));
        if (ids.isEmpty()) {
            return Map.of();
        }
        return channels.findAllById(ids).stream()
                .collect(Collectors.toMap(Channel::getId, Function.identity(), (a, b) -> a))
                .entrySet().stream()
                .collect(Collectors.toMap(Map.Entry::getKey, e -> e.getValue().getCode()));
    }
}
