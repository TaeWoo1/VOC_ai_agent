package com.sellerops.inquiry.draft;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sellerops.agent.llm.AgentDraftGenerator;
import com.sellerops.agent.llm.AgentDraftResponseParser;
import com.sellerops.agent.llm.AgentDraftService;
import com.sellerops.agent.quota.AgentQuotaService;
import com.sellerops.agent.quota.AgentUsageKind;
import com.sellerops.agent.quota.QuotaDecision;
import com.sellerops.coverage.ChannelDataState;
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
import com.sellerops.order.ChannelOrderRepository;
import com.sellerops.order.fact.OrderStoreFreshness;
import com.sellerops.product.Product;
import com.sellerops.product.ProductRepository;
import com.sellerops.product.ProductVariant;
import com.sellerops.product.ProductVariantRepository;
import com.sellerops.product.library.KnowledgeSourceType;
import com.sellerops.product.library.ProductKnowledgeChunkRepository;
import com.sellerops.product.library.ProductKnowledgeLibraryService;
import com.sellerops.product.library.ProductKnowledgeSourceRepository;
import com.sellerops.product.library.dto.KnowledgeSourceRequest;
import com.sellerops.product.library.dto.KnowledgeSourceView;
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
 * Knowledge Gap Resolution v1 — the seller answers what SellerOps could not, and the same question is
 * judged again.
 *
 * <p><b>Everything here runs over the REAL library service.</b> The composer tests next door stub the
 * product lane, because they are about which sentence a state produces; these are about whether a
 * document a seller just wrote is actually retrievable and actually applies, and a stub that returns
 * a fixed passage cannot fail either way. The only stub is the model, and only because a live vendor
 * would make this suite cost money and stop being deterministic.
 *
 * <p><b>The negative cases are the point.</b> Saving knowledge is not a licence to say GROUNDED: a
 * sentence about a different 규격 is evidence about a different item, and a sentence about a topic
 * nobody asked about is not evidence at all. Both leave the state exactly where it was.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class KnowledgeGapResolutionTest {

    private static final OrderStoreFreshness FRESH =
            (orgId, channelCode, accountId, rows) -> ChannelDataState.OBSERVED_FRESH;

    /** The question the whole line of work started from. Kept verbatim. */
    private static final String QUESTION = "전선이 몇 가닥까지 들어가나요?";

    @Autowired InquiryWorkItemRepository workItems;
    @Autowired InquiryRepository inquiries;
    @Autowired InquiryReplyDraftRepository draftRows;
    @Autowired InquiryDraftEvidenceRepository evidence;
    @Autowired ProductRepository products;
    @Autowired ProductVariantRepository variants;
    @Autowired ProductKnowledgeSourceRepository productSources;
    @Autowired ProductKnowledgeChunkRepository productChunks;
    @Autowired OrgKnowledgeSourceRepository orgSources;
    @Autowired OrgKnowledgeChunkRepository orgChunks;
    @Autowired AnswerMemoryRepository memories;
    @Autowired ChannelOrderRepository channelOrders;
    @Autowired com.sellerops.channel.ChannelRepository channels;

    private final UUID org = UUID.randomUUID();
    private final UUID user = UUID.randomUUID();
    private ProductKnowledgeLibraryService library;
    private InquiryReplyDraftService draftService;

    @BeforeEach
    void setUp() {
        library = new ProductKnowledgeLibraryService(products, productSources, productChunks, variants);
        draftService = new InquiryReplyDraftService(workItems, draftRows);
    }

    // ---------------------------------------------------------------- B

    @Test
    @DisplayName("B — a saved answer basis is indexed in the same transaction, so it is quotable at once")
    void savingIndexes() {
        UUID productId = seedProduct();
        KnowledgeSourceView saved = library.create(org, productId,
                new KnowledgeSourceRequest(KnowledgeSourceType.DESCRIPTION, "수용 전선",
                        "2호 몰딩에는 일반 가전 전선 기준으로 3가닥까지 들어갑니다.", null, null),
                user, "판매자");

        assertThat(saved.chunks()).as("a document with no passages is one no question can reach")
                .isGreaterThan(0);
        assertThat(productChunks.findAllByOrgIdAndProductId(org, productId)).isNotEmpty();
        assertThat(saved.variantId()).as("전체 상품 공통 is the default, and it is a decision, not a null")
                .isNull();
        assertThat(saved.scopeKo()).isEqualTo("전체 상품 공통");
    }

    // ---------------------------------------------------------------- A (state) + the loop

    @Test
    @DisplayName("the loop: NO_ANSWER_BASIS, the seller writes one sentence, and the question is answerable")
    void theLoop() {
        UUID productId = seedProduct();
        InquiryWorkItem work = seedAsking(productId, QUESTION, "몰딩 하나에 몇 가닥이나 넣을 수 있나요?");
        StubModel model = StubModel.writing("답변", "본문");

        GeneratedDraftView before = composer(model).generate(org, work.getId(), user);
        assertThat(before.answerBasis()).isEqualTo(AnswerBasisState.NO_ANSWER_BASIS.name());
        assertThat(before.draft()).isNull();
        assertThat(before.productId()).as("the CTA needs somewhere to save; this is it")
                .isEqualTo(productId);
        assertThat(before.answerBasisAction())
                .as("§9 — the customer's own noun, handed back deterministically")
                .contains("「가닥」").contains("규격");
        assertThat(model.calls).as("no basis means no model call, before and after").isZero();

        library.create(org, productId, new KnowledgeSourceRequest(KnowledgeSourceType.DESCRIPTION,
                "수용 가능한 전선", "몰딩 안에는 전선을 3가닥까지 넣을 수 있습니다.", null, null), user, "판매자");

        GeneratedDraftView after = composer(model).generate(org, work.getId(), user);
        // NOT «saved knowledge ⇒ GROUNDED». This question moves with the 규격 and this listing
        // declares none, so the honest verdict is that a basis now exists and one fact is still
        // missing — and the missing fact belongs to the customer, not to the seller. A draft IS
        // written, and asking which 규격 is the whole of it.
        assertThat(after.knowledgeState()).isEqualTo(DraftKnowledgeState.GROUNDED.name());
        assertThat(after.answerBasis()).isEqualTo(AnswerBasisState.NEEDS_CLARIFICATION.name());
        assertThat(after.draft()).isNotNull();
        assertThat(after.evidence()).hasSize(1);
        assertThat(model.sawKnowledge).extracting(AgentDraftGenerator.Passage::text)
                .anyMatch(t -> t.contains("3가닥"));
    }

    @Test
    @DisplayName("A — a question that cannot move with the option is GROUNDED as soon as the seller answers it")
    void aQuestionThatDoesNotMoveWithTheOptionBecomesGrounded() {
        UUID productId = seedProduct();
        InquiryWorkItem work = seedAsking(productId, "실크벽지에도 붙나요?", "실크벽지에 붙일 수 있나요?");
        StubModel model = StubModel.writing("답변", "본문");

        assertThat(composer(model).generate(org, work.getId(), user).answerBasis())
                .isEqualTo(AnswerBasisState.NO_ANSWER_BASIS.name());

        library.create(org, productId, new KnowledgeSourceRequest(KnowledgeSourceType.USAGE,
                "벽지 부착", "실크벽지에도 붙습니다. 표면의 먼지를 닦고 눌러 주세요.", null, null), user, "판매자");

        GeneratedDraftView after = composer(model).generate(org, work.getId(), user);
        assertThat(after.answerBasis()).isEqualTo(AnswerBasisState.GROUNDED.name());
        assertThat(after.draft()).isNotNull();
        assertThat(model.sawApplicability).isEqualTo("(해당 없음)");
    }

    // ---------------------------------------------------------------- C

    @Test
    @DisplayName("C — knowledge that does not answer this question leaves NO_ANSWER_BASIS exactly where it was")
    void irrelevantKnowledgeChangesNothing() {
        UUID productId = seedProduct();
        InquiryWorkItem work = seedAsking(productId, QUESTION, "몇 가닥이나 들어가나요?");
        StubModel model = StubModel.writing("답변", "본문");

        library.create(org, productId, new KnowledgeSourceRequest(KnowledgeSourceType.POLICY,
                "교환 및 반품", "수령 후 7일 이내에 교환이나 반품을 요청하실 수 있습니다.", null, null),
                user, "판매자");

        GeneratedDraftView view = composer(model).generate(org, work.getId(), user);
        assertThat(view.answerBasis()).isEqualTo(AnswerBasisState.NO_ANSWER_BASIS.name());
        assertThat(view.draft()).isNull();
        assertThat(view.knowledgeState()).as("the library exists; it does not cover this")
                .isEqualTo(DraftKnowledgeState.NO_MATCH.name());
        assertThat(model.calls).isZero();
    }

    // ---------------------------------------------------------------- D

    @Test
    @DisplayName("D — per-규격 knowledge with no 규격 named is NEEDS_CLARIFICATION, and the model is told so")
    void variantKnowledgeWithNoVariantNamed() {
        UUID productId = seedProduct();
        UUID second = seedVariant(productId, "3호");
        seedKnowledgeFor(productId, second, "3호 몰딩에는 전선을 4가닥까지 넣을 수 있습니다.");
        InquiryWorkItem work = seedAsking(productId, QUESTION, "몇 가닥이나 들어가나요?");
        StubModel model = StubModel.writing("답변", "본문");

        GeneratedDraftView view = composer(model).generate(org, work.getId(), user);

        assertThat(view.answerBasis()).isEqualTo(AnswerBasisState.NEEDS_CLARIFICATION.name());
        assertThat(view.draft()).as("asking which 규격 IS an answer, and it invents nothing").isNotNull();
        assertThat(model.sawApplicability)
                .contains("어떤 규격인지 확정되지 않았습니다")
                .contains("특정 규격에만 해당하는 내용");
        assertThat(model.sawApplicability).as("the payload floor: a caution, never the option list")
                .doesNotContain("3호");
    }

    // ---------------------------------------------------------------- E

    @Test
    @DisplayName("E — the customer names their 규격, and that 규격's knowledge grounds the reply")
    void variantKnowledgeWithTheVariantNamed() {
        UUID productId = seedProduct();
        UUID second = seedVariant(productId, "3호");
        seedKnowledgeFor(productId, second, "3호 몰딩에는 전선을 4가닥까지 넣을 수 있습니다.");
        InquiryWorkItem work = seedAsking(productId, "3호 문의", "3호 쓰는데 전선이 몇 가닥까지 들어가나요?");
        StubModel model = StubModel.writing("답변", "본문");

        GeneratedDraftView view = composer(model).generate(org, work.getId(), user);

        assertThat(view.answerBasis()).isEqualTo(AnswerBasisState.GROUNDED.name());
        assertThat(model.sawKnowledge).extracting(AgentDraftGenerator.Passage::text)
                .anyMatch(t -> t.contains("4가닥"));
        assertThat(model.sawApplicability).as("resolved: no per-규격 caution is added")
                .doesNotContain("특정 규격에만 해당하는 내용");
    }

    // ---------------------------------------------------------------- F

    @Test
    @DisplayName("F — another 규격's knowledge is not weak evidence about this customer; it is excluded")
    void anotherVariantsKnowledgeIsNotEvidence() {
        UUID productId = seedProduct();
        UUID two = seedVariant(productId, "2호");
        seedVariant(productId, "3호");
        seedKnowledgeFor(productId, two, "2호 몰딩에는 전선을 3가닥까지 넣을 수 있습니다.");
        InquiryWorkItem work = seedAsking(productId, "3호 문의", "3호 쓰는데 전선이 몇 가닥까지 들어가나요?");
        StubModel model = StubModel.writing("답변", "본문");

        GeneratedDraftView view = composer(model).generate(org, work.getId(), user);

        assertThat(model.sawKnowledge).as("the 2호 sentence never reaches the drafter at all").isEmpty();
        assertThat(view.answerBasis()).isEqualTo(AnswerBasisState.NO_ANSWER_BASIS.name());
        assertThat(view.draft()).isNull();
        assertThat(model.calls).isZero();
    }

    @Test
    @DisplayName("F — the filter excludes the other 규격 and keeps 전체 상품 공통, at the library itself")
    void theFilterKeepsProductLevelAndDropsTheOtherVariant() {
        UUID productId = seedProduct();
        UUID two = seedVariant(productId, "2호");
        UUID three = seedVariant(productId, "3호");
        library.create(org, productId, new KnowledgeSourceRequest(KnowledgeSourceType.DESCRIPTION,
                "수용 가능한 전선", "몰딩 안에는 전선을 3가닥까지 넣을 수 있습니다.", null, null), user, "판매자");
        seedKnowledgeFor(productId, two, "2호 몰딩에는 전선을 3가닥까지 넣을 수 있습니다.");

        // Asserted here rather than through a draft on purpose: this is a statement about which
        // DOCUMENTS a scope admits, and running it through the scorer would let a retrieval
        // threshold answer for the filter.
        assertThat(library.search(org, productId, "전선이 몇 가닥까지 들어가나요", 5,
                com.sellerops.product.library.KnowledgeVariantScope.of(three)).passages())
                .as("전체 상품 공통 is true of 3호 too; the other 규격's sentence is not")
                .hasSize(1)
                .allMatch(p -> p.content().startsWith("몰딩 안에는"));

        assertThat(library.search(org, productId, "전선이 몇 가닥까지 들어가나요", 5,
                com.sellerops.product.library.KnowledgeVariantScope.unresolved()).passages())
                .as("nobody named a 규격, so nothing is excluded — that is what NEEDS_CLARIFICATION rests on")
                .hasSize(2);
    }

    @Test
    @DisplayName("a 규격 from another product cannot be bound — the scope is a channel fact, not a label")
    void aForeignVariantIsRefused() {
        UUID productId = seedProduct();
        UUID otherProduct = seedProduct();
        UUID foreign = seedVariant(otherProduct, "2호");

        assertThatThrownBy(() -> library.create(org, productId,
                new KnowledgeSourceRequest(KnowledgeSourceType.DESCRIPTION, "제목", "본문", null, foreign),
                user, "판매자"))
                .hasMessageContaining("이 상품의 규격이 아닙니다");
    }

    // ---------------------------------------------------------------- helpers

    private void seedKnowledgeFor(UUID productId, UUID variantId, String body) {
        library.create(org, productId, new KnowledgeSourceRequest(KnowledgeSourceType.DESCRIPTION,
                "수용 가능한 전선", body, null, variantId), user, "판매자");
    }

    private UUID seedProduct() {
        Product p = new Product();
        p.setOrgId(org);
        p.setName("선바로 일체형 전선몰딩");
        p.setSku("SKU-" + UUID.randomUUID());
        p.setStatus("ACTIVE");
        return products.save(p).getId();
    }

    private UUID seedVariant(UUID productId, String optionName) {
        ProductVariant v = new ProductVariant();
        v.setOrgId(org);
        v.setProductId(productId);
        v.setExternalVariantId("opt-" + UUID.randomUUID());
        v.setOptionName(optionName);
        v.setSource("TEST");
        v.setObservedAt(Instant.parse("2026-08-22T00:00:00Z"));
        return variants.save(v).getId();
    }

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

    private InquiryDraftComposer composer(StubModel model) {
        InquiryEvidenceRetriever retriever = new InquiryEvidenceRetriever(products, library,
                new SellerOperationsKnowledgeService(orgSources, orgChunks),
                new AnswerMemoryService(memories, orgChunks, productChunks),
                com.sellerops.order.fact.StoredOnlyOrderFacts.reader(channelOrders, channels, FRESH));
        return new InquiryDraftComposer(workItems, inquiries, draftService, evidence, retriever, model,
                allowingQuota(), variants, new DraftEvidenceSnippets(productChunks, orgChunks, memories),
                new com.sellerops.product.detail.ProductDetailEnrichmentTrigger(
                        null, null, null, null, List.of(), false),
                null, null);
    }

    private static AgentQuotaService allowingQuota() {
        return new AgentQuotaService(null, null) {
            @Override
            public QuotaDecision consume(UUID orgId, AgentUsageKind kind, String runId) {
                return new QuotaDecision(true, null, 0, 0);
            }
        };
    }

    /** A model that records what it was shown and how many times it was reached. */
    static final class StubModel extends AgentDraftService {
        private final AgentDraftResponseParser.ParsedDraft answer;
        final List<AgentDraftGenerator.Passage> sawKnowledge = new ArrayList<>();
        String sawApplicability;
        int calls;

        private StubModel(AgentDraftResponseParser.ParsedDraft answer) {
            super(null, null);
            this.answer = answer;
        }

        static StubModel writing(String title, String comments) {
            return new StubModel(
                    new AgentDraftResponseParser.ParsedDraft("general_reply", title, comments));
        }

        @Override
        public boolean isEnabledFor(UUID orgId) {
            return true;
        }

        @Override
        public String versionFor(UUID orgId) {
            return "stub/v1";
        }

        @Override
        public Optional<AgentDraftResponseParser.ParsedDraft> draft(
                UUID orgId, String title, String details,
                List<AgentDraftGenerator.Passage> knowledge, String orderState, String applicability,
                String style) {
            calls++;
            sawKnowledge.clear();
            sawKnowledge.addAll(knowledge);
            sawApplicability = applicability;
            return Optional.ofNullable(answer);
        }
    }
}
