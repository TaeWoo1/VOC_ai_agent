package com.sellerops.inquiry.queue;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.inquiry.queue.dto.InquiryQueueItem;
import com.sellerops.inquiry.queue.dto.InquiryQueueResponse;
import com.sellerops.inquiry.workitem.InquiryWorkItem;
import com.sellerops.inquiry.workitem.InquiryWorkItemPhase;
import com.sellerops.inquiry.workitem.InquiryWorkItemRepository;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * Read side of the inquiry work queue: org scoping (tenant isolation), phase
 * filtering, and sanitized rows (no buyer identity). Seeds inquiries + work items
 * directly so the read is exercised independently of the ingest path.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class InquiryQueueServiceTest {

    @Autowired InquiryRepository inquiries;
    @Autowired InquiryWorkItemRepository workItems;

    private InquiryQueueService service;

    @BeforeEach
    void setUp() {
        service = new InquiryQueueService(workItems, inquiries);
    }

    /** Persist an inquiry + a work item in {@code phase}; returns the work item id. */
    private UUID seed(UUID org, UUID sellerAccountId, UUID channelId,
                      InquiryWorkItemPhase phase, String title) {
        Inquiry q = new Inquiry();
        q.setOrgId(org);
        q.setChannelId(channelId);
        q.setTitle(title);
        q.setBody("본문 " + title);
        q.setStatus("UNANSWERED");
        q.setReceivedAt(Instant.parse("2026-06-27T00:00:00Z"));
        UUID inquiryId = inquiries.save(q).getId();

        InquiryWorkItem wi = new InquiryWorkItem();
        wi.setOrgId(org);
        wi.setInquiryId(inquiryId);
        wi.setSellerAccountId(sellerAccountId);
        wi.setChannelId(channelId);
        wi.setPhase(phase);
        return workItems.save(wi).getId();
    }

    @Test
    void returnsOnlyTheRequestedPhase() {
        UUID org = UUID.randomUUID();
        UUID acc = UUID.randomUUID();
        UUID channel = UUID.randomUUID();
        UUID openId = seed(org, acc, channel, InquiryWorkItemPhase.OPEN, "열린 문의");
        // A later-lifecycle phase seeded directly (no transition creates it in this
        // slice) purely to prove the read filter discriminates by phase.
        seed(org, acc, channel, InquiryWorkItemPhase.PROPOSED, "제안된 문의");

        InquiryQueueResponse open = service.queue(org, InquiryWorkItemPhase.OPEN, 0, 20);
        assertThat(open.content()).extracting(InquiryQueueItem::workItemId).containsExactly(openId);
        assertThat(open.content()).extracting(InquiryQueueItem::phase).containsOnly("OPEN");
        assertThat(open.totalElements()).isEqualTo(1);

        InquiryQueueResponse proposed = service.queue(org, InquiryWorkItemPhase.PROPOSED, 0, 20);
        assertThat(proposed.content()).extracting(InquiryQueueItem::phase).containsOnly("PROPOSED");
        assertThat(proposed.totalElements()).isEqualTo(1);
    }

    @Test
    void isTenantIsolatedByOrg() {
        UUID orgA = UUID.randomUUID();
        UUID orgB = UUID.randomUUID();
        UUID accA = UUID.randomUUID();
        UUID accB = UUID.randomUUID();
        UUID channel = UUID.randomUUID();
        UUID aItem = seed(orgA, accA, channel, InquiryWorkItemPhase.OPEN, "A 문의");
        UUID bItem = seed(orgB, accB, channel, InquiryWorkItemPhase.OPEN, "B 문의");

        InquiryQueueResponse a = service.queue(orgA, InquiryWorkItemPhase.OPEN, 0, 20);
        assertThat(a.content()).extracting(InquiryQueueItem::workItemId).containsExactly(aItem);
        assertThat(a.content()).extracting(InquiryQueueItem::sellerAccountId).containsExactly(accA);

        InquiryQueueResponse b = service.queue(orgB, InquiryWorkItemPhase.OPEN, 0, 20);
        assertThat(b.content()).extracting(InquiryQueueItem::workItemId).containsExactly(bItem);
        // Org B never sees org A's work item.
        assertThat(b.content()).extracting(InquiryQueueItem::workItemId).doesNotContain(aItem);
    }

    @Test
    void rowsAreSanitizedAndCarryTheExactConnection() {
        UUID org = UUID.randomUUID();
        UUID acc = UUID.randomUUID();
        UUID channel = UUID.randomUUID();
        seed(org, acc, channel, InquiryWorkItemPhase.OPEN, "재고 문의");

        InquiryQueueItem item = service.queue(org, InquiryWorkItemPhase.OPEN, 0, 20).content().get(0);
        assertThat(item.sellerAccountId()).isEqualTo(acc);
        assertThat(item.channelId()).isEqualTo(channel);
        assertThat(item.status()).isEqualTo("UNANSWERED");
        assertThat(item.title()).isEqualTo("재고 문의");
        assertThat(item.receivedAt()).isEqualTo(Instant.parse("2026-06-27T00:00:00Z"));
        // The DTO has no buyer-identity component at all (sanitized by construction).
        assertThat(item.toString()).doesNotContain("author");
    }

    @Test
    void pagesResults() {
        UUID org = UUID.randomUUID();
        UUID acc = UUID.randomUUID();
        UUID channel = UUID.randomUUID();
        for (int i = 0; i < 3; i++) {
            seed(org, acc, channel, InquiryWorkItemPhase.OPEN, "문의 " + i);
        }

        InquiryQueueResponse firstPage = service.queue(org, InquiryWorkItemPhase.OPEN, 0, 2);
        assertThat(firstPage.content()).hasSize(2);
        assertThat(firstPage.totalElements()).isEqualTo(3);
        assertThat(firstPage.totalPages()).isEqualTo(2);

        InquiryQueueResponse secondPage = service.queue(org, InquiryWorkItemPhase.OPEN, 1, 2);
        assertThat(secondPage.content()).hasSize(1);
    }
}
