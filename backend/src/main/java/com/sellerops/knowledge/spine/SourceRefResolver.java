package com.sellerops.knowledge.spine;

import com.sellerops.attention.reply.ReviewReplyApproval;
import com.sellerops.attention.reply.ReviewReplyDraft;
import com.sellerops.attention.triage.ReviewTriage;
import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.workitem.InquiryWorkItem;
import com.sellerops.knowledge.guidance.SellerGuidance;
import com.sellerops.knowledge.memory.AnswerMemory;
import com.sellerops.knowledge.org.OrgKnowledgeChunk;
import com.sellerops.knowledge.org.OrgKnowledgeSource;
import com.sellerops.product.ProductFact;
import com.sellerops.product.library.ProductKnowledgeChunk;
import com.sellerops.product.library.ProductKnowledgeSource;
import com.sellerops.review.Review;
import com.sellerops.review.triage.feedback.TriageCorrection;
import jakarta.persistence.EntityManager;
import java.util.EnumMap;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Component;

/**
 * <b>Follows a {@link SourceRef} back to the raw row, in one organisation.</b>
 *
 * <p>The proof that a knowledge entry — and every claim compiled from it — is traceable: each ref names a table
 * and a row id, and this re-reads that row with the caller's organisation in the predicate. A row that was
 * deleted, or that belongs to another organisation, does not resolve.
 *
 * <p>The table is chosen from the closed {@link SourceRef.Kind} map below, never from caller input, so the one
 * dynamic part of the query is an entity name this class wrote.
 */
@Component
public class SourceRefResolver {

    private static final Map<SourceRef.Kind, Class<?>> TABLES = new EnumMap<>(SourceRef.Kind.class);

    static {
        TABLES.put(SourceRef.Kind.ORG_KNOWLEDGE_SOURCE, OrgKnowledgeSource.class);
        TABLES.put(SourceRef.Kind.ORG_KNOWLEDGE_CHUNK, OrgKnowledgeChunk.class);
        TABLES.put(SourceRef.Kind.PRODUCT_KNOWLEDGE_SOURCE, ProductKnowledgeSource.class);
        TABLES.put(SourceRef.Kind.PRODUCT_KNOWLEDGE_CHUNK, ProductKnowledgeChunk.class);
        TABLES.put(SourceRef.Kind.PRODUCT_FACT, ProductFact.class);
        TABLES.put(SourceRef.Kind.ANSWER_MEMORY, AnswerMemory.class);
        TABLES.put(SourceRef.Kind.INQUIRY, Inquiry.class);
        TABLES.put(SourceRef.Kind.INQUIRY_WORK_ITEM, InquiryWorkItem.class);
        TABLES.put(SourceRef.Kind.REVIEW, Review.class);
        TABLES.put(SourceRef.Kind.REVIEW_REPLY_APPROVAL, ReviewReplyApproval.class);
        TABLES.put(SourceRef.Kind.REVIEW_REPLY_DRAFT, ReviewReplyDraft.class);
        TABLES.put(SourceRef.Kind.REVIEW_TRIAGE, ReviewTriage.class);
        TABLES.put(SourceRef.Kind.TRIAGE_CORRECTION, TriageCorrection.class);
        TABLES.put(SourceRef.Kind.SELLER_GUIDANCE, SellerGuidance.class);
    }

    private final EntityManager em;

    public SourceRefResolver(EntityManager em) {
        this.em = em;
    }

    /** Whether the raw row this ref points at exists in {@code orgId}. */
    public boolean resolves(UUID orgId, SourceRef ref) {
        if (orgId == null || ref == null || ref.kind() == null || ref.id() == null) {
            return false;
        }
        String entity = em.getMetamodel().entity(TABLES.get(ref.kind())).getName();
        Long found = em.createQuery("select count(e) from " + entity + " e where e.id = :id and e.orgId = :orgId",
                        Long.class)
                .setParameter("id", ref.id())
                .setParameter("orgId", orgId)
                .getSingleResult();
        return found != null && found > 0;
    }

    /** Every kind has a table — a kind added without one would be a ref nothing can follow. */
    static boolean coversEveryKind() {
        return TABLES.keySet().containsAll(java.util.EnumSet.allOf(SourceRef.Kind.class));
    }
}
