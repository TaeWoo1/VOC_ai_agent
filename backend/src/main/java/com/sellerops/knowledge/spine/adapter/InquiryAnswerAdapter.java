package com.sellerops.knowledge.spine.adapter;

import com.sellerops.knowledge.memory.AnswerMemory;
import com.sellerops.knowledge.memory.AnswerMemoryRepository;
import com.sellerops.knowledge.spine.KnowledgeAuthority;
import com.sellerops.knowledge.spine.KnowledgeEntry;
import com.sellerops.knowledge.spine.KnowledgeSpineScope;
import com.sellerops.knowledge.spine.SourceRef;
import com.sellerops.knowledge.spine.SpineSourceType;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Component;

/**
 * <b>Past inquiries and the answer the seller actually gave</b> — read from Answer Memory, which already holds
 * exactly that and nothing else: a collected channel answer, a seller approval, or a verified send. No AI draft
 * reaches it, so none reaches the spine.
 *
 * <p>The memory row is the knowledge; the inquiry it answered is the raw source it points at. The customer's
 * question is not carried — Answer Memory never stored it, and the entry is matched on the topic signature
 * that survives of it.
 *
 * <p>{@link KnowledgeAuthority#PAST_SELLER_ANSWER}, whatever the strength: a verified send proves the answer
 * reached the customer, not that it is still true. The strength is kept in the provenance sentence.
 */
@Component
public class InquiryAnswerAdapter implements KnowledgeSourceAdapter {

    private final AnswerMemoryRepository memories;

    public InquiryAnswerAdapter(AnswerMemoryRepository memories) {
        this.memories = memories;
    }

    @Override
    public List<Indexed> read(UUID orgId, UUID productId) {
        return memories.findAllByOrgId(orgId).stream()
                .filter(m -> orgId.equals(m.getOrgId()))
                // An unbound answer is ORG knowledge; a bound one belongs to its product and to no other.
                .filter(m -> m.getProductId() == null || m.getProductId().equals(productId))
                .sorted(Comparator.comparing(AnswerMemory::getOriginRef))
                .map(m -> new Indexed(entry(m), m.getNormalized()))
                .toList();
    }

    private static KnowledgeEntry entry(AnswerMemory m) {
        List<SourceRef> refs = new ArrayList<>();
        refs.add(new SourceRef(SourceRef.Kind.ANSWER_MEMORY, m.getId(), "v" + m.getVersion()));
        if (m.getOriginInquiryId() != null) {
            refs.add(SourceRef.of(SourceRef.Kind.INQUIRY, m.getOriginInquiryId()));
        }
        if (m.getOriginWorkItemId() != null) {
            refs.add(new SourceRef(SourceRef.Kind.INQUIRY_WORK_ITEM, m.getOriginWorkItemId(),
                    m.getOriginDraftVersion() == null ? null : "v" + m.getOriginDraftVersion()));
        }
        boolean bound = m.getProductId() != null;
        return new KnowledgeEntry(SpineSourceType.INQUIRY_ANSWER + ":" + m.getId(), SpineSourceType.INQUIRY_ANSWER,
                bound ? KnowledgeSpineScope.PRODUCT : KnowledgeSpineScope.ORG, m.getProductId(), m.getChannelCode(),
                KnowledgeAuthority.PAST_SELLER_ANSWER,
                m.getAnswerTitle() == null || m.getAnswerTitle().isBlank() ? "과거 문의 답변" : m.getAnswerTitle(),
                m.getAnswerBody(), m.getUpdatedAt(), "문의 답변 · " + m.getStrength().labelKo(), refs);
    }
}
