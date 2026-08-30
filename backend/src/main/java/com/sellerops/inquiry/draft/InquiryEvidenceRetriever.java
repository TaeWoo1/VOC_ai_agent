package com.sellerops.inquiry.draft;

import com.sellerops.common.MarkupText;
import com.sellerops.inquiry.Inquiry;
import com.sellerops.knowledge.RetrievalOutcome;
import com.sellerops.knowledge.RetrievalQuery;
import com.sellerops.knowledge.KnowledgeScope;
import com.sellerops.knowledge.KnowledgeTopic;
import com.sellerops.knowledge.memory.AnswerMemoryService;
import com.sellerops.knowledge.memory.dto.AnswerMemoryPassage;
import com.sellerops.knowledge.memory.dto.AnswerMemorySearchResponse;
import com.sellerops.knowledge.org.SellerOperationsKnowledgeService;
import com.sellerops.knowledge.org.dto.OrgKnowledgePassage;
import com.sellerops.knowledge.org.dto.OrgKnowledgeSearchResponse;
import com.sellerops.order.fact.OrderFact;
import com.sellerops.order.fact.OrderFactLookup;
import com.sellerops.product.OperatorProductName;
import com.sellerops.product.library.KnowledgeAuthorship;
import com.sellerops.product.Product;
import com.sellerops.product.ProductRepository;
import com.sellerops.product.library.KnowledgeVariantScope;
import com.sellerops.product.library.ProductKnowledgeLibraryService;
import com.sellerops.product.library.dto.KnowledgePassage;
import com.sellerops.product.library.dto.KnowledgeSearchResponse;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Component;

/**
 * Everything a reply may be grounded in, gathered once, with each source kept apart from the others.
 *
 * <p><b>The order of evidence is not a ranking of sources.</b> A question is answered by whichever
 * evidence proves the claim it asks for: "폭이 몇 mm인가요?" is proved by the product's own notes and
 * by nothing else; "현금영수증 발급 가능한가요?" is proved by the company's operating policy and never
 * by a product; "예전에 어떻게 안내하셨죠?" is proved by what the seller actually answered. Deciding in
 * advance that one lane outranks another would answer the first question with a shipping policy
 * whenever the product library happened to be thin, which is exactly the failure the retrieval
 * redesign closed on 2026-08-24. So every lane runs, every lane is scored by the same scorer, and the
 * merge is by score.
 *
 * <p><b>With one structural exception: each CURRENT lane that produced anything keeps its best
 * passage.</b> A mixed question — "이 상품 반품하려면 어떻게 하나요?" — needs the product AND the
 * policy, and a pure top-N by score answers it with whichever lane is wordier. Reserving one slot per
 * lane is not a priority claim; it is the statement that a lane which can speak to the question should
 * be heard once before another lane is heard twice. Product and policy remain exact peers under it.
 *
 * <p><b>The one precedence that IS declared: current evidence outranks a past answer</b>
 * (product-owner, 2026-08-26). {@link KnowledgeScope#current()} splits the lanes in two, and the split
 * is not about relevance — it is about what the two kinds of passage claim. The product's notes and
 * the company's policy say what is true now, and each is corrected when it goes wrong. A past answer
 * says only that this sentence was once sent; {@code EXECUTOR_SENT_VERIFIED} proves it reached the
 * marketplace, not that it was right. It may have been written under a policy that has since changed.
 * So the historical lane gets <b>no reserved slot, at most one passage, and last position</b>, and —
 * the part that actually matters — a past answer <b>alone</b> never makes a draft
 * {@link DraftKnowledgeState#GROUNDED}. Before this, a memory-only match told the seller
 * 「판매자가 등록한 과거 답변을 근거로 썼습니다」 over a draft with no current basis for a single fact
 * in it.
 *
 * <p>This is NOT the lane ranking the 2026-08-24 redesign closed. That one would have decided in
 * advance that a product beats a policy; this one leaves those two equal and separates «what is true»
 * from «what was said». Nothing here suppresses a past answer — it is still retrieved, still shown,
 * and still the right thing to imitate for tone. It just stops being an authority on a current fact.
 *
 * <p><b>A missing product does not end the search.</b> Most of the Cafe24 backlog resolves to no
 * product, and the questions in it — 세금계산서, 현금영수증, 배송 — are org-level. The product lane is
 * simply absent for those, and the draft is still grounded.
 *
 * <p><b>Two scopes are read, not searched.</b> {@link KnowledgeScope#ORDER_STATE} comes from
 * {@link InquiryOrderFactReader} — a deterministic exact join against the order the CHANNEL named,
 * carrying its own freshness — and {@link KnowledgeScope#CHANNEL_FACT} is not consulted here at all:
 * what a platform supports is an operational capability, not something to tell a customer in a reply.
 */
@Component
public class InquiryEvidenceRetriever {

    /**
     * How many passages reach the drafter.
     *
     * <p>Four, for three lanes. It was three when there was one lane; adding two lanes without adding
     * a slot would have meant a product question losing its product passage to a policy. It is not
     * three per lane: a drafter handed nine passages writes an essay that quotes all of them.
     */
    public static final int MAX_PASSAGES = 4;

    /**
     * How much of the question is used as the retrieval query.
     *
     * <p>The Cafe24 backlog contains forwarded mail threads running to thousands of characters, where
     * the actual question is the first line and the rest is quoted history. A whole thread as a query
     * dilutes every term. The title plus the head of the body is where the question is.
     */
    static final int QUERY_CHARS = 400;

    private final ProductRepository products;
    private final ProductKnowledgeLibraryService productKnowledge;
    private final SellerOperationsKnowledgeService orgKnowledge;
    private final AnswerMemoryService answerMemory;
    private final InquiryOrderFactReader orderFacts;

    public InquiryEvidenceRetriever(ProductRepository products,
                                    ProductKnowledgeLibraryService productKnowledge,
                                    SellerOperationsKnowledgeService orgKnowledge,
                                    AnswerMemoryService answerMemory,
                                    InquiryOrderFactReader orderFacts) {
        this.products = products;
        this.productKnowledge = productKnowledge;
        this.orgKnowledge = orgKnowledge;
        this.answerMemory = answerMemory;
        this.orderFacts = orderFacts;
    }

    /**
     * One passage offered as grounding, carrying the scope it came from.
     *
     * <p>The scope is not decoration. It is what a seller reads above the quote ("상품 정보" /
     * "운영 정책" / "과거 답변") and what makes a wrong answer fixable: a wrong spec is fixed in the
     * product library, a wrong shipping promise in the operating policy, and neither fix reaches the
     * other.
     */
    public record ScopedPassage(KnowledgeScope scope, String heading, String text, UUID sourceId,
                                UUID chunkId, String locator, double score,
                                KnowledgeAuthorship authoredOrigin, String variantName) {

        /**
         * The shape every lane but the product one uses. A policy and a past answer are written by a
         * person at this company, which is what the default says — there is no picture behind either
         * — and neither is written about one 규격, which is what the null says.
         */
        public ScopedPassage(KnowledgeScope scope, String heading, String text, UUID sourceId,
                             UUID chunkId, String locator, double score) {
            this(scope, heading, text, sourceId, chunkId, locator, score,
                    KnowledgeAuthorship.SELLER_ENTERED_KNOWLEDGE, null);
        }

        public ScopedPassage(KnowledgeScope scope, String heading, String text, UUID sourceId,
                             UUID chunkId, String locator, double score,
                             KnowledgeAuthorship authoredOrigin) {
            this(scope, heading, text, sourceId, chunkId, locator, score, authoredOrigin, null);
        }

        /** Whether this sentence was written about ONE 규격 rather than the whole listing. */
        public boolean variantSpecific() {
            return variantName != null;
        }

        /** May a figure in this passage close a sentence on its own? False for the image lane. */
        public boolean figuresUnaided() {
            return authoredOrigin == null || authoredOrigin.carriesExactFiguresUnaided();
        }
    }

    /**
     * What could be found for one inquiry.
     *
     * @param state               the PRODUCT lane's verdict, kept as the closed vocabulary the draft
     *                            row already stores. {@code GROUNDED} means at least one passage of
     *                            ANY scope was found.
     * @param supersededMemories  past answers that matched but were suppressed by a stronger or newer
     *                            answer on the same topic
     */
    public record InquiryEvidence(UUID productId, DraftKnowledgeState state,
                                  List<ScopedPassage> passages,
                                  OrderFact order,
                                  int supersededMemories,
                                  RetrievalOutcome productOutcome,
                                  RetrievalOutcome policyOutcome,
                                  List<KnowledgeTopic> policyTopicsDeclared) {

        public InquiryEvidence(UUID productId, DraftKnowledgeState state, List<ScopedPassage> passages,
                               OrderFact order, int supersededMemories,
                               RetrievalOutcome productOutcome, RetrievalOutcome policyOutcome) {
            this(productId, state, passages, order, supersededMemories, productOutcome, policyOutcome, List.of());
        }

        /** Whether the company registered ANY rule about this topic — the 「기준 없음」 fact per topic. */
        public boolean policyDeclares(KnowledgeTopic topic) {
            return topic != null && policyTopicsDeclared != null && policyTopicsDeclared.contains(topic);
        }

        /** The pre-outcome shape: lanes described only by the state and the passages. */
        public InquiryEvidence(UUID productId, DraftKnowledgeState state, List<ScopedPassage> passages,
                               OrderFact order, int supersededMemories) {
            this(productId, state, passages, order, supersededMemories,
                    productId == null ? RetrievalOutcome.ABSENT
                            : state == DraftKnowledgeState.NO_LIBRARY ? RetrievalOutcome.ABSENT
                            : passages.stream().anyMatch(p -> p.scope() == KnowledgeScope.PRODUCT)
                                    ? RetrievalOutcome.FOUND : RetrievalOutcome.NO_RELEVANT_EVIDENCE,
                    passages.stream().anyMatch(p -> p.scope() == KnowledgeScope.ORG_OPERATIONS)
                            ? RetrievalOutcome.FOUND : RetrievalOutcome.ABSENT);
        }

        /** The scopes that actually contributed, in the order the passages are in. */
        public Set<KnowledgeScope> scopes() {
            Set<KnowledgeScope> used = new LinkedHashSet<>();
            passages.forEach(p -> used.add(p.scope()));
            return used;
        }

        /**
         * May the figures in this evidence close a sentence unaided?
         *
         * <p>False as soon as ONE current passage came out of a picture — not a majority, not the
         * top-scoring one. The drafter is shown all of them at once and cannot be told "trust the
         * numbers in the second bullet but not the third", so the caution applies to the set.
         *
         * <p>Only CURRENT passages are considered. A past answer is already barred from being a
         * source of fact, so its authorship changes nothing here.
         */
        public boolean figuresUnaided() {
            return passages.stream().filter(p -> p.scope().current())
                    .allMatch(ScopedPassage::figuresUnaided);
        }

        /**
         * Is any of this evidence written about one 규격 in particular?
         *
         * <p>True as soon as ONE passage is, for the reason {@link #figuresUnaided()} gives: the
         * drafter reads them together and cannot be told which bullet the caution applies to.
         */
        public boolean variantSpecific() {
            return passages.stream().anyMatch(ScopedPassage::variantSpecific);
        }
    }

    /**
     * Gather the evidence for one inquiry, for a draft that is about to be written.
     *
     * <p>Spends no model call. Reaches a channel at most once, and only for the ORDER lane: a
     * grounded sentence about an order's state has to be about the state now, so the order fact is
     * allowed one bounded exact read — see {@link OrderFactLookup}. The three retrieval lanes reach
     * nothing but this database.
     */
    public InquiryEvidence retrieve(UUID orgId, Inquiry inquiry) {
        return retrieve(orgId, inquiry, KnowledgeVariantScope.unresolved());
    }

    /** The same gather, restricted to the 규격 the caller resolved from the customer's own words. */
    public InquiryEvidence retrieve(UUID orgId, Inquiry inquiry, KnowledgeVariantScope scope) {
        String title = MarkupText.toPlainText(inquiry.getTitle());
        String details = MarkupText.toPlainText(inquiry.getBody());
        // The question in its bounded forms — title, subject, whole — never one glued string
        // (Retrieval & Grounding Correctness v1): the absence gate judges each form on its own.
        return retrieve(orgId, inquiry, RetrievalQuery.of(null, title, details),
                OrderFactLookup.EXACT_ALLOWED, scope);
    }

    /**
     * The canonical product this inquiry resolves to, or null.
     *
     * <p>Exposed because the 규격 has to be resolved BEFORE the retrieval it scopes, and resolving a
     * 규격 means reading this product's options. A caller that guessed the product id from
     * {@code inquiry.getProductId()} would skip the shared-bucket check this applies.
     */
    public UUID resolveProductId(UUID orgId, Inquiry inquiry) {
        return inquiry == null ? null : namedProductOrNull(orgId, inquiry.getProductId());
    }

    /**
     * The same gather, with the query already built — used by the audit that measures coverage.
     *
     * <p>Stored facts only. The audit classifies thousands of rows in one pass and none of them is a
     * seller waiting for an answer; letting it resolve order facts the way a screen does would turn
     * one coverage report into one marketplace request per bound inquiry.
     */
    public InquiryEvidence retrieve(UUID orgId, Inquiry inquiry, String query) {
        return retrieve(orgId, inquiry, query, OrderFactLookup.STORED_ONLY);
    }

    /** The gather, with the caller stating how far it may go for the order fact. */
    public InquiryEvidence retrieve(UUID orgId, Inquiry inquiry, String query, OrderFactLookup lookup) {
        return retrieve(orgId, inquiry, query, lookup, KnowledgeVariantScope.unresolved());
    }

    /** The gather, with both the order-fact reach and the 규격 scope stated by the caller. */
    public InquiryEvidence retrieve(UUID orgId, Inquiry inquiry, String query, OrderFactLookup lookup,
                                    KnowledgeVariantScope scope) {
        return retrieve(orgId, inquiry, RetrievalQuery.ofText(query), lookup, scope);
    }

    /** The gather, over the question's bounded candidates. */
    public InquiryEvidence retrieve(UUID orgId, Inquiry inquiry, RetrievalQuery question,
                                    OrderFactLookup lookup, KnowledgeVariantScope scope) {
        UUID productId = namedProductOrNull(orgId, inquiry.getProductId());
        String query = question.full();

        List<ScopedPassage> productLane = new ArrayList<>();
        DraftKnowledgeState productVerdict = DraftKnowledgeState.NO_PRODUCT;
        RetrievalOutcome productOutcome = RetrievalOutcome.ABSENT;
        if (productId != null) {
            KnowledgeSearchResponse found =
                    productKnowledge.search(orgId, productId, question, MAX_PASSAGES, scope);
            productOutcome = found.outcome();
            productVerdict = found.documentsSearched() == 0 ? DraftKnowledgeState.NO_LIBRARY
                    : found.passages().isEmpty() ? DraftKnowledgeState.NO_MATCH
                    : DraftKnowledgeState.GROUNDED;
            for (KnowledgePassage passage : found.passages()) {
                productLane.add(new ScopedPassage(KnowledgeScope.PRODUCT, passage.title(),
                        passage.content(), passage.sourceId(), passage.chunkId(),
                        locator(passage), passage.score(), passage.authoredOrigin(),
                        passage.variantName()));
            }
        }

        OrgKnowledgeSearchResponse policies = orgKnowledge.search(orgId, question, MAX_PASSAGES);
        List<ScopedPassage> policyLane = new ArrayList<>();
        for (OrgKnowledgePassage passage : policies.passages()) {
            policyLane.add(new ScopedPassage(KnowledgeScope.ORG_OPERATIONS, passage.title(),
                    passage.content(), passage.sourceId(), passage.chunkId(), locator(passage),
                    passage.score()));
        }

        // This inquiry's own answer is excluded: a reply approved on THIS work item must not come
        // back as precedent for the next version of itself.
        AnswerMemorySearchResponse remembered =
                answerMemory.search(orgId, question, productId, inquiry.getId(), MAX_PASSAGES);
        List<ScopedPassage> memoryLane = new ArrayList<>();
        for (AnswerMemoryPassage passage : remembered.passages()) {
            memoryLane.add(new ScopedPassage(KnowledgeScope.PAST_ANSWER, headingFor(passage),
                    passage.answerBody(), passage.memoryId(), null, locator(passage), passage.score()));
        }

        List<ScopedPassage> merged = merge(List.of(productLane, policyLane), memoryLane);
        // GROUNDED is a claim about the FACTS the draft may state, so it is earned by current
        // evidence only. A memory-only match leaves the product lane's own verdict standing: the
        // seller is told there is no current basis, and the past answer is still in front of them.
        boolean groundedInCurrent = merged.stream().anyMatch(p -> p.scope().current());
        DraftKnowledgeState state =
                groundedInCurrent ? DraftKnowledgeState.GROUNDED : productVerdict;
        return new InquiryEvidence(productId, state, merged,
                orderFacts.read(orgId, inquiry, lookup), remembered.supersededByConflict(),
                productOutcome, policies.outcome(), policies.topicsDeclared());
    }

    /** At most this many passages of the window may be a past answer. */
    static final int MAX_HISTORICAL_PASSAGES = 1;

    /**
     * One slot for each CURRENT lane that found something, then the rest by score, then — only if
     * the window is not already full — a single past answer.
     *
     * <p>Within the current lanes the fill is a plain score comparison — no per-scope bonus, no
     * per-scope penalty. The tie-break is the scope's declaration order and then the heading, which
     * is a determinism device and not a preference: two passages that score identically must come
     * back in the same order on every run, or the same question cites different evidence twice.
     *
     * <p>The historical lane is outside that competition rather than losing it. It cannot reserve a
     * slot, cannot take more than {@link #MAX_HISTORICAL_PASSAGES}, and cannot displace a current
     * passage — because the question it answers ("what did we say last time?") is not the question a
     * factual claim needs answered ("what is true?"). It is dropped first when the window is full,
     * which is the correct thing to drop: if four current passages already speak to the question,
     * the draft does not need a fifth source that only proves something was once sent.
     */
    private static List<ScopedPassage> merge(List<List<ScopedPassage>> currentLanes,
                                             List<ScopedPassage> historicalLane) {
        Comparator<ScopedPassage> byScore = Comparator.comparingDouble(ScopedPassage::score).reversed()
                .thenComparing(p -> p.scope().ordinal())
                .thenComparing(ScopedPassage::heading, Comparator.nullsLast(Comparator.naturalOrder()));
        List<ScopedPassage> reserved = new ArrayList<>();
        List<ScopedPassage> rest = new ArrayList<>();
        for (List<ScopedPassage> lane : currentLanes) {
            if (lane.isEmpty()) {
                continue;
            }
            reserved.add(lane.get(0));
            rest.addAll(lane.subList(1, lane.size()));
        }
        // Sorted WITHIN each group, never across them: a second global sort would push a lane's only
        // passage out of the window again and undo the reservation this method exists for.
        reserved.sort(byScore);
        rest.sort(byScore);
        List<ScopedPassage> out = new ArrayList<>(reserved);
        out.addAll(rest);
        if (out.size() > MAX_PASSAGES) {
            return List.copyOf(out.subList(0, MAX_PASSAGES));
        }
        historicalLane.stream().sorted(byScore).limit(MAX_HISTORICAL_PASSAGES)
                .filter(p -> out.size() < MAX_PASSAGES)
                .forEach(out::add);
        return List.copyOf(out);
    }

    /** Whether this product id points at a real, named product rather than ingest's shared bucket. */
    private UUID namedProductOrNull(UUID orgId, UUID productId) {
        if (productId == null) {
            return null;
        }
        return products.findById(productId)
                .filter(p -> p.getOrgId().equals(orgId))
                .filter(p -> OperatorProductName.displayNameOrNull(p) != null)
                .map(Product::getId)
                .orElse(null);
    }

    static String query(String title, String details) {
        String joined = ((title == null ? "" : title) + " " + (details == null ? "" : details)).strip();
        return joined.length() > QUERY_CHARS ? joined.substring(0, QUERY_CHARS) : joined;
    }

    /** A past answer's heading names its provenance, because that is what the seller must weigh. */
    private static String headingFor(AnswerMemoryPassage passage) {
        return passage.answerTitle() == null || passage.answerTitle().isBlank()
                ? passage.strengthLabel() : passage.answerTitle();
    }

    /** {@code product-knowledge/USAGE:데모 운영자} — the same shape the agent runtime cites. */
    private static String locator(KnowledgePassage passage) {
        return "product-knowledge/" + passage.sourceType().name() + ":" + author(passage.authorName());
    }

    /** {@code org-policy/TAX_INVOICE:데모 운영자#v2} — the revision is part of a policy's identity. */
    private static String locator(OrgKnowledgePassage passage) {
        return "org-policy/" + passage.knowledgeType().name() + ":" + author(passage.authorName())
                + "#v" + passage.version();
    }

    /** {@code answer-memory/USER_APPROVED:NAVER} — strength first, because that is what it weighs. */
    private static String locator(AnswerMemoryPassage passage) {
        return "answer-memory/" + passage.strength().name()
                + (passage.channelCode() == null ? "" : ":" + passage.channelCode());
    }

    private static String author(String name) {
        return name == null || name.isBlank() ? "판매자" : name;
    }
}
