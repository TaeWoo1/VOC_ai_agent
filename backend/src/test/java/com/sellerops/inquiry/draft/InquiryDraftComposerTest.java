package com.sellerops.inquiry.draft;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.agent.llm.AgentDraftGenerator;
import com.sellerops.agent.llm.AgentDraftResponseParser;
import com.sellerops.agent.llm.AgentDraftService;
import com.sellerops.agent.quota.AgentQuotaService;
import com.sellerops.agent.quota.AgentUsageKind;
import com.sellerops.agent.quota.QuotaDecision;
import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.inquiry.draft.dto.GeneratedDraftView;
import com.sellerops.inquiry.reply.InquiryReplyDraftRepository;
import com.sellerops.inquiry.reply.InquiryReplyDraftService;
import com.sellerops.inquiry.workitem.InquiryWorkItem;
import com.sellerops.inquiry.workitem.InquiryWorkItemPhase;
import com.sellerops.inquiry.workitem.InquiryWorkItemRepository;
import com.sellerops.knowledge.memory.AnswerMemoryRepository;
import com.sellerops.knowledge.memory.AnswerMemoryService;
import com.sellerops.knowledge.org.OrgKnowledgeChunkRepository;
import com.sellerops.knowledge.org.OrgKnowledgeSourceRepository;
import com.sellerops.knowledge.org.SellerOperationsKnowledgeService;
import com.sellerops.coverage.ChannelDataState;
import com.sellerops.order.ChannelOrderRepository;
import com.sellerops.order.fact.OrderStoreFreshness;
import com.sellerops.product.Product;
import com.sellerops.product.ProductRepository;
import com.sellerops.product.library.KnowledgeSourceType;
import com.sellerops.product.library.ProductKnowledgeChunkRepository;
import com.sellerops.product.library.ProductKnowledgeLibraryService;
import com.sellerops.product.library.dto.KnowledgePassage;
import com.sellerops.product.library.dto.KnowledgeSearchResponse;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * Inquiry Draft v1: what the draft is grounded in, and — more importantly — what it does NOT claim
 * to be grounded in.
 *
 * <p>The four {@link DraftKnowledgeState} values are four different sentences a seller reads above a
 * reply they are about to send under their own name, so each gets its own test. The two that matter
 * most are the negatives: a draft written by the deterministic fallback must never be labelled
 * GROUNDED even when the retrieval succeeded (nothing that wrote it saw those passages), and a
 * product with no library must stay distinguishable from a library that does not cover the question.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class InquiryDraftComposerTest {


    /**
     * The freshness verdict, supplied directly.
     *
     * <p>These tests are about which order a reference resolves to and what may be said about it —
     * not about whether the capability registry declares ORDER_SUMMARY. {@code OBSERVED_FRESH} keeps
     * that axis out of the way, so a failure here means the binding is wrong.
     */
    private static final OrderStoreFreshness FRESH =
            (orgId, channelCode, accountId, rows) -> ChannelDataState.OBSERVED_FRESH;

    @Autowired InquiryWorkItemRepository workItems;
    @Autowired InquiryRepository inquiries;
    @Autowired InquiryReplyDraftRepository draftRows;
    @Autowired InquiryDraftEvidenceRepository evidence;
    @Autowired ProductRepository products;
    @Autowired com.sellerops.product.ProductVariantRepository variants;
    @Autowired OrgKnowledgeSourceRepository orgSources;
    @Autowired OrgKnowledgeChunkRepository orgChunks;
    @Autowired ProductKnowledgeChunkRepository productChunks;
    @Autowired com.sellerops.product.library.ProductKnowledgeSourceRepository productSources;
    @Autowired AnswerMemoryRepository memories;
    @Autowired ChannelOrderRepository channelOrders;
    @Autowired com.sellerops.channel.ChannelRepository channels;

    private final UUID org = UUID.randomUUID();
    private final UUID user = UUID.randomUUID();
    private InquiryReplyDraftService draftService;

    @BeforeEach
    void setUp() {
        draftService = new InquiryReplyDraftService(workItems, draftRows);
    }

    @Test
    @DisplayName("GROUNDED: the retrieved passages reach the model AND become citations")
    void grounded() {
        UUID productId = seedProduct();
        InquiryWorkItem wi = seedProposed(productId);
        StubLibrary library = StubLibrary.returning(passage("사용법", "테이프를 벗기고 벽면에 붙입니다."));
        StubModel model = StubModel.writing("[답변] 사용 방법", "테이프를 벗기고 벽면에 붙이시면 됩니다.");

        GeneratedDraftView view = composer(library, model).generate(org, wi.getId(), user);

        assertThat(view.knowledgeState()).isEqualTo(DraftKnowledgeState.GROUNDED.name());
        assertThat(view.authorKind()).isEqualTo(DraftAuthorKind.MODEL.name());
        assertThat(model.sawKnowledge).as("evidence retrieved but not shown is not grounding")
                .extracting(AgentDraftGenerator.Passage::text)
                .containsExactly("테이프를 벗기고 벽면에 붙입니다.");
        assertThat(view.evidence()).singleElement()
                .satisfies(e -> {
                    assertThat(e.title()).isEqualTo("사용법");
                    assertThat(e.locator()).isEqualTo("product-knowledge/USAGE:데모 운영자");
                });
        assertThat(evidence.findAllByWorkItemIdAndDraftVersionOrderByOrdinalAsc(
                wi.getId(), view.draft().version())).hasSize(1);
    }

    @Test
    @DisplayName("a citation carries the sentence the drafter was shown, not only its title")
    void citationsCarryACheckableExcerpt() {
        // The 2026-08-26 defect: the source's TITLE is about 접착, the passage that grounded the
        // reply is about 가닥 수, and a seller reading only the title cannot check the answer.
        UUID productId = seedProduct();
        InquiryWorkItem wi = seedAsking(productId, "문의", "전선이 몇 가닥까지 들어가나요?");
        String faq = "Q. 떼었다가 다시 붙일 수 있나요?\nA. 기본 양면테이프는 1회용입니다.\n"
                + "Q. 몇 가닥까지 들어가나요?\nA. 일반 가전 전선 기준으로 3~4가닥이 여유 있게 들어갑니다.";
        GeneratedDraftView view = composer(StubLibrary.returning(passage("자주 묻는 질문 - 접착과 재부착", faq)),
                StubModel.writing("[답변] 문의", "확인해 안내드리겠습니다.")).generate(org, wi.getId(), user);

        assertThat(view.evidence()).singleElement().satisfies(e -> {
            assertThat(e.title()).isEqualTo("자주 묻는 질문 - 접착과 재부착");
            assertThat(e.snippet()).as("the excerpt is what makes the title checkable")
                    .contains("3~4가닥")
                    .doesNotContain("\n");
        });
    }

    @Test
    @DisplayName("a citation read back later carries the same excerpt, resolved from the source")
    void citationsReadBackCarryTheirExcerpt() {
        UUID productId = seedProduct();
        InquiryWorkItem wi = seedAsking(productId, "문의", "전선이 몇 가닥까지 들어가나요?");
        // A real stored chunk, because the read path resolves the excerpt from the source rather
        // than from anything the citation row holds.
        KnowledgePassage stored = seedChunk(productId, "자주 묻는 질문", "A. 3~4가닥이 여유 있게 들어갑니다.");
        GeneratedDraftView view = composer(StubLibrary.returning(stored),
                StubModel.writing("[답변] 문의", "확인해 안내드리겠습니다.")).generate(org, wi.getId(), user);

        // The generate path holds the passage text; the read path has to go and get it. Both must
        // put the same thing in front of the seller, or the citation changes when the page reloads.
        assertThat(composer(StubLibrary.empty(0), StubModel.disabled())
                .evidenceFor(org, wi.getId(), view.draft().version()))
                .singleElement()
                .satisfies(e -> assertThat(e.snippet()).contains("3~4가닥"));
    }

    @Test
    @DisplayName("a variant-dependent question arrives at the model with its 규격 unresolved")
    void variantDependentQuestionsCarryTheirApplicability() {
        // The 2026-08-26 NAVER live case, end to end: the FAQ passage genuinely answers the question,
        // and the drafter is nonetheless told that the figure is not settled for this customer.
        UUID productId = seedProduct();
        InquiryWorkItem wi = seedAsking(productId, "문의", "전선이 몇 가닥까지 들어가나요?");
        StubLibrary library = StubLibrary.returning(passage("자주 묻는 질문",
                "Q. 몇 가닥까지 들어가나요? A. 일반 가전 전선 기준으로 3~4가닥이 여유 있게 들어갑니다."));
        StubModel model = StubModel.writing("[답변] 문의", "확인해 안내드리겠습니다.");

        composer(library, model).generate(org, wi.getId(), user);

        assertThat(model.sawKnowledge).as("the evidence is still retrieved and still shown").hasSize(1);
        assertThat(model.sawSpecScope).isEqualTo(
                SpecApplicability.Applicability.VARIANT_UNRESOLVED.messageKo());
    }

    @Test
    @DisplayName("a question whose answer cannot move with the option carries no extra caution")
    void invariantQuestionsCarryNoApplicabilityCaution() {
        UUID productId = seedProduct();
        InquiryWorkItem wi = seedAsking(productId, "문의", "벽지에도 붙는지 궁금합니다.");
        StubModel model = StubModel.writing("[답변] 문의", "실크벽지에는 붙습니다.");

        composer(StubLibrary.returning(passage("자주 묻는 질문", "실크벽지에는 붙습니다.")), model)
                .generate(org, wi.getId(), user);

        assertThat(model.sawSpecScope).isEqualTo(
                SpecApplicability.Applicability.NOT_VARIANT_SENSITIVE.messageKo());
    }

    @Test
    @DisplayName("ingest's shared (미지정 상품) bucket is NOT a product — it is NO_PRODUCT, not NO_LIBRARY")
    void unspecifiedBucketIsNotAProduct() {
        // Most of the live Cafe24 backlog carries a non-null productId pointing at this one shared
        // row. Reporting NO_LIBRARY about it would say "이 상품에 등록된 상품 지식이 없다" about a
        // product that does not exist, and invite the seller to write knowledge into a bucket.
        Product bucket = new Product();
        bucket.setOrgId(org);
        bucket.setName("(미지정 상품)");
        bucket.setSku("SKU-" + UUID.randomUUID());
        bucket.setStatus("ACTIVE");
        UUID bucketId = products.save(bucket).getId();
        InquiryWorkItem wi = seedProposed(bucketId);
        StubLibrary library = StubLibrary.empty(0);

        GeneratedDraftView view = composer(library, StubModel.writing("제목", "본문"))
                .generate(org, wi.getId(), user);

        assertThat(view.knowledgeState()).isEqualTo(DraftKnowledgeState.NO_PRODUCT.name());
        assertThat(library.searched).isFalse();
        assertThat(view.productId()).isNull();
    }

    @Test
    @DisplayName("NO_PRODUCT: an inquiry with no canonical product retrieves nothing and says so")
    void noProduct() {
        InquiryWorkItem wi = seedProposed(null);
        StubLibrary library = StubLibrary.returning(passage("사용법", "쓰이지 않아야 합니다."));

        GeneratedDraftView view = composer(library, StubModel.writing("제목", "본문"))
                .generate(org, wi.getId(), user);

        assertThat(view.knowledgeState()).isEqualTo(DraftKnowledgeState.NO_PRODUCT.name());
        assertThat(library.searched).as("no product means there is nothing to search").isFalse();
        assertThat(view.evidence()).isEmpty();
        assertThat(view.knowledgeNote()).contains("상품과 연결되지 않았고");
    }

    @Test
    @DisplayName("NO_LIBRARY and NO_MATCH are different sentences, because they are different problems")
    void twoKindsOfAbsence() {
        UUID productId = seedProduct();

        InquiryWorkItem empty = seedProposed(productId);
        GeneratedDraftView emptyView = composer(StubLibrary.empty(0), StubModel.writing("제목", "본문"))
                .generate(org, empty.getId(), user);
        assertThat(emptyView.knowledgeState()).isEqualTo(DraftKnowledgeState.NO_LIBRARY.name());

        InquiryWorkItem unmatched = seedProposed(productId);
        GeneratedDraftView unmatchedView = composer(StubLibrary.empty(3), StubModel.writing("제목", "본문"))
                .generate(org, unmatched.getId(), user);
        assertThat(unmatchedView.knowledgeState()).isEqualTo(DraftKnowledgeState.NO_MATCH.name());

        assertThat(emptyView.knowledgeNote()).isNotEqualTo(unmatchedView.knowledgeNote());
    }

    @Test
    @DisplayName("no model ran — nothing is written, and no promise is made on the seller's behalf")
    void noModelMeansNoDraft() {
        // This replaced the deterministic fallback on 2026-08-26. That drafter wrote 「확인한 뒤
        // 정확한 안내를 드리겠습니다」 — a commitment SellerOps made in the seller's voice with no
        // evidence and no author. An empty box the seller fills in is the honest version.
        UUID productId = seedProduct();
        InquiryWorkItem wi = seedProposed(productId);
        StubLibrary library = StubLibrary.returning(passage("사용법", "테이프를 벗기고 붙입니다."));

        GeneratedDraftView view = composer(library, StubModel.disabled()).generate(org, wi.getId(), user);

        assertThat(view.draft()).isNull();
        assertThat(view.authorKind()).isNull();
        // GROUNDED, not NO_ANSWER_BASIS: the library answered this question perfectly well and the
        // switch is what is off. Saying otherwise sends the seller to fix something that is not
        // broken (product-owner, 2026-08-27).
        assertThat(view.answerBasis()).isEqualTo(AnswerBasisState.GROUNDED.name());
        assertThat(view.unavailableMessage()).isEqualTo(InquiryDraftComposer.CAPABILITY_OFF);
        assertThat(view.evidence()).isEmpty();
        assertThat(draftRows.countByWorkItemId(wi.getId()))
                .as("a version nobody composed must not exist for an approval to bind to").isZero();
    }

    @Test
    @DisplayName("grounded + the vendor did not answer — that is NOT a missing answer basis")
    void vendorFailureIsNotAMissingBasis() {
        // The defect this pins, in one sentence: a timeout used to be reported as NO_ANSWER_BASIS,
        // so a seller with a complete library was told 「답변 기준이 필요합니다」 and sent off to
        // write knowledge they had already written. The evidence verdict and the machinery's
        // verdict are different sentences and must not be able to overwrite each other.
        UUID productId = seedProduct();
        InquiryWorkItem wi = seedProposed(productId);
        StubLibrary library = StubLibrary.returning(passage("사용법", "테이프를 벗기고 붙입니다."));

        GeneratedDraftView view =
                composer(library, StubModel.refusing()).generate(org, wi.getId(), user);

        assertThat(view.draft()).isNull();
        assertThat(view.answerBasis()).isEqualTo(AnswerBasisState.GROUNDED.name());
        assertThat(view.unavailableMessage()).isEqualTo(InquiryDraftComposer.MODEL_FAILED);
        assertThat(view.unavailableMessage()).doesNotContain("답변 기준");
    }

    @Test
    @DisplayName("the 상세페이지 read failed — we did not finish looking, so we do not say there is nothing")
    void detailReadFailureIsNotAMissingBasis() {
        InquiryWorkItem wi = seedBound();
        StubModel model = StubModel.writing("제목", "본문");

        GeneratedDraftView view = composer(StubLibrary.empty(0), model, allowingQuota(),
                failingTrigger()).generate(org, wi.getId(), user);

        assertThat(view.draft()).isNull();
        assertThat(view.unavailableMessage()).isEqualTo(InquiryDraftComposer.DETAIL_READ_FAILED);
        assertThat(model.sawTitle).as("no basis was established, so no model call was made").isNull();
    }

    @Test
    @DisplayName("the 상세페이지 read succeeded and found nothing — THAT is a missing answer basis")
    void settledAbsenceStillReportsNoBasis() {
        InquiryWorkItem wi = seedBound();

        GeneratedDraftView view = composer(StubLibrary.empty(0), StubModel.writing("제목", "본문"))
                .generate(org, wi.getId(), user);

        assertThat(view.answerBasis()).isEqualTo(AnswerBasisState.NO_ANSWER_BASIS.name());
        assertThat(view.answerBasisNote()).isEqualTo("답변 기준이 필요합니다.");
        assertThat(view.unavailableMessage()).as("nothing failed — the library is simply empty")
                .isNull();
    }

    @Test
    @DisplayName("the day's AI budget is spent — nothing is written, and the reason is said")
    void quotaExhaustedWritesNothingAndSaysWhy() {
        UUID productId = seedProduct();
        InquiryWorkItem wi = seedProposed(productId);

        GeneratedDraftView view = composer(StubLibrary.returning(passage("사용법", "붙입니다.")),
                StubModel.writing("제목", "본문"), exhaustedQuota()).generate(org, wi.getId(), user);

        assertThat(view.draft()).isNull();
        assertThat(view.unavailableMessage()).contains("오늘");
        // The budget stopped it, not the evidence — and tomorrow the same question is answerable.
        assertThat(view.answerBasis()).isEqualTo(AnswerBasisState.GROUNDED.name());
    }

    @Test
    @DisplayName("NO_ANSWER_BASIS: no evidence means no model call at all, and 「답변 기준이 필요합니다」")
    void noAnswerBasisSpendsNothing() {
        InquiryWorkItem wi = seedProposed(null);
        StubModel model = StubModel.writing("제목", "본문");

        GeneratedDraftView view = composer(StubLibrary.empty(0), model).generate(org, wi.getId(), user);

        assertThat(view.answerBasis()).isEqualTo(AnswerBasisState.NO_ANSWER_BASIS.name());
        assertThat(view.answerBasisNote()).isEqualTo("답변 기준이 필요합니다.");
        assertThat(view.answerBasisAction()).as("what the seller can do about it")
                .contains("어떤 상품");
        assertThat(model.sawTitle).as("the model is not asked to write a reply with no basis").isNull();
        assertThat(view.draft()).isNull();
    }

    @Test
    @DisplayName("NEEDS_CLARIFICATION: evidence exists, the 규격 does not — a draft IS written")
    void needsClarificationStillDrafts() {
        UUID productId = seedProduct();
        InquiryWorkItem wi = seedAsking(productId, "문의", "전선이 몇 가닥까지 들어가나요?");
        StubModel model = StubModel.writing("[답변] 문의", "사용하실 규격을 알려주시면 정확히 안내드리겠습니다.");

        GeneratedDraftView view = composer(
                StubLibrary.returning(passage("자주 묻는 질문", "3~4가닥이 들어갑니다.")), model)
                .generate(org, wi.getId(), user);

        assertThat(view.answerBasis()).isEqualTo(AnswerBasisState.NEEDS_CLARIFICATION.name());
        assertThat(view.draft()).as("asking for the missing fact IS the reply").isNotNull();
        assertThat(view.answerBasisAction()).isNull();
    }

    @Test
    @DisplayName("a regenerate appends a version, so an approval bound to the previous one is stale")
    void regenerateAppendsAndInvalidates() {
        UUID productId = seedProduct();
        InquiryWorkItem wi = seedProposed(productId);
        StubLibrary library = StubLibrary.returning(passage("사용법", "테이프를 벗기고 붙입니다."));

        GeneratedDraftView first = composer(library, StubModel.writing("첫 제목", "첫 본문"))
                .generate(org, wi.getId(), user);
        GeneratedDraftView next = composer(library, StubModel.writing("둘째 제목", "둘째 본문"))
                .generate(org, wi.getId(), user);

        assertThat(next.draft().version()).isEqualTo(first.draft().version() + 1);
        assertThat(next.draft().contentFingerprint()).isNotEqualTo(first.draft().contentFingerprint());
    }

    @Test
    @DisplayName("the question reaches the model as text — the stored body may be a mail thread in markup")
    void markupNeverReachesTheDrafter() {
        UUID productId = seedProduct();
        InquiryWorkItem wi = seedProposed(productId);
        StubModel model = StubModel.writing("제목", "본문");

        composer(StubLibrary.returning(passage("사용법", "붙입니다.")), model)
                .generate(org, wi.getId(), user);

        assertThat(model.sawTitle).isEqualTo("사용 방법이 궁금합니다");
        assertThat(model.sawDetails).doesNotContain("<p>").doesNotContain("&nbsp;");
    }

    @Test
    @DisplayName("the retrieval query is bounded — a forwarded mail thread is not the question")
    void queryIsBounded() {
        String thread = "재고 있나요? " + "인용된 지난 대화 ".repeat(200);
        assertThat(InquiryEvidenceRetriever.query("제목", thread))
                .hasSize(InquiryEvidenceRetriever.QUERY_CHARS)
                .startsWith("제목 재고 있나요?");
    }

    // ---- helpers ----

    private InquiryDraftComposer composer(StubLibrary library, StubModel model) {
        return composer(library, model, allowingQuota());
    }

    /**
     * The image lane, absent. These cases are about the draft path; a null progress query means
     * "no picture is being read", which is the state every deployment is in until the lane is on.
     */
    private com.sellerops.product.detail.image.ProductDetailImageKnowledge imageKnowledge;

    private InquiryDraftComposer composer(StubLibrary library, StubModel model, AgentQuotaService quota) {
        // The 상세페이지 trigger, switched off: a disabled trigger returns before it touches a
        // repository, which is also the assertion that the draft path behaves identically in a
        // deployment that never turns the lane on — the default one since 2026-08-27.
        return composer(library, model, quota,
                new com.sellerops.product.detail.ProductDetailEnrichmentTrigger(
                        null, null, null, null, List.of(), false));
    }

    private InquiryDraftComposer composer(StubLibrary library, StubModel model,
                                          AgentQuotaService quota,
                                          com.sellerops.product.detail.ProductDetailEnrichmentTrigger
                                                  trigger) {
        // The real retriever over a stubbed product lane: the org-policy and past-answer lanes run
        // against genuinely empty stores, which is the state these cases are about.
        InquiryEvidenceRetriever retriever = new InquiryEvidenceRetriever(products, library,
                new SellerOperationsKnowledgeService(orgSources, orgChunks),
                new AnswerMemoryService(memories, orgChunks, productChunks),
                com.sellerops.order.fact.StoredOnlyOrderFacts.reader(channelOrders, channels, FRESH));
        return new InquiryDraftComposer(workItems, inquiries, draftService, evidence, retriever, model,
                quota, variants, new DraftEvidenceSnippets(productChunks, orgChunks, memories),
                trigger, imageKnowledge);
    }

    /** A passage whose chunk really exists, for the paths that go back to the source to read it. */
    private KnowledgePassage seedChunk(UUID productId, String title, String content) {
        com.sellerops.product.library.ProductKnowledgeSource source =
                new com.sellerops.product.library.ProductKnowledgeSource();
        source.setOrgId(org);
        source.setProductId(productId);
        source.setSourceType(KnowledgeSourceType.FAQ);
        source.setTitle(title);
        source.setBody(content);
        source.setAuthorName("데모 운영자");
        UUID sourceId = productSources.save(source).getId();

        com.sellerops.product.library.ProductKnowledgeChunk chunk =
                new com.sellerops.product.library.ProductKnowledgeChunk();
        chunk.setOrgId(org);
        chunk.setProductId(productId);
        chunk.setSourceId(sourceId);
        chunk.setOrdinal(0);
        chunk.setContent(content);
        chunk.setNormalized(content);
        UUID chunkId = productChunks.save(chunk).getId();

        return new KnowledgePassage(sourceId, chunkId, KnowledgeSourceType.FAQ, title, content, 0,
                0.82, "데모 운영자", null, Instant.parse("2026-08-24T00:00:00Z"));
    }

    private static KnowledgePassage passage(String title, String content) {
        return new KnowledgePassage(UUID.randomUUID(), UUID.randomUUID(), KnowledgeSourceType.USAGE,
                title, content, 0, 0.82, "데모 운영자", null, Instant.parse("2026-08-24T00:00:00Z"));
    }

    private UUID seedProduct() {
        Product p = new Product();
        p.setOrgId(org);
        p.setName("선바로 일체형 전선몰딩");
        p.setSku("SKU-" + UUID.randomUUID());
        p.setStatus("ACTIVE");
        return products.save(p).getId();
    }

    /** As {@link #seedProposed}, with the customer's own words — what the applicability reads. */
    private InquiryWorkItem seedAsking(UUID productId, String title, String body) {
        Inquiry q = new Inquiry();
        q.setOrgId(org);
        q.setChannelId(UUID.randomUUID());
        q.setTitle(title);
        q.setBody(body);
        q.setStatus("UNANSWERED");
        q.setProductId(productId);
        q.setReceivedAt(Instant.parse("2026-08-22T00:00:00Z"));
        UUID inquiryId = inquiries.save(q).getId();

        InquiryWorkItem wi = new InquiryWorkItem();
        wi.setOrgId(org);
        wi.setInquiryId(inquiryId);
        wi.setSellerAccountId(UUID.randomUUID());
        wi.setChannelId(q.getChannelId());
        wi.setPhase(InquiryWorkItemPhase.PROPOSED);
        return workItems.save(wi);
    }

    private InquiryWorkItem seedProposed(UUID productId) {
        Inquiry q = new Inquiry();
        q.setOrgId(org);
        q.setChannelId(UUID.randomUUID());
        q.setTitle("<p>사용 방법이 궁금합니다</p>");
        q.setBody("<p>처음 써봅니다.</p>&nbsp;");
        q.setStatus("UNANSWERED");
        q.setProductId(productId);
        q.setReceivedAt(Instant.parse("2026-08-22T00:00:00Z"));
        UUID inquiryId = inquiries.save(q).getId();

        InquiryWorkItem wi = new InquiryWorkItem();
        wi.setOrgId(org);
        wi.setInquiryId(inquiryId);
        wi.setSellerAccountId(UUID.randomUUID());
        wi.setChannelId(q.getChannelId());
        wi.setPhase(InquiryWorkItemPhase.PROPOSED);
        return workItems.save(wi);
    }

    /** A trigger whose one channel read failed. Nothing else about the draft path changes. */
    private static com.sellerops.product.detail.ProductDetailEnrichmentTrigger failingTrigger() {
        return new com.sellerops.product.detail.ProductDetailEnrichmentTrigger(
                null, null, null, null, List.of(), true) {
            @Override
            public Result enrichIfNeeded(UUID orgId, UUID productId) {
                return new Result(Outcome.READ_FAILED, null);
            }
        };
    }

    /** An inquiry bound to a product by the source — the only shape that reaches the trigger. */
    private InquiryWorkItem seedBound() {
        UUID productId = seedProduct();
        InquiryWorkItem wi = seedProposed(productId);
        Inquiry q = inquiries.findById(wi.getInquiryId()).orElseThrow();
        q.setProductBinding(com.sellerops.inquiry.InquiryProductBinding.SOURCE_EXACT.name());
        inquiries.save(q);
        return wi;
    }

    /** Always allows. The quota's own arithmetic is {@code AgentQuotaServiceTest}'s subject. */
    private static AgentQuotaService allowingQuota() {
        return new AgentQuotaService(null, null) {
            @Override
            public QuotaDecision consume(UUID orgId, AgentUsageKind kind, String runId) {
                return new QuotaDecision(true, null, 0, 0);
            }
        };
    }

    private static AgentQuotaService exhaustedQuota() {
        return new AgentQuotaService(null, null) {
            @Override
            public QuotaDecision consume(UUID orgId, AgentUsageKind kind, String runId) {
                return new QuotaDecision(false, QuotaDecision.Reason.DAILY_LLM_CALLS, 5, 5);
            }
        };
    }

    /** A library with a fixed answer, and a flag proving whether it was consulted at all. */
    static final class StubLibrary extends ProductKnowledgeLibraryService {
        private final int documentsSearched;
        private final List<KnowledgePassage> passages;
        boolean searched;

        private StubLibrary(int documentsSearched, List<KnowledgePassage> passages) {
            super(null, null, null);
            this.documentsSearched = documentsSearched;
            this.passages = passages;
        }

        static StubLibrary returning(KnowledgePassage... found) {
            return new StubLibrary(1, List.of(found));
        }

        static StubLibrary empty(int documentsSearched) {
            return new StubLibrary(documentsSearched, List.of());
        }

        @Override
        public KnowledgeSearchResponse search(UUID orgId, UUID productId, String query, int limit) {
            searched = true;
            return new KnowledgeSearchResponse(productId, query, documentsSearched,
                    documentsSearched, passages);
        }
    }

    /** A model that either writes a fixed draft or is off, recording exactly what it was shown. */
    static final class StubModel extends AgentDraftService {
        private final AgentDraftResponseParser.ParsedDraft answer;
        /**
         * Separate from {@code answer != null} since 2026-08-27, because the two failures it used to
         * conflate are now two different sentences on the seller's screen: a capability that is off,
         * and a capability that ran and came back with nothing.
         */
        private final boolean enabled;
        final List<AgentDraftGenerator.Passage> sawKnowledge = new ArrayList<>();
        String sawTitle;
        String sawDetails;

        private StubModel(AgentDraftResponseParser.ParsedDraft answer, boolean enabled) {
            super(null, null);
            this.answer = answer;
            this.enabled = enabled;
        }

        static StubModel writing(String title, String comments) {
            return new StubModel(
                    new AgentDraftResponseParser.ParsedDraft("general_reply", title, comments), true);
        }

        /** The switch is off. No call is attempted. */
        static StubModel disabled() {
            return new StubModel(null, false);
        }

        /** The switch is on, the call was made, and the vendor gave nothing back. */
        static StubModel refusing() {
            return new StubModel(null, true);
        }

        @Override
        public boolean isEnabledFor(UUID orgId) {
            return enabled;
        }

        @Override
        public String versionFor(UUID orgId) {
            return enabled ? "stub-model/v1" : null;
        }

        String sawOrderState;
        String sawSpecScope;

        // The SIX-argument form is the one the composer calls; overriding a shorter convenience
        // would leave the real implementation running underneath it — which is exactly what broke
        // when the spec-applicability argument was added, and is why the override is the widest one.
        @Override
        public Optional<AgentDraftResponseParser.ParsedDraft> draft(
                UUID orgId, String title, String details, List<AgentDraftGenerator.Passage> knowledge,
                String orderState, String specScope) {
            sawTitle = title;
            sawDetails = details;
            sawKnowledge.addAll(knowledge);
            sawOrderState = orderState;
            sawSpecScope = specScope;
            return Optional.ofNullable(answer);
        }
    }
}
