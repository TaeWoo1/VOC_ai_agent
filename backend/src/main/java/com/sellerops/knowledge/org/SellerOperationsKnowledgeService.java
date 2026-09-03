package com.sellerops.knowledge.org;

import com.sellerops.common.ApiException;
import com.sellerops.knowledge.KnowledgeRetriever;
import com.sellerops.knowledge.KnowledgeTopic;
import com.sellerops.knowledge.KnowledgeSemantics;
import com.sellerops.knowledge.RetrievalOutcome;
import com.sellerops.knowledge.semantic.KnowledgeEvidenceEligibility;
import com.sellerops.knowledge.semantic.KnowledgeSemanticSearch;
import com.sellerops.knowledge.RetrievalQuery;
import com.sellerops.knowledge.KnowledgeText;
import com.sellerops.knowledge.org.dto.OrgKnowledgePassage;
import com.sellerops.knowledge.org.dto.OrgKnowledgeRequest;
import com.sellerops.knowledge.org.dto.OrgKnowledgeSearchResponse;
import com.sellerops.knowledge.org.dto.OrgKnowledgeView;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.EnumSet;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 운영 정책 / 답변 기준 — the company's own rules, written once and quotable everywhere.
 *
 * <p><b>The axis the product was missing.</b> Product knowledge answers "폭이 몇 mm인가요?"; nothing
 * answered "현금영수증 발급 가능한가요?", which is the second most common question in the Demo Org's
 * real backlog. Those questions are not about a product and never resolve to one, so no amount of
 * product knowledge reaches them.
 *
 * <p><b>The same retrieval, not a second one.</b> Chunking, normalization, scoring, the absence gate
 * and the thresholds are {@link KnowledgeText} and {@link KnowledgeRetriever} — the identical code
 * the product library runs. A second implementation would be a second place for the 2026-08-24
 * inversion to live, and the two would disagree about what "이 질문에 답할 내용이 없다" means on the
 * same day.
 *
 * <p><b>No subject to discount.</b> The product library drops words explained by the product's own
 * name, because within one product's library that name distinguishes nothing. An org corpus has no
 * such name: the company name is not repeated in every policy, and there is no equivalent word to
 * remove. So the discounted subject is empty here, and that is a real difference between the two
 * corpora rather than an omission.
 */
@Service
public class SellerOperationsKnowledgeService {

    /** Passages per answer. More than this is not grounding; it is pasting the policy back. */
    static final int MAX_PASSAGES = 5;

    private final OrgKnowledgeSourceRepository sources;
    private final OrgKnowledgeChunkRepository chunks;
    private final KnowledgeSemanticSearch semanticSearch;
    private final KnowledgeEvidenceEligibility eligibility;

    public SellerOperationsKnowledgeService(OrgKnowledgeSourceRepository sources,
                                            OrgKnowledgeChunkRepository chunks) {
        this(sources, chunks, KnowledgeSemanticSearch.disabled(),
                KnowledgeEvidenceEligibility.disabled());
    }

    @org.springframework.beans.factory.annotation.Autowired
    public SellerOperationsKnowledgeService(OrgKnowledgeSourceRepository sources,
                                            OrgKnowledgeChunkRepository chunks,
                                            KnowledgeSemanticSearch semanticSearch,
                                            KnowledgeEvidenceEligibility eligibility) {
        this.sources = sources;
        this.chunks = chunks;
        this.semanticSearch = semanticSearch;
        this.eligibility = eligibility;
    }

    @Transactional(readOnly = true)
    public List<OrgKnowledgeView> list(UUID orgId) {
        Map<UUID, Integer> counts = new HashMap<>();
        for (OrgKnowledgeChunk chunk : chunks.findAllByOrgId(orgId)) {
            counts.merge(chunk.getSourceId(), 1, Integer::sum);
        }
        return sources.findAllByOrgIdOrderByCreatedAtAsc(orgId).stream()
                .map(source -> view(source, counts.getOrDefault(source.getId(), 0)))
                .toList();
    }

    @Transactional
    public OrgKnowledgeView create(UUID orgId, OrgKnowledgeRequest request, UUID authorUserId,
                                   String authorName) {
        OrgKnowledgeSource source = new OrgKnowledgeSource();
        source.setOrgId(orgId);
        source.setAuthorUserId(authorUserId);
        source.setAuthorName(authorName);
        apply(source, request);
        OrgKnowledgeSource saved = sources.save(source);
        return view(saved, reindex(saved));
    }

    /**
     * Edit one rule.
     *
     * <p>The version rises only when the BODY changed. Renaming a document or re-filing it under a
     * different type does not make last week's citation stale, and a version that ticked on every
     * save would say it did.
     */
    @Transactional
    public OrgKnowledgeView update(UUID orgId, UUID sourceId, OrgKnowledgeRequest request) {
        OrgKnowledgeSource source = sources.findByIdAndOrgId(sourceId, orgId)
                .orElseThrow(() -> ApiException.notFound("운영 정책을 찾을 수 없습니다."));
        String before = source.getBody();
        apply(source, request);
        if (!source.getBody().equals(before)) {
            source.setVersion(source.getVersion() + 1);
        }
        OrgKnowledgeSource saved = sources.save(source);
        return view(saved, reindex(saved));
    }

    @Transactional
    public void delete(UUID orgId, UUID sourceId) {
        OrgKnowledgeSource source = sources.findByIdAndOrgId(sourceId, orgId)
                .orElseThrow(() -> ApiException.notFound("운영 정책을 찾을 수 없습니다."));
        chunks.deleteAllBySourceId(source.getId());
        sources.delete(source);
    }

    /**
     * The passages of this org's operating rules that cover the question.
     *
     * <p>Takes no product. That is the point: this lane is reachable for an inquiry that never
     * resolved to a product, which is most of the backlog it exists for.
     */
    @Transactional(readOnly = true)
    public OrgKnowledgeSearchResponse search(UUID orgId, String query, int limit) {
        return search(orgId, RetrievalQuery.ofText(query), limit);
    }

    /**
     * The search over one question's bounded candidates, with the applicability gate — the same
     * loop the product library runs (Retrieval &amp; Grounding Correctness v1). A rule's declared
     * topic is its {@link OrgKnowledgeType} plus whatever its title names; a question about 세금계산서
     * does not get the shipping policy because both mention 발송.
     */
    @Transactional(readOnly = true)
    public OrgKnowledgeSearchResponse search(UUID orgId, RetrievalQuery question, int limit) {
        // Retired rules stop answering (Knowledge Sources & Acquisition v1) — the row stays so the
        // citations that stood on it still resolve.
        List<OrgKnowledgeSource> documents = sources.findAllByOrgIdOrderByCreatedAtAsc(orgId).stream()
                .filter(OrgKnowledgeSource::isActive)
                .toList();
        List<OrgKnowledgeChunk> corpus = chunks.findAllByOrgId(orgId);
        Map<UUID, OrgKnowledgeSource> byId = new HashMap<>();
        documents.forEach(d -> byId.put(d.getId(), d));

        // The title carries the topic ("현금영수증 발급 안내") and the body often never repeats it, so
        // the title is matched with the passage rather than beside it.
        List<KnowledgeRetriever.Candidate<OrgKnowledgeChunk>> candidates = new ArrayList<>();
        for (OrgKnowledgeChunk chunk : corpus) {
            OrgKnowledgeSource source = byId.get(chunk.getSourceId());
            if (source != null) {
                candidates.add(new KnowledgeRetriever.Candidate<>(chunk,
                        KnowledgeText.normalize(source.getTitle()) + chunk.getNormalized(),
                        source.getTitle() + "\n" + chunk.getContent()));
            }
        }
        Set<KnowledgeTopic> asked = KnowledgeTopic.of(question.text());
        List<OrgKnowledgePassage> hits = new ArrayList<>();
        int rejected = 0;
        int tried = 0;
        String matchedBy = question.full();
        // Same list, same filters: only rules this org owns and has not retired are ever seen.
        KnowledgeSemantics semantics = semanticSearch.forQuestion(orgId, question.full(), candidates,
                question.customerWritten());
        for (RetrievalQuery.Candidate candidate : semantics != null
                ? List.of(new RetrievalQuery.Candidate(question.full(), RetrievalQuery.Origin.FULL))
                : question.candidates()) {
            tried++;
            List<OrgKnowledgePassage> found = new ArrayList<>();
            int rejectedHere = 0;
            for (KnowledgeRetriever.Hit<OrgKnowledgeChunk> hit
                    : KnowledgeRetriever.rank(candidate.text(), candidates, null, semantics)) {
                OrgKnowledgeChunk chunk = hit.ref();
                OrgKnowledgeSource source = byId.get(chunk.getSourceId());
                if (!KnowledgeTopic.applicable(asked, declaredTopics(source))
                        || !KnowledgeTopic.remedyApplicable(question.text(), source.getTitle())) {
                    rejectedHere++;
                    continue;
                }
                found.add(new OrgKnowledgePassage(source.getId(), chunk.getId(), source.getKnowledgeType(),
                        source.getTitle(), chunk.getContent(), chunk.getOrdinal(), round(hit.coverage()),
                        source.getAuthorName(), source.getSourceUrl(), source.getVersion(),
                        source.getUpdatedAt()));
            }
            rejected += rejectedHere;
            if (!found.isEmpty()) {
                hits = found;
                matchedBy = candidate.text();
                break;
            }
        }
        // Same refusal-only judgement the product lane applies, on this lane's own passages.
        if (semantics != null) {
            hits = new ArrayList<>(eligibility.filter(orgId, question.full(),
                    question.customerWritten(), hits,
                    p -> p.title() + "\n" + p.content()));
        }
        RetrievalOutcome outcome = documents.isEmpty() ? RetrievalOutcome.ABSENT
                : !hits.isEmpty() ? RetrievalOutcome.FOUND
                : rejected > 0 ? RetrievalOutcome.NOT_APPLICABLE
                : RetrievalOutcome.NO_RELEVANT_EVIDENCE;
        hits.sort(Comparator.comparingDouble(OrgKnowledgePassage::score).reversed()
                // Ties resolve by document title then position, never by map iteration order: an
                // answer that cites a different policy on every identical run is not evidence.
                .thenComparing(OrgKnowledgePassage::title)
                .thenComparingInt(OrgKnowledgePassage::ordinal));
        int cap = Math.max(1, Math.min(limit <= 0 ? MAX_PASSAGES : limit, MAX_PASSAGES));
        Set<KnowledgeTopic> declared = EnumSet.noneOf(KnowledgeTopic.class);
        documents.forEach(d -> declared.addAll(declaredTopics(d)));
        return new OrgKnowledgeSearchResponse(matchedBy, documents.size(), corpus.size(),
                hits.size() > cap ? List.copyOf(hits.subList(0, cap)) : List.copyOf(hits),
                outcome, rejected, tried, List.copyOf(declared));
    }

    /**
     * What a rule declares itself to be about: its type, and whatever its title names. A type with no
     * operating topic (공통 안내, 기타) declares nothing and is never rejected on topic.
     */
    static Set<KnowledgeTopic> declaredTopics(OrgKnowledgeSource source) {
        Set<KnowledgeTopic> topics = EnumSet.noneOf(KnowledgeTopic.class);
        KnowledgeTopic typed = topicOf(source.getKnowledgeType());
        if (typed != null) {
            topics.add(typed);
        }
        topics.addAll(KnowledgeTopic.of(source.getTitle()));
        return topics;
    }

    /** The one-to-one part of the two vocabularies; the rest declare no topic. */
    static KnowledgeTopic topicOf(OrgKnowledgeType type) {
        if (type == null) {
            return null;
        }
        return switch (type) {
            case SHIPPING_POLICY -> KnowledgeTopic.SHIPPING;
            case CANCELLATION_POLICY -> KnowledgeTopic.CANCELLATION;
            case EXCHANGE_REFUND_POLICY -> KnowledgeTopic.EXCHANGE_RETURN;
            case PAYMENT_POLICY -> KnowledgeTopic.PAYMENT;
            case TAX_INVOICE -> KnowledgeTopic.TAX_INVOICE;
            case CASH_RECEIPT -> KnowledgeTopic.CASH_RECEIPT;
            case GENERAL_CS_FAQ, OTHER -> null;
        };
    }

    /** Rebuild one rule's passages. Old passages go first, so a shortened policy shrinks. */
    /**
     * Index one rule's passages — the same rebuild the editor performs, exposed for the document
     * importer (Knowledge Sources &amp; Acquisition v1).
     *
     * <p>Public for the reason {@code ProductKnowledgeIndexer} was extracted at all: retrieval reads
     * chunks, never sources, so a second writer that forgets to index writes a document nothing can
     * find and nothing complains about.
     */
    @Transactional
    public int index(OrgKnowledgeSource source) {
        return reindex(source);
    }

    /**
     * <p><b>The delete is flushed before the inserts</b>, for the reason
     * {@code ProductKnowledgeIndexer} records: Hibernate runs every insert before any delete, so
     * re-indexing an existing rule would insert ordinal 1 beside the ordinal 1 still there.
     */
    private int reindex(OrgKnowledgeSource source) {
        chunks.deleteAllBySourceId(source.getId());
        chunks.flush();
        List<String> parts = KnowledgeText.chunk(source.getBody());
        List<OrgKnowledgeChunk> rows = new ArrayList<>(parts.size());
        for (int i = 0; i < parts.size(); i++) {
            OrgKnowledgeChunk chunk = new OrgKnowledgeChunk();
            chunk.setOrgId(source.getOrgId());
            chunk.setSourceId(source.getId());
            chunk.setOrdinal(i + 1);
            chunk.setContent(parts.get(i));
            chunk.setNormalized(KnowledgeText.normalize(parts.get(i)));
            rows.add(chunk);
        }
        chunks.saveAll(rows);
        return rows.size();
    }

    private void apply(OrgKnowledgeSource source, OrgKnowledgeRequest request) {
        source.setKnowledgeType(request.knowledgeType());
        source.setTitle(request.title().strip());
        source.setBody(request.body().strip());
        String url = request.sourceUrl() == null || request.sourceUrl().isBlank()
                ? null : request.sourceUrl().strip();
        source.setSourceUrl(url);
    }

    private static OrgKnowledgeView view(OrgKnowledgeSource source, int passageCount) {
        return new OrgKnowledgeView(source.getId(), source.getKnowledgeType(),
                source.getKnowledgeType().labelKo(), source.getTitle(), source.getBody(),
                source.getSourceUrl(), source.getAuthorName(), source.getVersion(), passageCount,
                source.getCreatedAt(), source.getUpdatedAt());
    }

    /** Two decimals — a score is a diagnostic, and full float noise reads as false precision. */
    private static double round(double value) {
        return Math.round(value * 100.0) / 100.0;
    }
}
