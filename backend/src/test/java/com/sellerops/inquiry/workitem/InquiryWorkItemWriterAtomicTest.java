package com.sellerops.inquiry.workitem;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.InquiryRepository;
import java.time.Instant;
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
 * The atomic guarantee: if any of (inquiry, work item, audit) fails, the whole unit
 * rolls back — an inquiry can never be persisted without its work item and audit.
 *
 * <p>The failure is injected on the last write (a throwing audit repository). The
 * test method runs with {@code NOT_SUPPORTED} so no ambient {@code @DataJpaTest}
 * transaction masks the writer's own transaction — the rollback is a real physical
 * rollback, observable afterwards.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class InquiryWorkItemWriterAtomicTest {

    @Autowired InquiryRepository inquiries;
    @Autowired InquiryWorkItemRepository workItems;
    @Autowired PlatformTransactionManager txManager;

    @Test
    @Transactional(propagation = Propagation.NOT_SUPPORTED)
    void rollsBackInquiryAndWorkItemWhenTheAuditWriteFails() {
        UUID org = UUID.randomUUID();
        UUID sellerAccountId = UUID.randomUUID();

        InquiryWorkItemAuditRepository failingAudits = mock(InquiryWorkItemAuditRepository.class);
        when(failingAudits.save(any())).thenThrow(new RuntimeException("audit write boom"));

        InquiryWorkItemWriter writer =
                new InquiryWorkItemWriter(inquiries, workItems, failingAudits, txManager);

        Inquiry inquiry = new Inquiry();
        inquiry.setOrgId(org);
        inquiry.setChannelId(UUID.randomUUID());
        inquiry.setBody("원자성 검증");
        inquiry.setStatus("UNANSWERED");
        inquiry.setReceivedAt(Instant.parse("2026-06-27T00:00:00Z"));

        assertThatThrownBy(() -> writer.openConnectorInquiry(inquiry, sellerAccountId))
                .isInstanceOf(RuntimeException.class);

        // Nothing survives: the inquiry and work item were rolled back with the audit.
        assertThat(inquiries.findTop50ByOrgIdOrderByReceivedAtDesc(org)).isEmpty();
        assertThat(workItems.countByOrgIdAndPhase(org, InquiryWorkItemPhase.OPEN)).isZero();
    }
}
