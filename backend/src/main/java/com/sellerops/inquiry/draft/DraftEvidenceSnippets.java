package com.sellerops.inquiry.draft;

import com.sellerops.inquiry.draft.dto.DraftEvidenceView;
import com.sellerops.knowledge.memory.AnswerMemory;
import com.sellerops.knowledge.memory.AnswerMemoryRepository;
import com.sellerops.knowledge.org.OrgKnowledgeChunk;
import com.sellerops.knowledge.org.OrgKnowledgeChunkRepository;
import com.sellerops.product.library.ProductKnowledgeChunk;
import com.sellerops.product.library.ProductKnowledgeChunkRepository;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Component;

/**
 * Turn stored citation rows into citations a seller can CHECK.
 *
 * <p><b>Why a reader exists at all.</b> {@code inquiry_draft_evidence} stores where a passage came
 * from, never what it said — deliberately, so a citation cannot drift from the document it points at.
 * That is still right for storage and was wrong for the screen: on 2026-08-26 a live reply was
 * grounded in a chunk titled 「자주 묻는 질문 - 접착과 재부착」 that contained, verbatim, the Q&amp;A the
 * customer had asked about 가닥 수. The seller saw a title about adhesive next to an answer about
 * wire counts and could not tell whether the draft had any basis. So the excerpt is read back from
 * the source at display time, which keeps the single copy of the text where it belongs and still puts
 * it in front of the person deciding whether to send.
 *
 * <p><b>A missing source is a missing snippet, not a missing citation.</b> A knowledge document the
 * seller has since deleted leaves a row whose title and locator are still true; the row renders with
 * no excerpt rather than disappearing, because it is a record of what the drafter was shown.
 *
 * <p>{@link com.sellerops.inquiry.draft.InquiryDraftEvidence#KIND_ORDER_FACT} never has one: it
 * points at a moment, not a document, and re-reading it next week would produce a different value —
 * which is exactly the copy this class must not invent.
 */
@Component
public class DraftEvidenceSnippets {

    private final ProductKnowledgeChunkRepository productChunks;
    private final OrgKnowledgeChunkRepository orgChunks;
    private final AnswerMemoryRepository memories;

    public DraftEvidenceSnippets(ProductKnowledgeChunkRepository productChunks,
                                 OrgKnowledgeChunkRepository orgChunks,
                                 AnswerMemoryRepository memories) {
        this.productChunks = productChunks;
        this.orgChunks = orgChunks;
        this.memories = memories;
    }

    /** Every stored row for one draft version, as views carrying their excerpt. */
    public List<DraftEvidenceView> viewsOf(List<InquiryDraftEvidence> rows) {
        return rows.stream().map(this::viewOf).toList();
    }

    /** One stored row as a view carrying its excerpt. */
    public DraftEvidenceView viewOf(InquiryDraftEvidence row) {
        return new DraftEvidenceView(row.getKind(), InquiryDraftEvidence.scopeLabelOf(row.getKind()),
                row.getTitle(), row.getLocator(), row.getSourceId(), row.getChunkId(),
                DraftEvidenceView.snippetOf(textOf(row)));
    }

    /**
     * One stored citation as a view, addressed by its values rather than by the inquiry row type
     * (Grounded Review Drafting v1).
     *
     * <p>The review lane stores the same four fields in its own table, and the excerpt lookup is a
     * function of the kind and the two ids — nothing about it is specific to a work item. Duplicating
     * this reader for reviews would give the two screens two ways to render the same citation.
     */
    public DraftEvidenceView viewOf(String kind, UUID sourceId, UUID chunkId, String title,
                                    String locator) {
        return new DraftEvidenceView(kind, InquiryDraftEvidence.scopeLabelOf(kind), title, locator,
                sourceId, chunkId, DraftEvidenceView.snippetOf(textOf(kind, sourceId, chunkId)));
    }

    private String textOf(InquiryDraftEvidence row) {
        return textOf(row.getKind(), row.getSourceId(), row.getChunkId());
    }

    private String textOf(String kind, UUID sourceId, UUID chunkId) {
        if (InquiryDraftEvidence.KIND_PRODUCT_KNOWLEDGE.equals(kind)) {
            return chunk(chunkId, productChunks, ProductKnowledgeChunk::getContent);
        }
        if (InquiryDraftEvidence.KIND_ORG_POLICY.equals(kind)) {
            return chunk(chunkId, orgChunks, OrgKnowledgeChunk::getContent);
        }
        if (InquiryDraftEvidence.KIND_ANSWER_MEMORY.equals(kind)) {
            // A past answer is stored whole rather than chunked, so the citation names the memory.
            return chunk(sourceId, memories, AnswerMemory::getAnswerBody);
        }
        return null;
    }

    private static <T> String chunk(UUID id,
                                    org.springframework.data.repository.CrudRepository<T, UUID> repo,
                                    java.util.function.Function<T, String> text) {
        return id == null ? null : repo.findById(id).map(text).orElse(null);
    }
}
