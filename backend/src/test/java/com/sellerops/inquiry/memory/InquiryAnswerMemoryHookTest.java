package com.sellerops.inquiry.memory;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.channel.ChannelRepository;
import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.draft.DraftAuthorKind;
import com.sellerops.inquiry.proposal.RuleBasedInquiryProposalProvider;
import com.sellerops.inquiry.reply.InquiryReplyDraft;
import com.sellerops.knowledge.memory.AnswerMemoryRepository;
import com.sellerops.knowledge.memory.AnswerMemoryService;
import com.sellerops.knowledge.org.OrgKnowledgeChunkRepository;
import com.sellerops.organization.Organization;
import com.sellerops.organization.OrganizationRepository;
import com.sellerops.product.ProductRepository;
import com.sellerops.product.library.ProductKnowledgeChunkRepository;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * Knowledge Context v1-A, proof E: approving the org's own deferral writes NO answer memory; approving
 * a model draft (the seller's act on evidence-grounded text) still does.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class InquiryAnswerMemoryHookTest {

    @Autowired AnswerMemoryRepository memories;
    @Autowired OrgKnowledgeChunkRepository orgChunks;
    @Autowired ProductKnowledgeChunkRepository productChunks;
    @Autowired ChannelRepository channels;
    @Autowired ProductRepository products;
    @Autowired OrganizationRepository organizations;

    private InquiryAnswerMemoryHook hook;
    private UUID org;

    @BeforeEach
    void setUp() {
        hook = new InquiryAnswerMemoryHook(new AnswerMemoryService(memories, orgChunks, productChunks),
                channels, products, new RuleBasedInquiryProposalProvider());
        Organization o = new Organization();
        o.setName("테스트 상점");
        org = organizations.save(o).getId();
    }

    @Test
    @DisplayName("E. an approved SELLER_APPROVED_FALLBACK draft is not remembered")
    void anApprovedFallbackIsNotRemembered() {
        hook.rememberApproved(inquiry(), draft(DraftAuthorKind.SELLER_APPROVED_FALLBACK,
                "확인 후 안내드리겠습니다."), UUID.randomUUID());

        assertThat(memories.countByOrgId(org)).isZero();
    }

    @Test
    @DisplayName("an approved MODEL draft is remembered as USER_APPROVED — the AI-draft guarantee is unchanged")
    void anApprovedModelDraftIsRemembered() {
        hook.rememberApproved(inquiry(), draft(DraftAuthorKind.MODEL,
                "영업일 기준 2일 이내에 출고됩니다."), UUID.randomUUID());

        assertThat(memories.countByOrgId(org)).isEqualTo(1);
    }

    private Inquiry inquiry() {
        Inquiry q = new Inquiry();
        q.setOrgId(org);
        q.setChannelId(UUID.randomUUID());
        q.setSellerAccountId(UUID.randomUUID());
        q.setTitle("배송 언제 오나요");
        q.setBody("주문한 지 일주일이 지났습니다.");
        q.setStatus("UNANSWERED");
        q.setReceivedAt(Instant.parse("2026-08-24T00:00:00Z"));
        return q;
    }

    private InquiryReplyDraft draft(DraftAuthorKind kind, String comments) {
        InquiryReplyDraft d = new InquiryReplyDraft();
        d.setOrgId(org);
        d.setWorkItemId(UUID.randomUUID());
        d.setVersion(1);
        d.setTitle("[답변] 배송 언제 오나요");
        d.setComments(comments);
        d.setAuthorKind(kind.name());
        return d;
    }
}
