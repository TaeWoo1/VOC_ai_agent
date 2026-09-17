package com.sellerops.knowledge.quality;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.agent.llm.AgentDraftGenerator;
import com.sellerops.agent.llm.AgentDraftProperties;
import com.sellerops.agent.llm.AgentDraftService;
import com.sellerops.agent.llm.JdkAgentLlmTransport;
import com.sellerops.agent.access.AgentCapabilityAccess;
import com.sellerops.agent.quota.AgentQuotaService;
import com.sellerops.agent.quota.AgentUsageKind;
import com.sellerops.agent.quota.QuotaDecision;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.InquiryProductBinding;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.inquiry.draft.AnswerBasisState;
import com.sellerops.inquiry.draft.DraftEvidenceSnippets;
import com.sellerops.inquiry.draft.InquiryDraftComposer;
import com.sellerops.inquiry.draft.InquiryDraftEvidenceRepository;
import com.sellerops.inquiry.draft.InquiryEvidenceRetriever;
import com.sellerops.inquiry.draft.InquiryKnowledgeAssessor;
import com.sellerops.inquiry.draft.dto.GeneratedDraftView;
import com.sellerops.inquiry.reply.InquiryReplyDraftRepository;
import com.sellerops.inquiry.reply.InquiryReplyDraftService;
import com.sellerops.inquiry.workitem.InquiryWorkItem;
import com.sellerops.inquiry.workitem.InquiryWorkItemPhase;
import com.sellerops.inquiry.workitem.InquiryWorkItemRepository;
import com.sellerops.knowledge.candidate.KnowledgeCandidateRepository;
import com.sellerops.knowledge.candidate.KnowledgeCandidateService;
import com.sellerops.knowledge.guidance.SellerGuidance;
import com.sellerops.knowledge.guidance.SellerGuidanceRepository;
import com.sellerops.knowledge.guidance.SellerGuidanceService;
import com.sellerops.knowledge.memory.AnswerMemoryRepository;
import com.sellerops.knowledge.memory.AnswerMemoryService;
import com.sellerops.knowledge.memory.AnswerMemoryStrength;
import com.sellerops.knowledge.org.OrgKnowledgeChunkRepository;
import com.sellerops.knowledge.org.OrgKnowledgeSourceRepository;
import com.sellerops.knowledge.org.OrgKnowledgeType;
import com.sellerops.knowledge.org.SellerOperationsKnowledgeService;
import com.sellerops.knowledge.org.dto.OrgKnowledgeRequest;
import com.sellerops.knowledge.spine.KnowledgeEntry;
import com.sellerops.knowledge.spine.KnowledgeSpineScope;
import com.sellerops.knowledge.spine.KnowledgeSpineService;
import com.sellerops.knowledge.spine.SourceRefResolver;
import com.sellerops.knowledge.spine.adapter.InquiryAnswerAdapter;
import com.sellerops.knowledge.spine.adapter.KnowledgeSourceAdapter;
import com.sellerops.knowledge.spine.adapter.ProductFactAdapter;
import com.sellerops.knowledge.spine.adapter.ReviewReplyAdapter;
import com.sellerops.knowledge.spine.adapter.SellerDecisionAdapter;
import com.sellerops.knowledge.spine.adapter.SellerGuidanceAdapter;
import com.sellerops.knowledge.spine.adapter.SellerKnowledgeAdapter;
import com.sellerops.order.fact.OrderFactLookup;
import com.sellerops.organization.Organization;
import com.sellerops.organization.OrganizationRepository;
import com.sellerops.product.FactConfidence;
import com.sellerops.product.FactKeys;
import com.sellerops.product.Product;
import com.sellerops.product.ProductFact;
import com.sellerops.product.ProductFactRepository;
import com.sellerops.product.ProductRepository;
import com.sellerops.product.ProductVariantRepository;
import com.sellerops.product.library.KnowledgeSourceType;
import com.sellerops.product.library.ProductKnowledgeChunkRepository;
import com.sellerops.product.library.ProductKnowledgeIndexer;
import com.sellerops.product.library.ProductKnowledgeLibraryService;
import com.sellerops.product.library.ProductKnowledgeSourceRepository;
import com.sellerops.product.library.dto.KnowledgeSourceRequest;
import jakarta.persistence.EntityManager;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * <b>Inquiry Quality Set v1</b> — 36 customer questions over one synthetic seller corpus
 * ({@code contracts/inquiry-quality/v1/cases.json}), scored on what the product actually decides.
 *
 * <p><b>Six axes, measured separately, because they fail separately:</b> did the retrieval reach the knowledge that
 * answers the question; did it use another product's or another policy's; did the answer-basis verdict match what the
 * corpus can honestly support; when nothing can, did the gap name the right thing to ask the seller for; does the
 * written draft claim only what the corpus states; and is a draft written exactly when one should be.
 *
 * <p><b>The first four need no model and run in CI.</b> They are the ones this package changed, and they are where a
 * regression would be silent. The last two need a real drafting model and run only when
 * {@code RUN_INQUIRY_QUALITY_LIVE=true} with a key — a vendor call in CI would make the suite pay per commit and make
 * the same commit score differently twice.
 *
 * <p>The corpus and the questions are synthetic: no seller wrote them and no customer asked them.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class InquiryQualitySetTest {

    static final Path CASES = Path.of("..", "contracts", "inquiry-quality", "v1", "cases.json");
    private static final ObjectMapper MAPPER = new ObjectMapper();

    /**
     * The floors this package measured, kept as floors rather than as a target.
     *
     * <p>They are the lexical scorer's real numbers on this corpus with the semantic lanes off — the posture every
     * deployment has until an organisation is given them. A deployment with the semantic lanes reaches more; that is
     * measured elsewhere ({@code docs/knowledge_retrieval_quality_v2.md}) and is not what this set defends.
     */
    static final double MIN_RETRIEVAL_HIT = 0.88;
    static final double MIN_BASIS_ACCURACY = 0.86;
    static final int MAX_WRONG_PRODUCT = 0;
    /**
     * Measured, and pinned so it cannot grow.
     *
     * <p>{@code 1}: 「택배 상자가 눌려서 제품이 부러진 채로 왔어요」 reaches the shipping policy and not the exchange one —
     * the lexical scorer admitting on a shared word (Q27). {@code 3}: three questions the company has written nothing
     * about are still GROUNDED because an unrelated rule shares a word with them (Q20 항균 · Q21 해외 · Q22 대량).
     * Both are admissions by the lexical lane, the failure the semantic lane exists to close; this set records them
     * rather than tuning thresholds under a package that was not about recall.
     */
    static final int MAX_WRONG_POLICY = 1;
    static final int MAX_FALSE_GROUNDING = 3;

    @Autowired EntityManager em;
    @Autowired OrganizationRepository organizations;
    @Autowired ProductRepository products;
    @Autowired ProductVariantRepository variants;
    @Autowired ProductFactRepository facts;
    @Autowired OrgKnowledgeSourceRepository orgSources;
    @Autowired OrgKnowledgeChunkRepository orgChunks;
    @Autowired ProductKnowledgeSourceRepository productSources;
    @Autowired ProductKnowledgeChunkRepository productChunks;
    @Autowired AnswerMemoryRepository memories;
    @Autowired SellerGuidanceRepository guidanceRows;
    @Autowired KnowledgeCandidateRepository candidateRows;
    @Autowired InquiryRepository inquiries;
    @Autowired InquiryWorkItemRepository workItems;
    @Autowired InquiryReplyDraftRepository draftRows;
    @Autowired InquiryDraftEvidenceRepository evidenceRows;
    @Autowired ChannelRepository channels;
    @Autowired com.sellerops.order.ChannelOrderRepository channelOrders;

    private UUID org;
    private final Map<String, UUID> productIds = new LinkedHashMap<>();
    private InquiryKnowledgeAssessor assessor;
    private KnowledgeSpineService spine;
    private InquiryEvidenceRetriever retriever;
    private KnowledgeCandidateService candidates;
    private InquiryReplyDraftService draftService;

    @BeforeEach
    void seed() throws Exception {
        JsonNode doc = MAPPER.readTree(Files.readString(CASES));
        Organization o = new Organization();
        o.setName("품질 세트 QA");
        org = organizations.save(o).getId();

        ProductKnowledgeLibraryService library =
                new ProductKnowledgeLibraryService(products, productSources, productChunks, variants);
        SellerOperationsKnowledgeService policies = new SellerOperationsKnowledgeService(orgSources, orgChunks);
        AnswerMemoryService memory = new AnswerMemoryService(memories, orgChunks, productChunks);
        SellerGuidanceService guidance = new SellerGuidanceService(guidanceRows);

        for (JsonNode rule : doc.path("library").path("org")) {
            policies.create(org, new OrgKnowledgeRequest(OrgKnowledgeType.valueOf(rule.path("type").asText()),
                    rule.path("title").asText(), rule.path("body").asText(), null), UUID.randomUUID(), "판매자");
        }
        for (JsonNode product : doc.path("library").path("products")) {
            Product p = new Product();
            p.setOrgId(org);
            p.setName(product.path("name").asText());
            p.setStatus("ACTIVE");
            UUID productId = products.save(p).getId();
            productIds.put(product.path("key").asText(), productId);
            for (JsonNode note : product.path("knowledge")) {
                library.create(org, productId, new KnowledgeSourceRequest(
                        KnowledgeSourceType.valueOf(note.path("type").asText()), note.path("title").asText(),
                        note.path("body").asText(), null), UUID.randomUUID(), "판매자");
            }
            for (JsonNode fact : product.path("facts")) {
                ProductFact f = new ProductFact();
                f.setOrgId(org);
                f.setProductId(productId);
                f.setFactKey(FactKeys.of(FactKeys.SPEC, fact.path("key").asText()));
                f.setFactValue(fact.path("value").asText());
                f.setUnit(fact.hasNonNull("unit") ? fact.path("unit").asText() : null);
                f.setSource("NAVER:PRODUCT_API:v1");
                f.setObservedAt(Instant.parse("2026-09-01T00:00:00Z"));
                f.setConfidence(FactConfidence.SOURCE_STATED);
                facts.save(f);
            }
        }
        int n = 0;
        for (JsonNode remembered : doc.path("library").path("memories")) {
            memory.remember(new AnswerMemoryService.RememberCommand(org, "quality-memory:" + n++,
                    AnswerMemoryStrength.valueOf(remembered.path("strength").asText()),
                    remembered.path("question").asText(), null, remembered.path("answer").asText(),
                    productIds.get(remembered.path("productKey").asText(null)), "NAVER", null, null, null, null, null,
                    null, null, null));
        }
        for (JsonNode note : doc.path("library").path("guidance")) {
            guidance.record(new SellerGuidanceService.Record(org, productIds.get(note.path("productKey").asText(null)),
                    SellerGuidance.Kind.valueOf(note.path("kind").asText()), "INQUIRY", UUID.randomUUID(), null,
                    note.path("question").asText(), note.path("text").asText(), UUID.randomUUID(), "판매자"));
        }

        retriever = new InquiryEvidenceRetriever(products, library, policies, memory,
                com.sellerops.order.fact.StoredOnlyOrderFacts.reader(channelOrders, channels,
                        (orgId, channelCode, accountId, rows) -> com.sellerops.coverage.ChannelDataState.OBSERVED_FRESH));
        List<KnowledgeSourceAdapter> adapters = List.of(
                new SellerKnowledgeAdapter(orgSources, orgChunks, productSources, productChunks),
                new ProductFactAdapter(facts), new InquiryAnswerAdapter(memories), new ReviewReplyAdapter(em),
                new SellerDecisionAdapter(em), new SellerGuidanceAdapter(guidanceRows));
        spine = new KnowledgeSpineService(adapters, products, new SourceRefResolver(em), retriever);
        assessor = new InquiryKnowledgeAssessor(retriever, spine, variants, products);
        candidates = new KnowledgeCandidateService(candidateRows, memories, productSources,
                new ProductKnowledgeIndexer(productChunks), products, orgSources, policies, variants);
        draftService = new InquiryReplyDraftService(workItems, draftRows);
    }

    @Test
    @DisplayName("retrieval, source isolation, answer basis and the named gap — measured per case, no model")
    void theDeterministicAxes() throws Exception {
        JsonNode doc = MAPPER.readTree(Files.readString(CASES));
        int withRequired = 0;
        int retrievalHits = 0;
        int wrongProduct = 0;
        int wrongPolicy = 0;
        int basisCorrect = 0;
        int gapNamed = 0;
        int gapExpected = 0;
        int falseGrounding = 0;
        List<String> misses = new ArrayList<>();

        for (JsonNode c : doc.path("cases")) {
            String id = c.path("id").asText();
            UUID productId = productIds.get(c.path("productKey").asText(null));
            Inquiry inquiry = seedInquiry(productId, c.path("title").asText(), c.path("body").asText());
            InquiryKnowledgeAssessor.Assessment a = assessor.assess(org, inquiry, OrderFactLookup.STORED_ONLY);

            List<String> required = strings(c.path("requiredKnowledge"));
            List<String> titles = a.spine().all().stream().map(KnowledgeEntry::title).toList();
            if (!required.isEmpty()) {
                withRequired++;
                if (titles.containsAll(required)) {
                    retrievalHits++;
                } else {
                    misses.add(id + " retrieval");
                }
            }
            for (KnowledgeEntry entry : a.spine().all()) {
                if (entry.scope() == KnowledgeSpineScope.PRODUCT && productId != null
                        && !productId.equals(entry.productId())) {
                    wrongProduct++;
                    misses.add(id + " wrong-product");
                }
            }
            // A policy the case did not name, cited for a case that named one, is the wrong rule for this question.
            if (!required.isEmpty()) {
                for (KnowledgeEntry entry : a.spine().evidence()) {
                    if (entry.scope() == KnowledgeSpineScope.ORG && !required.contains(entry.title())
                            && entry.sourceType() == com.sellerops.knowledge.spine.SpineSourceType.ORG_KNOWLEDGE) {
                        wrongPolicy++;
                        misses.add(id + " wrong-policy:" + entry.title());
                    }
                }
            }
            boolean needsSeller = c.path("sellerInputRequired").asBoolean();
            boolean refused = a.basis() == AnswerBasisState.NO_ANSWER_BASIS;
            if (needsSeller && !a.spine().evidence().isEmpty()) {
                // The company wrote nothing about this, and something was offered as if it had. The passage itself
                // names which rule was admitted, so the finding is actionable rather than a number.
                falseGrounding++;
                misses.add(id + " false-grounding:"
                        + a.spine().evidence().stream().map(KnowledgeEntry::title).toList());
            }
            if (needsSeller == refused) {
                basisCorrect++;
            } else {
                misses.add(id + " basis:" + a.basis());
            }
            String expectedSubject = c.path("expectedMissingSubject").asText(null);
            if (expectedSubject != null) {
                gapExpected++;
                if (expectedSubject.equals(a.missingSubject())) {
                    gapNamed++;
                } else {
                    misses.add(id + " gap:" + a.missingSubject());
                }
            }
        }

        int total = doc.path("cases").size();
        System.out.printf("%n  inquiry-quality/v1 — deterministic axes (lexical retrieval, no model)%n"
                        + "    cases                  %d%n"
                        + "    retrieval hit          %d/%d (%.2f)%n"
                        + "    wrong-product usage    %d%n"
                        + "    wrong-policy usage     %d%n"
                        + "    answer-basis correct   %d/%d (%.2f)%n"
                        + "    false grounding        %d%n"
                        + "    gap named correctly    %d/%d%n"
                        + "    misses: %s%n%n",
                total, retrievalHits, withRequired, ratio(retrievalHits, withRequired), wrongProduct, wrongPolicy,
                basisCorrect, total, ratio(basisCorrect, total), falseGrounding, gapNamed, gapExpected, misses);

        assertThat(ratio(retrievalHits, withRequired)).isGreaterThanOrEqualTo(MIN_RETRIEVAL_HIT);
        assertThat(wrongProduct).as("another product's knowledge is never evidence").isLessThanOrEqualTo(MAX_WRONG_PRODUCT);
        assertThat(wrongPolicy).as("another rule is not this question's rule").isLessThanOrEqualTo(MAX_WRONG_POLICY);
        assertThat(falseGrounding).as("a question nothing was written about").isLessThanOrEqualTo(MAX_FALSE_GROUNDING);
        assertThat(ratio(basisCorrect, total)).isGreaterThanOrEqualTo(MIN_BASIS_ACCURACY);
    }

    @Test
    @DisplayName("a refused draft cites nothing, and names the customer's own noun to ask about")
    void aGapIsOnlyEverAboutSomethingAbsent() throws Exception {
        JsonNode doc = MAPPER.readTree(Files.readString(CASES));
        for (JsonNode c : doc.path("cases")) {
            if (!c.path("sellerInputRequired").asBoolean() || c.path("expectedMissingSubject").isNull()) {
                continue;
            }
            UUID productId = productIds.get(c.path("productKey").asText(null));
            Inquiry inquiry = seedInquiry(productId, c.path("title").asText(), c.path("body").asText());
            InquiryKnowledgeAssessor.Assessment a = assessor.assess(org, inquiry, OrderFactLookup.STORED_ONLY);
            if (a.basis() != AnswerBasisState.NO_ANSWER_BASIS) {
                continue;  // a measured false grounding; the count above is where that is reported
            }
            assertThat(a.spine().evidence()).as("%s: a refused draft cites nothing", c.path("id").asText()).isEmpty();
            assertThat(a.missingSubject()).as("%s: the seller is asked for the customer's own noun",
                    c.path("id").asText()).isEqualTo(c.path("expectedMissingSubject").asText());
        }
    }

    /**
     * The live axes: what the model actually wrote, scored against the corpus.
     *
     * <p>Run with {@code RUN_INQUIRY_QUALITY_LIVE=true} and the drafting capability's own environment
     * ({@code SELLEROPS_AGENT_DRAFT_API_KEY}, optionally {@code …_MODEL}). One draft per case that has a basis; the
     * refusals cost nothing because no model is called for them.
     */
    @Test
    @org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable(named = "RUN_INQUIRY_QUALITY_LIVE", matches = "true")
    @DisplayName("live: unsupported claims, draft usability and refusal correctness")
    void theLiveAxes() throws Exception {
        JsonNode doc = MAPPER.readTree(Files.readString(CASES));
        AgentDraftService model = liveModel();
        InquiryDraftComposer composer = new InquiryDraftComposer(workItems, inquiries, draftService, evidenceRows,
                retriever, assessor, model, allowingQuota(), variants,
                new DraftEvidenceSnippets(productChunks, orgChunks, memories),
                new com.sellerops.product.detail.ProductDetailEnrichmentTrigger(null, null, null, null, List.of(),
                        false), null, null, null, candidates);

        int drafted = 0;
        int expectedDrafts = 0;
        int refusedCorrectly = 0;
        int expectedRefusals = 0;
        int unsupported = 0;
        int supported = 0;
        int supportExpected = 0;
        List<String> findings = new ArrayList<>();

        for (JsonNode c : doc.path("cases")) {
            String id = c.path("id").asText();
            UUID productId = productIds.get(c.path("productKey").asText(null));
            InquiryWorkItem work = seedWork(productId, c.path("title").asText(), c.path("body").asText());
            GeneratedDraftView view = composer.generateAs(org, work.getId(), "SYSTEM:QUALITY_SET");
            boolean needsSeller = c.path("sellerInputRequired").asBoolean();
            if (needsSeller) {
                expectedRefusals++;
                if (view.draft() == null) {
                    refusedCorrectly++;
                } else {
                    findings.add(id + " wrote a draft with no basis");
                }
                continue;
            }
            expectedDrafts++;
            if (view.draft() == null) {
                findings.add(id + " no draft: " + view.answerBasis());
                continue;
            }
            drafted++;
            String body = view.draft().comments() == null ? "" : view.draft().comments();
            for (String claim : strings(c.path("mustNotClaim"))) {
                if (body.contains(claim)) {
                    unsupported++;
                    findings.add(id + " claimed 「" + claim + "」");
                }
            }
            List<String> support = strings(c.path("mustSupport"));
            if (!support.isEmpty()) {
                supportExpected++;
                if (support.stream().anyMatch(body::contains)) {
                    supported++;
                } else {
                    findings.add(id + " did not carry " + support);
                }
            }
        }

        System.out.printf("%n  inquiry-quality/v1 — live axes (model: %s)%n"
                        + "    drafts written         %d/%d%n"
                        + "    refusals correct       %d/%d%n"
                        + "    unsupported claims     %d%n"
                        + "    carried the figure     %d/%d%n"
                        + "    findings: %s%n%n",
                System.getenv().getOrDefault("SELLEROPS_AGENT_DRAFT_MODEL", "(default)"), drafted, expectedDrafts,
                refusedCorrectly, expectedRefusals, unsupported, supported, supportExpected, findings);

        // Measured 2026-09-18: 6 of the 9. The three that wrote anyway are the three the deterministic axis already
        // names (Q20 항균 · Q21 해외 · Q22 대량) — the lexical lane admitted an unrelated rule, so the basis said
        // GROUNDED and the drafter was asked. It did not invent the missing fact in any of them (unsupported = 0);
        // it wrote around it. The floor is the measurement, so it cannot quietly get worse.
        assertThat(refusedCorrectly).as("a draft with no basis is the one failure this set exists to catch")
                .isGreaterThanOrEqualTo(6);
        assertThat(unsupported).as("a claim the corpus does not state").isZero();
    }

    // ── fixtures ────────────────────────────────────────────────────────────────────────────────────────────────

    private AgentDraftService liveModel() {
        String key = System.getenv("SELLEROPS_AGENT_DRAFT_API_KEY");
        assertThat(key).as("the live axes need the drafting capability's own key").isNotBlank();
        AgentDraftProperties properties = new AgentDraftProperties(true, "*", "OPENAI",
                System.getenv().getOrDefault("SELLEROPS_AGENT_DRAFT_MODEL", "gpt-5-2025-08-07"), key, 4000, "low");
        return new AgentDraftService(properties, new JdkAgentLlmTransport(),
                new AgentCapabilityAccess("ALLOW_LIST", mock(com.sellerops.selleraccount.SellerAccountRepository.class)));
    }

    private Inquiry seedInquiry(UUID productId, String title, String body) {
        Inquiry q = new Inquiry();
        q.setOrgId(org);
        q.setChannelId(UUID.randomUUID());
        q.setTitle(title);
        q.setBody(body);
        q.setStatus("UNANSWERED");
        q.setProductId(productId);
        q.setProductBinding(productId == null ? null : InquiryProductBinding.SOURCE_EXACT.name());
        q.setReceivedAt(Instant.parse("2026-09-17T00:00:00Z"));
        return inquiries.save(q);
    }

    private InquiryWorkItem seedWork(UUID productId, String title, String body) {
        Inquiry q = seedInquiry(productId, title, body);
        InquiryWorkItem wi = new InquiryWorkItem();
        wi.setOrgId(org);
        wi.setInquiryId(q.getId());
        wi.setSellerAccountId(UUID.randomUUID());
        wi.setChannelId(q.getChannelId());
        wi.setPhase(InquiryWorkItemPhase.PROPOSED);
        return workItems.save(wi);
    }

    private static List<String> strings(JsonNode array) {
        List<String> out = new ArrayList<>();
        array.forEach(node -> out.add(node.asText()));
        return out;
    }

    private static double ratio(int hits, int total) {
        return total == 0 ? 1.0 : (double) hits / total;
    }

    private static AgentQuotaService allowingQuota() {
        return new AgentQuotaService(null, null) {
            @Override
            public QuotaDecision consume(UUID orgId, AgentUsageKind kind, String idempotencyKey) {
                return new QuotaDecision(true, null, 0, 0);
            }
        };
    }

    @SuppressWarnings("unused")
    private static String passageText(AgentDraftGenerator.Passage passage) {
        return passage.text();
    }
}
