package com.sellerops.inquiry.queue;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.common.DataOrigin;
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
import org.junit.jupiter.api.DisplayName;
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
    @Autowired com.sellerops.channel.ChannelRepository channels;
    @Autowired com.sellerops.product.ProductRepository products;

    private InquiryQueueService service;

    @BeforeEach
    void setUp() {
        service = new InquiryQueueService(workItems, inquiries, channels, products);
    }

    /** Persist an inquiry + a work item in {@code phase}; returns the work item id. */
    private UUID seed(UUID org, UUID sellerAccountId, UUID channelId,
                      InquiryWorkItemPhase phase, String title) {
        return seed(org, sellerAccountId, channelId, phase, title, DataOrigin.REAL);
    }

    private UUID seed(UUID org, UUID sellerAccountId, UUID channelId,
                      InquiryWorkItemPhase phase, String title, DataOrigin origin) {
        Inquiry q = new Inquiry();
        q.setOrgId(org);
        q.setChannelId(channelId);
        q.setTitle(title);
        q.setBody("본문 " + title);
        q.setStatus("UNANSWERED");
        q.setDataOrigin(origin);
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

    @Test
    void manufacturedWorkIsNotOperationalWork() {
        // This queue is where an item is worked from, approved in, and ultimately sent from. A fixture
        // standing in that line would be a manufactured row in the path of a marketplace write, so it
        // is excluded here as well as at the writer — the writer's fence only protects rows collected
        // after it shipped, and these predate it.
        UUID org = UUID.randomUUID();
        UUID account = UUID.randomUUID();
        UUID channel = UUID.randomUUID();
        seed(org, account, channel, InquiryWorkItemPhase.OPEN, "진짜 문의");
        seed(org, account, channel, InquiryWorkItemPhase.OPEN, "데모 문의", DataOrigin.DEMO_SEED);
        seed(org, account, channel, InquiryWorkItemPhase.OPEN, "검증 픽스처", DataOrigin.VERIFY_FIXTURE);

        InquiryQueueResponse page = service.queue(org, InquiryWorkItemPhase.OPEN, 0, 20);

        assertThat(page.content()).extracting(InquiryQueueItem::title).containsExactly("진짜 문의");
        // The count is narrowed with the rows, not after them: a queue that says 3 while showing 1 is
        // its own defect, and paging past the first page would have skipped real work.
        assertThat(page.totalElements()).isEqualTo(1);
    }

    @Test
    void excludingManufacturedWorkFromTheQueueDoesNotDeleteItsHistory() {
        UUID org = UUID.randomUUID();
        UUID account = UUID.randomUUID();
        UUID channel = UUID.randomUUID();
        UUID workItemId = seed(org, account, channel, InquiryWorkItemPhase.OPEN, "데모 문의",
                DataOrigin.DEMO_SEED);

        assertThat(service.queue(org, InquiryWorkItemPhase.OPEN, 0, 20).content()).isEmpty();
        // Still on record for debug/history readers. Not operational is not the same as not collected.
        assertThat(workItems.findById(workItemId)).isPresent();
    }

    @Test
    @DisplayName("§1-B — an OPEN item whose inquiry the channel already answered is not a task")
    void answeredInquiryLeavesTheActionableQueue() {
        UUID org = UUID.randomUUID();
        UUID account = UUID.randomUUID();
        UUID channel = UUID.randomUUID();
        UUID stale = seed(org, account, channel, InquiryWorkItemPhase.PROPOSED, "이미 답변함");
        UUID waiting = seed(org, account, channel, InquiryWorkItemPhase.PROPOSED, "아직 답변 안 함");
        // The seller replied in the marketplace console; our sweep has not run since.
        Inquiry answered = inquiries.findAll().stream()
                .filter(q -> "이미 답변함".equals(q.getTitle())).findFirst().orElseThrow();
        answered.setStatus("ANSWERED");
        inquiries.save(answered);

        InquiryQueueResponse page = service.queue(org, InquiryWorkItemPhase.PROPOSED, 0, 20);

        assertThat(page.content()).extracting(InquiryQueueItem::workItemId).containsExactly(waiting);
        assertThat(stale).isNotNull();
    }

    @Test
    @DisplayName("a COMPLETED item's inquiry is answered BY DEFINITION — that tab is not emptied")
    void completedWorkKeepsItsAnsweredInquiry() {
        UUID org = UUID.randomUUID();
        UUID account = UUID.randomUUID();
        UUID channel = UUID.randomUUID();
        UUID done = seed(org, account, channel, InquiryWorkItemPhase.COMPLETED, "답변 완료");
        Inquiry answered = inquiries.findAll().stream()
                .filter(q -> "답변 완료".equals(q.getTitle())).findFirst().orElseThrow();
        answered.setStatus("ANSWERED");
        inquiries.save(answered);

        InquiryQueueResponse page = service.queue(org, InquiryWorkItemPhase.COMPLETED, 0, 20);

        assertThat(page.content()).extracting(InquiryQueueItem::workItemId).containsExactly(done);
    }
}
