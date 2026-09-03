package com.sellerops.knowledge.setup;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sellerops.common.ApiException;
import com.sellerops.knowledge.candidate.KnowledgeCandidateRepository;
import com.sellerops.knowledge.candidate.KnowledgeCandidateService;
import com.sellerops.knowledge.candidate.dto.KnowledgeCandidateView;
import com.sellerops.knowledge.document.KnowledgeSummaryService;
import com.sellerops.knowledge.document.dto.KnowledgeSummaryView;
import com.sellerops.knowledge.memory.AnswerMemoryRepository;
import com.sellerops.knowledge.org.OrgKnowledgeChunkRepository;
import com.sellerops.knowledge.org.OrgKnowledgeSource;
import com.sellerops.knowledge.org.OrgKnowledgeSourceRepository;
import com.sellerops.knowledge.org.OrgKnowledgeType;
import com.sellerops.knowledge.org.SellerOperationsKnowledgeService;
import com.sellerops.organization.Organization;
import com.sellerops.organization.OrganizationRepository;
import com.sellerops.product.Product;
import com.sellerops.product.ProductRepository;
import com.sellerops.product.ProductVariant;
import com.sellerops.product.ProductVariantRepository;
import com.sellerops.product.library.KnowledgeSourceType;
import com.sellerops.product.library.ProductKnowledgeChunkRepository;
import com.sellerops.product.library.ProductKnowledgeIndexer;
import com.sellerops.product.library.ProductKnowledgeSource;
import com.sellerops.product.library.ProductKnowledgeSourceRepository;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * <b>Knowledge Setup &amp; Inbox UX v1 — the two properties the screens rest on.</b>
 *
 * <p><b>§3 A question is never an answer.</b> The measured defect: 「답변 기준으로 등록」 on a
 * drafting-gap card wrote the candidate's stored text — which for a gap is 「'…'에 대해 고객에게
 * 안내하는 공식 기준이 있나요? 이 상품에 저장된 지식에서 찾지 못했습니다.」 — into the company's
 * product knowledge as an indexed, citable FAQ. The next customer to ask would have been answered
 * with reviewnary's own confusion. A repeated ANSWER may still be accepted unedited, because that
 * text is a sentence the seller has already written to customers many times.
 *
 * <p><b>§2 The numbers partition.</b> A seller can add 상품 지식 + 운영 기준 + 연결된 자료 and get
 * the size of their library, which is the only reason to print four numbers instead of one.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class KnowledgeSetupInboxTest {

    @Autowired OrganizationRepository organizations;
    @Autowired ProductRepository products;
    @Autowired ProductKnowledgeSourceRepository productSources;
    @Autowired ProductKnowledgeChunkRepository productChunks;
    @Autowired OrgKnowledgeSourceRepository orgSources;
    @Autowired OrgKnowledgeChunkRepository orgChunks;
    @Autowired AnswerMemoryRepository memories;
    @Autowired KnowledgeCandidateRepository candidateRows;
    @Autowired ProductVariantRepository variantRows;

    private KnowledgeCandidateService candidates;
    private KnowledgeSummaryService summary;
    private UUID org;
    private UUID productId;

    @BeforeEach
    void setUp() {
        ProductKnowledgeIndexer productIndexer = new ProductKnowledgeIndexer(productChunks);
        SellerOperationsKnowledgeService orgKnowledge =
                new SellerOperationsKnowledgeService(orgSources, orgChunks, null, null);
        candidates = new KnowledgeCandidateService(candidateRows, memories, productSources,
                productIndexer, products, orgSources, orgKnowledge, variantRows);
        summary = new KnowledgeSummaryService(productSources, orgSources, memories, products,
                candidateRows);

        Organization o = new Organization();
        o.setName("지식 설정 QA");
        org = organizations.save(o).getId();
        Product p = new Product();
        p.setOrgId(org);
        p.setName("QA 실리콘 주방매트");
        p.setSku("SKU-" + UUID.randomUUID());
        p.setStatus("ACTIVE");
        productId = products.save(p).getId();
    }

    private UUID variant(String optionName) {
        ProductVariant v = new ProductVariant();
        v.setOrgId(org);
        v.setProductId(productId);
        v.setOptionName(optionName);
        v.setSource("CHANNEL_LISTING");
        v.setObservedAt(java.time.Instant.now());
        return variantRows.save(v).getId();
    }

    @Test
    @DisplayName("an answered ask is REPORTED as answered, not merely not-refiled")
    void anAnsweredAskSaysSo() {
        String question = "「미끄럼 방지」에 대해 고객에게 안내할 공식 기준이 필요합니다.";
        UUID candidateId = candidates.noteGap(org, "PRODUCT", productId, "미끄럼 방지", question).getId();

        // Before the seller answers it, nothing claims they did.
        assertThat(candidates.alreadyAnswered(org, "PRODUCT", productId, question)).isFalse();

        candidates.accept(org, candidateId, "미끄럼 방지 안내", "이 매트는 실리콘 도트로 고정됩니다.",
                KnowledgeSourceType.USAGE, null, null, null, "판매자");

        // Afterwards it is a FACT the screen can read — the difference between 「정보를 입력하세요」 and
        // 「기준은 추가하셨지만 이 질문에는 아직 적용되지 않습니다」. Telling a seller to add what they
        // already added says their work did not happen.
        assertThat(candidates.alreadyAnswered(org, "PRODUCT", productId, question)).isTrue();
        // And the ask is still not refiled — the two facts are separate and both hold.
        assertThat(candidates.noteGap(org, "PRODUCT", productId, "미끄럼 방지", question)).isNull();
    }

    @Test
    @DisplayName("a different ask is a different question — identity, never resemblance")
    void anotherAskIsUntouched() {
        String answered = "「미끄럼 방지」에 대해 고객에게 안내할 공식 기준이 필요합니다.";
        String other = "「두께」에 대해 고객에게 안내할 공식 기준이 필요합니다.";
        UUID id = candidates.noteGap(org, "PRODUCT", productId, "미끄럼 방지", answered).getId();
        candidates.accept(org, id, "미끄럼 방지 안내", "실리콘 도트로 고정됩니다.",
                KnowledgeSourceType.USAGE, null, null, null, "판매자");

        assertThat(candidates.alreadyAnswered(org, "PRODUCT", productId, other)).isFalse();
        // The same words about the COMPANY are a different ask too: the scope is part of the identity.
        assertThat(candidates.alreadyAnswered(org, "ORG", null, answered)).isFalse();
    }

    @Test
    @DisplayName("§3 — a drafting gap accepted with nothing written is refused, not filed")
    void aGapIsNeverItsOwnAnswer() {
        UUID candidateId = candidates
                .noteGap(org, "PRODUCT", productId, "미끄럼 방지",
                        "「미끄럼 방지」에 대해 고객에게 안내할 공식 기준이 필요합니다.")
                .getId();

        assertThatThrownBy(() -> candidates.accept(org, candidateId, null, null, null, null, null, "판매자"))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("고객에게 안내할 내용");

        // Nothing was written, and the ask is still waiting.
        assertThat(productSources.countByOrgIdAndProductId(org, productId)).isZero();
        assertThat(candidateRows.countByOrgIdAndState(org, KnowledgeCandidateService.STATE_OPEN))
                .isEqualTo(1);
    }

    @Test
    @DisplayName("§3 — the same gap, with the seller's own sentence, becomes ordinary knowledge")
    void aGapWithASentenceIsFiled() {
        UUID candidateId = candidates
                .noteGap(org, "PRODUCT", productId, "미끄럼 방지",
                        "「미끄럼 방지」에 대해 고객에게 안내할 공식 기준이 필요합니다.")
                .getId();

        candidates.accept(org, candidateId, "미끄럼 방지",
                "물기를 닦은 평평한 바닥에서는 밀리지 않습니다.",
                KnowledgeSourceType.FAQ, null, null, "판매자");

        ProductKnowledgeSource written = productSources
                .findAllByOrgIdAndProductIdOrderByCreatedAtAsc(org, productId).get(0);
        assertThat(written.getBody()).isEqualTo("물기를 닦은 평평한 바닥에서는 밀리지 않습니다.");
        assertThat(written.getBody()).doesNotContain("있나요");
    }

    @Test
    @DisplayName("§3 — a sentence the seller already wrote may still be accepted unedited")
    void aRepeatedAnswerKeepsItsFallback() {
        memories.deleteAll();
        UUID candidateId = candidates
                .noteGap(org, "ORG", null, "배송", "제주 지역은 1~2일 더 걸릴 수 있습니다.")
                .getId();
        // noteGap files DRAFT_GAP; a repeated answer is the other producer, so its origin is set here
        // the way proposeFromAnswers sets it.
        candidateRows.findById(candidateId).ifPresent(row -> {
            row.setOrigin(KnowledgeCandidateService.ORIGIN_REPEATED_ANSWER);
            candidateRows.save(row);
        });

        candidates.accept(org, candidateId, null, null, null, OrgKnowledgeType.SHIPPING_POLICY,
                null, "판매자");

        OrgKnowledgeSource written = orgSources.findAllByOrgIdOrderByCreatedAtAsc(org).get(0);
        assertThat(written.getBody()).isEqualTo("제주 지역은 1~2일 더 걸릴 수 있습니다.");
    }

    /**
     * Knowledge Gap Continuity v1 — <b>answering an ask closes THAT ask, and only that one.</b>
     *
     * <p>The measured defect: the seller answered a gap on the inquiry screen, the fact was filed,
     * and the identical ask was still waiting in 확인 필요 — so the inbox counted work that was
     * already done. It closes by IDENTITY: no other row is touched, and nothing here compares what
     * the seller wrote against what was asked.
     */
    @Test
    @DisplayName("§C — accepting one ask closes exactly it, links its source, and leaves the rest open")
    void answeringOneAskClosesOnlyIt() {
        UUID answered = candidates
                .noteGap(org, "PRODUCT", productId, "미끄럼 방지",
                        "「미끄럼 방지」에 대해 고객에게 안내할 공식 기준이 필요합니다.")
                .getId();
        UUID similar = candidates
                .noteGap(org, "PRODUCT", productId, "미끄럼",
                        "「미끄럼」에 대해 고객에게 안내할 공식 기준이 필요합니다.")
                .getId();
        UUID spec = variant("60x90cm / 5mm");

        KnowledgeCandidateView closed = candidates.accept(org, answered, "미끄럼 방지",
                "물기를 닦은 평평한 바닥에서는 밀리지 않습니다.",
                KnowledgeSourceType.FAQ, null, spec, null, "판매자");

        assertThat(closed.state()).isEqualTo(KnowledgeCandidateService.STATE_ACCEPTED);
        // The link back: which source this ask became.
        assertThat(closed.sourceId()).isNotNull();
        ProductKnowledgeSource written = productSources.findById(closed.sourceId()).orElseThrow();
        assertThat(written.getBody()).isEqualTo("물기를 닦은 평평한 바닥에서는 밀리지 않습니다.");
        // The 규격 the seller chose survives the one write that also closed the ask.
        assertThat(written.getVariantId()).isEqualTo(spec);
        // A near-identical ask is NOT closed. Resemblance is not identity.
        assertThat(candidateRows.findById(similar).orElseThrow().getState())
                .isEqualTo(KnowledgeCandidateService.STATE_OPEN);
    }

    /**
     * Knowledge Gap Continuity v1 — <b>an answered ask does not come straight back.</b>
     *
     * <p>Saving re-asks for the draft, and the regenerate re-runs the gap detection, so an ask that
     * is still unanswerable from the library would be filed anew the moment the seller closed it.
     * On screen that is indistinguishable from never having closed it. Identity only: same scope,
     * same product, same question.
     */
    @Test
    @DisplayName("§C — the same ask is not filed again after it has been answered")
    void anAnsweredAskIsNotRefiled() {
        String question = "「미끄럼 방지」에 대해 고객에게 안내할 공식 기준이 필요합니다.";
        UUID first = candidates.noteGap(org, "PRODUCT", productId, "미끄럼 방지", question).getId();
        candidates.accept(org, first, null, "밀리지 않습니다.", KnowledgeSourceType.FAQ, null,
                null, null, "판매자");

        // The regenerate's filing, on the very next breath.
        assertThat(candidates.noteGap(org, "PRODUCT", productId, "미끄럼 방지", question)).isNull();
        assertThat(candidateRows.countByOrgIdAndState(org, KnowledgeCandidateService.STATE_OPEN))
                .isZero();

        // A DIFFERENT question about the same product is still filed — this is identity, not topic.
        assertThat(candidates.noteGap(org, "PRODUCT", productId, "내열",
                "「내열」에 대해 고객에게 안내할 공식 기준이 필요합니다.")).isNotNull();
        assertThat(candidateRows.countByOrgIdAndState(org, KnowledgeCandidateService.STATE_OPEN))
                .isEqualTo(1);
    }

    @Test
    @DisplayName("§C — a dismissed ask may still be noticed again: 「아니요」 means «not this, now»")
    void aDismissedAskMayReturn() {
        String question = "「내열」에 대해 고객에게 안내할 공식 기준이 필요합니다.";
        UUID first = candidates.noteGap(org, "PRODUCT", productId, "내열", question).getId();
        candidates.dismiss(org, first, "판매자");

        assertThat(candidates.noteGap(org, "PRODUCT", productId, "내열", question)).isNotNull();
    }

    @Test
    @DisplayName("§C — a 규격 from another product is refused, never silently widened to all of them")
    void aForeignSpecIsRefused() {
        Product other = new Product();
        other.setOrgId(org);
        other.setName("다른 상품");
        other.setSku("SKU-" + UUID.randomUUID());
        other.setStatus("ACTIVE");
        UUID otherId = products.save(other).getId();
        ProductVariant foreign = new ProductVariant();
        foreign.setOrgId(org);
        foreign.setProductId(otherId);
        foreign.setOptionName("대형");
        foreign.setSource("CHANNEL_LISTING");
        foreign.setObservedAt(java.time.Instant.now());
        UUID foreignId = variantRows.save(foreign).getId();

        UUID candidateId = candidates
                .noteGap(org, "PRODUCT", productId, "미끄럼 방지", "「미끄럼 방지」에 대해…")
                .getId();

        assertThatThrownBy(() -> candidates.accept(org, candidateId, null, "밀리지 않습니다.",
                KnowledgeSourceType.FAQ, null, foreignId, null, "판매자"))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("이 상품의 규격이 아닙니다");
        assertThat(candidateRows.findById(candidateId).orElseThrow().getState())
                .isEqualTo(KnowledgeCandidateService.STATE_OPEN);
    }

    @Test
    @DisplayName("§2 — hand-written knowledge and uploaded documents are counted apart, never twice")
    void theNumbersPartition() {
        ProductKnowledgeSource typed = new ProductKnowledgeSource();
        typed.setOrgId(org);
        typed.setProductId(productId);
        typed.setSourceType(KnowledgeSourceType.USAGE);
        typed.setTitle("부착 방법");
        typed.setBody("표면의 먼지를 닦은 뒤 30초 이상 눌러 주세요.");
        productSources.save(typed);

        ProductKnowledgeSource uploaded = new ProductKnowledgeSource();
        uploaded.setOrgId(org);
        uploaded.setProductId(productId);
        uploaded.setSourceType(KnowledgeSourceType.USAGE);
        uploaded.setDocumentName("사용설명서.pdf");
        uploaded.setTitle("사용설명서");
        uploaded.setBody("…");
        productSources.save(uploaded);

        OrgKnowledgeSource rule = new OrgKnowledgeSource();
        rule.setOrgId(org);
        rule.setKnowledgeType(OrgKnowledgeType.SHIPPING_POLICY);
        rule.setTitle("배송 기준");
        rule.setBody("오후 2시 이전 결제분은 당일 출고합니다.");
        orgSources.save(rule);

        KnowledgeSummaryView view = summary.of(org);
        assertThat(view.productKnowledge()).isEqualTo(1);
        assertThat(view.operatingRules()).isEqualTo(1);
        assertThat(view.documents()).isEqualTo(1);
        // Three rows, three numbers, and their sum is the size of the library.
        assertThat(view.productKnowledge() + view.operatingRules() + view.documents()).isEqualTo(3);
        // What reviewnary read WITHOUT being taught is a separate number, and not part of that sum.
        assertThat(view.products()).isEqualTo(1);
    }
}
