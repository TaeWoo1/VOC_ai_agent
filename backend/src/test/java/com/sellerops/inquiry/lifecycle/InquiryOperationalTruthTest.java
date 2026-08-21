package com.sellerops.inquiry.lifecycle;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.community.Cafe24CommunityArticleRepository;
import com.sellerops.customermemory.CustomerMemoryEntry;
import com.sellerops.customermemory.CustomerMemoryEntryRepository;
import com.sellerops.customermemory.CustomerMemoryKind;
import com.sellerops.customermemory.LexicalCustomerMemoryRetriever;
import com.sellerops.customermemory.RepeatedInquiryService;
import com.sellerops.customermemory.dto.RepeatedInquiryView;
import com.sellerops.dashboard.DashboardService;
import com.sellerops.inbox.InboxService;
import com.sellerops.inbox.dto.InboxResponse;
import com.sellerops.ingest.IngestionService;
import com.sellerops.itemanalysis.ItemAnalysis;
import com.sellerops.ingest.canonical.CanonicalInquiry;
import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.InquiryOperationalState;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.inquiry.workitem.InquiryWorkItem;
import com.sellerops.inquiry.workitem.InquiryWorkItemAuditRepository;
import com.sellerops.inquiry.workitem.InquiryWorkItemDisposition;
import com.sellerops.inquiry.workitem.InquiryWorkItemPhase;
import com.sellerops.inquiry.workitem.InquiryWorkItemRepository;
import com.sellerops.inquiry.workitem.InquiryWorkItemWriter;
import com.sellerops.inquiry.workitem.dismissal.InquiryWorkItemDismissalBatchRepository;
import com.sellerops.inquiry.workitem.dismissal.InquiryWorkItemDismissalService;
import com.sellerops.inquiry.workitem.dismissal.InquiryWorkItemDismissalService.DismissalCommand;
import com.sellerops.order.OrderDailySummaryRepository;
import com.sellerops.order.OrderService;
import com.sellerops.product.ProductRepository;
import com.sellerops.product.ProductService;
import com.sellerops.review.ReviewRepository;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.data.domain.PageRequest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.PlatformTransactionManager;

/**
 * The seller's dismissal decision, and every current-truth number that has to honour it.
 *
 * <p><b>The failure this pins.</b> On 2026-07-06 the demo org's seller dismissed 3,199 Cafe24 board-6
 * spam posts through approved dismissal batches. That decision landed on {@code inquiry_work_item} and
 * nowhere else, and every "what do I have to deal with" read goes to {@code inquiries} directly — so 홈
 * counted 3,216 미답변 of which 3,200 were work the seller had already decided not to do, the repeat
 * analysis reported 기타 ×1,779 as a customer pattern, and the Operator answered out of the same
 * corpus. The work queue itself was always right, because it is the one read that is phase-filtered.
 *
 * <p><b>What is asserted here is a corpus, not a screen.</b> 홈, Today Inbox, the weekly report and the
 * Operator all count through {@code InquiryRepository}; pinning the repository's corpus and the two
 * services that publish the headline number is what makes those four agree by construction rather than
 * by four separate assertions that can drift apart.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class InquiryOperationalTruthTest {

    @Autowired InquiryRepository inquiries;
    @Autowired ReviewRepository reviews;
    @Autowired OrderDailySummaryRepository orders;
    @Autowired ProductRepository products;
    @Autowired Cafe24CommunityArticleRepository communityArticles;
    @Autowired ChannelRepository channels;
    @Autowired SellerAccountRepository sellerAccounts;
    @Autowired InquiryWorkItemRepository workItems;
    @Autowired InquiryWorkItemAuditRepository audits;
    @Autowired InquiryWorkItemDismissalBatchRepository batches;
    @Autowired CustomerMemoryEntryRepository memory;
    @Autowired com.sellerops.itemanalysis.ItemAnalysisRepository analyses;
    @Autowired PlatformTransactionManager txManager;

    private static final String APPROVED_BY = "demo@sellerops.ai";
    private static final String APPROVED_AT = "2026-08-21T00:00:00Z";

    private final UUID org = UUID.randomUUID();
    private UUID channelId;
    private UUID accountId;

    private IngestionService ingest;
    private InquiryWorkItemDismissalService dismissal;
    private InquiryOperationalStateBackfill backfill;
    private InboxService inbox;
    private DashboardService dashboard;

    @BeforeEach
    void setUp() {
        Channel ch = new Channel();
        ch.setCode("CAFE24");
        ch.setNameKo("카페24");
        ch.setStatus(ChannelStatus.AVAILABLE);
        ch.setSupportsInquiry(true);
        ch.setSortOrder(0);
        channelId = channels.save(ch).getId();

        SellerAccount acc = new SellerAccount();
        acc.setOrgId(org);
        acc.setChannelId(channelId);
        acc.setConnectionStatus(ChannelStatus.CONNECTED);
        acc.setFileUpload(false);
        accountId = sellerAccounts.save(acc).getId();

        InquiryWorkItemWriter writer = new InquiryWorkItemWriter(inquiries, workItems, audits, txManager);
        ingest = new IngestionService(reviews, inquiries, orders, new ProductService(products),
                communityArticles, channels, writer);
        InquiryOperationalStateProjector projector = new InquiryOperationalStateProjector();
        dismissal = new InquiryWorkItemDismissalService(workItems, inquiries, projector, audits, batches,
                sellerAccounts, channels, txManager);
        backfill = new InquiryOperationalStateBackfill(inquiries, workItems, projector);
        inbox = new InboxService(inquiries, reviews, channels, products);
        dashboard = new DashboardService(inquiries, reviews, orders, products,
                new OrderService(orders, channels), inbox);
    }

    // ------------------------------------------------------------------ 1. every current consumer

    @Test
    @DisplayName("a seller-dismissed inquiry leaves every current-truth read, and 홈 · 인박스 agree")
    void dismissedLeavesCurrentTruth() {
        ingestThree();
        assertThat(inquiries.countByOrgIdAndStatus(org, "UNANSWERED")).isEqualTo(3);

        dismissAsSpam("spam-batch-1", spamWorkItemIds());

        // The headline number, from both services that publish it. 홈 reads the secret-aware count and
        // Today Inbox / the weekly report / the Operator's inbox tool read the plain one — they have to
        // land on the same corpus or the same words print two numbers.
        assertThat(dashboard.summary(org).cards().unansweredInquiries())
                .as("홈")
                .isEqualTo(1);
        InboxResponse response = inbox.inbox(org);
        assertThat(response.unansweredInquiries())
                .as("Today Inbox / 리포트 / Operator — the same corpus as 홈")
                .isEqualTo(1);
        assertThat(response.items())
                .as("the feed is a list of work, and dismissed work is not work")
                .hasSize(1);
        assertThat(response.items().get(0).id()).isEqualTo(realInquiry().getId().toString());

        // The product axis: volumes, the unanswered-per-product figure, and the analysis sample.
        UUID productId = realInquiry().getProductId();
        assertThat(inquiries.countByOrgIdAndProductId(org, productId)).isEqualTo(1);
        assertThat(inquiries.countByOrgIdAndProductIdAndStatus(org, productId, "UNANSWERED")).isEqualTo(1);
        assertThat(inquiries.findIdsByProduct(org, productId, PageRequest.of(0, 50)))
                .containsExactly(realInquiry().getId());

        // The item-analysis backlog: no verdict is computed for work the seller set aside.
        assertThat(inquiries.countUnanalyzedByOrgId(org)).isEqualTo(1);

        // The semantic corpus: the classifier is never spent on a dismissed post.
        assertThat(inquiries.findForMemoryIndexing(org, PageRequest.of(0, 50)))
                .extracting(Inquiry::getExternalId)
                .containsExactly("Q-REAL");
    }

    // ------------------------------------------------------------------ 3. non-SPAM untouched

    @Test
    @DisplayName("dismissing two leaves the third exactly as it was")
    void nonSpamUntouched() {
        ingestThree();
        Inquiry before = realInquiry();

        dismissAsSpam("spam-batch-1", spamWorkItemIds());

        Inquiry after = realInquiry();
        assertThat(after.getOperationalState()).isEqualTo(InquiryOperationalState.ACTIVE);
        assertThat(after.getOperationalStateAt()).as("an untouched row records no transition").isNull();
        assertThat(after.getStatus()).isEqualTo(before.getStatus());
        assertThat(after.getBody()).isEqualTo(before.getBody());
        assertThat(workItems.findByInquiryId(after.getId()).orElseThrow().getPhase())
                .isEqualTo(InquiryWorkItemPhase.OPEN);
    }

    @Test
    @DisplayName("exclusion is a state, never a delete — the row and its work item survive intact")
    void exclusionIsNotDeletion() {
        ingestThree();
        dismissAsSpam("spam-batch-1", spamWorkItemIds());

        assertThat(inquiries.findAll()).as("nothing was removed from storage").hasSize(3);
        Inquiry excluded = inquiries.findByOrgIdAndChannelIdAndExternalId(org, channelId, "Q-SPAM-1")
                .orElseThrow();
        assertThat(excluded.getOperationalState()).isEqualTo(InquiryOperationalState.EXCLUDED_SPAM);
        assertThat(excluded.getOperationalStateAt()).isNotNull();
        assertThat(excluded.getBody()).as("the body is kept — audit reads still see it").isNotBlank();
        assertThat(workItems.findByInquiryId(excluded.getId())).isPresent();
        assertThat(audits.findAll()).as("the audit trail is append-only and untouched").isNotEmpty();
    }

    @Test
    @DisplayName("the dedup key still sees an excluded row, so re-collection never duplicates it")
    void dedupStillSeesExcludedRows() {
        ingestThree();
        dismissAsSpam("spam-batch-1", spamWorkItemIds());

        // The platform serves the same spam post again on the next sweep.
        ingest.ingestInquiries(org, channelId, accountId, List.of(row("Q-SPAM-1", 1, "UNANSWERED")));

        assertThat(inquiries.findAll()).as("one stored row, not two").hasSize(3);
        assertThat(inquiries.findByOrgIdAndChannelIdAndExternalId(org, channelId, "Q-SPAM-1").orElseThrow()
                .getOperationalState())
                .as("re-collection is not a reason to reconsider the seller's decision")
                .isEqualTo(InquiryOperationalState.EXCLUDED_SPAM);
    }

    // ------------------------------------------------------------------ 2. reversal

    @Test
    @DisplayName("reverse the dismissal and the inquiry is operationally eligible again")
    void reversalRestoresIt() {
        ingestThree();
        dismissAsSpam("spam-batch-1", spamWorkItemIds());
        assertThat(inbox.inbox(org).unansweredInquiries()).isEqualTo(1);

        // The reversal is at the ledger — the work item goes back to OPEN. The projection follows it;
        // there is no undo record to keep and no compensating state to unwind.
        InquiryWorkItem item = workItems.findByInquiryId(spamInquiry("Q-SPAM-1").getId()).orElseThrow();
        item.setPhase(InquiryWorkItemPhase.OPEN);
        item.setDisposition(null);
        workItems.save(item);

        InquiryOperationalStateBackfill.Result result = backfill.run(org);

        assertThat(result.restored()).isEqualTo(1);
        assertThat(result.excluded()).as("the other dismissal still stands").isZero();
        assertThat(spamInquiry("Q-SPAM-1").getOperationalState()).isEqualTo(InquiryOperationalState.ACTIVE);
        assertThat(inbox.inbox(org).unansweredInquiries()).isEqualTo(2);
        assertThat(dashboard.summary(org).cards().unansweredInquiries()).isEqualTo(2);
    }

    // ------------------------------------------------------------------ D. recovery of existing rows

    @Test
    @DisplayName("rows dismissed before the column existed are recovered from the ledger, idempotently")
    void backfillRecoversPreExistingDismissals() {
        ingestThree();
        // Exactly the shape of the demo org's 3,199: a DISMISSED / SPAM work item whose inquiry was
        // never projected, because the projection did not exist when the batch ran.
        for (UUID id : spamWorkItemIds()) {
            InquiryWorkItem item = workItems.findById(id).orElseThrow();
            item.setPhase(InquiryWorkItemPhase.DISMISSED);
            item.setDisposition(InquiryWorkItemDisposition.SPAM);
            workItems.save(item);
        }
        assertThat(inbox.inbox(org).unansweredInquiries())
                .as("before the backfill the ledger says spam and the count does not")
                .isEqualTo(3);

        InquiryOperationalStateBackfill.Result first = backfill.run(org);
        assertThat(first.excluded()).isEqualTo(2);
        assertThat(inbox.inbox(org).unansweredInquiries()).isEqualTo(1);

        InquiryOperationalStateBackfill.Result second = backfill.run(org);
        assertThat(second.changed()).as("a second run writes nothing").isZero();
        assertThat(second.examined()).as("but it still checked the same rows").isEqualTo(2);
        assertThat(inbox.inbox(org).unansweredInquiries()).isEqualTo(1);
    }

    // ------------------------------------------------------------------ 5. memory: current vs history

    @Test
    @DisplayName("current retrieval passes over a dismissed inquiry; its memory entry is still there")
    void memoryExcludesFromCurrentButKeepsHistory() {
        ingestThree();
        Inquiry spamA = spamInquiry("Q-SPAM-1");
        Inquiry spamB = spamInquiry("Q-SPAM-2");
        Inquiry real = realInquiry();
        // Three entries sharing one signature: on the current corpus that is one occurrence, not three.
        UUID spamEntryA = entry(spamA.getId(), "배송:지연", "배송").getId();
        entry(spamB.getId(), "배송:지연", "배송");
        entry(real.getId(), "배송:지연", "배송");

        dismissAsSpam("spam-batch-1", spamWorkItemIds());

        RepeatedInquiryService repeats = new RepeatedInquiryService(memory);
        List<RepeatedInquiryView> rows = repeats.repeats(org, LocalDate.parse("2026-08-21"), 28);
        assertThat(rows)
                .as("two of the three occurrences were dismissed as spam — one occurrence is not a repeat")
                .isEmpty();

        LexicalCustomerMemoryRetriever retriever = new LexicalCustomerMemoryRetriever(memory);
        assertThat(retriever.retrieve(org,
                new com.sellerops.customermemory.CustomerMemoryRetriever.RetrievalCue("배송:지연", "배송", null),
                null, 10))
                .as("current retrieval answers out of current truth only")
                .hasSize(1);

        assertThat(memory.findById(spamEntryA))
                .as("the historical record survives — nothing in this package deletes an entry")
                .isPresent();
        assertThat(memory.findByOrgIdAndEntryKindAndSourceId(org, CustomerMemoryKind.INQUIRY, spamA.getId()))
                .as("and re-indexing still finds it, so a reversal needs no re-creation")
                .isPresent();
    }

    @Test
    @DisplayName("stored analyses of a dismissed inquiry are kept but drop out of the current list")
    void itemAnalysisListExcludesDismissed() {
        ingestThree();
        analysis(spamInquiry("Q-SPAM-1").getId(), "답변 필요");
        analysis(spamInquiry("Q-SPAM-2").getId(), "답변 필요");
        analysis(realInquiry().getId(), "FAQ 후보");
        UUID reviewSourceId = UUID.randomUUID();
        ItemAnalysis reviewRow = new ItemAnalysis();
        reviewRow.setOrgId(org);
        reviewRow.setSourceType("REVIEW");
        reviewRow.setSourceId(reviewSourceId);
        reviewRow.setCategory("품질");
        reviewRow.setUrgency("보통");
        reviewRow.setRecommendedAction("확인 필요");
        reviewRow.setAnalyzerVersion("test/v1");
        reviewRow.setAnalyzerKind("RULE_BASED");
        reviewRow.setAnalyzerName("test");
        reviewRow.setSentiment("NEUTRAL");
        reviewRow.setSummary("리뷰 요약");
        analyses.save(reviewRow);

        dismissAsSpam("spam-batch-1", spamWorkItemIds());

        assertThat(analyses.findAllByOrgIdOrderByCreatedAtDesc(org))
                .as("the 리포트's FAQ / 상세페이지 후보 counts read this list — it must be the current corpus")
                .extracting(ItemAnalysis::getRecommendedAction)
                .containsExactlyInAnyOrder("FAQ 후보", "확인 필요");
        assertThat(analyses.count())
                .as("but the stored verdicts are still there — this is a projection, not a purge")
                .isEqualTo(4);
    }

    // ------------------------------------------------------------------ helpers

    private void ingestThree() {
        ingest.ingestInquiries(org, channelId, accountId, List.of(
                row("Q-SPAM-1", 1, "UNANSWERED"),
                row("Q-SPAM-2", 2, "UNANSWERED"),
                row("Q-REAL", 3, "UNANSWERED")));
    }

    private CanonicalInquiry row(String externalId, int sourceRow, String status) {
        return new CanonicalInquiry(null, "SKU-1", null, "본문 " + externalId,
                status, at("2026-08-10"), externalId, sourceRow, "제목 " + externalId, "N");
    }

    private static Instant at(String date) {
        return LocalDate.parse(date).atStartOfDay(ZoneOffset.UTC).toInstant();
    }

    private Inquiry spamInquiry(String externalId) {
        return inquiries.findByOrgIdAndChannelIdAndExternalId(org, channelId, externalId).orElseThrow();
    }

    private Inquiry realInquiry() {
        return inquiries.findByOrgIdAndChannelIdAndExternalId(org, channelId, "Q-REAL").orElseThrow();
    }

    private List<UUID> spamWorkItemIds() {
        return List.of(
                workItems.findByInquiryId(spamInquiry("Q-SPAM-1").getId()).orElseThrow().getId(),
                workItems.findByInquiryId(spamInquiry("Q-SPAM-2").getId()).orElseThrow().getId());
    }

    private void dismissAsSpam(String commandId, List<UUID> workItemIds) {
        dismissal.executeAllOrNothing(
                new DismissalCommand(org, accountId, InquiryWorkItemDisposition.SPAM, commandId,
                        "OPERATOR:test", workItemIds),
                "CONFIRM_DISMISS", APPROVED_BY, APPROVED_AT);
    }

    private ItemAnalysis analysis(UUID inquiryId, String recommendedAction) {
        ItemAnalysis row = new ItemAnalysis();
        row.setOrgId(org);
        row.setSourceType("INQUIRY");
        row.setSourceId(inquiryId);
        row.setCategory("배송");
        row.setUrgency("보통");
        row.setRecommendedAction(recommendedAction);
        row.setAnalyzerVersion("test/v1");
        row.setAnalyzerKind("RULE_BASED");
        row.setAnalyzerName("test");
        row.setSentiment("NEUTRAL");
        row.setSummary("문의 요약");
        return analyses.save(row);
    }

    private CustomerMemoryEntry entry(UUID sourceId, String signature, String topic) {
        CustomerMemoryEntry e = new CustomerMemoryEntry();
        e.setOrgId(org);
        e.setEntryKind(CustomerMemoryKind.INQUIRY);
        e.setSourceId(sourceId);
        e.setChannelId(channelId);
        e.setTopic(topic);
        e.setSignatureKey(signature);
        e.setOccurredOn(LocalDate.parse("2026-08-10"));
        e.setAnswered(false);
        return memory.save(e);
    }
}
