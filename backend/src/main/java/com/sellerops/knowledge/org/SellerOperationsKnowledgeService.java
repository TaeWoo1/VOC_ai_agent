package com.sellerops.knowledge.org;

import com.sellerops.common.ApiException;
import com.sellerops.knowledge.KnowledgeRetriever;
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

    public SellerOperationsKnowledgeService(OrgKnowledgeSourceRepository sources,
                                            OrgKnowledgeChunkRepository chunks) {
        this.sources = sources;
        this.chunks = chunks;
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
        List<OrgKnowledgeSource> documents = sources.findAllByOrgIdOrderByCreatedAtAsc(orgId);
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
                        KnowledgeText.normalize(source.getTitle()) + chunk.getNormalized()));
            }
        }
        List<OrgKnowledgePassage> hits = new ArrayList<>();
        for (KnowledgeRetriever.Hit<OrgKnowledgeChunk> hit
                : KnowledgeRetriever.rank(query, candidates, null)) {
            OrgKnowledgeChunk chunk = hit.ref();
            OrgKnowledgeSource source = byId.get(chunk.getSourceId());
            hits.add(new OrgKnowledgePassage(source.getId(), chunk.getId(), source.getKnowledgeType(),
                    source.getTitle(), chunk.getContent(), chunk.getOrdinal(), round(hit.coverage()),
                    source.getAuthorName(), source.getSourceUrl(), source.getVersion(),
                    source.getUpdatedAt()));
        }
        hits.sort(Comparator.comparingDouble(OrgKnowledgePassage::score).reversed()
                // Ties resolve by document title then position, never by map iteration order: an
                // answer that cites a different policy on every identical run is not evidence.
                .thenComparing(OrgKnowledgePassage::title)
                .thenComparingInt(OrgKnowledgePassage::ordinal));
        int cap = Math.max(1, Math.min(limit <= 0 ? MAX_PASSAGES : limit, MAX_PASSAGES));
        return new OrgKnowledgeSearchResponse(query, documents.size(), corpus.size(),
                hits.size() > cap ? List.copyOf(hits.subList(0, cap)) : List.copyOf(hits));
    }

    /** Rebuild one rule's passages. Old passages go first, so a shortened policy shrinks. */
    private int reindex(OrgKnowledgeSource source) {
        chunks.deleteAllBySourceId(source.getId());
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
