package com.sellerops.inquiry.workitem.dismissal;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.inquiry.workitem.InquiryWorkItem;
import com.sellerops.inquiry.workitem.InquiryWorkItemAudit;
import com.sellerops.inquiry.workitem.InquiryWorkItemAuditRepository;
import com.sellerops.inquiry.workitem.InquiryWorkItemDisposition;
import com.sellerops.inquiry.workitem.InquiryWorkItemEvent;
import com.sellerops.inquiry.workitem.InquiryWorkItemPhase;
import com.sellerops.inquiry.workitem.InquiryWorkItemRepository;
import com.sellerops.inquiry.workitem.dismissal.InquiryWorkItemDismissalService.DismissalCommand;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * Proves the batch ledger, item transitions, and item audits commit-or-roll-back as
 * one unit. To observe a real (not just first-level-cache) rollback, this class runs
 * the test method non-transactionally ({@link Propagation#NOT_SUPPORTED}) so the
 * service's own transaction is the only one — and uses a dedicated in-memory database
 * so the permanently-committed setup rows never collide with other test classes
 * (notably the global-unique {@code channel.code}).
 *
 * <p>The mid-batch failure is a genuine DB constraint: a pre-seeded audit occupies the
 * unique {@code (work_item_id, command_id)} slot the second item's dismissal audit
 * needs, so its insert fails at flush and the whole transaction rolls back.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
@Transactional(propagation = Propagation.NOT_SUPPORTED)
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class InquiryWorkItemDismissalRollbackTest {

    @DynamicPropertySource
    static void isolatedDatabase(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", () ->
                "jdbc:h2:mem:sellerops_dismissal_rollback;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1");
    }

    @Autowired InquiryWorkItemRepository workItems;
    @Autowired InquiryWorkItemAuditRepository audits;
    @Autowired InquiryWorkItemDismissalBatchRepository batches;
    @Autowired InquiryRepository inquiries;
    @Autowired SellerAccountRepository accounts;
    @Autowired ChannelRepository channels;
    @Autowired PlatformTransactionManager txManager;

    @Test
    void batchTransitionsAndAuditsRollBackTogetherOnOneItemFailure() {
        InquiryWorkItemDismissalService service = new InquiryWorkItemDismissalService(
                workItems, audits, batches, accounts, channels, txManager);

        UUID org = UUID.randomUUID();
        Channel cafe24 = new Channel();
        cafe24.setCode("CAFE24");
        cafe24.setNameKo("카페24");
        cafe24.setStatus(ChannelStatus.AVAILABLE);
        cafe24.setSupportsInquiry(true);
        UUID channelId = channels.save(cafe24).getId();

        SellerAccount acct = new SellerAccount();
        acct.setOrgId(org);
        acct.setChannelId(channelId);
        acct.setConnectionStatus(ChannelStatus.CONNECTED);
        acct.setFileUpload(false);
        UUID accountId = accounts.save(acct).getId();

        UUID a = openItem(org, accountId, channelId);
        UUID b = openItem(org, accountId, channelId);

        // Pre-seed an audit occupying (b, "chunk-1") so the dismissal audit for b collides.
        InquiryWorkItemAudit seed = new InquiryWorkItemAudit();
        seed.setOrgId(org);
        seed.setWorkItemId(b);
        seed.setCommandId("chunk-1");
        seed.setEventType(InquiryWorkItemEvent.WORK_ITEM_OPENED);
        seed.setPhaseFrom(null);
        seed.setPhaseTo(InquiryWorkItemPhase.OPEN);
        seed.setActor("seed");
        audits.save(seed);

        DismissalCommand cmd = new DismissalCommand(org, accountId, InquiryWorkItemDisposition.SPAM,
                "chunk-1", "OPERATOR:test", List.of(a, b));

        assertThatThrownBy(() -> service.executeAllOrNothing(
                cmd, "CONFIRM_DISMISS", "operator@sellerops.ai", "2026-07-05T00:00:00Z"))
                .isInstanceOf(RuntimeException.class);

        // Real rollback: no batch, no transition, no dismissal audit for the first item.
        assertThat(batches.findByOrgIdAndCommandId(org, "chunk-1")).isEmpty();
        assertThat(workItems.findById(a).orElseThrow().getPhase()).isEqualTo(InquiryWorkItemPhase.OPEN);
        assertThat(workItems.findById(b).orElseThrow().getPhase()).isEqualTo(InquiryWorkItemPhase.OPEN);
        long dismissalsA = audits.findByWorkItemIdOrderByCreatedAtAsc(a).stream()
                .filter(x -> x.getEventType() == InquiryWorkItemEvent.WORK_ITEM_DISMISSED).count();
        assertThat(dismissalsA).isZero();
    }

    private UUID openItem(UUID org, UUID accountId, UUID channelId) {
        Inquiry q = new Inquiry();
        q.setOrgId(org);
        q.setChannelId(channelId);
        q.setBody("본문");
        q.setStatus("UNANSWERED");
        q.setReceivedAt(Instant.parse("2025-05-01T00:00:00Z"));
        UUID inquiryId = inquiries.save(q).getId();

        InquiryWorkItem w = new InquiryWorkItem();
        w.setOrgId(org);
        w.setInquiryId(inquiryId);
        w.setSellerAccountId(accountId);
        w.setChannelId(channelId);
        w.setPhase(InquiryWorkItemPhase.OPEN);
        return workItems.save(w).getId();
    }
}
