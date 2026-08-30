package com.sellerops.knowledge.org;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sellerops.knowledge.org.dto.OrgKnowledgeRequest;
import com.sellerops.knowledge.org.dto.OrgKnowledgeSearchResponse;
import com.sellerops.knowledge.org.dto.OrgKnowledgeView;
import com.sellerops.organization.Organization;
import com.sellerops.organization.OrganizationRepository;
import com.sellerops.knowledge.RetrievalOutcome;
import com.sellerops.knowledge.RetrievalQuery;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * 운영 정책 / 답변 기준 — the axis that was missing.
 *
 * <p>The case that matters most is the one the product library structurally cannot serve: a question
 * that resolves to NO product. The Demo Org's real Cafe24 backlog is 69 unanswered inquiries of which
 * 25 mention 세금계산서 and 17 mention 현금영수증 and one mentions a dimension — so a knowledge layer
 * reachable only through a product answers almost none of it, however full it is.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class SellerOperationsKnowledgeServiceTest {

    @Autowired OrgKnowledgeSourceRepository sources;
    @Autowired OrgKnowledgeChunkRepository chunks;
    @Autowired OrganizationRepository organizations;

    private SellerOperationsKnowledgeService service;
    private UUID org;

    @BeforeEach
    void setUp() {
        service = new SellerOperationsKnowledgeService(sources, chunks);
        Organization o = new Organization();
        o.setName("테스트 상점");
        org = organizations.save(o).getId();
    }

    @Test
    @DisplayName("a policy question with no product is answerable — the product library never could be")
    void aProductFreeQuestionIsAnswerable() {
        write(OrgKnowledgeType.CASH_RECEIPT, "현금영수증 발급 안내",
                "결제 완료 후 현금영수증 발급을 요청하실 수 있습니다. 주문 시 입력하신 휴대폰 번호로 발급됩니다.");

        OrgKnowledgeSearchResponse found = service.search(org, "현금영수증 발급 가능한가요?", 5);

        assertThat(found.passages()).isNotEmpty();
        assertThat(found.passages().get(0).knowledgeType()).isEqualTo(OrgKnowledgeType.CASH_RECEIPT);
        assertThat(found.passages().get(0).version()).isEqualTo(1);
    }

    @Test
    @DisplayName("a question the policies do not cover returns nothing rather than the least-bad policy")
    void absenceIsAResult() {
        write(OrgKnowledgeType.CASH_RECEIPT, "현금영수증 발급 안내",
                "결제 완료 후 현금영수증 발급을 요청하실 수 있습니다. 주문 시 입력하신 휴대폰 번호로 발급됩니다.");

        assertThat(service.search(org, "몰딩 내부 폭이 몇 mm인가요?", 5).passages())
                .as("a spec question must not be answered out of a receipt policy")
                .isEmpty();
    }

    @Test
    @DisplayName("documentsSearched separates \"nobody wrote it\" from \"it does not cover this\"")
    void theEmptyStatesAreDistinguishable() {
        assertThat(service.search(org, "현금영수증 발급 가능한가요?", 5).documentsSearched()).isZero();

        write(OrgKnowledgeType.SHIPPING_POLICY, "배송 안내", "영업일 기준 2일 이내 출고됩니다.");
        OrgKnowledgeSearchResponse found = service.search(org, "현금영수증 발급 가능한가요?", 5);

        assertThat(found.documentsSearched()).isOne();
        assertThat(found.passages()).isEmpty();
    }

    @Test
    @DisplayName("the version rises when the policy changes and stays put when only its title does")
    void versionTracksTheTextAndNotTheFiling() {
        OrgKnowledgeView first = write(OrgKnowledgeType.SHIPPING_POLICY, "배송 안내",
                "영업일 기준 2일 이내 출고됩니다.");

        OrgKnowledgeView renamed = service.update(org, first.id(), new OrgKnowledgeRequest(
                OrgKnowledgeType.SHIPPING_POLICY, "배송 정책 안내", "영업일 기준 2일 이내 출고됩니다.", null));
        assertThat(renamed.version()).as("renaming does not make last week's citation stale").isOne();

        OrgKnowledgeView revised = service.update(org, first.id(), new OrgKnowledgeRequest(
                OrgKnowledgeType.SHIPPING_POLICY, "배송 정책 안내", "영업일 기준 3일 이내 출고됩니다.", null));
        assertThat(revised.version()).isEqualTo(2);
    }

    @Test
    @DisplayName("a shortened policy loses its passages — a deleted sentence stops being quotable")
    void reindexShrinks() {
        OrgKnowledgeView long_ = write(OrgKnowledgeType.EXCHANGE_REFUND_POLICY, "교환 및 반품 안내",
                "수령 후 7일 이내에 교환을 신청하실 수 있습니다.\n\n"
                        + "단순 변심의 경우 왕복 배송비가 부과됩니다. 제품 하자인 경우 배송비는 부과되지 않습니다.\n\n"
                        + "사용하신 제품은 교환이 어렵습니다. 포장을 개봉하신 경우에도 상태에 따라 교환이 가능합니다.");
        int before = long_.passageCount();

        OrgKnowledgeView shortened = service.update(org, long_.id(), new OrgKnowledgeRequest(
                OrgKnowledgeType.EXCHANGE_REFUND_POLICY, "교환 및 반품 안내",
                "수령 후 7일 이내에 교환을 신청하실 수 있습니다.", null));

        assertThat(shortened.passageCount()).isLessThanOrEqualTo(before);
        assertThat(chunks.findAllByOrgId(org)).hasSize(shortened.passageCount());
    }

    @Test
    @DisplayName("another org's policy is not reachable, and not merely not returned")
    void policiesAreOrgScoped() {
        OrgKnowledgeView mine = write(OrgKnowledgeType.SHIPPING_POLICY, "배송 안내",
                "영업일 기준 2일 이내 출고됩니다.");
        Organization other = new Organization();
        other.setName("다른 상점");
        UUID otherOrg = organizations.save(other).getId();

        assertThat(service.list(otherOrg)).isEmpty();
        assertThat(service.search(otherOrg, "배송 언제 되나요", 5).passages()).isEmpty();
        assertThatThrownBy(() -> service.delete(otherOrg, mine.id()))
                .hasMessageContaining("운영 정책");
    }

    // ── Retrieval & Grounding Correctness v1: the four outcomes, and the candidates that reach a rule.

    @Test
    @DisplayName("D. no rules at all → ABSENT")
    void noRulesIsAbsent() {
        assertThat(service.search(org, "배송은 며칠 걸리나요?", 5).outcome()).isEqualTo(RetrievalOutcome.ABSENT);
    }

    @Test
    @DisplayName("E. a return rule that matches a shipping question lexically is NOT_APPLICABLE — not 「기준 없음」")
    void existingRuleThatDoesNotApplyIsNotAbsence() {
        // The rule really contains the question's words (배송, 기간): a lexical hit, declared about returns.
        write(OrgKnowledgeType.EXCHANGE_REFUND_POLICY, "교환 반품 안내",
                "반품 배송 기간은 수령 후 7일 이내이며 반품 배송비는 고객 부담입니다.");

        OrgKnowledgeSearchResponse found = service.search(org, "배송 기간 얼마나 걸려요", 5);

        assertThat(found.passages()).isEmpty();
        assertThat(found.outcome()).isEqualTo(RetrievalOutcome.NOT_APPLICABLE);
        assertThat(found.rejectedNotApplicable()).isGreaterThan(0);
        assertThat(found.documentsSearched()).isEqualTo(1);
    }

    @Test
    @DisplayName("F. rules exist but none has words for the question → NO_RELEVANT_EVIDENCE")
    void missOverExistingRulesIsNotAbsence() {
        write(OrgKnowledgeType.SHIPPING_POLICY, "배송 안내", "주문 후 영업일 기준 2일 안에 발송합니다.");
        OrgKnowledgeSearchResponse found = service.search(org, "방수 되나요?", 5);
        assertThat(found.outcome()).isEqualTo(RetrievalOutcome.NO_RELEVANT_EVIDENCE);
    }

    @Test
    @DisplayName("a customer's shipping thread — title, greeting, body — still reaches the shipping rule")
    void longQuestionReachesTheRuleThroughItsShorterForms() {
        write(OrgKnowledgeType.SHIPPING_POLICY, "배송 기준",
                "주문 후 영업일 기준 2일 안에 출고하며, 출고 후 1~2일 안에 도착합니다.");
        RetrievalQuery question = RetrievalQuery.of(null, "배송 문의",
                "안녕하세요. 어제 주문했는데 배송은 보통 며칠 걸리나요? 급해서 문의드립니다. 확인 부탁드립니다.");

        OrgKnowledgeSearchResponse found = service.search(org, question, 5);

        assertThat(found.outcome()).isEqualTo(RetrievalOutcome.FOUND);
        assertThat(found.passages().get(0).title()).isEqualTo("배송 기준");
    }

    @Test
    @DisplayName("the seller's noun and an instruction sentence about the same rule find the same rule (Retrieval Query Selection v1)")
    void instructionPhrasingFindsTheSameRule() {
        write(OrgKnowledgeType.EXCHANGE_REFUND_POLICY, "교환·반품 처리 기준",
                "교환·반품은 수령 후 7일 이내 접수분만 처리합니다. 단순 변심 반품은 왕복 배송비 6,000원을 고객이 부담합니다.");
        OrgKnowledgeSearchResponse noun = service.search(org, "우리 반품 기준 뭐였지", 5);
        OrgKnowledgeSearchResponse sentence = service.search(org,
                "우리 회사 규정에 교환이나 반품이 가능한 조건이 명시돼 있는지 확인해줘", 5);
        assertThat(noun.outcome()).isEqualTo(RetrievalOutcome.FOUND);
        assertThat(sentence.outcome()).isEqualTo(RetrievalOutcome.FOUND);
        assertThat(sentence.passages().get(0).title()).isEqualTo(noun.passages().get(0).title());
        assertThat(sentence.query()).doesNotContain("확인").doesNotContain("규정").doesNotContain("명시");
    }

    private OrgKnowledgeView write(OrgKnowledgeType type, String title, String body) {
        return service.create(org, new OrgKnowledgeRequest(type, title, body, null),
                UUID.randomUUID(), "데모 운영자");
    }
}
