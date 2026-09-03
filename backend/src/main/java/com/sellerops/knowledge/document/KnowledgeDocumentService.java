package com.sellerops.knowledge.document;

import com.sellerops.common.ApiException;
import com.sellerops.knowledge.document.dto.KnowledgeDocumentView;
import com.sellerops.knowledge.org.OrgKnowledgeChunkRepository;
import com.sellerops.knowledge.org.OrgKnowledgeSource;
import com.sellerops.knowledge.org.OrgKnowledgeSourceRepository;
import com.sellerops.knowledge.org.OrgKnowledgeType;
import com.sellerops.knowledge.org.SellerOperationsKnowledgeService;
import com.sellerops.product.OperatorProductName;
import com.sellerops.product.Product;
import com.sellerops.product.ProductRepository;
import com.sellerops.product.library.KnowledgeAuthorship;
import com.sellerops.product.library.KnowledgeSourceType;
import com.sellerops.product.library.ProductKnowledgeIndexer;
import com.sellerops.product.library.ProductKnowledgeSource;
import com.sellerops.product.library.ProductKnowledgeSourceRepository;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * <b>The seller's own material, brought in as it is.</b> (Knowledge Sources &amp; Acquisition v1)
 *
 * <p>A manual, an FAQ, a shipping policy: the company already wrote these, and a product that makes
 * them retype one into a form is asking for work that was already done. This takes the file, extracts
 * its text ({@link KnowledgeDocumentText}), and writes it into <b>the corpus that already exists</b> —
 * a {@code ProductKnowledgeSource} or an {@code OrgKnowledgeSource}, indexed by the same indexer, found
 * by the same retriever, cited with the same {@code DraftEvidenceView}. There is no document corpus
 * beside the knowledge corpus, because a second corpus is a second thing to keep in sync and a second
 * place a citation can point.
 *
 * <p><b>The seller confirms the FILE, not the passages.</b> What they are asked is what this is, where
 * it applies, and whether it is current — three questions about a document a person can answer. Asking
 * them to approve forty chunks would be asking them to do the chunker's job, and they would say yes to
 * all of it without reading, which is worse than not asking.
 *
 * <p><b>Retiring, not deleting.</b> {@link #setActive} stops a superseded manual from grounding new
 * answers while leaving every citation that stood on it resolvable. A delete would erase the record of
 * what a draft was written from.
 *
 * <p>No model is called here, and nothing leaves this deployment.
 */
@Service
public class KnowledgeDocumentService {

    /** Which corpus a document lands in. Two, because there are two corpora — see the class note. */
    public enum Scope { PRODUCT, ORG }

    private final ProductKnowledgeSourceRepository productSources;
    private final ProductKnowledgeIndexer productIndexer;
    private final ProductRepository products;
    private final OrgKnowledgeSourceRepository orgSources;
    private final OrgKnowledgeChunkRepository orgChunks;
    private final SellerOperationsKnowledgeService orgKnowledge;

    public KnowledgeDocumentService(ProductKnowledgeSourceRepository productSources,
                                    ProductKnowledgeIndexer productIndexer, ProductRepository products,
                                    OrgKnowledgeSourceRepository orgSources,
                                    OrgKnowledgeChunkRepository orgChunks,
                                    SellerOperationsKnowledgeService orgKnowledge) {
        this.productSources = productSources;
        this.productIndexer = productIndexer;
        this.products = products;
        this.orgSources = orgSources;
        this.orgChunks = orgChunks;
        this.orgKnowledge = orgKnowledge;
    }

    /**
     * Import one document into one corpus.
     *
     * @param sourceType for a PRODUCT document, which kind it is (FAQ / USAGE / POLICY / DESCRIPTION)
     * @param orgType    for an ORG document, which operating topic it states
     * @throws ApiException 400 on a format this cannot read, a file too large, or a document with no
     *                      readable text; 404 when the product is not this org's
     */
    @Transactional
    public KnowledgeDocumentView importDocument(UUID orgId, Scope scope, UUID productId,
                                                KnowledgeSourceType sourceType, OrgKnowledgeType orgType,
                                                String filename, byte[] bytes, UUID actorUserId,
                                                String actorName) {
        String text = KnowledgeDocumentText.extract(filename, bytes);
        String title = titleFor(filename);
        if (scope == Scope.PRODUCT) {
            Product product = products.findById(productId)
                    .filter(p -> p.getOrgId().equals(orgId))
                    .orElseThrow(() -> ApiException.notFound("상품을 찾을 수 없습니다."));
            ProductKnowledgeSource source = new ProductKnowledgeSource();
            source.setOrgId(orgId);
            source.setProductId(product.getId());
            source.setSourceType(sourceType == null ? KnowledgeSourceType.FAQ : sourceType);
            // The seller uploaded it, so it is theirs — and the file is what they can retire.
            source.setAuthoredOrigin(KnowledgeAuthorship.SELLER_UPLOADED_DOCUMENT);
            source.setDocumentName(filename);
            source.setTitle(title);
            source.setBody(text);
            source.setAuthorUserId(actorUserId);
            source.setAuthorName(actorName);
            ProductKnowledgeSource saved = productSources.save(source);
            int passages = productIndexer.index(saved);
            return view(saved, passages, product);
        }
        OrgKnowledgeSource source = new OrgKnowledgeSource();
        source.setOrgId(orgId);
        source.setKnowledgeType(orgType == null ? OrgKnowledgeType.GENERAL_CS_FAQ : orgType);
        source.setAuthoredOrigin(KnowledgeAuthorship.SELLER_UPLOADED_DOCUMENT);
        source.setDocumentName(filename);
        source.setTitle(title);
        source.setBody(text);
        source.setAuthorUserId(actorUserId);
        source.setAuthorName(actorName);
        OrgKnowledgeSource saved = orgSources.save(source);
        int passages = orgKnowledge.index(saved);
        return view(saved, passages);
    }

    /** Every uploaded document this org has, product and org corpora together, newest first. */
    @Transactional(readOnly = true)
    public List<KnowledgeDocumentView> list(UUID orgId) {
        List<KnowledgeDocumentView> out = new ArrayList<>();
        for (ProductKnowledgeSource source : productSources.findAllByOrgIdAndDocumentNameIsNotNull(orgId)) {
            Product product = products.findById(source.getProductId()).orElse(null);
            out.add(view(source, chunkCountOf(source), product));
        }
        for (OrgKnowledgeSource source : orgSources.findAllByOrgIdAndDocumentNameIsNotNull(orgId)) {
            out.add(view(source, orgChunks.countBySourceId(source.getId())));
        }
        out.sort((a, b) -> b.uploadedAt().compareTo(a.uploadedAt()));
        return List.copyOf(out);
    }

    /**
     * Retire or restore one document.
     *
     * <p>Addressed by its source id, which is what the list hands back, and scoped to this org on both
     * corpora — an id from another company resolves to nothing rather than to their document.
     */
    @Transactional
    public KnowledgeDocumentView setActive(UUID orgId, UUID sourceId, boolean active) {
        ProductKnowledgeSource product = productSources.findByIdAndOrgId(sourceId, orgId).orElse(null);
        if (product != null) {
            product.setActive(active);
            ProductKnowledgeSource saved = productSources.save(product);
            return view(saved, chunkCountOf(saved), products.findById(saved.getProductId()).orElse(null));
        }
        OrgKnowledgeSource org = orgSources.findByIdAndOrgId(sourceId, orgId)
                .orElseThrow(() -> ApiException.notFound("자료를 찾을 수 없습니다."));
        org.setActive(active);
        OrgKnowledgeSource saved = orgSources.save(org);
        return view(saved, orgChunks.countBySourceId(saved.getId()));
    }

    private int chunkCountOf(ProductKnowledgeSource source) {
        return productIndexer.countFor(source.getId());
    }

    /**
     * The document's title.
     *
     * <p>The filename with its extension removed — the seller named the file, and a title we composed
     * would be a second name for the same thing. Bounded to the column, and never empty.
     */
    static String titleFor(String filename) {
        String name = filename == null ? "" : filename.strip();
        int slash = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'));
        if (slash >= 0) {
            name = name.substring(slash + 1);
        }
        int dot = name.lastIndexOf('.');
        if (dot > 0) {
            name = name.substring(0, dot);
        } else if (dot == 0) {
            // The whole name is an extension («.pdf»). There is no title in it to keep.
            name = "";
        }
        name = name.strip();
        if (name.isEmpty()) {
            name = "올린 자료";
        }
        return name.length() > 200 ? name.substring(0, 200) : name;
    }

    private static KnowledgeDocumentView view(ProductKnowledgeSource source, int passages, Product product) {
        return new KnowledgeDocumentView(source.getId(), "PRODUCT", source.getProductId(),
                product == null ? null : OperatorProductName.displayNameOrNull(product),
                source.getDocumentName(), source.getTitle(), source.getSourceType().name(),
                source.isActive(), passages, source.getAuthorName(), source.getCreatedAt());
    }

    private static KnowledgeDocumentView view(OrgKnowledgeSource source, int passages) {
        return new KnowledgeDocumentView(source.getId(), "ORG", null, null,
                source.getDocumentName(), source.getTitle(), source.getKnowledgeType().name(),
                source.isActive(), passages, source.getAuthorName(), source.getCreatedAt());
    }
}
