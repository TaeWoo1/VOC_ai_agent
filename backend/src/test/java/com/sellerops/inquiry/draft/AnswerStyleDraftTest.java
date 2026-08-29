package com.sellerops.inquiry.draft;

import static org.assertj.core.api.Assertions.as;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.InstanceOfAssertFactories.STRING;

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
import com.sellerops.knowledge.style.AnswerLength;
import com.sellerops.knowledge.style.AnswerStyleService;
import com.sellerops.knowledge.style.AnswerTone;
import com.sellerops.knowledge.style.EmojiPolicy;
import com.sellerops.knowledge.style.OrganizationAnswerStyleRepository;
import com.sellerops.knowledge.style.dto.AnswerStyleRequest;
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
 * Organization Answer Style v1 — what the style does, and what it is not allowed to do, at the one
 * place a reply is written.
 *
 * <p><b>Every assertion is about the payload or the stored version, never about a sentence a model
 * produced.</b> The model's wording is not a deterministic function of anything in this repository,
 * so a test that asserted 「친근하게 답했는가」 would be asserting the vendor's mood. What IS ours is
 * which instructions were sent, which facts travelled with them, and what was saved — and the
 * contract this package rests on is checkable there: <b>style changes the wording section and
 * nothing else.</b>
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class AnswerStyleDraftTest {

    private static final OrderStoreFreshness FRESH =
            (orgId, channelCode, accountId, rows) -> ChannelDataState.OBSERVED_FRESH;

    private static final String FALLBACK =
            "정확한 확인이 필요한 내용입니다. 확인 후 다시 안내드리겠습니다.";

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
    @Autowired OrganizationAnswerStyleRepository styleRows;

    private final UUID org = UUID.randomUUID();
    private final UUID user = UUID.randomUUID();
    private ProductKnowledgeLibraryService library;
    private InquiryReplyDraftService draftService;
    private AnswerStyleService styles;

    @BeforeEach
    void setUp() {
        library = new ProductKnowledgeLibraryService(products, productSources, productChunks, variants);
        draftService = new InquiryReplyDraftService(workItems, draftRows);
        styles = new AnswerStyleService(styleRows);
    }

    // ---------------------------------------------------------------- A · B

    @Test
    @DisplayName("A — with no profile, the model is told nothing extra: today's prompt is unchanged")
    void noProfileSendsNoStyleSection() {
        StubModel model = grounded();
        composer(model).generate(org, groundedInquiry(), user);

        assertThat(model.calls).isEqualTo(1);
        assertThat(model.sawStyle).isNull();
    }

    @Test
    @DisplayName("B — POLITE and FRIENDLY are two different instructions, in our words, not the seller's")
    void toneChangesWhatTheModelIsTold() {
        UUID work = groundedInquiry();
        save(AnswerTone.POLITE, AnswerLength.NORMAL, EmojiPolicy.NONE, "고객님");
        StubModel polite = grounded();
        composer(polite).generate(org, work, user);

        save(AnswerTone.FRIENDLY, AnswerLength.SHORT, EmojiPolicy.LIMITED, "고객님");
        StubModel friendly = grounded();
        composer(friendly).generate(org, work, user);

        assertThat(polite.sawStyle).contains(AnswerTone.POLITE.instructionKo());
        assertThat(friendly.sawStyle).contains(AnswerTone.FRIENDLY.instructionKo())
                .contains(AnswerLength.SHORT.instructionKo())
                .contains(EmojiPolicy.LIMITED.instructionKo());
        assertThat(polite.sawStyle).isNotEqualTo(friendly.sawStyle);
    }

    // ---------------------------------------------------------------- C

    @Test
    @DisplayName("C — the same question with two styles carries the same facts; only the wording moves")
    void styleDoesNotTouchTheFacts() {
        UUID work = groundedInquiry();
        save(AnswerTone.POLITE, AnswerLength.NORMAL, EmojiPolicy.NONE, null);
        StubModel first = grounded();
        composer(first).generate(org, work, user);

        save(AnswerTone.CONCISE, AnswerLength.DETAILED, EmojiPolicy.LIMITED, "고객님");
        StubModel second = grounded();
        composer(second).generate(org, work, user);

        assertThat(second.sawKnowledge).as("the same passages, in the same order")
                .isEqualTo(first.sawKnowledge);
        assertThat(second.sawOrderState).isEqualTo(first.sawOrderState);
        assertThat(second.sawSpecScope).isEqualTo(first.sawSpecScope);
        assertThat(second.sawTitle).isEqualTo(first.sawTitle);
        assertThat(second.sawDetails).isEqualTo(first.sawDetails);
        assertThat(second.sawStyle).as("and the ONLY thing that moved").isNotEqualTo(first.sawStyle);
    }

    @Test
    @DisplayName("C2 — a conversation tone hint moves the style section only; the facts are byte-identical")
    void toneHintDoesNotTouchTheFacts() {
        UUID work = groundedInquiry();
        StubModel plain = grounded();
        composer(plain).generate(org, work, user);

        StubModel softer = grounded();
        composer(softer).generate(org, work, user, ToneHint.SOFTER);

        assertThat(softer.sawKnowledge).isEqualTo(plain.sawKnowledge);
        assertThat(softer.sawOrderState).isEqualTo(plain.sawOrderState);
        assertThat(softer.sawSpecScope).isEqualTo(plain.sawSpecScope);
        assertThat(softer.sawTitle).isEqualTo(plain.sawTitle);
        assertThat(softer.sawDetails).isEqualTo(plain.sawDetails);
        assertThat(plain.sawStyle).as("no profile, no hint: no style section").isNull();
        assertThat(softer.sawStyle).as("the hint is the org tone, overridden, in our words")
                .contains(AnswerTone.FRIENDLY.instructionKo());

        StubModel shorter = grounded();
        composer(shorter).generate(org, work, user, ToneHint.SHORTER);
        assertThat(shorter.sawStyle).contains(AnswerLength.SHORT.instructionKo());
        assertThat(shorter.sawKnowledge).isEqualTo(plain.sawKnowledge);
        assertThat(shorter.sawDetails).isEqualTo(plain.sawDetails);

        // The overridden profile is what the stamp sees, so the identity moved without a new column.
        assertThat(styles.profileFor(org).isDefault()).as("and the org setting itself did not move").isTrue();
    }

    @Test
    @DisplayName("C3 — a hint over NO_ANSWER_BASIS is ignored: no model, no draft, same as before")
    void toneHintIgnoredWithoutBasis() {
        StubModel model = grounded();
        GeneratedDraftView view = composer(model).generate(org, unanswerableInquiry(), user, ToneHint.SOFTER);

        assertThat(model.calls).isZero();
        assertThat(view.draft()).isNull();
    }

    // ---------------------------------------------------------------- D

    @Test
    @DisplayName("D — a forbidden phrase in the generated reply refuses the draft; it is not edited out")
    void aForbiddenPhraseRefusesTheDraft() {
        UUID work = groundedInquiry();
        styles.save(org, new AnswerStyleRequest(null, null, null, null, null, null,
                List.of(), List.of("죄송하지만"), null), user);
        StubModel model = StubModel.writing("답변", "죄송하지만 확인이 어렵습니다.");

        GeneratedDraftView view = composer(model).generate(org, work, user);

        assertThat(model.calls).as("the model ran — this is a check on its output").isEqualTo(1);
        assertThat(view.draft()).isNull();
        assertThat(view.unavailableMessage()).isEqualTo(InquiryDraftComposer.STYLE_FORBIDDEN_PHRASE);
        assertThat(draftRows.findTopByWorkItemIdOrderByVersionDesc(work))
                .as("nothing carrying the banned phrase was saved").isEmpty();
    }

    @Test
    @DisplayName("the ban survives the spacing the model chose — 「무료 배송」 catches 「무료배송」")
    void theBanIsNotDefeatedByASpace() {
        UUID work = groundedInquiry();
        styles.save(org, new AnswerStyleRequest(null, null, null, null, null, null,
                List.of(), List.of("무료 배송"), null), user);

        GeneratedDraftView view = composer(StubModel.writing("답변", "무료배송 가능합니다."))
                .generate(org, work, user);
        assertThat(view.draft()).isNull();
    }

    // ---------------------------------------------------------------- F · G

    @Test
    @DisplayName("F — no basis and no approved fallback: no model call, no draft. Unchanged.")
    void noBasisAndNoFallbackWritesNothing() {
        StubModel model = grounded();
        GeneratedDraftView view = composer(model).generate(org, unanswerableInquiry(), user);

        assertThat(view.answerBasis()).isEqualTo(AnswerBasisState.NO_ANSWER_BASIS.name());
        assertThat(view.draft()).isNull();
        assertThat(model.calls).isZero();
    }

    @Test
    @DisplayName("G — no basis with an approved fallback: the seller's sentence, verbatim, no model call")
    void theApprovedFallbackIsUsedExactly() {
        UUID work = unanswerableInquiry();
        styles.save(org, new AnswerStyleRequest(AnswerTone.FRIENDLY, AnswerLength.SHORT,
                EmojiPolicy.LIMITED, "안녕하세요. 선바로입니다.", "감사합니다.", "고객님",
                List.of(), List.of(), FALLBACK), user);
        StubModel model = grounded();

        GeneratedDraftView view = composer(model).generate(org, work, user);

        assertThat(model.calls).as("a pre-approved sentence needs no model").isZero();
        assertThat(view.draft()).isNotNull();
        assertThat(view.draft().comments()).as("not a word changed, and no greeting bolted on")
                .isEqualTo(FALLBACK);
        assertThat(view.authorKind())
                .isEqualTo(DraftAuthorKind.SELLER_APPROVED_FALLBACK.name());
        assertThat(view.answerBasis())
                .as("a deferral is not an answer — the screen still says what is missing")
                .isEqualTo(AnswerBasisState.NO_ANSWER_BASIS.name());
        assertThat(view.answerBasisAction()).isNotNull();
        assertThat(view.evidence()).as("nothing was cited, because nothing applied").isEmpty();
        assertThat(draftRows.findTopByWorkItemIdOrderByVersionDesc(work))
                .get().extracting(d -> d.getModelVersion(), as(STRING)).startsWith("style/v1@");
    }

    // ---------------------------------------------------------------- H

    @Test
    @DisplayName("H — in NEEDS_CLARIFICATION the style applies and adds no question of its own")
    void clarificationKeepsItsOwnMissingContext() {
        UUID productId = seedProduct();
        UUID three = seedVariant(productId, "3호");
        library.create(org, productId, new KnowledgeSourceRequest(KnowledgeSourceType.DESCRIPTION,
                "3호 수용 전선", "3호 몰딩에는 전선을 4가닥까지 넣을 수 있습니다.", null, three), user, "판매자");
        UUID work = seedAsking(productId, "전선이 몇 가닥까지 들어가나요?", "몇 가닥 넣을 수 있나요?").getId();
        save(AnswerTone.FRIENDLY, AnswerLength.SHORT, EmojiPolicy.NONE, "고객님");
        StubModel model = grounded();

        GeneratedDraftView view = composer(model).generate(org, work, user);

        assertThat(view.answerBasis()).isEqualTo(AnswerBasisState.NEEDS_CLARIFICATION.name());
        assertThat(model.sawStyle).as("the wording is still the company's")
                .contains(AnswerTone.FRIENDLY.instructionKo());
        assertThat(model.sawSpecScope).contains("확정되지 않았습니다");
        assertThat(model.sawStyle)
                .as("what to ASK about comes from applicability; the style names no topic and no option")
                .doesNotContain("가닥").doesNotContain("3호")
                .doesNotContain("전선");
    }

    // ---------------------------------------------------------------- versioning (§15)

    @Test
    @DisplayName("changing a style does not touch a version already written — append-only, still")
    void aStyleChangeDoesNotRewriteHistory() {
        UUID work = groundedInquiry();
        save(AnswerTone.POLITE, AnswerLength.NORMAL, EmojiPolicy.NONE, null);
        GeneratedDraftView first = composer(grounded()).generate(org, work, user);
        int version = first.draft().version();
        String body = first.draft().comments();
        String stamp = draftRows.findTopByWorkItemIdOrderByVersionDesc(work).orElseThrow()
                .getModelVersion();
        assertThat(stamp).contains("style/v1");

        save(AnswerTone.CONCISE, AnswerLength.SHORT, EmojiPolicy.LIMITED, "고객님");

        var stored = draftRows.findTopByWorkItemIdOrderByVersionDesc(work).orElseThrow();
        assertThat(stored.getVersion()).isEqualTo(version);
        assertThat(stored.getComments()).isEqualTo(body);
        assertThat(stored.getModelVersion()).as("last month's wording stays readable")
                .isEqualTo(stamp);
    }

    // ---------------------------------------------------------------- helpers

    private void save(AnswerTone tone, AnswerLength length, EmojiPolicy emoji, String address) {
        styles.save(org, new AnswerStyleRequest(tone, length, emoji, null, null, address,
                List.of(), List.of(), null), user);
    }

    /** A question whose answer is in the library and does not move with 규격. */
    private UUID groundedInquiry() {
        UUID productId = seedProduct();
        library.create(org, productId, new KnowledgeSourceRequest(KnowledgeSourceType.DESCRIPTION,
                "부착 방법", "몰딩 뒷면 테이프를 벗기고 벽면에 눌러 붙입니다.", null, null), user, "판매자");
        return seedAsking(productId, "어떻게 붙이나요?", "부착 방법이 궁금합니다.").getId();
    }

    /** A question with no library behind it at all. */
    private UUID unanswerableInquiry() {
        return seedAsking(seedProduct(), "포장은 어떻게 되나요?", "포장 상태가 궁금합니다.").getId();
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

    private static StubModel grounded() {
        return StubModel.writing("답변", "안내드립니다. 확인 부탁드립니다.");
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
                null, styles, null);
    }

    private static AgentQuotaService allowingQuota() {
        return new AgentQuotaService(null, null) {
            @Override
            public QuotaDecision consume(UUID orgId, AgentUsageKind kind, String runId) {
                return new QuotaDecision(true, null, 0, 0);
            }
        };
    }

    /** A model that records exactly what it was told, including the style section. */
    static final class StubModel extends AgentDraftService {
        private final AgentDraftResponseParser.ParsedDraft answer;
        final List<AgentDraftGenerator.Passage> sawKnowledge = new ArrayList<>();
        String sawTitle;
        String sawDetails;
        String sawOrderState;
        String sawSpecScope;
        String sawStyle;
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
            return "stub-model/v1";
        }

        @Override
        public Optional<AgentDraftResponseParser.ParsedDraft> draft(
                UUID orgId, String title, String details, List<AgentDraftGenerator.Passage> knowledge,
                String orderState, String specScope, String style, String companyContext) {
            calls++;
            sawKnowledge.clear();
            sawKnowledge.addAll(knowledge);
            sawTitle = title;
            sawDetails = details;
            sawOrderState = orderState;
            sawSpecScope = specScope;
            sawStyle = style;
            return Optional.ofNullable(answer);
        }
    }
}
