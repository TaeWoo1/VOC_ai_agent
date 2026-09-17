package com.sellerops.knowledge.spine;

import com.sellerops.common.ApiException;
import com.sellerops.knowledge.KnowledgeRetriever;
import com.sellerops.knowledge.KnowledgeTopic;
import com.sellerops.knowledge.RetrievalOutcome;
import com.sellerops.knowledge.RetrievalQuery;
import com.sellerops.knowledge.spine.adapter.KnowledgeSourceAdapter;
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
 * <p><b>Not a replacement for the draft lanes.</b> Inquiry and review drafting keep their own retrieval
 * ({@code InquiryEvidenceRetriever}, {@code ReviewDraftComposer}) with its lane rules and payload floors, and this
 * class does not touch them. The spine is the read an operator surface or agent uses to ask "what does this
 * company know about this", across sources the draft lanes deliberately keep apart.
 *
 * <p><b>The same matcher, and nothing a vendor sees.</b> Matching is {@link KnowledgeRetriever}'s lexical scorer
 * over the same bounded question ladder, with the same topic applicability refusal. It calls no model: the
 * semantic lanes send the customer's question to a vendor and are a deployment decision per organisation, and a
 * new read path is not the place to widen that.
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

    private final List<KnowledgeSourceAdapter> adapters;
    private final ProductRepository products;
    private final SourceRefResolver resolver;
    private final Clock clock;

    @Autowired
    public KnowledgeSpineService(List<KnowledgeSourceAdapter> adapters, ProductRepository products,
                                 SourceRefResolver resolver) {
        this(adapters, products, resolver, Clock.systemUTC());
    }

    KnowledgeSpineService(List<KnowledgeSourceAdapter> adapters, ProductRepository products,
                          SourceRefResolver resolver, Clock clock) {
        this.adapters = List.copyOf(adapters);
        this.products = products;
        this.resolver = resolver;
        this.clock = clock;
    }

    /** Every entry in scope — ORG, plus the product's own when one is named — in authority order. */
    @Transactional(readOnly = true)
    public List<KnowledgeEntry> entries(UUID orgId, UUID productId) {
        return corpus(orgId, requireProduct(orgId, productId)).stream()
                .map(KnowledgeSourceAdapter.Indexed::entry)
                .toList();
    }

    @Transactional(readOnly = true)
    public KnowledgeSpineSearchResponse search(UUID orgId, UUID productId, String query, int limit) {
        if (query == null || query.isBlank()) {
            throw ApiException.badRequest("찾을 내용을 입력해 주세요.");
        }
        Product product = requireProduct(orgId, productId);
        List<KnowledgeSourceAdapter.Indexed> corpus = corpus(orgId, product);
        List<KnowledgeRetriever.Candidate<KnowledgeSourceAdapter.Indexed>> candidates = corpus.stream()
                .map(i -> new KnowledgeRetriever.Candidate<>(i, i.searchable()))
                .toList();
        RetrievalQuery question = RetrievalQuery.ofText(query);
        Set<KnowledgeTopic> asked = KnowledgeTopic.of(question.text());
        String productName = OperatorProductName.displayNameOrNull(product);

        List<KnowledgeSpineSearchResponse.Hit> hits = List.of();
        String matchedBy = question.full();
        int rejected = 0;
        for (RetrievalQuery.Candidate form : question.candidates()) {
            List<KnowledgeSpineSearchResponse.Hit> found = new ArrayList<>();
            for (KnowledgeRetriever.Hit<KnowledgeSourceAdapter.Indexed> hit
                    : KnowledgeRetriever.rank(form.text(), candidates, productName)) {
                KnowledgeEntry entry = hit.ref().entry();
                // Refusal only: an entry whose title declares a different topic does not answer this one.
                if (!KnowledgeTopic.applicable(asked, KnowledgeTopic.of(entry.title()))) {
                    rejected++;
                    continue;
                }
                found.add(new KnowledgeSpineSearchResponse.Hit(entry, Math.round(hit.coverage() * 1000) / 1000.0));
            }
            if (!found.isEmpty()) {
                hits = found;
                matchedBy = form.text();
                break;
            }
        }
        int cap = Math.max(1, Math.min(limit <= 0 ? DEFAULT_LIMIT : limit, MAX_LIMIT));
        List<KnowledgeSpineSearchResponse.Hit> ranked = hits.stream()
                .sorted(Comparator.comparingDouble(KnowledgeSpineSearchResponse.Hit::score).reversed()
                        .thenComparing(KnowledgeSpineSearchResponse.Hit::entry, AUTHORITY_ORDER))
                .limit(cap)
                .toList();
        RetrievalOutcome outcome = corpus.isEmpty() ? RetrievalOutcome.ABSENT
                : !ranked.isEmpty() ? RetrievalOutcome.FOUND
                : rejected > 0 ? RetrievalOutcome.NOT_APPLICABLE
                : RetrievalOutcome.NO_RELEVANT_EVIDENCE;
        return new KnowledgeSpineSearchResponse(query, matchedBy, productId, corpus.size(), outcome, ranked);
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
        List<KnowledgeEntry> entries = corpus(orgId, product).stream()
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

    private List<KnowledgeSourceAdapter.Indexed> corpus(UUID orgId, Product product) {
        UUID productId = product == null ? null : product.getId();
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
