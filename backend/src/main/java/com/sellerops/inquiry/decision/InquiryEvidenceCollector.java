package com.sellerops.inquiry.decision;

import com.sellerops.channel.ChannelRepository;
import com.sellerops.common.DataOrigin;
import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.draft.InquiryEvidenceRetriever;
import com.sellerops.knowledge.KnowledgeScope;
import com.sellerops.knowledge.RetrievalQuery;
import com.sellerops.knowledge.org.OrgKnowledgeChunk;
import com.sellerops.knowledge.org.OrgKnowledgeChunkRepository;
import com.sellerops.knowledge.org.OrgKnowledgeSource;
import com.sellerops.knowledge.org.OrgKnowledgeSourceRepository;
import com.sellerops.order.fact.OrderFactLookup;
import com.sellerops.product.ChannelProduct;
import com.sellerops.product.ChannelProductRepository;
import com.sellerops.product.FactKeys;
import com.sellerops.product.ProductFact;
import com.sellerops.product.ProductFactRepository;
import com.sellerops.product.ProductVariant;
import com.sellerops.product.ProductVariantRepository;
import com.sellerops.product.catalogue.CatalogueInvestigator;
import com.sellerops.product.library.KnowledgeVariantScope;
import com.sellerops.product.library.ProductKnowledgeChunk;
import com.sellerops.product.library.ProductKnowledgeChunkRepository;
import com.sellerops.product.library.ProductKnowledgeSource;
import com.sellerops.product.library.ProductKnowledgeSourceRepository;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * <b>Everything current this system holds that could answer an inquiry's needs</b> (Inquiry Decision v2) — collected
 * without a model, bounded, and handed to one coverage judge.
 *
 * <p>Relevance is the judge's question, so this class casts wide and ranks nothing semantically:
 * <ol>
 *   <li>the whole-question lanes the assessment already ran (product knowledge, company rules — with F5 when an org
 *       has it on, so both retrieval paths pass the same gate);</li>
 *   <li>the same lanes once per need, with the planner's short search phrase — a message with three questions is three
 *       searches, and a lexical scorer weighing three questions at once finds the one it can;</li>
 *   <li><b>a small library whole</b>: when this listing's notes or this company's rules are only a handful of passages,
 *       all of them — a judge reading twelve passages is cheaper than a retrieval miss;</li>
 *   <li><b>the stored catalogue</b>: this listing's facts, its options with their selling state, its 추가상품 — what
 *       Catalogue Bootstrap wrote and no lane read before — plus what the catalogue investigation found across the
 *       seller's other listings;</li>
 *   <li>the stored order fact, when one was observed.</li>
 * </ol>
 * Past answers go to a separate list: they are precedents the judge may propose for a prefill, never evidence.
 *
 * <p>It starts no acquisition: a NAVER listing whose detail was never read is reported as
 * {@link DetailCapability#NOT_ACQUIRED} and the plan is kept on the decision; nothing here reaches a channel.
 */
@Component
public class InquiryEvidenceCollector {

    /** A library at or under this many passages is read whole. */
    static final int WHOLE_LIBRARY_PASSAGES = 12;
    static final int MAX_CATALOGUE_CHARS = 1500;
    static final int MAX_PRECEDENT_CHARS = 500;

    private final InquiryEvidenceRetriever retriever;
    private final ProductKnowledgeSourceRepository productSources;
    private final ProductKnowledgeChunkRepository productChunks;
    private final OrgKnowledgeSourceRepository orgSources;
    private final OrgKnowledgeChunkRepository orgChunks;
    private final ProductFactRepository facts;
    private final ProductVariantRepository variants;
    private final ChannelProductRepository listings;
    private final ChannelRepository channels;

    public InquiryEvidenceCollector(InquiryEvidenceRetriever retriever,
                                    ProductKnowledgeSourceRepository productSources,
                                    ProductKnowledgeChunkRepository productChunks,
                                    OrgKnowledgeSourceRepository orgSources, OrgKnowledgeChunkRepository orgChunks,
                                    ProductFactRepository facts, ProductVariantRepository variants,
                                    ChannelProductRepository listings, ChannelRepository channels) {
        this.retriever = retriever;
        this.productSources = productSources;
        this.productChunks = productChunks;
        this.orgSources = orgSources;
        this.orgChunks = orgChunks;
        this.facts = facts;
        this.variants = variants;
        this.listings = listings;
        this.channels = channels;
    }

    @Transactional(readOnly = true)
    public InquiryDecisionEngine.Pool collect(UUID orgId, Inquiry inquiry, UUID productId,
                                              InquiryEvidenceRetriever.InquiryEvidence whole,
                                              CatalogueInvestigator.Finding catalogue, KnowledgeVariantScope scope,
                                              List<InquiryNeed> needs) {
        Map<String, EvidenceCandidate> evidence = new LinkedHashMap<>();
        Map<UUID, PrecedentCandidate> precedents = new LinkedHashMap<>();
        addLanes(whole, evidence, precedents);
        for (InquiryNeed need : needs) {
            addLanes(retriever.retrieve(orgId, inquiry, RetrievalQuery.ofText(need.search()), OrderFactLookup.STORED_ONLY,
                    scope), evidence, precedents);
        }
        addWholeLibraries(orgId, productId, scope, evidence);
        addCatalogue(orgId, productId, catalogue, evidence);
        if (whole != null && whole.order() != null && String.valueOf(whole.order().state()).startsWith("OBSERVED")) {
            put(evidence, new EvidenceCandidate(null, EvidenceCandidate.Kind.ORDER_FACT, "주문 상태",
                    whole.order().messageKo(), null, null, null));
        }
        return new InquiryDecisionEngine.Pool(List.copyOf(evidence.values()), List.copyOf(precedents.values()));
    }

    /** Whether this system can read the listing's 상세페이지 — from stored facts and listing channels only. */
    @Transactional(readOnly = true)
    public DetailCapability detail(UUID orgId, UUID productId) {
        if (productId == null) {
            return DetailCapability.NOT_APPLICABLE;
        }
        Set<String> codes = new LinkedHashSet<>();
        for (ChannelProduct cp : listings.findByOrgIdAndProductId(orgId, productId)) {
            channels.findById(cp.getChannelId()).ifPresent(ch -> codes.add(ch.getCode()));
        }
        String shape = facts.findByOrgIdAndProductId(orgId, productId).stream()
                .filter(f -> FactKeys.DETAIL_PAGE.equals(f.getFactKey())).map(ProductFact::getFactValue)
                .findFirst().orElse(null);
        if (shape != null) {
            return "IMAGE_ONLY".equals(shape) ? DetailCapability.IMAGE_ONLY : DetailCapability.READABLE;
        }
        if (codes.contains("NAVER")) {
            return DetailCapability.NOT_ACQUIRED;
        }
        return codes.isEmpty() ? DetailCapability.NOT_APPLICABLE : DetailCapability.NOT_COLLECTED;
    }

    private static void addLanes(InquiryEvidenceRetriever.InquiryEvidence lanes, Map<String, EvidenceCandidate> evidence,
                                 Map<UUID, PrecedentCandidate> precedents) {
        if (lanes == null) {
            return;
        }
        for (InquiryEvidenceRetriever.ScopedPassage p : lanes.passages()) {
            if (p.scope() == KnowledgeScope.PAST_ANSWER) {
                if (p.sourceId() != null && !precedents.containsKey(p.sourceId())) {
                    precedents.put(p.sourceId(), new PrecedentCandidate(null, p.sourceId(), bound(p.text(),
                            MAX_PRECEDENT_CHARS)));
                }
            } else if (p.scope().current()) {
                EvidenceCandidate.Kind kind = p.scope() == KnowledgeScope.ORG_OPERATIONS
                        ? EvidenceCandidate.Kind.ORG_KNOWLEDGE : EvidenceCandidate.Kind.PRODUCT_KNOWLEDGE;
                put(evidence, new EvidenceCandidate(null, kind, p.heading(), p.text(), p.sourceId(), null, null));
            }
        }
    }

    private void addWholeLibraries(UUID orgId, UUID productId, KnowledgeVariantScope scope,
                                   Map<String, EvidenceCandidate> evidence) {
        if (productId != null) {
            Map<UUID, ProductKnowledgeSource> byId = new HashMap<>();
            for (ProductKnowledgeSource s : productSources.findAllByOrgIdAndProductIdOrderByCreatedAtAsc(orgId, productId)) {
                if (s.isActive() && s.getDataOrigin() == DataOrigin.REAL
                        && (scope == null || scope.admits(s.getVariantId()))) {
                    byId.put(s.getId(), s);
                }
            }
            List<ProductKnowledgeChunk> chunks = productChunks.findAllByOrgIdAndProductId(orgId, productId).stream()
                    .filter(c -> byId.containsKey(c.getSourceId()))
                    .sorted(Comparator.comparing(ProductKnowledgeChunk::getOrdinal)).toList();
            if (!chunks.isEmpty() && chunks.size() <= WHOLE_LIBRARY_PASSAGES) {
                for (ProductKnowledgeChunk c : chunks) {
                    put(evidence, new EvidenceCandidate(null, EvidenceCandidate.Kind.PRODUCT_KNOWLEDGE,
                            byId.get(c.getSourceId()).getTitle(), c.getContent(), c.getSourceId(), null, null));
                }
            }
        }
        Map<UUID, OrgKnowledgeSource> rules = new HashMap<>();
        for (OrgKnowledgeSource s : orgSources.findAllByOrgIdOrderByCreatedAtAsc(orgId)) {
            if (s.isActive() && s.getDataOrigin() == DataOrigin.REAL) {
                rules.put(s.getId(), s);
            }
        }
        List<OrgKnowledgeChunk> ruleChunks = orgChunks.findAllByOrgId(orgId).stream()
                .filter(c -> rules.containsKey(c.getSourceId()))
                .sorted(Comparator.comparing(OrgKnowledgeChunk::getOrdinal)).toList();
        if (!ruleChunks.isEmpty() && ruleChunks.size() <= WHOLE_LIBRARY_PASSAGES) {
            for (OrgKnowledgeChunk c : ruleChunks) {
                put(evidence, new EvidenceCandidate(null, EvidenceCandidate.Kind.ORG_KNOWLEDGE,
                        rules.get(c.getSourceId()).getTitle(), c.getContent(), c.getSourceId(), null, null));
            }
        }
    }

    /**
     * The stored catalogue of this listing, as three candidates: its facts, its options with their selling state and
     * its 추가상품 — one candidate each, so the judge reads a list as a list. Detail-page bookkeeping is not a fact.
     */
    private void addCatalogue(UUID orgId, UUID productId, CatalogueInvestigator.Finding catalogue,
                              Map<String, EvidenceCandidate> evidence) {
        if (productId != null) {
            List<String> factLines = new ArrayList<>();
            List<String> addons = new ArrayList<>();
            for (ProductFact f : facts.findByOrgIdAndProductId(orgId, productId)) {
                if (f.getFactKey() == null || f.getFactValue() == null || f.getFactValue().isBlank()
                        || FactKeys.DETAIL_PAGE.equals(f.getFactKey())) {
                    continue;
                }
                if (f.getFactKey().startsWith(FactKeys.SUPPLEMENT_PREFIX)) {
                    addons.add(f.getFactValue().strip());
                } else {
                    factLines.add(f.getFactKey() + ": " + f.getFactValue().strip()
                            + (f.getUnit() == null ? "" : " " + f.getUnit()));
                }
            }
            if (!factLines.isEmpty()) {
                put(evidence, new EvidenceCandidate(null, EvidenceCandidate.Kind.PRODUCT_FACTS, "상품 등록 정보",
                        bound(String.join("\n", factLines.stream().sorted().toList()), MAX_CATALOGUE_CHARS), null,
                        productId, null));
            }
            List<String> options = new ArrayList<>();
            for (ProductVariant v : variants.findByOrgIdAndProductId(orgId, productId)) {
                if (v.getOptionName() != null && !v.getOptionName().isBlank()) {
                    options.add(v.getOptionName().strip() + " (" + sellingKo(v.getSellingStatus()) + ")");
                }
            }
            if (!options.isEmpty()) {
                put(evidence, new EvidenceCandidate(null, EvidenceCandidate.Kind.OPTIONS, "옵션 목록",
                        bound(String.join("\n", options.stream().sorted().toList()), MAX_CATALOGUE_CHARS), null,
                        productId, null));
            }
            if (!addons.isEmpty()) {
                put(evidence, new EvidenceCandidate(null, EvidenceCandidate.Kind.ADDONS, "추가상품 목록",
                        bound(String.join("\n", addons.stream().sorted().toList()), MAX_CATALOGUE_CHARS), null,
                        productId, null));
            }
        }
        if (catalogue != null) {
            for (CatalogueInvestigator.Statement s : catalogue.matches()) {
                put(evidence, new EvidenceCandidate(null, EvidenceCandidate.Kind.PRODUCT_FACTS,
                        s.productName() == null ? "다른 상품" : s.productName(), s.text(), s.sourceId(), s.productId(),
                        s.factKey()));
            }
        }
    }

    private static String sellingKo(String status) {
        if (status == null) {
            return "상태 미확인";
        }
        return switch (status) {
            case "SELLING", "SALE" -> "판매 중";
            case "SUSPENDED", "SUSPENSION" -> "판매 중지";
            case "OUTOFSTOCK", "OUT_OF_STOCK", "SOLD_OUT" -> "품절";
            default -> status;
        };
    }

    private static void put(Map<String, EvidenceCandidate> evidence, EvidenceCandidate c) {
        if (c.text() == null || c.text().isBlank()) {
            return;
        }
        evidence.putIfAbsent(c.kind() + "|" + c.sourceId() + "|" + c.text().strip(), c);
    }

    private static String bound(String s, int max) {
        if (s == null) {
            return "";
        }
        return s.length() <= max ? s : s.substring(0, max);
    }
}
