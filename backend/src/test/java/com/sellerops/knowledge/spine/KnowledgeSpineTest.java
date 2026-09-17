package com.sellerops.knowledge.spine;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sellerops.attention.reply.OperatorOutcome;
import com.sellerops.attention.reply.ReviewReplyApproval;
import com.sellerops.attention.reply.ReviewReplyApprovalRepository;
import com.sellerops.attention.reply.ReviewReplyApprovalState;
import com.sellerops.attention.reply.ReviewReplyDraft;
import com.sellerops.attention.reply.ReviewReplyDraftRepository;
import com.sellerops.attention.reply.ReviewReplyFingerprint;
import com.sellerops.attention.reply.ReviewReplyOutcome;
import com.sellerops.attention.reply.ReviewReplyOutcomeRepository;
import com.sellerops.attention.reply.ReviewReplyValidation;
import com.sellerops.attention.reply.VerificationState;
import com.sellerops.attention.triage.ReviewTriage;
import com.sellerops.attention.triage.ReviewTriageRepository;
import com.sellerops.attention.triage.TriageDisposition;
import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.common.ApiException;
import com.sellerops.knowledge.RetrievalOutcome;
import com.sellerops.knowledge.memory.AnswerMemoryRepository;
import com.sellerops.knowledge.memory.AnswerMemoryService;
import com.sellerops.knowledge.memory.AnswerMemoryStrength;
import com.sellerops.knowledge.org.OrgKnowledgeChunkRepository;
import com.sellerops.knowledge.org.OrgKnowledgeSourceRepository;
import com.sellerops.knowledge.org.OrgKnowledgeType;
import com.sellerops.knowledge.org.SellerOperationsKnowledgeService;
import com.sellerops.knowledge.org.dto.OrgKnowledgeRequest;
import com.sellerops.knowledge.spine.adapter.InquiryAnswerAdapter;
import com.sellerops.knowledge.spine.adapter.KnowledgeSourceAdapter;
import com.sellerops.knowledge.spine.adapter.ProductFactAdapter;
import com.sellerops.knowledge.spine.adapter.ReviewReplyAdapter;
import com.sellerops.knowledge.spine.adapter.SellerDecisionAdapter;
import com.sellerops.knowledge.spine.adapter.SellerKnowledgeAdapter;
import com.sellerops.knowledge.spine.dto.CompiledKnowledgeView;
import com.sellerops.knowledge.spine.dto.KnowledgeSpineSearchResponse;
import com.sellerops.knowledge.spine.dto.KnowledgeTraceView;
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
import com.sellerops.product.library.ProductKnowledgeLibraryService;
import com.sellerops.product.library.ProductKnowledgeSourceRepository;
import com.sellerops.product.library.dto.KnowledgeSourceRequest;
import com.sellerops.review.Review;
import com.sellerops.review.ReviewReplyState;
import com.sellerops.review.ReviewRepository;
import com.sellerops.review.triage.ReviewTriageTier;
import com.sellerops.review.triage.feedback.TriageCorrection;
import com.sellerops.review.triage.feedback.TriageCorrectionRepository;
import com.sellerops.review.triage.feedback.TriageShownSource;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import java.util.stream.Stream;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.ActiveProfiles;

/**
 * Knowledge Spine v1 — one scoped, attributed read over every raw trace of the seller's operation.
 *
 * <p>What is pinned: (1) the same product's policy, product note, product detail, past inquiry answer, approved
 * review reply and review decision come back from ONE search, each with scope, authority, freshness, provenance and
 * refs; (2) another product's and another organisation's knowledge never does; (3) every compiled claim follows
 * back to a raw row in this organisation and to none in another; (4) no customer sentence travels in an entry; and
 * (5) what is not the seller's word — a template reply, a withdrawn approval, a non-seller decision, a retired
 * document — is not knowledge.
 *
 * <p>Hermetic: real repositories on the test database, no network, no marketplace, no model.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
@Import({SellerKnowledgeAdapter.class, ProductFactAdapter.class, InquiryAnswerAdapter.class,
        ReviewReplyAdapter.class, SellerDecisionAdapter.class, SourceRefResolver.class, KnowledgeSpineService.class})
class KnowledgeSpineTest {

    static final Instant T0 = Instant.parse("2026-09-10T00:00:00Z");
    static final String CUSTOMER_SENTENCE = "벽에 붙였는데 이틀 만에 접착이 떨어졌어요 너무 속상하네요";

    @Autowired KnowledgeSpineService spine;
    @Autowired SourceRefResolver resolver;
    @Autowired List<KnowledgeSourceAdapter> adapters;

    @Autowired OrganizationRepository organizations;
    @Autowired ProductRepository products;
    @Autowired ProductVariantRepository variants;
    @Autowired ChannelRepository channels;
    @Autowired OrgKnowledgeSourceRepository orgSources;
    @Autowired OrgKnowledgeChunkRepository orgChunks;
    @Autowired ProductKnowledgeSourceRepository productSources;
    @Autowired ProductKnowledgeChunkRepository productChunks;
    @Autowired ProductFactRepository facts;
    @Autowired AnswerMemoryRepository memories;
    @Autowired ReviewRepository reviews;
    @Autowired ReviewReplyDraftRepository drafts;
    @Autowired ReviewReplyApprovalRepository approvals;
    @Autowired ReviewReplyOutcomeRepository outcomes;
    @Autowired ReviewTriageRepository triages;
    @Autowired TriageCorrectionRepository corrections;

    private UUID orgA;
    private UUID orgB;
    private UUID channel;
    private UUID molding;      // org A — the product under question
    private UUID mat;          // org A — a neighbour whose knowledge must not leak
    private UUID foreign;      // org B
    private UUID reviewOnMolding;

    @BeforeEach
    void seed() {
        orgA = org("상점 A");
        orgB = org("상점 B");
        Channel ch = new Channel();
        ch.setCode("NAVER");
        ch.setNameKo("네이버 스마트스토어");
        ch.setStatus(ChannelStatus.AVAILABLE);
        ch.setSortOrder(0);
        channel = channels.save(ch).getId();
        molding = product(orgA, "선바로 일체형 전선몰딩");
        mat = product(orgA, "논슬립 주방 매트");
        foreign = product(orgB, "다른 상점 전선몰딩");

        SellerOperationsKnowledgeService policies = new SellerOperationsKnowledgeService(orgSources, orgChunks);
        policies.create(orgA, new OrgKnowledgeRequest(OrgKnowledgeType.EXCHANGE_REFUND_POLICY, "교환 및 반품 안내",
                "상품 수령 후 7일 이내에 교환 신청을 하실 수 있습니다. 접착 불량은 사진을 보내 주시면 교환해 드립니다.",
                null), UUID.randomUUID(), "운영자");
        policies.create(orgB, new OrgKnowledgeRequest(OrgKnowledgeType.EXCHANGE_REFUND_POLICY, "교환 안내",
                "다른 상점의 교환 신청 기준: 접착 불량 교환은 30일 이내입니다.", null), UUID.randomUUID(), "B 운영자");

        ProductKnowledgeLibraryService library =
                new ProductKnowledgeLibraryService(products, productSources, productChunks, variants);
        library.create(orgA, molding, new KnowledgeSourceRequest(KnowledgeSourceType.USAGE, "접착 안내",
                "부착 면을 알코올로 닦고 말린 뒤 붙여 주세요. 접착 후 24시간 동안 떨어지지 않게 눌러 주시면 됩니다.", null),
                UUID.randomUUID(), "운영자");
        library.create(orgA, mat, new KnowledgeSourceRequest(KnowledgeSourceType.USAGE, "매트 접착 안내",
                "매트 뒷면 접착 패드가 떨어지면 물로 씻어 말리면 접착력이 돌아옵니다.", null), UUID.randomUUID(), "운영자");
        library.create(orgB, foreign, new KnowledgeSourceRequest(KnowledgeSourceType.USAGE, "접착 안내",
                "B 상점: 접착이 떨어지면 드라이어로 데워 다시 붙여 주세요.", null), UUID.randomUUID(), "B 운영자");

        fact(orgA, molding, FactKeys.DESC_SUMMARY, "강력 접착 테이프가 미리 부착된 일체형 전선몰딩입니다. 떨어짐 없이 깔끔하게 정리됩니다.");
        fact(orgA, molding, FactKeys.of(FactKeys.SPEC, "두께"), "1.2");

        AnswerMemoryService memory = new AnswerMemoryService(memories, orgChunks, productChunks);
        remember(memory, orgA, "inquiry-answer:molding", "접착이 잘 떨어지나요",
                "부착 면을 알코올로 닦은 뒤 붙이시면 접착이 떨어지지 않고 오래 유지됩니다.", molding);
        remember(memory, orgA, "inquiry-answer:mat", "매트 접착이 떨어져요",
                "매트 접착 패드는 물로 씻어 말리면 다시 붙습니다. 떨어지면 세척해 주세요.", mat);
        remember(memory, orgA, "inquiry-answer:unbound", "교환 신청 어떻게 하나요",
                "교환 신청은 수령 후 7일 이내에 해 주시면 됩니다.", null);
        remember(memory, orgB, "inquiry-answer:foreign", "접착이 떨어져요",
                "B 상점 답변: 접착이 떨어지면 드라이어로 데워 주세요.", foreign);

        reviewOnMolding = review(orgA, molding, 2, CUSTOMER_SENTENCE);
        approvedReply(orgA, reviewOnMolding, "MODEL",
                "불편을 드려 죄송합니다. 부착 면을 알코올로 닦은 뒤 다시 붙이시면 접착이 떨어지지 않습니다.", true);
        // The org's own template, approved for one review — a decision on that review, not an answer to a topic.
        approvedReply(orgA, review(orgA, molding, 1, "접착 떨어짐"), "RULE",
                "저희 제품을 이용해 주셔서 감사합니다. 접착 떨어짐 불편 확인했습니다.", false);
        approvedReply(orgA, review(orgA, mat, 2, "매트 접착이 떨어져요"), "SELLER",
                "매트 접착 패드는 세척하면 다시 붙습니다. 떨어지면 물로 씻어 주세요.", false);
        approvedReply(orgB, review(orgB, foreign, 2, "접착이 떨어져요"), "SELLER",
                "B 상점 답글: 접착이 떨어지면 드라이어로 데워 주세요.", false);

        triage(orgA, reviewOnMolding, TriageDisposition.MONITOR, "SELLER:" + UUID.randomUUID());
        UUID systemDecided = review(orgA, molding, 3, "접착이 조금 약해요 떨어질까 걱정");
        triage(orgA, systemDecided, TriageDisposition.NO_ACTION, "SYSTEM");
        TriageCorrection correction = new TriageCorrection();
        correction.setOrgId(orgA);
        correction.setReviewId(reviewOnMolding);
        correction.setShownTier(ReviewTriageTier.FYI);
        correction.setShownSource(TriageShownSource.RULES);
        correction.setCorrectedTier(ReviewTriageTier.NEEDS_ATTENTION);
        correction.setCorrectedAt(T0.plusSeconds(60));
        corrections.save(correction);
    }

    @Test
    @DisplayName("one scoped search returns the product's policy, note, detail, past answer, review reply and decision — each attributed")
    void oneScopedSearchCoversEveryRawSource() {
        KnowledgeSpineSearchResponse found = spine.search(orgA, molding, "접착이 떨어져요", 20);

        assertThat(found.outcome()).isEqualTo(RetrievalOutcome.FOUND);
        Set<SpineSourceType> types = found.hits().stream().map(h -> h.entry().sourceType()).collect(Collectors.toSet());
        assertThat(types).contains(SpineSourceType.ORG_KNOWLEDGE, SpineSourceType.PRODUCT_KNOWLEDGE,
                SpineSourceType.PRODUCT_FACT, SpineSourceType.INQUIRY_ANSWER, SpineSourceType.REVIEW_REPLY,
                SpineSourceType.REVIEW_DECISION);
        assertThat(found.hits()).allSatisfy(hit -> {
            KnowledgeEntry e = hit.entry();
            assertThat(e.authority()).isNotNull();
            assertThat(e.scope()).isNotNull();
            assertThat(e.provenance()).isNotBlank();
            assertThat(e.capturedAt()).as(e.entryId()).isNotNull();
            assertThat(e.sourceRefs()).as(e.entryId()).isNotEmpty();
        });
        KnowledgeEntry policy = entryOf(found, SpineSourceType.ORG_KNOWLEDGE);
        assertThat(policy.scope()).isEqualTo(KnowledgeSpineScope.ORG);
        assertThat(policy.authority()).isEqualTo(KnowledgeAuthority.SELLER_POLICY);
        assertThat(entryOf(found, SpineSourceType.PRODUCT_KNOWLEDGE).authority())
                .isEqualTo(KnowledgeAuthority.SELLER_CONFIRMED_PRODUCT_KNOWLEDGE);
        assertThat(entryOf(found, SpineSourceType.REVIEW_DECISION).authority())
                .isEqualTo(KnowledgeAuthority.RECENT_SELLER_DECISION);
        assertThat(entryOf(found, SpineSourceType.PRODUCT_FACT).authority()).isEqualTo(KnowledgeAuthority.PRODUCT_DETAIL);
        KnowledgeEntry answer = entryOf(found, SpineSourceType.INQUIRY_ANSWER);
        assertThat(answer.authority()).isEqualTo(KnowledgeAuthority.PAST_SELLER_ANSWER);
        assertThat(answer.provenance()).contains(AnswerMemoryStrength.IMPORTED_SELLER_ANSWER.labelKo());
        KnowledgeEntry reply = entryOf(found, SpineSourceType.REVIEW_REPLY);
        assertThat(reply.authority()).isEqualTo(KnowledgeAuthority.PAST_SELLER_ANSWER);
        assertThat(reply.provenance()).contains("등록했다고 기록한");
        assertThat(reply.sourceRefs()).extracting(SourceRef::kind).contains(SourceRef.Kind.REVIEW,
                SourceRef.Kind.REVIEW_REPLY_APPROVAL, SourceRef.Kind.REVIEW_REPLY_DRAFT);
    }

    @Test
    @DisplayName("another product's knowledge never appears — in the search, the corpus, or the compiled view")
    void anotherProductsKnowledgeNeverMixesIn() {
        for (KnowledgeEntry e : Stream.concat(
                spine.search(orgA, molding, "접착이 떨어져요", 20).hits().stream().map(KnowledgeSpineSearchResponse.Hit::entry),
                spine.entries(orgA, molding).stream()).toList()) {
            assertThat(e.scope() == KnowledgeSpineScope.ORG || molding.equals(e.productId())).as(e.entryId()).isTrue();
            assertThat(e.productId()).as(e.entryId()).isNotEqualTo(mat);
            assertThat(e.text()).doesNotContain("매트");
        }
        assertThat(spine.entries(orgA, mat)).noneMatch(e -> molding.equals(e.productId()));
        assertThat(spine.entries(orgA, mat)).anyMatch(e -> mat.equals(e.productId()));
        assertThat(spine.compiled(orgA, molding).sections()).flatExtracting(CompiledKnowledgeView.Section::claims)
                .noneMatch(c -> c.excerpt().contains("매트"));
        // A company-level read carries no product's knowledge at all.
        assertThat(spine.entries(orgA, null)).allMatch(e -> e.scope() == KnowledgeSpineScope.ORG);
        // And every adapter keeps the contract on its own, not only because the service re-fences it.
        for (KnowledgeSourceAdapter adapter : adapters) {
            assertThat(adapter.read(orgA, molding)).as(adapter.getClass().getSimpleName())
                    .allMatch(i -> i.entry().scope() == KnowledgeSpineScope.ORG || molding.equals(i.entry().productId()));
            assertThat(adapter.read(orgA, null)).as(adapter.getClass().getSimpleName())
                    .allMatch(i -> i.entry().scope() == KnowledgeSpineScope.ORG);
        }
    }

    @Test
    @DisplayName("another organisation's knowledge never appears, and its product is not a door")
    void anotherOrgsKnowledgeNeverMixesIn() {
        List<KnowledgeEntry> mine = Stream.concat(spine.entries(orgA, molding).stream(),
                spine.entries(orgA, null).stream()).toList();
        assertThat(mine).noneMatch(e -> e.text().contains("B 상점") || e.text().contains("다른 상점"));
        assertThat(spine.search(orgA, molding, "접착이 떨어져요", 20).hits())
                .noneMatch(h -> h.entry().text().contains("B 상점") || h.entry().text().contains("다른 상점"));
        assertThat(spine.entries(orgB, foreign)).isNotEmpty()
                .noneMatch(e -> e.text().contains("알코올") || e.text().contains("7일"));

        assertThatThrownBy(() -> spine.search(orgB, molding, "접착", 5)).isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> spine.compiled(orgB, molding)).isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> spine.entries(orgA, foreign)).isInstanceOf(ApiException.class);
        for (KnowledgeSourceAdapter adapter : adapters) {
            // Even handed a product id it was never meant to see, an adapter reads only its own organisation's rows.
            assertThat(adapter.read(orgA, foreign)).as(adapter.getClass().getSimpleName())
                    .noneMatch(i -> i.entry().text().contains("B 상점") || foreign.equals(i.entry().productId()));
        }
    }

    @Test
    @DisplayName("every compiled claim follows back to a raw row in this organisation, and to none in another")
    void compiledClaimsTraceToRawSources() {
        CompiledKnowledgeView view = spine.compiled(orgA, molding);

        assertThat(view.authority()).isEqualTo(KnowledgeAuthority.COMPILED_KNOWLEDGE);
        assertThat(view.newestSourceAt()).isNotNull();
        List<CompiledKnowledgeView.Claim> claims = view.sections().stream()
                .flatMap(s -> s.claims().stream()).toList();
        assertThat(claims).isNotEmpty();
        assertThat(claims).allSatisfy(claim -> {
            assertThat(claim.authority()).as("a claim keeps its source's authority")
                    .isNotEqualTo(KnowledgeAuthority.COMPILED_KNOWLEDGE);
            assertThat(claim.sourceRefs()).isNotEmpty();
            assertThat(claim.sourceRefs()).allSatisfy(ref -> {
                assertThat(resolver.resolves(orgA, ref)).as(claim.entryId() + " → " + ref).isTrue();
                assertThat(resolver.resolves(orgB, ref)).as("cross-org " + ref).isFalse();
            });
        });

        String replyId = claims.stream().filter(c -> c.sourceType() == SpineSourceType.REVIEW_REPLY)
                .findFirst().orElseThrow().entryId();
        KnowledgeTraceView trace = spine.trace(orgA, molding, replyId);
        assertThat(trace.sources()).isNotEmpty().allMatch(KnowledgeTraceView.ResolvedRef::resolved);
        assertThat(trace.sources()).extracting(r -> r.ref().id()).contains(reviewOnMolding);
        assertThatThrownBy(() -> spine.trace(orgA, mat, replyId)).isInstanceOf(ApiException.class);
        assertThat(SourceRefResolver.coversEveryKind()).isTrue();
    }

    @Test
    @DisplayName("a compiled section is led by the highest authority on record — policy before a past answer")
    void authorityLeadsEachSection() {
        CompiledKnowledgeView view = spine.compiled(orgA, molding);

        assertThat(view.sections()).allSatisfy(section -> {
            List<Integer> ranks = section.claims().stream().map(c -> c.authority().rank()).toList();
            assertThat(ranks).isSorted();
            assertThat(section.governingAuthority()).isEqualTo(section.claims().get(0).authority());
            assertThat(section.onRecord()).isGreaterThanOrEqualTo(section.claims().size());
        });
        CompiledKnowledgeView.Section exchange = view.sections().stream()
                .filter(s -> s.key().equals("TOPIC_EXCHANGE_RETURN")).findFirst().orElseThrow();
        assertThat(exchange.claims().get(0).sourceType()).isEqualTo(SpineSourceType.ORG_KNOWLEDGE);
        assertThat(exchange.claims()).extracting(CompiledKnowledgeView.Claim::sourceType)
                .contains(SpineSourceType.INQUIRY_ANSWER);
        assertThat(view.sections()).extracting(CompiledKnowledgeView.Section::governingAuthority)
                .extracting(KnowledgeAuthority::rank).isSorted();
    }

    @Test
    @DisplayName("no customer sentence travels in an entry — the review is a ref, not text")
    void customerTextNeverTravels() {
        List<KnowledgeEntry> all = spine.entries(orgA, molding);
        assertThat(all).noneMatch(e -> e.text().contains("속상") || e.title().contains("속상")
                || e.text().contains("이틀 만에"));
        assertThat(spine.search(orgA, molding, "이틀 만에 속상", 20).hits())
                .noneMatch(h -> h.entry().text().contains("속상"));
    }

    @Test
    @DisplayName("what is not the seller's word is not knowledge: a template reply, a withdrawn approval, a system decision, a retired note")
    void onlyTheSellersOwnWordIsKnowledge() {
        List<KnowledgeEntry> before = spine.entries(orgA, molding);
        assertThat(before).noneMatch(e -> e.text().contains("저희 제품을 이용해 주셔서 감사합니다"));
        assertThat(before).filteredOn(e -> e.sourceType() == SpineSourceType.REVIEW_DECISION).singleElement()
                .satisfies(e -> assertThat(e.text()).contains("지켜보기"));
        assertThat(before).filteredOn(e -> e.sourceType() == SpineSourceType.TRIAGE_CORRECTION).singleElement()
                .satisfies(e -> assertThat(e.text()).contains("「참고」 → 「확인 필요」"));

        ReviewReplyApproval approval = approvals.findByOrgIdAndReviewId(orgA, reviewOnMolding).orElseThrow();
        approval.setState(ReviewReplyApprovalState.WITHDRAWN);
        approval.setApprovedVersion(null);
        approval.setApprovedFingerprint(null);
        approvals.saveAndFlush(approval);
        productSources.findAllByOrgIdAndProductIdOrderByCreatedAtAsc(orgA, molding).forEach(s -> {
            s.setActive(false);
            productSources.saveAndFlush(s);
        });

        List<KnowledgeEntry> after = spine.entries(orgA, molding);
        assertThat(after).noneMatch(e -> e.sourceType() == SpineSourceType.REVIEW_REPLY);
        assertThat(after).noneMatch(e -> e.sourceType() == SpineSourceType.PRODUCT_KNOWLEDGE);
        assertThat(after).anyMatch(e -> e.sourceType() == SpineSourceType.ORG_KNOWLEDGE);
    }

    @Test
    @DisplayName("no adapter produces a compiled or external authority — compiling never promotes a source")
    void noAdapterClaimsADerivedAuthority() {
        assertThat(Stream.concat(spine.entries(orgA, molding).stream(), spine.entries(orgA, mat).stream()))
                .extracting(KnowledgeEntry::authority)
                .doesNotContain(KnowledgeAuthority.COMPILED_KNOWLEDGE, KnowledgeAuthority.EXTERNAL_REFERENCE);
        // A company with nothing on record says so rather than inventing an empty match.
        UUID empty = org("빈 상점");
        assertThat(spine.search(empty, null, "접착", 5).outcome()).isEqualTo(RetrievalOutcome.ABSENT);
    }

    @Test
    @DisplayName("the spine is read-only: no adapter, service or resolver saves, deletes or calls a model")
    void spineIsReadOnly() throws Exception {
        Path root = Path.of("src/main/java/com/sellerops/knowledge/spine");
        try (Stream<Path> files = Files.walk(root)) {
            for (Path file : files.filter(f -> f.toString().endsWith(".java")).toList()) {
                String code = Files.readString(file).replaceAll("(?s)/\\*.*?\\*/", "").replaceAll("//[^\n]*", "");
                assertThat(code).as(file.toString())
                        .doesNotContain(".save(", ".delete", ".persist(", ".merge(", "executeUpdate",
                                "ChatModel", "AgentLlm", "KnowledgeSemanticSearch", "KnowledgeEmbedding",
                                "HttpClient", "RestTemplate", "WebClient");
            }
        }
    }

    // ---- fixtures --------------------------------------------------------------------------------------------

    private static KnowledgeEntry entryOf(KnowledgeSpineSearchResponse found, SpineSourceType type) {
        return found.hits().stream().map(KnowledgeSpineSearchResponse.Hit::entry)
                .filter(e -> e.sourceType() == type).findFirst().orElseThrow(() -> new AssertionError("no " + type));
    }

    private UUID org(String name) {
        Organization o = new Organization();
        o.setName(name);
        return organizations.save(o).getId();
    }

    private UUID product(UUID org, String name) {
        Product p = new Product();
        p.setOrgId(org);
        p.setName(name);
        p.setStatus("ACTIVE");
        return products.save(p).getId();
    }

    private void fact(UUID org, UUID product, String key, String value) {
        ProductFact f = new ProductFact();
        f.setOrgId(org);
        f.setProductId(product);
        f.setFactKey(key);
        f.setFactValue(value);
        f.setSource("NAVER:PRODUCT_API:v1");
        f.setObservedAt(T0);
        f.setConfidence(FactConfidence.SOURCE_STATED);
        facts.save(f);
    }

    private void remember(AnswerMemoryService memory, UUID org, String ref, String question, String answer,
                          UUID product) {
        memory.remember(new AnswerMemoryService.RememberCommand(org, ref, AnswerMemoryStrength.IMPORTED_SELLER_ANSWER,
                question, null, answer, product, "NAVER", null, null, null, null, null, null, null, null));
    }

    private UUID review(UUID org, UUID product, int rating, String body) {
        Review r = new Review();
        r.setOrgId(org);
        r.setChannelId(channel);
        r.setProductId(product);
        r.setRating(rating);
        r.setBody(body);
        r.setNegative(rating <= 2);
        r.setReceivedAt(T0);
        r.setReplyState(ReviewReplyState.PENDING);
        return reviews.save(r).getId();
    }

    private void approvedReply(UUID org, UUID review, String authorKind, String body, boolean reported) {
        String normalized = ReviewReplyValidation.normalize(body);
        String fingerprint = ReviewReplyFingerprint.of(normalized);
        ReviewReplyDraft d = new ReviewReplyDraft();
        d.setOrgId(org);
        d.setReviewId(review);
        d.setVersion(1);
        d.setBody(normalized);
        d.setContentFingerprint(fingerprint);
        d.setFingerprintAlgorithm(ReviewReplyValidation.FINGERPRINT_ALGORITHM);
        d.setCreatedBy("SELLER:op");
        d.setAuthorKind(authorKind);
        d.setProductId(null);
        drafts.save(d);
        ReviewReplyApproval a = new ReviewReplyApproval();
        a.setOrgId(org);
        a.setReviewId(review);
        a.setState(ReviewReplyApprovalState.APPROVED);
        a.setApprovedVersion(1);
        a.setApprovedFingerprint(fingerprint);
        a.setDecidedBy("SELLER:op");
        a.setDecidedAt(T0);
        approvals.save(a);
        if (reported) {
            ReviewReplyOutcome o = new ReviewReplyOutcome();
            o.setOrgId(org);
            o.setReviewId(review);
            o.setSubmissionRef("ref" + UUID.randomUUID().toString().substring(0, 8));
            o.setRecordedVersion(1);
            o.setRecordedFingerprint(fingerprint);
            o.setFingerprintAlgorithm(ReviewReplyValidation.FINGERPRINT_ALGORITHM);
            o.setOperatorOutcome(OperatorOutcome.OPERATOR_REPORTED_SUBMITTED);
            o.setVerification(VerificationState.UNVERIFIED);
            o.setAwRunRef("run_abc123");
            o.setCommandId(UUID.randomUUID().toString());
            o.setRecordedBy("SELLER:op");
            outcomes.save(o);
        }
    }

    private void triage(UUID org, UUID review, TriageDisposition disposition, String actor) {
        ReviewTriage t = new ReviewTriage();
        t.setOrgId(org);
        t.setReviewId(review);
        t.setChannelId(channel);
        t.setDisposition(disposition);
        t.setDecidedBy(actor);
        t.setDecidedAt(T0.plusSeconds(30));
        triages.save(t);
    }
}
