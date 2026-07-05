package com.sellerops.inquiry.publish;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.sellerops.inquiry.reply.InquiryReplyDraft;
import com.sellerops.inquiry.workitem.InquiryWorkItem;
import com.sellerops.inquiry.workitem.InquiryWorkItemAuditRepository;
import com.sellerops.inquiry.workitem.InquiryWorkItemPhase;
import com.sellerops.inquiry.workitem.InquiryWorkItemRepository;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * Rollback-before-dispatch: if any of (approval, intent, execution, phase flip,
 * audit) fails, the whole binding rolls back and the work item stays PROPOSED —
 * nothing is left partially bound. Runs {@code NOT_SUPPORTED} so the writer's own
 * transaction is authoritative.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class InquiryPublishBindingWriterTest {

    @Autowired InquiryWorkItemRepository workItems;
    @Autowired InquiryApprovalRepository approvals;
    @Autowired InquiryActionIntentRepository intents;
    @Autowired InquiryExecutionRepository executions;
    @Autowired PlatformTransactionManager txManager;

    @Test
    @Transactional(propagation = Propagation.NOT_SUPPORTED)
    void auditFailureRollsBackTheEntireBindingAndLeavesPhaseProposed() {
        UUID org = UUID.randomUUID();
        InquiryWorkItem wi = new InquiryWorkItem();
        wi.setOrgId(org);
        wi.setInquiryId(UUID.randomUUID());
        wi.setSellerAccountId(UUID.randomUUID());
        wi.setChannelId(UUID.randomUUID());
        wi.setPhase(InquiryWorkItemPhase.PROPOSED);
        wi = workItems.save(wi);

        InquiryReplyDraft draft = new InquiryReplyDraft();
        draft.setVersion(1);
        draft.setContentFingerprint("fp-abc");

        InquiryWorkItemAuditRepository failingAudits = mock(InquiryWorkItemAuditRepository.class);
        when(failingAudits.save(any())).thenThrow(new RuntimeException("audit boom"));
        InquiryPublishBindingWriter writer = new InquiryPublishBindingWriter(
                workItems, approvals, intents, executions, failingAudits, txManager);

        final InquiryWorkItem toBind = wi;
        try {
            assertThatThrownBy(() -> writer.bind(toBind, draft, "cmd1", "SELLER:x"))
                    .isInstanceOf(RuntimeException.class);

            assertThat(approvals.findByWorkItemId(toBind.getId())).isEmpty();
            assertThat(intents.findByWorkItemId(toBind.getId())).isEmpty();
            assertThat(executions.findByWorkItemId(toBind.getId())).isEmpty();
            assertThat(workItems.findById(toBind.getId()).orElseThrow().getPhase())
                    .isEqualTo(InquiryWorkItemPhase.PROPOSED);
        } finally {
            workItems.deleteById(toBind.getId()); // committed under NOT_SUPPORTED — clean up
        }
    }
}
