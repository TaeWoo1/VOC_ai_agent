package com.sellerops.knowledge.memory;

import com.sellerops.common.DataOrigin;
import com.sellerops.knowledge.KnowledgeRetriever;
import com.sellerops.knowledge.RetrievalOutcome;
import com.sellerops.knowledge.RetrievalQuery;
import com.sellerops.knowledge.KnowledgeText;
import com.sellerops.knowledge.TopicSignature;
import com.sellerops.knowledge.memory.dto.AnswerMemoryPassage;
import com.sellerops.knowledge.memory.dto.AnswerMemorySearchResponse;
import com.sellerops.knowledge.org.OrgKnowledgeChunk;
import com.sellerops.knowledge.org.OrgKnowledgeChunkRepository;
import com.sellerops.product.library.ProductKnowledgeChunk;
import com.sellerops.product.library.ProductKnowledgeChunkRepository;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Customer Operations Memory — what this company has actually answered before.
 *
 * <p><b>Only the seller's own acts get in.</b> {@link #remember} is called from three places and no
 * others: a collected marketplace answer, an approval, and a verified send. Nothing writes an AI
 * draft here, and nothing writes a draft a person was still editing. That is the whole safety
 * property of this class — a memory that accepted unapproved model output would be a model reading
 * its own guesses back as precedent, and the drift would be invisible because every citation would
 * still look like "판매자의 과거 답변".
 *
 * <p><b>It never writes a policy.</b> A remembered answer can disagree with the company's written
 * operating rule, and when it does the rule is not edited and not overruled — both are offered, each
 * with its own provenance, and the person decides. Automatic promotion of "what we said last time"
 * into "what we do" is how an exception becomes a policy nobody chose.
 *
 * <p><b>The same retrieval as everything else.</b> {@link KnowledgeRetriever}, the same thresholds,
 * the same absence gate. A past answer that does not cover the question is not offered, exactly as a
 * product note that does not cover it is not offered.
 */
@Service
public class AnswerMemoryService {

    /** Remembered answers per question. Past answers are context, not a second document to paste. */
    static final int MAX_PASSAGES = 3;

    private final AnswerMemoryRepository memories;
    private final OrgKnowledgeChunkRepository orgChunks;
    private final ProductKnowledgeChunkRepository productChunks;

    public AnswerMemoryService(AnswerMemoryRepository memories, OrgKnowledgeChunkRepository orgChunks,
                               ProductKnowledgeChunkRepository productChunks) {
        this.memories = memories;
        this.orgChunks = orgChunks;
        this.productChunks = productChunks;
    }

    /**
     * One act of the seller's, in the form this memory can hold.
     *
     * @param originRef the identity of the ACT, not of the text — {@code inquiry-answer:<uuid>},
     *                  {@code approved:<workItem>:<version>}, {@code verified:<workItem>}. Re-running
     *                  the same act updates its row; a different act is a different row.
     * @param question  the customer's question. Read to build the signature and then discarded — it
     *                  is never stored.
     */
    public record RememberCommand(UUID orgId, String originRef, AnswerMemoryStrength strength,
                                  String question, String answerTitle, String answerBody,
                                  UUID productId, String channelCode, String sourceSubtype,
                                  String topicCategory, UUID originInquiryId, UUID originWorkItemId,
                                  Integer originDraftVersion, UUID authorUserId, String authorName,
                                  DataOrigin dataOrigin) {
    }

    /**
     * Record one seller act, idempotently.
     *
     * <p><b>Strength never falls on the same act.</b> A re-collection of an inquiry whose answer this
     * org already verified must not turn a verified memory back into an imported one: the row keeps
     * the strongest thing that has been true of it. Different acts are different rows, so a real
     * downgrade — which does not exist — could only be written deliberately.
     *
     * @return the stored row, or empty when there was nothing to remember (a blank answer)
     */
    @Transactional
    public java.util.Optional<AnswerMemory> remember(RememberCommand command) {
        if (command.answerBody() == null || command.answerBody().isBlank()) {
            return java.util.Optional.empty();
        }
        AnswerMemory row = memories.findByOrgIdAndOriginRef(command.orgId(), command.originRef())
                .orElseGet(AnswerMemory::new);
        String body = command.answerBody().strip();
        String signature = TopicSignature.of(command.question(), sellerCorpus(command.orgId()));
        boolean existed = row.getId() != null;
        if (existed && body.equals(row.getAnswerBody()) && signature.equals(row.getTopicSignature())
                && command.strength().rank() <= row.getStrength().rank()) {
            return java.util.Optional.of(row);
        }
        if (existed && !body.equals(row.getAnswerBody())) {
            row.setVersion(row.getVersion() + 1);
        }
        row.setOrgId(command.orgId());
        row.setOriginRef(command.originRef());
        row.setStrength(existed && row.getStrength() != null
                && row.getStrength().rank() > command.strength().rank()
                ? row.getStrength() : command.strength());
        row.setTopicSignature(signature);
        row.setTopicCategory(command.topicCategory());
        row.setAnswerTitle(command.answerTitle());
        row.setAnswerBody(body);
        row.setNormalized(KnowledgeText.normalize(signature) + KnowledgeText.normalize(body));
        row.setProductId(command.productId());
        row.setChannelCode(command.channelCode());
        row.setSourceSubtype(command.sourceSubtype());
        row.setOriginInquiryId(command.originInquiryId());
        row.setOriginWorkItemId(command.originWorkItemId());
        row.setOriginDraftVersion(command.originDraftVersion());
        row.setAuthorUserId(command.authorUserId());
        row.setAuthorName(command.authorName());
        row.setDataOrigin(command.dataOrigin() == null ? DataOrigin.REAL : command.dataOrigin());
        return java.util.Optional.of(memories.save(row));
    }

    /**
     * The past answers that cover this question.
     *
     * <p><b>Another product's answer is never offered.</b> A memory bound to product A is in scope
     * only for a question about product A; an unbound memory is in scope for any question, because an
     * answer that never named a product cannot be about the wrong one. This is the same fence the
     * product library gets for free by being scoped to one product, applied by hand because this
     * corpus is org-wide.
     */
    @Transactional(readOnly = true)
    public AnswerMemorySearchResponse search(UUID orgId, String query, UUID productId, int limit) {
        return search(orgId, query, productId, null, limit);
    }

    /**
     * The same search, excluding the inquiry that is being answered right now.
     *
     * <p><b>An answer is not evidence for itself.</b> Once a seller approves a reply to work item W,
     * that reply is a memory — and regenerating W's draft would then retrieve it as "판매자의 과거
     * 답변" and write the next version from it. Every regeneration would agree with the last one a
     * little more, and the citation would look like precedent the whole way down. The exclusion is
     * by ORIGIN INQUIRY rather than by text, because the same sentence approved on a different
     * inquiry genuinely is precedent.
     */
    @Transactional(readOnly = true)
    public AnswerMemorySearchResponse search(UUID orgId, String query, UUID productId,
                                             UUID excludeInquiryId, int limit) {
        return search(orgId, RetrievalQuery.ofText(query), productId, excludeInquiryId, limit);
    }

    /**
     * The search over one question's bounded candidates (Retrieval &amp; Grounding Correctness v1):
     * the same forms the product library and the rules are asked in, so 「예전에 반품 문의에 뭐라고
     * 답했어?」 finds the answer that was sent about 반품. Order within a candidate is unchanged —
     * relevance, then strength, then recency.
     */
    @Transactional(readOnly = true)
    public AnswerMemorySearchResponse search(UUID orgId, RetrievalQuery question, UUID productId,
                                             UUID excludeInquiryId, int limit) {
        return search(orgId, question, productId, null, excludeInquiryId, limit);
    }

    /**
     * The closed phrasing of a "what did we answer before" request — words that say the seller wants
     * a past answer, not what the answer should be about. Reviewable in one line, like the rest.
     */
    static final Set<String> PAST_ANSWER_PHRASING = Set.of(
            "예전", "이전", "과거", "전에", "지난", "뭐라", "뭐라고", "어떻게", "답했", "답변", "답한", "보냈", "보낸",
            "승인", "대응", "응대", "처리", "했었", "했는지", "했나", "참고", "문의", "리뷰", "사례", "기록");

    /**
     * The same search, told the product's name so words that only name the product are not read as
     * a topic — and, when the question names no topic at all, answering by LISTING that product's
     * remembered answers (strongest first, then newest) instead of by matching.
     *
     * <p>Live (2026-08-30): 「QA 전선몰딩 문의에 예전에 뭐라고 답했어?」 carried no topical word, so the
     * lexical gate correctly matched nothing — over a product with a verified answer on record. A
     * question that asks for the record without naming a topic is answered by the record. A question
     * that names a topic (「예전에 방수 문의에 뭐라고 답했어」) and misses stays a miss: listing would
     * hand back answers about something else as if they were about 방수.
     */
    @Transactional(readOnly = true)
    public AnswerMemorySearchResponse search(UUID orgId, RetrievalQuery question, UUID productId,
                                             String productName, UUID excludeInquiryId, int limit) {
        List<AnswerMemory> corpus = memories.findAllByOrgId(orgId).stream()
                .filter(m -> m.getProductId() == null || m.getProductId().equals(productId))
                .filter(m -> excludeInquiryId == null
                        || !excludeInquiryId.equals(m.getOriginInquiryId()))
                .toList();
        List<KnowledgeRetriever.Candidate<AnswerMemory>> candidates = corpus.stream()
                .map(m -> new KnowledgeRetriever.Candidate<>(m, m.getNormalized()))
                .toList();
        List<KnowledgeRetriever.Hit<AnswerMemory>> ranked = List.of();
        String matchedBy = question.full();
        int tried = 0;
        for (RetrievalQuery.Candidate candidate : question.candidates()) {
            tried++;
            ranked = KnowledgeRetriever.rank(candidate.text(), candidates, productName);
            if (!ranked.isEmpty()) {
                matchedBy = candidate.text();
                break;
            }
        }
        if (ranked.isEmpty() && productId != null
                && RetrievalQuery.residualTopicWords(question.full(), productName, PAST_ANSWER_PHRASING).isEmpty()) {
            // Browse, not match: the question named the product and nothing else. Only THIS product's
            // answers (an unbound answer says nothing about which product it was for), in the order a
            // conflict is resolved in — strength, then recency — with the retriever's score absent.
            ranked = corpus.stream()
                    .filter(m -> productId.equals(m.getProductId()))
                    .sorted(Comparator.comparingInt((AnswerMemory m) -> -m.getStrength().rank())
                            .thenComparing(AnswerMemory::getUpdatedAt, Comparator.nullsLast(Comparator.reverseOrder())))
                    .map(m -> new KnowledgeRetriever.Hit<>(m, 0.0, 0))
                    .toList();
            matchedBy = ranked.isEmpty() ? matchedBy : "";
        }

        Conflicts resolved = resolveConflicts(ranked);
        int cap = Math.max(1, Math.min(limit <= 0 ? MAX_PASSAGES : limit, MAX_PASSAGES));
        List<AnswerMemoryPassage> passages = resolved.kept().stream()
                .limit(cap)
                .map(AnswerMemoryService::passage)
                .toList();
        RetrievalOutcome outcome = corpus.isEmpty() ? RetrievalOutcome.ABSENT
                : passages.isEmpty() ? RetrievalOutcome.NO_RELEVANT_EVIDENCE : RetrievalOutcome.FOUND;
        return new AnswerMemorySearchResponse(matchedBy, corpus.size(), resolved.superseded(), passages,
                outcome, tried);
    }

    /**
     * Collapse remembered answers that speak to the same standing rule.
     *
     * <p>Two answers in the same deterministic category, about the same product scope, are two
     * statements of one rule — "교환 가능합니다" and "제품 확인 후 교환 여부를 안내합니다". Offering
     * both to a drafter is offering it a contradiction and letting it choose; the seller's strongest
     * and then most recent statement is what the company currently does, so that one is kept.
     *
     * <p>Rows with no category are not grouped. Being uncategorised is not evidence that two answers
     * are about the same thing, and collapsing on it would hide one real answer behind another.
     */
    private static Conflicts resolveConflicts(List<KnowledgeRetriever.Hit<AnswerMemory>> ranked) {
        Map<String, KnowledgeRetriever.Hit<AnswerMemory>> best = new LinkedHashMap<>();
        List<KnowledgeRetriever.Hit<AnswerMemory>> ungrouped = new ArrayList<>();
        int superseded = 0;
        for (KnowledgeRetriever.Hit<AnswerMemory> hit : ranked) {
            AnswerMemory row = hit.ref();
            if (row.getTopicCategory() == null || row.getTopicCategory().isBlank()) {
                ungrouped.add(hit);
                continue;
            }
            String key = row.getTopicCategory() + "|" + row.getProductId();
            KnowledgeRetriever.Hit<AnswerMemory> incumbent = best.get(key);
            if (incumbent == null) {
                best.put(key, hit);
            } else if (wins(row, incumbent.ref())) {
                best.put(key, hit);
                superseded++;
            } else {
                superseded++;
            }
        }
        List<KnowledgeRetriever.Hit<AnswerMemory>> kept = new ArrayList<>(best.values());
        kept.addAll(ungrouped);
        kept.sort(Comparator
                .comparingDouble((KnowledgeRetriever.Hit<AnswerMemory> h) -> h.coverage()).reversed()
                .thenComparingInt(h -> -h.ref().getStrength().rank())
                .thenComparing(h -> h.ref().getUpdatedAt(), Comparator.reverseOrder()));
        return new Conflicts(kept, superseded);
    }

    /** Stronger wins; equal strength, the more recent. Never the higher retrieval score. */
    private static boolean wins(AnswerMemory candidate, AnswerMemory incumbent) {
        if (candidate.getStrength().rank() != incumbent.getStrength().rank()) {
            return candidate.getStrength().rank() > incumbent.getStrength().rank();
        }
        return candidate.getUpdatedAt() != null && incumbent.getUpdatedAt() != null
                && candidate.getUpdatedAt().isAfter(incumbent.getUpdatedAt());
    }

    private record Conflicts(List<KnowledgeRetriever.Hit<AnswerMemory>> kept, int superseded) {
    }

    /**
     * The seller's own vocabulary — every word they have written about their own business.
     *
     * <p>Read fresh rather than cached: a signature computed the day a policy was written must not
     * differ from one computed the day after, and the corpus is bounded (one org's notes).
     */
    private String sellerCorpus(UUID orgId) {
        StringBuilder sb = new StringBuilder();
        for (OrgKnowledgeChunk chunk : orgChunks.findAllByOrgId(orgId)) {
            sb.append(chunk.getNormalized());
        }
        for (ProductKnowledgeChunk chunk : productChunks.findAllByOrgId(orgId)) {
            sb.append(chunk.getNormalized());
        }
        return sb.toString();
    }

    private static AnswerMemoryPassage passage(KnowledgeRetriever.Hit<AnswerMemory> hit) {
        AnswerMemory row = hit.ref();
        return new AnswerMemoryPassage(row.getId(), row.getTopicSignature(), row.getTopicCategory(),
                row.getAnswerTitle(), row.getAnswerBody(), round(hit.coverage()), row.getStrength(),
                row.getStrength().labelKo(), row.getProductId(), row.getChannelCode(),
                row.getAuthorName(), row.getVersion(), row.getUpdatedAt());
    }

    private static double round(double value) {
        return Math.round(value * 100.0) / 100.0;
    }

    /** Whether this org has remembered anything at all — the empty-state question, not a search. */
    @Transactional(readOnly = true)
    public long count(UUID orgId) {
        return memories.countByOrgId(orgId);
    }
}
