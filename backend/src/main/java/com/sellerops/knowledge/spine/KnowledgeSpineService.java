package com.sellerops.knowledge.spine;

import com.sellerops.common.ApiException;
import com.sellerops.knowledge.KnowledgeRetriever;
import com.sellerops.knowledge.KnowledgeTopic;
import com.sellerops.knowledge.RetrievalOutcome;
import com.sellerops.knowledge.RetrievalQuery;
import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.draft.InquiryEvidenceRetriever;
import com.sellerops.knowledge.spine.adapter.KnowledgeSourceAdapter;
import com.sellerops.knowledge.spine.adapter.ProductFactAdapter;
import com.sellerops.knowledge.spine.adapter.SellerKnowledgeAdapter;
import com.sellerops.order.fact.OrderFactLookup;
import com.sellerops.product.library.KnowledgeVariantScope;
import com.sellerops.knowledge.spine.dto.CompiledKnowledgeView;
import com.sellerops.knowledge.spine.dto.KnowledgeSpineSearchResponse;
import com.sellerops.knowledge.spine.dto.KnowledgeTraceView;
import com.sellerops.product.OperatorProductName;
import com.sellerops.product.Product;
import com.sellerops.product.ProductRepository;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.EnumSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * <b>Knowledge Spine v1 — every trace of the seller's operation, read as one scoped, attributed body of company
 * knowledge.</b>
 *
 * <p><b>Raw source is the source of truth; everything here is a view.</b> The spine owns no table. Each
 * {@link KnowledgeSourceAdapter} reads rows another package already writes — the seller's policies and product
 * notes, the channel's product detail, Answer Memory, approved review replies, the seller's review decisions —
 * and states each as a {@link KnowledgeEntry} with its scope, authority, freshness, provenance and the refs back
 * to its rows. Nothing is copied, so nothing goes stale and there is no second place to correct.
 *
 * <p><b>The one retrieval (Knowledge &amp; Intelligence Closure v1).</b> {@link #retrieveForInquiry} and
 * {@link #retrieveForProduct} are what the case investigator, the inquiry draft and the review draft all read, so the
 * three cannot disagree about what the company knows because they asked different code. The grounding lanes are
 * {@link InquiryEvidenceRetriever}'s — its scorer, semantic lane when an org has it, applicability refusals, current-
 * over-historical merge — unchanged; the spine attributes every passage (authority, provenance, freshness, refs),
 * adds the seller-confirmed context those lanes never carried (guidance, review decisions, approved review replies,
 * channel attributes) and resolves conflicting figures toward the higher authority ({@link KnowledgeConflict}).
 * The earlier parallel lexical search over the whole corpus is gone.
 *
 * <p><b>Scope is a fence, not a filter preference.</b> A product that does not belong to the caller's organisation
 * is a 404 before any adapter runs; every adapter reads with the organisation in its predicate; and a product
 * query sees ORG entries and that product's entries, never another product's.
 */
@Service
public class KnowledgeSpineService {

    static final int DEFAULT_LIMIT = 8;
    static final int MAX_LIMIT = 20;
    /** Claims shown per compiled section. The rest are counted, not dropped silently. */
    static final int CLAIMS_PER_SECTION = 3;
    static final int EXCERPT_CHARS = 200;

    private static final Set<SpineSourceType> DECISIONS =
            EnumSet.of(SpineSourceType.REVIEW_DECISION, SpineSourceType.TRIAGE_CORRECTION);
    private static final Set<SpineSourceType> PAST_ANSWERS =
            EnumSet.of(SpineSourceType.INQUIRY_ANSWER, SpineSourceType.REVIEW_REPLY);

    /** Authority first, then the freshest, then a stable id — a compiled view that reorders itself is not evidence. */
    static final Comparator<KnowledgeEntry> AUTHORITY_ORDER = Comparator
            .comparingInt((KnowledgeEntry e) -> e.authority().rank())
            .thenComparing(KnowledgeEntry::capturedAt, Comparator.nullsLast(Comparator.reverseOrder()))
            .thenComparing(KnowledgeEntry::entryId);

    /** Context entries per question. Context informs; it is not a second evidence window. */
    static final int MAX_CONTEXT = 4;

    private static final Set<SpineSourceType> CONTEXT_TYPES = EnumSet.of(SpineSourceType.SELLER_GUIDANCE,
            SpineSourceType.REVIEW_DECISION, SpineSourceType.TRIAGE_CORRECTION, SpineSourceType.REVIEW_REPLY,
            SpineSourceType.PRODUCT_FACT);

    private final List<KnowledgeSourceAdapter> adapters;
    private final ProductRepository products;
    private final SourceRefResolver resolver;
    private final InquiryEvidenceRetriever retriever;
    private final Clock clock;

    @Autowired
    public KnowledgeSpineService(List<KnowledgeSourceAdapter> adapters, ProductRepository products,
                                 SourceRefResolver resolver, InquiryEvidenceRetriever retriever) {
        this(adapters, products, resolver, retriever, Clock.systemUTC());
    }

    public KnowledgeSpineService(List<KnowledgeSourceAdapter> adapters, ProductRepository products,
                                 SourceRefResolver resolver, InquiryEvidenceRetriever retriever, Clock clock) {
        this.adapters = List.copyOf(adapters);
        this.products = products;
        this.resolver = resolver;
        this.retriever = retriever;
        this.clock = clock;
    }

    /** Every entry in scope — ORG, plus the product's own when one is named — in authority order. */
    @Transactional(readOnly = true)
    public List<KnowledgeEntry> entries(UUID orgId, UUID productId) {
        requireProduct(orgId, productId);
        return corpus(orgId, productId).stream()
                .map(KnowledgeSourceAdapter.Indexed::entry)
                .toList();
    }

    /**
     * The REST read: one scoped search over every source, through the same retrieval the drafts and the investigator
     * use. There is no second scorer here — the lanes are {@link InquiryEvidenceRetriever}'s, and the context entries
     * are matched by the same lexical scorer, question ladder and topic refusal.
     */
    @Transactional(readOnly = true)
    public KnowledgeSpineSearchResponse search(UUID orgId, UUID productId, String query, int limit) {
        if (query == null || query.isBlank()) {
            throw ApiException.badRequest("찾을 내용을 입력해 주세요.");
        }
        requireProduct(orgId, productId);
        RetrievalQuery question = RetrievalQuery.ofText(query);
        SpineRetrieval found = retrieveForProduct(orgId, productId, question, KnowledgeVariantScope.unresolved());
        int cap = Math.max(1, Math.min(limit <= 0 ? DEFAULT_LIMIT : limit, MAX_LIMIT));
        Map<String, Double> scores = new LinkedHashMap<>();
        for (InquiryEvidenceRetriever.ScopedPassage p : found.lanes().passages()) {
            scores.put(unitKey(p), p.score());
        }
        List<KnowledgeSpineSearchResponse.Hit> hits = found.all().stream()
                .limit(cap)
                .map(e -> new KnowledgeSpineSearchResponse.Hit(e, scores.getOrDefault(unitOf(e.entryId()), 0.0)))
                .toList();
        RetrievalOutcome outcome = !hits.isEmpty() ? RetrievalOutcome.FOUND
                : found.lanes().productOutcome() == RetrievalOutcome.ABSENT
                        && found.lanes().policyOutcome() == RetrievalOutcome.ABSENT
                        && corpus(orgId, productId).isEmpty() ? RetrievalOutcome.ABSENT
                : found.lanes().policyOutcome() == RetrievalOutcome.NOT_APPLICABLE ? RetrievalOutcome.NOT_APPLICABLE
                : RetrievalOutcome.NO_RELEVANT_EVIDENCE;
        return new KnowledgeSpineSearchResponse(query, question.full(), productId,
                corpus(orgId, productId).size(), outcome, hits, found.conflicts());
    }

    /** The retrieval for one inquiry: its product, its 규격 scope, its order fact reach — the draft path's question. */
    @Transactional(readOnly = true)
    public SpineRetrieval retrieveForInquiry(UUID orgId, Inquiry inquiry, RetrievalQuery question,
                                             OrderFactLookup lookup, KnowledgeVariantScope scope) {
        InquiryEvidenceRetriever.InquiryEvidence lanes = retriever.retrieve(orgId, inquiry, question, lookup, scope);
        return assemble(orgId, lanes, question);
    }

    /** The retrieval for a question about a product that is not an inquiry — a review, or a seller's search. */
    @Transactional(readOnly = true)
    public SpineRetrieval retrieveForProduct(UUID orgId, UUID productId, RetrievalQuery question,
                                             KnowledgeVariantScope scope) {
        InquiryEvidenceRetriever.InquiryEvidence lanes = retriever.retrieveFor(orgId, productId, question, scope);
        return assemble(orgId, lanes, question);
    }

    private SpineRetrieval assemble(UUID orgId, InquiryEvidenceRetriever.InquiryEvidence lanes,
                                    RetrievalQuery question) {
        UUID productId = lanes.productId();
        List<KnowledgeSourceAdapter.Indexed> corpus = corpus(orgId, productId);
        Map<String, KnowledgeEntry> byUnit = new LinkedHashMap<>();
        for (KnowledgeSourceAdapter.Indexed indexed : corpus) {
            byUnit.put(unitOf(indexed.entry().entryId()), indexed.entry());
        }
        Map<InquiryEvidenceRetriever.ScopedPassage, KnowledgeEntry> evidence = new LinkedHashMap<>();
        for (InquiryEvidenceRetriever.ScopedPassage passage : lanes.passages()) {
            evidence.put(passage, byUnit.getOrDefault(unitKey(passage), entryOf(passage, productId)));
        }
        Set<String> used = new java.util.HashSet<>();
        evidence.values().forEach(e -> used.add(e.entryId()));

        List<KnowledgeSourceAdapter.Indexed> candidates = corpus.stream()
                .filter(i -> CONTEXT_TYPES.contains(i.entry().sourceType()))
                .filter(i -> i.entry().sourceType() != SpineSourceType.PRODUCT_FACT
                        || ProductFactAdapter.isAttribute(i.entry()))
                .filter(i -> !used.contains(i.entry().entryId()))
                .toList();
        List<KnowledgeEntry> context = matchContext(candidates, question,
                productId == null || products == null ? null : products.findById(productId)
                        .map(OperatorProductName::displayNameOrNull).orElse(null));

        List<KnowledgeEntry> all = new ArrayList<>(evidence.values());
        all.addAll(context);
        List<KnowledgeConflict> conflicts = KnowledgeConflict.detect(all);
        Set<String> losers = new java.util.HashSet<>();
        conflicts.forEach(c -> losers.add(c.loserEntryId()));

        List<InquiryEvidenceRetriever.ScopedPassage> kept = new ArrayList<>();
        for (Map.Entry<InquiryEvidenceRetriever.ScopedPassage, KnowledgeEntry> e : evidence.entrySet()) {
            if (!losers.contains(e.getValue().entryId())) {
                kept.add(e.getKey());
            }
        }
        // Conservative: a conflict never takes away the only current basis. The figure is not trusted — the
        // conflict is shown — but grounding that existed before the check still exists after it.
        if (kept.stream().noneMatch(p -> p.scope().current())
                && lanes.passages().stream().anyMatch(p -> p.scope().current())) {
            kept = new ArrayList<>(lanes.passages());
        }
        InquiryEvidenceRetriever.InquiryEvidence resolved = kept.size() == lanes.passages().size() ? lanes
                : new InquiryEvidenceRetriever.InquiryEvidence(lanes.productId(), lanes.state(), List.copyOf(kept),
                        lanes.order(), lanes.supersededMemories(), lanes.productOutcome(), lanes.policyOutcome(),
                        lanes.policyTopicsDeclared());
        List<KnowledgeEntry> keptEvidence = new ArrayList<>();
        for (InquiryEvidenceRetriever.ScopedPassage passage : resolved.passages()) {
            keptEvidence.add(evidence.get(passage));
        }
        List<KnowledgeEntry> keptContext = context.stream().filter(e -> !losers.contains(e.entryId())).toList();
        return new SpineRetrieval(resolved, keptEvidence, keptContext, conflicts);
    }

    /** Context entries that cover the question, best first, at most {@link #MAX_CONTEXT}. */
    private static List<KnowledgeEntry> matchContext(List<KnowledgeSourceAdapter.Indexed> candidates,
                                                     RetrievalQuery question, String productName) {
        if (candidates.isEmpty()) {
            return List.of();
        }
        List<KnowledgeRetriever.Candidate<KnowledgeSourceAdapter.Indexed>> scored = candidates.stream()
                .map(i -> new KnowledgeRetriever.Candidate<>(i, i.searchable()))
                .toList();
        Set<KnowledgeTopic> asked = KnowledgeTopic.of(question.text());
        for (RetrievalQuery.Candidate form : question.candidates()) {
            List<KnowledgeRetriever.Hit<KnowledgeSourceAdapter.Indexed>> hits =
                    KnowledgeRetriever.rank(form.text(), scored, productName).stream()
                            .filter(h -> KnowledgeTopic.applicable(asked, KnowledgeTopic.of(h.ref().entry().title())))
                            .toList();
            if (!hits.isEmpty()) {
                return hits.stream()
                        .sorted(Comparator.comparingDouble(
                                        (KnowledgeRetriever.Hit<KnowledgeSourceAdapter.Indexed> h) -> -h.coverage())
                                .thenComparing(h -> h.ref().entry(), AUTHORITY_ORDER))
                        .limit(MAX_CONTEXT)
                        .map(h -> h.ref().entry())
                        .toList();
            }
        }
        return List.of();
    }

    /** The id of the citable unit an entry id names — the part after the source type. */
    static String unitOf(String entryId) {
        int at = entryId == null ? -1 : entryId.indexOf(':');
        return at < 0 ? String.valueOf(entryId) : entryId.substring(at + 1);
    }

    private static String unitKey(InquiryEvidenceRetriever.ScopedPassage passage) {
        return String.valueOf(passage.chunkId() != null ? passage.chunkId() : passage.sourceId());
    }

    /** A passage the corpus did not list (a row written between the two reads): attributed from the passage alone. */
    private static KnowledgeEntry entryOf(InquiryEvidenceRetriever.ScopedPassage p, UUID productId) {
        return switch (p.scope()) {
            case PRODUCT -> new KnowledgeEntry(SellerKnowledgeAdapter.typeOf(p.authoredOrigin()) + ":" + p.chunkId(),
                    SellerKnowledgeAdapter.typeOf(p.authoredOrigin()), KnowledgeSpineScope.PRODUCT, productId, null,
                    SellerKnowledgeAdapter.authorityOf(p.authoredOrigin()), p.heading(), p.text(), null,
                    "상품 지식", List.of(SourceRef.of(SourceRef.Kind.PRODUCT_KNOWLEDGE_SOURCE, p.sourceId()),
                            SourceRef.of(SourceRef.Kind.PRODUCT_KNOWLEDGE_CHUNK, p.chunkId())));
            case ORG_OPERATIONS -> new KnowledgeEntry(SpineSourceType.ORG_KNOWLEDGE + ":" + p.chunkId(),
                    SpineSourceType.ORG_KNOWLEDGE, KnowledgeSpineScope.ORG, null, null, KnowledgeAuthority.SELLER_POLICY,
                    p.heading(), p.text(), null, "판매자가 등록한 운영 기준",
                    List.of(SourceRef.of(SourceRef.Kind.ORG_KNOWLEDGE_SOURCE, p.sourceId()),
                            SourceRef.of(SourceRef.Kind.ORG_KNOWLEDGE_CHUNK, p.chunkId())));
            default -> new KnowledgeEntry(SpineSourceType.INQUIRY_ANSWER + ":" + p.sourceId(),
                    SpineSourceType.INQUIRY_ANSWER, KnowledgeSpineScope.ORG, null, null,
                    KnowledgeAuthority.PAST_SELLER_ANSWER, p.heading(), p.text(), null, "과거 문의 답변",
                    List.of(SourceRef.of(SourceRef.Kind.ANSWER_MEMORY, p.sourceId())));
        };
    }

    /**
     * The compiled read: entries grouped by what they are about, each group led by its highest authority.
     *
     * <p>Grouping is deterministic — a declared {@link KnowledgeTopic} when the entry names exactly one it can be
     * placed under, otherwise the family of its source. No model reads or rewrites anything.
     */
    @Transactional(readOnly = true)
    public CompiledKnowledgeView compiled(UUID orgId, UUID productId) {
        Product product = requireProduct(orgId, productId);
        List<KnowledgeEntry> entries = corpus(orgId, productId).stream()
                .map(KnowledgeSourceAdapter.Indexed::entry)
                .sorted(AUTHORITY_ORDER)
                .toList();
        Map<String, List<KnowledgeEntry>> grouped = new LinkedHashMap<>();
        Map<String, String> labels = new LinkedHashMap<>();
        for (KnowledgeEntry entry : entries) {
            String[] section = sectionOf(entry);
            grouped.computeIfAbsent(section[0], k -> new ArrayList<>()).add(entry);
            labels.putIfAbsent(section[0], section[1]);
        }
        List<CompiledKnowledgeView.Section> sections = grouped.entrySet().stream()
                .map(e -> new CompiledKnowledgeView.Section(e.getKey(), labels.get(e.getKey()),
                        e.getValue().get(0).authority(), e.getValue().size(),
                        e.getValue().stream().limit(CLAIMS_PER_SECTION).map(KnowledgeSpineService::claim).toList()))
                .sorted(Comparator.comparingInt((CompiledKnowledgeView.Section s) -> s.governingAuthority().rank())
                        .thenComparing(CompiledKnowledgeView.Section::key))
                .toList();
        Instant newest = entries.stream().map(KnowledgeEntry::capturedAt).filter(Objects::nonNull)
                .max(Comparator.naturalOrder()).orElse(null);
        return new CompiledKnowledgeView(productId, OperatorProductName.displayNameOrNull(product),
                KnowledgeAuthority.COMPILED_KNOWLEDGE, clock.instant(), entries.size(), newest, sections);
    }

    /** One entry, re-read from its raw source, with each ref followed back to its row. */
    @Transactional(readOnly = true)
    public KnowledgeTraceView trace(UUID orgId, UUID productId, String entryId) {
        KnowledgeEntry entry = entries(orgId, productId).stream()
                .filter(e -> e.entryId().equals(entryId))
                .findFirst()
                .orElseThrow(() -> ApiException.notFound("해당 지식 항목을 찾을 수 없습니다."));
        return new KnowledgeTraceView(entry, entry.sourceRefs().stream()
                .map(ref -> new KnowledgeTraceView.ResolvedRef(ref, resolver.resolves(orgId, ref)))
                .toList());
    }

    private List<KnowledgeSourceAdapter.Indexed> corpus(UUID orgId, UUID productId) {
        List<KnowledgeSourceAdapter.Indexed> all = new ArrayList<>();
        for (KnowledgeSourceAdapter adapter : adapters) {
            for (KnowledgeSourceAdapter.Indexed indexed : adapter.read(orgId, productId)) {
                KnowledgeEntry entry = indexed.entry();
                // The fence, restated where every adapter's output meets: nothing bound to another product.
                if (entry.scope() == KnowledgeSpineScope.PRODUCT
                        && (productId == null || !productId.equals(entry.productId()))) {
                    continue;
                }
                all.add(indexed);
            }
        }
        all.sort(Comparator.comparing(KnowledgeSourceAdapter.Indexed::entry, AUTHORITY_ORDER));
        return all;
    }

    private Product requireProduct(UUID orgId, UUID productId) {
        if (productId == null) {
            return null;
        }
        return products.findById(productId)
                .filter(p -> orgId.equals(p.getOrgId()))
                .orElseThrow(() -> ApiException.notFound("상품을 찾을 수 없습니다."));
    }

    private static String[] sectionOf(KnowledgeEntry entry) {
        if (DECISIONS.contains(entry.sourceType())) {
            return new String[] {"DECISIONS", "판매자 판단"};
        }
        Set<KnowledgeTopic> topics = KnowledgeTopic.of(entry.title() + " " + entry.text());
        if (topics.size() == 1) {
            KnowledgeTopic topic = topics.iterator().next();
            return new String[] {"TOPIC_" + topic.name(), topic.labelKo()};
        }
        if (PAST_ANSWERS.contains(entry.sourceType())) {
            return new String[] {"PAST_ANSWERS", "과거 답변"};
        }
        if (entry.sourceType() == SpineSourceType.ORG_KNOWLEDGE) {
            return new String[] {"POLICY", "운영 기준"};
        }
        return new String[] {"PRODUCT", "상품 정보"};
    }

    private static CompiledKnowledgeView.Claim claim(KnowledgeEntry e) {
        String flat = e.text() == null ? "" : e.text().replaceAll("\\s+", " ").strip();
        String excerpt = flat.length() > EXCERPT_CHARS ? flat.substring(0, EXCERPT_CHARS) + "…" : flat;
        return new CompiledKnowledgeView.Claim(e.entryId(), e.sourceType(), e.scope(), e.authority(), e.title(),
                excerpt, e.capturedAt(), e.provenance(), e.sourceRefs());
    }
}
