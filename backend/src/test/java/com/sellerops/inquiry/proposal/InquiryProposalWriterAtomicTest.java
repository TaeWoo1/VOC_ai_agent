package com.sellerops.inquiry.proposal;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.sellerops.inquiry.workitem.InquiryWorkItem;
import com.sellerops.inquiry.workitem.InquiryWorkItemAuditRepository;
import com.sellerops.inquiry.workitem.InquiryWorkItemPhase;
import com.sellerops.inquiry.workitem.InquiryWorkItemRepository;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * The atomic OPEN &rarr; PROPOSED write. Runs {@code NOT_SUPPORTED} so the writer's own
 * transaction is authoritative (no ambient {@code @DataJpaTest} tx masks the
 * rollback / defers the constraint), matching {@code InquiryWorkItemWriterAtomicTest}.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class InquiryProposalWriterAtomicTest {

    @Autowired InquiryWorkItemRepository workItems;
    @Autowired InquiryProposalRepository proposals;
    @Autowired InquiryWorkItemAuditRepository audits;
    @Autowired PlatformTransactionManager txManager;

    private InquiryWorkItem seedOpen(UUID org) {
        InquiryWorkItem wi = new InquiryWorkItem();
        wi.setOrgId(org);
        wi.setInquiryId(UUID.randomUUID());
        wi.setSellerAccountId(UUID.randomUUID());
        wi.setChannelId(UUID.randomUUID());
        wi.setPhase(InquiryWorkItemPhase.OPEN);
        return workItems.save(wi);
    }

    private InquiryProposal proposal(InquiryWorkItem wi) {
        InquiryProposal p = new InquiryProposal();
        p.setOrgId(wi.getOrgId());
        p.setWorkItemId(wi.getId());
        p.setInquiryId(wi.getInquiryId());
        p.setActionKind("POST_INQUIRY_REPLY");
        p.setSummaryCategory("delivery_status_reply");
        p.setRequiresApproval(true);
        p.setProposedBy("SYSTEM:RULE_PROPOSER");
        p.setProviderKind("RULE_BASED");
        p.setProviderName("rule-proposer");
        p.setProviderVersion("rules-v1");
        return p;
    }

    @Test
    @Transactional(propagation = Propagation.NOT_SUPPORTED)
    void auditFailureRollsBackTheProposalAndLeavesThePhaseOpen() {
        UUID org = UUID.randomUUID();
        InquiryWorkItem wi = seedOpen(org);

        InquiryWorkItemAuditRepository failingAudits = mock(InquiryWorkItemAuditRepository.class);
        when(failingAudits.save(any())).thenThrow(new RuntimeException("audit write boom"));
        InquiryProposalWriter writer = new InquiryProposalWriter(workItems, proposals, failingAudits, txManager);

        try {
            assertThatThrownBy(() -> writer.attachProposalAndTransition(wi, proposal(wi), "SELLER:x"))
                    .isInstanceOf(RuntimeException.class);

            assertThat(proposals.findByWorkItemId(wi.getId())).isEmpty();
            assertThat(workItems.findById(wi.getId()).orElseThrow().getPhase())
                    .isEqualTo(InquiryWorkItemPhase.OPEN);
            assertThat(audits.countByWorkItemId(wi.getId())).isZero();
        } finally {
            cleanupCommitted(wi.getId());
        }
    }

    @Test
    @Transactional(propagation = Propagation.NOT_SUPPORTED)
    void aSecondAttachForTheSameWorkItemViolatesTheUniqueConstraint() {
        UUID org = UUID.randomUUID();
        InquiryWorkItem wi = seedOpen(org);
        InquiryProposalWriter writer = new InquiryProposalWriter(workItems, proposals, audits, txManager);

        try {
            writer.attachProposalAndTransition(wi, proposal(wi), "SELLER:x");

            // A concurrent/duplicate propose commits a second row → UNIQUE(work_item_id) rejects it.
            assertThatThrownBy(() -> writer.attachProposalAndTransition(wi, proposal(wi), "SELLER:y"))
                    .isInstanceOf(DataIntegrityViolationException.class);

            assertThat(proposals.findByWorkItemId(wi.getId())).isPresent();
            assertThat(workItems.findById(wi.getId()).orElseThrow().getPhase())
                    .isEqualTo(InquiryWorkItemPhase.PROPOSED);
        } finally {
            cleanupCommitted(wi.getId());
        }
    }

    /** Delete rows committed by a NOT_SUPPORTED test so the shared context stays isolated. */
    private void cleanupCommitted(UUID workItemId) {
        proposals.findByWorkItemId(workItemId).ifPresent(p -> proposals.deleteById(p.getId()));
        audits.deleteAll(audits.findByWorkItemIdOrderByCreatedAtAsc(workItemId));
        workItems.deleteById(workItemId);
    }
}
