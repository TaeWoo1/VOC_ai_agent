package com.sellerops.knowledge.document;

import com.sellerops.knowledge.candidate.KnowledgeCandidateRepository;
import com.sellerops.knowledge.candidate.KnowledgeCandidateService;
import com.sellerops.knowledge.document.dto.KnowledgeSummaryView;
import com.sellerops.knowledge.memory.AnswerMemoryRepository;
import com.sellerops.knowledge.org.OrgKnowledgeSourceRepository;
import com.sellerops.product.ProductRepository;
import com.sellerops.product.library.ProductKnowledgeSourceRepository;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * <b>The six numbers behind 「reviewnary가 알고 있는 정보」.</b> (Knowledge Setup &amp; Inbox UX v1 §2)
 *
 * <p>Six counting queries, no joins, no model, no marketplace. It exists as its own class because it
 * reads across four corpora that have four owners, and giving any one of those owners the job would
 * make it the place the other three's counting rules drift into.
 *
 * <p>See {@link KnowledgeSummaryView} for what each number means and why the first three partition
 * rather than overlap.
 */
@Service
public class KnowledgeSummaryService {

    private final ProductKnowledgeSourceRepository productSources;
    private final OrgKnowledgeSourceRepository orgSources;
    private final AnswerMemoryRepository memories;
    private final ProductRepository products;
    private final KnowledgeCandidateRepository candidates;

    public KnowledgeSummaryService(ProductKnowledgeSourceRepository productSources,
                                   OrgKnowledgeSourceRepository orgSources,
                                   AnswerMemoryRepository memories, ProductRepository products,
                                   KnowledgeCandidateRepository candidates) {
        this.productSources = productSources;
        this.orgSources = orgSources;
        this.memories = memories;
        this.products = products;
        this.candidates = candidates;
    }

    @Transactional(readOnly = true)
    public KnowledgeSummaryView of(UUID orgId) {
        return new KnowledgeSummaryView(
                productSources.countByOrgIdAndDocumentNameIsNull(orgId),
                orgSources.countByOrgIdAndDocumentNameIsNull(orgId),
                productSources.countByOrgIdAndDocumentNameIsNotNull(orgId)
                        + orgSources.countByOrgIdAndDocumentNameIsNotNull(orgId),
                memories.countByOrgId(orgId),
                products.countByOrgId(orgId),
                candidates.countByOrgIdAndState(orgId, KnowledgeCandidateService.STATE_OPEN));
    }
}
