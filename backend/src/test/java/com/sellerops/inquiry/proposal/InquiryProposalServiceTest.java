package com.sellerops.inquiry.proposal;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sellerops.common.ApiException;
import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.inquiry.proposal.InquiryProposalProvider.Draft;
import com.sellerops.inquiry.proposal.InquiryProposalProvider.SellerInquiryContext;
import com.sellerops.inquiry.proposal.dto.InquiryDetail;
import com.sellerops.inquiry.proposal.dto.ProposalResult;
import com.sellerops.inquiry.workitem.InquiryWorkItem;
import com.sellerops.inquiry.workitem.InquiryWorkItemAudit;
import com.sellerops.inquiry.workitem.InquiryWorkItemAuditRepository;
import com.sellerops.inquiry.workitem.InquiryWorkItemEvent;
import com.sellerops.inquiry.workitem.InquiryWorkItemPhase;
import com.sellerops.inquiry.workitem.InquiryWorkItemRepository;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.http.HttpStatus;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * Seller-initiated OPEN &rarr; PROPOSED coordinator + detail read. Hand-{@code new}ed
 * collaborators over H2, matching the repo convention. A configurable {@link
 * FakeProvider} exercises success, counting, failure, and the concurrent-race window.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class InquiryProposalServiceTest {

    @Autowired InquiryRepository inquiries;
    @Autowired InquiryWorkItemRepository workItems;
    @Autowired InquiryProposalRepository proposals;
    @Autowired InquiryWorkItemAuditRepository audits;
    @Autowired PlatformTransactionManager txManager;

    private InquiryProposalWriter writer;
    private final UUID org = UUID.randomUUID();
    private final UUID sellerUser = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        writer = new InquiryProposalWriter(workItems, proposals, audits, txManager);
    }

    /** A tunable provider: counts calls, can inject a side effect, can fail. */
    private static final class FakeProvider implements InquiryProposalProvider {
        int calls;
        Runnable before;
        RuntimeException boom;
        Draft draft = new Draft("delivery_status_reply", "RULE_BASED", "rule-proposer", "rules-v1");

        @Override
        public Draft propose(SellerInquiryContext context) {
            calls++;
            if (before != null) {
                before.run();
            }
            if (boom != null) {
                throw boom;
            }
            return draft;
        }
    }

    private InquiryProposalService service(InquiryProposalProvider provider) {
        return new InquiryProposalService(workItems, proposals, inquiries, provider, writer);
    }

    private InquiryWorkItem seedOpen(UUID orgId, String title, String body, String author) {
        Inquiry q = new Inquiry();
        q.setOrgId(orgId);
        q.setChannelId(UUID.randomUUID());
        q.setTitle(title);
        q.setBody(body);
        q.setAuthor(author);
        q.setStatus("UNANSWERED");
        q.setInformStatus("미처리");
        q.setReceivedAt(Instant.parse("2026-06-27T00:00:00Z"));
        UUID inquiryId = inquiries.save(q).getId();

        InquiryWorkItem wi = new InquiryWorkItem();
        wi.setOrgId(orgId);
        wi.setInquiryId(inquiryId);
        wi.setSellerAccountId(UUID.randomUUID());
        wi.setChannelId(q.getChannelId());
        wi.setPhase(InquiryWorkItemPhase.OPEN);
        return workItems.save(wi);
    }

    private List<InquiryWorkItemAudit> proposedAudits(UUID workItemId) {
        return audits.findByWorkItemIdOrderByCreatedAtAsc(workItemId).stream()
                .filter(a -> a.getEventType() == InquiryWorkItemEvent.PROPOSAL_ADDED)
                .toList();
    }

    @Test
    void proposeTransitionsOpenToProposedWithProvenanceAndPiiSafeProposal() {
        String body = "배송 언제 오나요 제 전화번호는 010-0000-0000";
        InquiryWorkItem wi = seedOpen(org, "배송 문의", body, "구매자-PII");
        FakeProvider provider = new FakeProvider();

        ProposalResult result = service(provider).propose(org, wi.getId(), sellerUser);

        assertThat(result.phase()).isEqualTo("PROPOSED");
        assertThat(workItems.findById(wi.getId()).orElseThrow().getPhase())
                .isEqualTo(InquiryWorkItemPhase.PROPOSED);

        // Provenance + coarse decision metadata persisted.
        InquiryProposal stored = proposals.findByWorkItemId(wi.getId()).orElseThrow();
        assertThat(stored.getActionKind()).isEqualTo("POST_INQUIRY_REPLY");
        assertThat(stored.getSummaryCategory()).isEqualTo("delivery_status_reply");
        assertThat(stored.isRequiresApproval()).isTrue();
        assertThat(stored.getProposedBy()).isEqualTo("SYSTEM:RULE_PROPOSER");
        assertThat(stored.getProviderKind()).isEqualTo("RULE_BASED");
        assertThat(stored.getProviderName()).isEqualTo("rule-proposer");
        assertThat(stored.getProviderVersion()).isEqualTo("rules-v1");

        // PII / body exclusion: no persisted proposal field carries the body or buyer.
        String persisted = String.join("|", stored.getActionKind(), stored.getSummaryCategory(),
                stored.getProposedBy(), stored.getProviderKind(), stored.getProviderName(),
                stored.getProviderVersion());
        assertThat(persisted).doesNotContain(body).doesNotContain("구매자-PII").doesNotContain("010-0000-0000");
        assertThat(result.proposal().toString()).doesNotContain(body).doesNotContain("구매자-PII");

        // Exactly one PROPOSAL_ADDED audit, OPEN -> PROPOSED, seller actor, propose command id.
        List<InquiryWorkItemAudit> trail = proposedAudits(wi.getId());
        assertThat(trail).hasSize(1);
        InquiryWorkItemAudit added = trail.get(0);
        assertThat(added.getPhaseFrom()).isEqualTo(InquiryWorkItemPhase.OPEN);
        assertThat(added.getPhaseTo()).isEqualTo(InquiryWorkItemPhase.PROPOSED);
        assertThat(added.getActor()).isEqualTo("SELLER:" + sellerUser);
        assertThat(added.getCommandId()).isEqualTo("propose:" + wi.getId());
        assertThat(provider.calls).isEqualTo(1);
    }

    @Test
    void replayReturnsExistingProposalWithoutInvokingProviderAgain() {
        InquiryWorkItem wi = seedOpen(org, "배송 문의", "택배 어디쯤", null);
        FakeProvider provider = new FakeProvider();
        InquiryProposalService service = service(provider);

        ProposalResult first = service.propose(org, wi.getId(), sellerUser);
        ProposalResult second = service.propose(org, wi.getId(), sellerUser);

        assertThat(second.proposal().proposalId()).isEqualTo(first.proposal().proposalId());
        assertThat(second.phase()).isEqualTo("PROPOSED");
        // Provider invoked once; no duplicate proposal or audit (UNIQUE bounds it to one).
        assertThat(provider.calls).isEqualTo(1);
        assertThat(proposals.findByWorkItemId(wi.getId())).isPresent();
        assertThat(proposedAudits(wi.getId())).hasSize(1);
    }

    @Test
    void onlyOpenMayTransition() {
        InquiryWorkItem wi = seedOpen(org, "배송 문의", "택배", null);
        wi.setPhase(InquiryWorkItemPhase.APPROVED); // not OPEN, and no proposal exists
        workItems.save(wi);
        FakeProvider provider = new FakeProvider();

        assertThatThrownBy(() -> service(provider).propose(org, wi.getId(), sellerUser))
                .isInstanceOfSatisfying(ApiException.class,
                        e -> assertThat(e.getStatus()).isEqualTo(HttpStatus.CONFLICT));
        assertThat(provider.calls).isZero();
        assertThat(proposals.findByWorkItemId(wi.getId())).isEmpty();
    }

    @Test
    void proposeAndDetailAreTenantIsolated() {
        InquiryWorkItem wi = seedOpen(org, "배송 문의", "택배", null);
        UUID otherOrg = UUID.randomUUID();
        FakeProvider provider = new FakeProvider();
        InquiryProposalService service = service(provider);

        assertThatThrownBy(() -> service.propose(otherOrg, wi.getId(), sellerUser))
                .isInstanceOfSatisfying(ApiException.class,
                        e -> assertThat(e.getStatus()).isEqualTo(HttpStatus.NOT_FOUND));
        assertThatThrownBy(() -> service.detail(otherOrg, wi.getId()))
                .isInstanceOfSatisfying(ApiException.class,
                        e -> assertThat(e.getStatus()).isEqualTo(HttpStatus.NOT_FOUND));
        assertThat(provider.calls).isZero();
        assertThat(proposals.findByWorkItemId(wi.getId())).isEmpty();
    }

    @Test
    void providerFailureLeavesItemOpenWithNoProposalOrAudit() {
        InquiryWorkItem wi = seedOpen(org, "배송 문의", "택배", null);
        FakeProvider provider = new FakeProvider();
        provider.boom = new RuntimeException("drafter down");

        assertThatThrownBy(() -> service(provider).propose(org, wi.getId(), sellerUser))
                .isInstanceOfSatisfying(ApiException.class,
                        e -> assertThat(e.getStatus()).isEqualTo(HttpStatus.SERVICE_UNAVAILABLE));

        assertThat(workItems.findById(wi.getId()).orElseThrow().getPhase())
                .isEqualTo(InquiryWorkItemPhase.OPEN);
        assertThat(proposals.findByWorkItemId(wi.getId())).isEmpty();
        assertThat(proposedAudits(wi.getId())).isEmpty();
    }

    @Test
    void detailExposesTitleAndDetailsButNeverAuthor() {
        InquiryWorkItem wi = seedOpen(org, "재고 문의", "아이보리 재고 있나요", "구매자-PII");

        InquiryDetail before = service(new FakeProvider()).detail(org, wi.getId());
        assertThat(before.title()).isEqualTo("재고 문의");
        assertThat(before.details()).isEqualTo("아이보리 재고 있나요");
        assertThat(before.phase()).isEqualTo("OPEN");
        assertThat(before.proposal()).isNull();
        // Buyer identity never surfaces.
        assertThat(before.toString()).doesNotContain("구매자-PII");

        FakeProvider provider = new FakeProvider();
        service(provider).propose(org, wi.getId(), sellerUser);
        InquiryDetail after = service(provider).detail(org, wi.getId());
        assertThat(after.phase()).isEqualTo("PROPOSED");
        assertThat(after.proposal()).isNotNull();
        assertThat(after.proposal().summaryCategory()).isEqualTo("delivery_status_reply");
    }

    @Test
    @Transactional(propagation = Propagation.NOT_SUPPORTED) // real per-writer tx so the UNIQUE race fires
    void concurrentRaceResolvesToTheExistingProposalWithoutDuplicating() {
        UUID raceOrg = UUID.randomUUID();
        InquiryWorkItem wi = seedOpen(raceOrg, "배송 문의", "택배", null);

        // Provider simulates another caller committing the winning proposal in the
        // window between our precheck and our write — the service must resolve to it.
        FakeProvider racing = new FakeProvider();
        InquiryProposal[] winner = new InquiryProposal[1];
        racing.before = () -> {
            InquiryProposal p = new InquiryProposal();
            p.setOrgId(raceOrg);
            p.setWorkItemId(wi.getId());
            p.setInquiryId(wi.getInquiryId());
            p.setActionKind("POST_INQUIRY_REPLY");
            p.setSummaryCategory("delivery_status_reply");
            p.setRequiresApproval(true);
            p.setProposedBy("SYSTEM:RULE_PROPOSER");
            p.setProviderKind("RULE_BASED");
            p.setProviderName("rule-proposer");
            p.setProviderVersion("rules-v1");
            winner[0] = writer.attachProposalAndTransition(wi, p, "SELLER:" + UUID.randomUUID());
        };

        try {
            ProposalResult result = service(racing).propose(raceOrg, wi.getId(), sellerUser);

            // The service resolved to the winning proposal instead of creating a duplicate.
            assertThat(result.proposal().proposalId()).isEqualTo(winner[0].getId());
            assertThat(result.phase()).isEqualTo("PROPOSED");
            assertThat(proposals.findByWorkItemId(wi.getId()).orElseThrow().getId())
                    .isEqualTo(winner[0].getId());
            assertThat(proposedAudits(wi.getId())).hasSize(1);
            assertThat(workItems.findById(wi.getId()).orElseThrow().getPhase())
                    .isEqualTo(InquiryWorkItemPhase.PROPOSED);
        } finally {
            // This method runs NOT_SUPPORTED, so its writes commit; clean them up so
            // the shared @DataJpaTest context stays isolated for other tests.
            cleanupCommitted(wi.getId(), wi.getInquiryId());
        }
    }

    /** Delete rows committed by a NOT_SUPPORTED test (proposal → audits → work item → inquiry). */
    private void cleanupCommitted(UUID workItemId, UUID inquiryId) {
        proposals.findByWorkItemId(workItemId).ifPresent(p -> proposals.deleteById(p.getId()));
        audits.deleteAll(audits.findByWorkItemIdOrderByCreatedAtAsc(workItemId));
        workItems.deleteById(workItemId);
        if (inquiryId != null) {
            inquiries.deleteById(inquiryId);
        }
    }
}
