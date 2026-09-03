package com.sellerops.knowledge.candidate;

import com.sellerops.common.ApiException;
import com.sellerops.knowledge.KnowledgeText;
import com.sellerops.knowledge.candidate.dto.KnowledgeCandidateView;
import com.sellerops.knowledge.memory.AnswerMemory;
import com.sellerops.knowledge.memory.AnswerMemoryRepository;
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
import java.security.MessageDigest;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * <b>확인 필요 — what reviewnary noticed, waiting for a person.</b>
 * (Knowledge Sources &amp; Acquisition v1)
 *
 * <p>Two producers, one inbox.
 *
 * <ol>
 *   <li><b>Repeated answers.</b> A sentence the seller has written to customers many times is
 *       probably their standard. {@link #proposeFromAnswers} counts them — <b>deterministically, with
 *       no model</b> — and files the ones over a threshold as candidates. The sentence is the
 *       seller's own, verbatim; nothing is paraphrased, summarised or generated, because a
 *       paraphrase of a policy is a different policy.</li>
 *   <li><b>Drafting gaps.</b> When a grounded draft could not answer something, the ask can be filed
 *       here instead of nagging on every screen ({@link #noteGap}).</li>
 * </ol>
 *
 * <p><b>Nothing here promotes anything.</b> {@link #accept} is the only path from a candidate to
 * knowledge, it runs on the seller's press, and what it writes is an ordinary knowledge source with
 * ordinary provenance — after which the candidate row is history rather than an authority.
 *
 * <p>Reaches no marketplace and calls no model.
 */
@Service
public class KnowledgeCandidateService {

    /** How many past answers must carry a sentence before it is worth asking about. */
    public static final int MIN_REPEATS = 3;

    /** Sentences shorter than this are greetings and sign-offs, not standards. */
    static final int MIN_SENTENCE_CHARS = 16;

    /** And longer than this is a whole answer rather than a rule inside one. */
    static final int MAX_SENTENCE_CHARS = 300;

    /** How many candidates one proposal run may add. A first run on a big backlog is not an inbox. */
    static final int MAX_PER_RUN = 20;

    public static final String STATE_OPEN = "OPEN";
    public static final String STATE_ACCEPTED = "ACCEPTED";
    public static final String STATE_DISMISSED = "DISMISSED";
    public static final String ORIGIN_REPEATED_ANSWER = "REPEATED_ANSWER";
    public static final String ORIGIN_DRAFT_GAP = "DRAFT_GAP";

    private final KnowledgeCandidateRepository candidates;
    private final AnswerMemoryRepository memories;
    private final ProductKnowledgeSourceRepository productSources;
    private final ProductKnowledgeIndexer productIndexer;
    private final ProductRepository products;
    private final OrgKnowledgeSourceRepository orgSources;
    private final SellerOperationsKnowledgeService orgKnowledge;

    public KnowledgeCandidateService(KnowledgeCandidateRepository candidates,
                                     AnswerMemoryRepository memories,
                                     ProductKnowledgeSourceRepository productSources,
                                     ProductKnowledgeIndexer productIndexer, ProductRepository products,
                                     OrgKnowledgeSourceRepository orgSources,
                                     SellerOperationsKnowledgeService orgKnowledge) {
        this.candidates = candidates;
        this.memories = memories;
        this.productSources = productSources;
        this.productIndexer = productIndexer;
        this.products = products;
        this.orgSources = orgSources;
        this.orgKnowledge = orgKnowledge;
    }

    /* ─────────────────────────────── the two producers ─────────────────────────────── */

    /**
     * Notice the sentences this seller keeps writing.
     *
     * <p>One pass over Answer Memory, split into sentences, normalized the way retrieval normalizes
     * (so 「먼지를 제거해 주세요.」 and 「먼지를 제거해주세요」 are one sentence rather than two), counted,
     * and filed above {@link #MIN_REPEATS}. Idempotent: the dedupe key is the normalized sentence, and
     * the partial unique index makes a second run a no-op rather than a duplicate.
     *
     * @return how many candidates were newly filed
     */
    @Transactional
    public int proposeFromAnswers(UUID orgId) {
        Map<String, Repeat> repeats = new LinkedHashMap<>();
        for (AnswerMemory memory : memories.findAllByOrgId(orgId)) {
            for (String sentence : sentencesOf(memory.getAnswerBody())) {
                String key = KnowledgeText.normalize(sentence);
                if (key.isBlank()) {
                    continue;
                }
                Repeat repeat = repeats.computeIfAbsent(key, k -> new Repeat(sentence));
                repeat.count++;
                // The product is claimed only when every occurrence agrees. A sentence written about
                // three different products is a company-wide habit, not a fact about one of them.
                repeat.observe(memory.getProductId());
            }
        }
        List<Repeat> ranked = new ArrayList<>(repeats.values());
        ranked.sort((a, b) -> Integer.compare(b.count, a.count));
        int filed = 0;
        for (Repeat repeat : ranked) {
            if (filed >= MAX_PER_RUN) {
                break;
            }
            if (repeat.count < MIN_REPEATS) {
                continue;
            }
            if (file(orgId, repeat) != null) {
                filed++;
            }
        }
        return filed;
    }

    /**
     * File a gap a draft ran into, so the ask lives in one place instead of on every screen.
     *
     * <p>Idempotent by the same key: a review drafted five times files one candidate.
     */
    @Transactional
    public KnowledgeCandidate noteGap(UUID orgId, String scope, UUID productId, String subject,
                                      String question) {
        String key = dedupeKey(scope, productId, question);
        return candidates.findByOrgIdAndDedupeKeyAndState(orgId, key, STATE_OPEN).orElseGet(() -> {
            KnowledgeCandidate row = new KnowledgeCandidate();
            row.setOrgId(orgId);
            row.setScope(scope);
            row.setProductId(productId);
            row.setSubject(bounded(subject, 300));
            row.setContent(question);
            row.setOrigin(ORIGIN_DRAFT_GAP);
            row.setEvidenceCount(0);
            row.setDedupeKey(key);
            try {
                return candidates.save(row);
            } catch (DataIntegrityViolationException race) {
                return candidates.findByOrgIdAndDedupeKeyAndState(orgId, key, STATE_OPEN).orElseThrow(() -> race);
            }
        });
    }

    /* ─────────────────────────────── the seller's decision ─────────────────────────────── */

    @Transactional(readOnly = true)
    public List<KnowledgeCandidateView> open(UUID orgId) {
        return candidates.findAllByOrgIdAndStateOrderByEvidenceCountDescCreatedAtDesc(orgId, STATE_OPEN)
                .stream().map(row -> view(row, productName(orgId, row.getProductId()))).toList();
    }

    /**
     * Accept one candidate: write an ordinary knowledge source and record which one it became.
     *
     * <p>The seller may edit the sentence before accepting — that is what {@code content} carries —
     * and the source is written with {@code SELLER_ENTERED_KNOWLEDGE} authorship, because by pressing
     * this the seller is entering it. The candidate did not author anything; it asked.
     *
     * <p><b>A gap's stored text is the QUESTION, and a question is never an answer.</b>
     * (Knowledge Setup &amp; Inbox UX v1 §3) A {@link #ORIGIN_REPEATED_ANSWER} candidate carries a
     * sentence this seller has already written to customers many times, so accepting it with no
     * edit means 「yes, that is our standard」 and falling back to the stored text is right. A
     * {@link #ORIGIN_DRAFT_GAP} candidate carries 「'…'에 대해 안내하는 공식 기준이 있나요?」, and
     * accepting THAT with no edit filed the question itself as the company's official knowledge —
     * measured on 2026-09-03, a product FAQ whose body was 「…공식 기준이 있나요? 이 상품에 저장된
     * 지식에서 찾지 못했습니다.」, indexed and citable, so the next customer to ask would have been
     * answered with reviewnary's own confusion. There is no fallback for a gap: the seller writes
     * the fact, or nothing is written.
     *
     * @throws ApiException 400 when a drafting gap is accepted with no content
     */
    @Transactional
    public KnowledgeCandidateView accept(UUID orgId, UUID candidateId, String title, String content,
                                         KnowledgeSourceType productType, OrgKnowledgeType orgType,
                                         UUID actorUserId, String actorName) {
        KnowledgeCandidate row = candidates.findByIdAndOrgId(candidateId, orgId)
                .orElseThrow(() -> ApiException.notFound("확인할 항목을 찾을 수 없습니다."));
        if (!STATE_OPEN.equals(row.getState())) {
            throw ApiException.conflict("이미 처리한 항목입니다.");
        }
        boolean written = content != null && !content.isBlank();
        if (!written && ORIGIN_DRAFT_GAP.equals(row.getOrigin())) {
            throw ApiException.badRequest("고객에게 안내할 내용을 적어 주세요.");
        }
        String body = written ? content.strip() : row.getContent();
        String heading = title == null || title.isBlank() ? row.getSubject() : title.strip();
        UUID sourceId;
        if ("PRODUCT".equals(row.getScope()) && row.getProductId() != null) {
            Product product = products.findById(row.getProductId())
                    .filter(p -> p.getOrgId().equals(orgId))
                    .orElseThrow(() -> ApiException.notFound("상품을 찾을 수 없습니다."));
            ProductKnowledgeSource source = new ProductKnowledgeSource();
            source.setOrgId(orgId);
            source.setProductId(product.getId());
            source.setSourceType(productType == null ? KnowledgeSourceType.FAQ : productType);
            source.setAuthoredOrigin(KnowledgeAuthorship.SELLER_ENTERED_KNOWLEDGE);
            source.setTitle(bounded(heading, 200));
            source.setBody(body);
            source.setAuthorUserId(actorUserId);
            source.setAuthorName(actorName);
            ProductKnowledgeSource saved = productSources.save(source);
            productIndexer.index(saved);
            sourceId = saved.getId();
        } else {
            OrgKnowledgeSource source = new OrgKnowledgeSource();
            source.setOrgId(orgId);
            source.setKnowledgeType(orgType == null ? OrgKnowledgeType.GENERAL_CS_FAQ : orgType);
            source.setAuthoredOrigin(KnowledgeAuthorship.SELLER_ENTERED_KNOWLEDGE);
            source.setTitle(bounded(heading, 200));
            source.setBody(body);
            source.setAuthorUserId(actorUserId);
            source.setAuthorName(actorName);
            OrgKnowledgeSource saved = orgSources.save(source);
            orgKnowledge.index(saved);
            sourceId = saved.getId();
        }
        row.setState(STATE_ACCEPTED);
        row.setSourceId(sourceId);
        row.setDecidedAt(Instant.now());
        row.setDecidedBy(actorName);
        return view(candidates.save(row), productName(orgId, row.getProductId()));
    }

    /** Not this — and deliberately not "never": the same sentence may be noticed again later. */
    @Transactional
    public KnowledgeCandidateView dismiss(UUID orgId, UUID candidateId, String actorName) {
        KnowledgeCandidate row = candidates.findByIdAndOrgId(candidateId, orgId)
                .orElseThrow(() -> ApiException.notFound("확인할 항목을 찾을 수 없습니다."));
        if (!STATE_OPEN.equals(row.getState())) {
            throw ApiException.conflict("이미 처리한 항목입니다.");
        }
        row.setState(STATE_DISMISSED);
        row.setDecidedAt(Instant.now());
        row.setDecidedBy(actorName);
        return view(candidates.save(row), productName(orgId, row.getProductId()));
    }

    /* ─────────────────────────────── internals ─────────────────────────────── */

    private KnowledgeCandidate file(UUID orgId, Repeat repeat) {
        String scope = repeat.productId == null ? "ORG" : "PRODUCT";
        String key = dedupeKey(scope, repeat.productId, repeat.sentence);
        if (candidates.findByOrgIdAndDedupeKeyAndState(orgId, key, STATE_OPEN).isPresent()) {
            return null;
        }
        KnowledgeCandidate row = new KnowledgeCandidate();
        row.setOrgId(orgId);
        row.setScope(scope);
        row.setProductId(repeat.productId);
        row.setSubject(bounded(repeat.sentence, 300));
        row.setContent(repeat.sentence);
        row.setOrigin(ORIGIN_REPEATED_ANSWER);
        row.setEvidenceCount(repeat.count);
        row.setDedupeKey(key);
        try {
            return candidates.save(row);
        } catch (DataIntegrityViolationException race) {
            return null;
        }
    }

    /**
     * Split an answer into sentences.
     *
     * <p>Korean sentence enders and newlines, and nothing cleverer: this is a counting aid, not an
     * analysis. A split that is slightly wrong produces a candidate the seller declines, which is the
     * cheap failure; a model that "understands" the answer produces one they cannot check.
     */
    static List<String> sentencesOf(String body) {
        if (body == null || body.isBlank()) {
            return List.of();
        }
        List<String> out = new ArrayList<>();
        for (String part : body.split("(?<=[.!?])\\s+|\\n+")) {
            String sentence = part.replaceAll("\\s+", " ").strip();
            if (sentence.length() >= MIN_SENTENCE_CHARS && sentence.length() <= MAX_SENTENCE_CHARS) {
                out.add(sentence);
            }
        }
        return out;
    }

    /** The identity of one candidate: scope, product and the normalized sentence, hashed to the column. */
    static String dedupeKey(String scope, UUID productId, String text) {
        String raw = scope + "|" + (productId == null ? "-" : productId) + "|" + KnowledgeText.normalize(text);
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(raw.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder(64);
            for (byte b : hash) {
                sb.append(Character.forDigit((b >> 4) & 0xF, 16)).append(Character.forDigit(b & 0xF, 16));
            }
            return sb.toString();
        } catch (Exception e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }

    private String productName(UUID orgId, UUID productId) {
        if (productId == null) {
            return null;
        }
        return products.findById(productId)
                .filter(p -> p.getOrgId().equals(orgId))
                .map(OperatorProductName::displayNameOrNull)
                .orElse(null);
    }

    private static KnowledgeCandidateView view(KnowledgeCandidate row, String productName) {
        return new KnowledgeCandidateView(row.getId(), row.getScope(), row.getProductId(), productName,
                row.getSubject(), row.getContent(), row.getOrigin(), row.getEvidenceCount(),
                row.getState(), row.getSourceId(), row.getCreatedAt());
    }

    private static String bounded(String text, int max) {
        String value = text == null ? "" : text.strip();
        return value.length() <= max ? value : value.substring(0, max);
    }

    /** One repeated sentence while it is being counted. */
    private static final class Repeat {
        private final String sentence;
        private int count;
        private UUID productId;
        private boolean productSettled;

        private Repeat(String sentence) {
            this.sentence = sentence;
        }

        /** The product survives only while every occurrence names the same one. */
        private void observe(UUID observed) {
            if (!productSettled) {
                productId = observed;
                productSettled = true;
                return;
            }
            if (productId != null && !productId.equals(observed)) {
                productId = null;
            }
        }
    }

    /** Test seam: how many candidates are waiting. */
    @Transactional(readOnly = true)
    public long openCount(UUID orgId) {
        return candidates.countByOrgIdAndState(orgId, STATE_OPEN);
    }
}
