package com.sellerops.connector.cafe24;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.community.Cafe24CommunityArticleRepository;
import com.sellerops.connector.DataType;
import com.sellerops.connector.FetchPage;
import com.sellerops.connector.FetchRequest;
import com.sellerops.credential.ConnectorCredentialRepository;
import com.sellerops.credential.CredentialVault;
import com.sellerops.ingest.IngestOutcome;
import com.sellerops.ingest.IngestionService;
import com.sellerops.ingest.canonical.CanonicalInquiry;
import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.InquiryOperationalState;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.inquiry.workitem.InquiryWorkItem;
import com.sellerops.inquiry.workitem.InquiryWorkItemAuditRepository;
import com.sellerops.inquiry.workitem.InquiryWorkItemPhase;
import com.sellerops.inquiry.workitem.InquiryWorkItemRepository;
import com.sellerops.inquiry.workitem.InquiryWorkItemWriter;
import com.sellerops.order.OrderDailySummaryRepository;
import com.sellerops.product.ProductRepository;
import com.sellerops.product.ProductService;
import com.sellerops.review.ReviewRepository;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.LocalDate;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.data.domain.Pageable;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.PlatformTransactionManager;

/**
 * Cafe24-native inquiry intake, end to end over the real (H2) DB: a board-6 (문의사항)
 * article flows through the shared {@link IngestionService#ingestInquiries} into the
 * common {@code Inquiry} plus exactly one OPEN {@code InquiryWorkItem} bound to the
 * exact seller connection — the same channel-neutral path the ESM connector uses.
 * Proves native identity mapping, duplicate-safe dedup, tenant/seller-account
 * isolation, that no buyer PII or Market Plus origin is stored, and that board 6
 * never writes to the community/VOC store.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class Cafe24InquiryIngestionFlowTest {

    private static final LocalDate START = LocalDate.parse("2026-01-01");
    private static final LocalDate END = LocalDate.parse("2026-06-25");

    @Autowired ReviewRepository reviews;
    @Autowired InquiryRepository inquiries;
    @Autowired OrderDailySummaryRepository orders;
    @Autowired ProductRepository products;
    @Autowired Cafe24CommunityArticleRepository communityArticles;
    @Autowired InquiryWorkItemRepository workItems;
    @Autowired InquiryWorkItemAuditRepository audits;
    @Autowired PlatformTransactionManager txManager;
    @Autowired ChannelRepository channels;
    @Autowired ConnectorCredentialRepository credentials;

    private final UUID org = UUID.randomUUID();
    private final UUID account = UUID.randomUUID();
    private final UUID channel = UUID.randomUUID();
    private final FakeCafe24HttpClient http = new FakeCafe24HttpClient();

    private CredentialVault vault;
    private IngestionService ingestion;
    private Cafe24ApiConnector connector;
    private Cafe24ApiConnector commentAwareConnector;

    @BeforeEach
    void setUp() {
        byte[] key = new byte[32];
        new SecureRandom().nextBytes(key);
        vault = new CredentialVault(credentials, new ObjectMapper(), Base64.getEncoder().encodeToString(key),
                "local-test-1");
        vault.store(org, account, "API", "OAUTH2",
                Map.of("mall_id", "samplemall", "refresh_token", "old-refresh-token"),
                null, null, null);
        ingestion = new IngestionService(reviews, inquiries, orders, new ProductService(products),
                communityArticles, channels, new InquiryWorkItemWriter(inquiries, workItems, audits, txManager));
        connector = new Cafe24ApiConnector(
                new Cafe24Authorizer(new Cafe24TokenClient(http), vault, "app-client-id", "app-client-secret"),
                new Cafe24OrdersClient(http), new Cafe24BoardArticlesClient(http), Clock.systemUTC());
        // The same connector WITH the comment lane. Kept as a second instance so every existing test
        // keeps proving the shape a deployment without the lane has — fewer signals, never a guessed one.
        commentAwareConnector = new Cafe24ApiConnector(
                new Cafe24Authorizer(new Cafe24TokenClient(http), vault, "app-client-id", "app-client-secret"),
                new Cafe24OrdersClient(http), new Cafe24BoardArticlesClient(http), null,
                new Cafe24InquiryAnswerObserver(new Cafe24BoardArticlesClient(http),
                        new Cafe24BoardCommentsClient(http)),
                Clock.systemUTC());
    }

    /**
     * One board-6 page through the COMMENT-AWARE connector, then ingest.
     *
     * <p>Three responses in order: the article page, the {@code comment=T} discovery, and the target's
     * comments. {@code commenterMemberId} decides the whole outcome — {@code "samplemall"} is the shop
     * ({@code member_id == mall_id}), anything else is a customer.
     */
    private IngestOutcome fetchAndIngestWithComment(long articleNo, String reply,
                                                    String commenterMemberId) {
        http.enqueue(FakeCafe24HttpClient.tokenOk("access-1", "old-refresh-token"));
        http.enqueue(FakeCafe24HttpClient.articlesOk(
                FakeCafe24HttpClient.article(articleNo, "제목", "본문", 77L, null,
                        "2026-06-20T10:00:00+09:00", reply)));
        http.enqueue(new Cafe24HttpClient.Response(200,
                "{\"articles\":[{\"article_no\":" + articleNo + "}]}", Map.of()));
        http.enqueue(new Cafe24HttpClient.Response(200,
                "{\"comments\":[{\"comment_no\":39,\"article_no\":" + articleNo + ","
                        + "\"created_date\":\"2026-06-21T14:56:24+09:00\","
                        + "\"member_id\":\"" + commenterMemberId + "\"}]}", Map.of()));
        String cursor = Cafe24ArticleCursor.window(6, START, END).encode();
        FetchPage page = commentAwareConnector.fetch(
                new FetchRequest(org, account, "CAFE24", DataType.INQUIRY, cursor, 3));
        @SuppressWarnings("unchecked")
        List<CanonicalInquiry> records = (List<CanonicalInquiry>) page.records();
        return ingestion.ingestInquiries(org, channel, account, records);
    }

    @Test
    void aShopCommentAnswersTheInquiryAndCompletesTheWorkItem() {
        // The measured 2026-08-26 shape: the article says N, the shop answered in a comment.
        fetchAndIngestWithComment(3674L, "N", "samplemall");

        Inquiry stored = inquiries.findTop50ByOrgIdOrderByReceivedAtDesc(org).get(0);
        assertThat(stored.getStatus()).isEqualTo("ANSWERED");
        assertThat(stored.getInformStatus())
                .as("the channel's reply_status is still N, and we still record what it said")
                .isEqualTo("N");
        assertThat(stored.getAnsweredAt()).isNotNull();
        assertThat(stored.getAnswerBody()).as("the fact, not the shop's words").isNull();
        assertThat(openWorkItems(org)).isEmpty();
    }

    @Test
    void aCustomerCommentLeavesTheInquiryWaiting() {
        fetchAndIngestWithComment(3675L, "N", "buyer01");

        Inquiry stored = inquiries.findTop50ByOrgIdOrderByReceivedAtDesc(org).get(0);
        assertThat(stored.getStatus()).isEqualTo("UNANSWERED");
        assertThat(stored.getAnsweredAt()).isNull();
        assertThat(openWorkItems(org))
                .as("someone commented; nobody answered — the seller still owes a reply").hasSize(1);
    }

    @Test
    void aShopCommentOnAnAlreadyOpenInquiryCompletesItOnTheNextSweep() {
        fetchAndIngest(3676L, "본문", "N", "F");
        UUID workItemId = openWorkItems(org).get(0).getId();

        IngestOutcome second = fetchAndIngestWithComment(3676L, "N", "samplemall");

        assertThat(second.insertedIds()).as("update in place, never a duplicate row").isEmpty();
        assertThat(inquiries.findTop50ByOrgIdOrderByReceivedAtDesc(org)).hasSize(1);
        assertThat(openWorkItems(org)).isEmpty();
        assertThat(workItems.findById(workItemId)).get()
                .extracting(InquiryWorkItem::getPhase).isEqualTo(InquiryWorkItemPhase.COMPLETED);
    }

    /** Fetch one board-6 page through the connector, then ingest for (org, account). */
    private IngestOutcome fetchAndIngest(long articleNo, String content, String reply) {
        http.enqueue(FakeCafe24HttpClient.tokenOk("access-1", "old-refresh-token"));
        http.enqueue(FakeCafe24HttpClient.articlesOk(
                FakeCafe24HttpClient.article(articleNo, "제목", content, 77L, null,
                        "2026-06-20T10:00:00+09:00", reply)));
        String cursor = Cafe24ArticleCursor.window(6, START, END).encode();
        FetchPage page = connector.fetch(new FetchRequest(org, account, "CAFE24", DataType.INQUIRY, cursor, 3));
        @SuppressWarnings("unchecked")
        List<CanonicalInquiry> records = (List<CanonicalInquiry>) page.records();
        return ingestion.ingestInquiries(org, channel, account, records);
    }

    /** Fetch one board-6 page carrying an explicit secret flag, then ingest for (org, account). */
    private IngestOutcome fetchAndIngest(long articleNo, String content, String reply, String secret) {
        http.enqueue(FakeCafe24HttpClient.tokenOk("access-1", "old-refresh-token"));
        http.enqueue(FakeCafe24HttpClient.articlesOk(
                FakeCafe24HttpClient.article(articleNo, "제목", content, 77L, null,
                        "2026-06-20T10:00:00+09:00", reply, secret)));
        String cursor = Cafe24ArticleCursor.window(6, START, END).encode();
        FetchPage page = connector.fetch(new FetchRequest(org, account, "CAFE24", DataType.INQUIRY, cursor, 3));
        @SuppressWarnings("unchecked")
        List<CanonicalInquiry> records = (List<CanonicalInquiry>) page.records();
        return ingestion.ingestInquiries(org, channel, account, records);
    }

    private List<InquiryWorkItem> openWorkItems(UUID orgId) {
        return workItems.findByOrgIdAndPhase(orgId, InquiryWorkItemPhase.OPEN, Pageable.unpaged()).getContent();
    }

    @Test
    void secretBoard6InquiryIsStoredWithIsSecretTrueAndKeptInTheQueue() {
        IngestOutcome out = fetchAndIngest(3010L, "비밀 문의 본문", "N", "T");

        assertThat(out.success()).isEqualTo(1);
        Inquiry q = inquiries.findTop50ByOrgIdOrderByReceivedAtDesc(org).get(0);
        assertThat(q.getSecret()).isTrue();
        assertThat(q.getExternalId()).isEqualTo("cafe24:b6:a3010");
        // A secret inquiry is still an actionable seller task — it stays in the work queue.
        assertThat(openWorkItems(org)).hasSize(1);
    }

    @Test
    void publicBoard6InquiryIsStoredWithIsSecretFalse() {
        fetchAndIngest(3011L, "공개 문의 본문", "N", "F");

        assertThat(inquiries.findTop50ByOrgIdOrderByReceivedAtDesc(org).get(0).getSecret()).isFalse();
    }

    @Test
    void reCollectingUnchangedIsANoOpUnderSourceAwareUpsert() {
        fetchAndIngest(3030L, "본문", "N", "F");
        IngestOutcome second = fetchAndIngest(3030L, "본문", "N", "F");

        assertThat(second.success()).isZero();
        assertThat(second.skipped()).isEqualTo(1);
        assertThat(inquiries.findTop50ByOrgIdOrderByReceivedAtDesc(org)).hasSize(1);
        assertThat(openWorkItems(org)).hasSize(1);
    }

    @Test
    void outOfWindowArticleCreatesNoInquiryAndNoWorkItemWhileInWindowAnsweredStoresSecretWithNoOpenItem() {
        // Mirrors the halted live run: a single-day window (2026-03-24) came back with an
        // in-window answered secret inquiry AND an out-of-window (2026-03-27) unanswered
        // secret inquiry. Only the in-window row may be stored; the out-of-window row must
        // create neither an inquiry nor a work item.
        http.enqueue(FakeCafe24HttpClient.tokenOk("access-1", "old-refresh-token"));
        http.enqueue(FakeCafe24HttpClient.articlesOk(
                FakeCafe24HttpClient.article(3101L, "제목", "본문", 77L, null,
                        "2026-03-24T10:00:00+09:00", "C", "T"),    // in-window, answered, secret
                FakeCafe24HttpClient.article(3102L, "제목", "본문2", 77L, null,
                        "2026-03-27T10:00:00+09:00", null, "T")));  // out-of-window, unanswered, secret
        String cursor = Cafe24ArticleCursor.window(6,
                LocalDate.parse("2026-03-24"), LocalDate.parse("2026-03-24")).encode();
        FetchPage page = connector.fetch(
                new FetchRequest(org, account, "CAFE24", DataType.INQUIRY, cursor, 50));
        @SuppressWarnings("unchecked")
        List<CanonicalInquiry> records = (List<CanonicalInquiry>) page.records();
        IngestOutcome out = ingestion.ingestInquiries(org, channel, account, records);

        // Only the in-window row is emitted, so only it is ingested.
        assertThat(out.success()).isEqualTo(1);
        List<Inquiry> rows = inquiries.findTop50ByOrgIdOrderByReceivedAtDesc(org);
        assertThat(rows).hasSize(1);
        Inquiry q = rows.get(0);
        assertThat(q.getExternalId()).isEqualTo("cafe24:b6:a3101");
        assertThat(q.getStatus()).isEqualTo("ANSWERED"); // C → answered
        assertThat(q.getSecret()).isTrue();               // secret preserved, kept in queue
        // The out-of-window article is nowhere — not stored, and no work item.
        assertThat(rows).noneMatch(r -> r.getExternalId().equals("cafe24:b6:a3102"));
        // The answered inquiry opens no OPEN work item, and the dropped unanswered one did not either.
        assertThat(openWorkItems(org)).isEmpty();
    }

    @Test
    void reCollectingWithReplyStatusNtoCUpdatesInPlaceAndCompletesTheWorkItem() {
        fetchAndIngest(3020L, "본문", "N", "F");
        Inquiry before = inquiries.findTop50ByOrgIdOrderByReceivedAtDesc(org).get(0);
        assertThat(before.getStatus()).isEqualTo("UNANSWERED");
        UUID inquiryId = before.getId();
        UUID workItemId = openWorkItems(org).get(0).getId();

        IngestOutcome second = fetchAndIngest(3020L, "본문", "C", "F");

        // Update in place — no duplicate row, no new inserted id, no new work item.
        assertThat(second.success()).isEqualTo(1);
        assertThat(second.insertedIds()).isEmpty();
        List<Inquiry> rows = inquiries.findTop50ByOrgIdOrderByReceivedAtDesc(org);
        assertThat(rows).hasSize(1);
        Inquiry after = rows.get(0);
        assertThat(after.getId()).isEqualTo(inquiryId);
        assertThat(after.getStatus()).isEqualTo("ANSWERED");
        assertThat(after.getInformStatus()).isEqualTo("C");
        // The one OPEN work item is COMPLETED — never reopened, never duplicated.
        assertThat(openWorkItems(org)).isEmpty();
        assertThat(workItems.findById(workItemId)).get()
                .extracting(InquiryWorkItem::getPhase).isEqualTo(InquiryWorkItemPhase.COMPLETED);
    }

    @Test
    void answeredInquiryIsNeverDowngradedByALaterUnansweredReCollection() {
        fetchAndIngest(3040L, "본문", "C", "F");   // already answered → history, no work item
        assertThat(inquiries.findTop50ByOrgIdOrderByReceivedAtDesc(org).get(0).getStatus())
                .isEqualTo("ANSWERED");

        fetchAndIngest(3040L, "본문", "N", "F");   // stale re-collection claims unanswered

        // Monotonic: status is never rolled back to UNANSWERED.
        assertThat(inquiries.findTop50ByOrgIdOrderByReceivedAtDesc(org).get(0).getStatus())
                .isEqualTo("ANSWERED");
        assertThat(openWorkItems(org)).isEmpty();
    }

    @Test
    void board6InquiryOpensOneOpenWorkItemBoundToTheConnection() {
        IngestOutcome outcome = fetchAndIngest(3003L, "곡면에도 붙나요", "N");

        assertThat(outcome.success()).isEqualTo(1);

        List<Inquiry> rows = inquiries.findTop50ByOrgIdOrderByReceivedAtDesc(org);
        assertThat(rows).hasSize(1);
        Inquiry q = rows.get(0);
        assertThat(q.getChannelId()).isEqualTo(channel);
        assertThat(q.getExternalId()).isEqualTo("cafe24:b6:a3003"); // native board+article identity
        assertThat(q.getTitle()).isEqualTo("제목");
        assertThat(q.getBody()).isEqualTo("곡면에도 붙나요");
        assertThat(q.getStatus()).isEqualTo("UNANSWERED"); // N → unanswered
        assertThat(q.getInformStatus()).isEqualTo("N"); // raw reply_status preserved
        assertThat(q.getAuthor()).isNull(); // no buyer PII persisted

        List<InquiryWorkItem> open = openWorkItems(org);
        assertThat(open).hasSize(1);
        InquiryWorkItem item = open.get(0);
        assertThat(item.getInquiryId()).isEqualTo(q.getId());
        assertThat(item.getSellerAccountId()).isEqualTo(account); // the exact connection
        assertThat(item.getChannelId()).isEqualTo(channel);
        assertThat(item.getPhase()).isEqualTo(InquiryWorkItemPhase.OPEN);

        // Board 6 leaves the community/VOC store entirely.
        assertThat(communityArticles.findAllByOrgId(org)).isEmpty();
    }

    @Test
    void reIngestingTheSameBoard6InquiryDedupesToOneWorkItem() {
        fetchAndIngest(3003L, "동일 본문", "N");
        IngestOutcome second = fetchAndIngest(3003L, "동일 본문", "N");

        // The native (board, article) external id dedupes the re-collected article.
        assertThat(second.success()).isZero();
        assertThat(second.skipped()).isEqualTo(1);
        assertThat(inquiries.findTop50ByOrgIdOrderByReceivedAtDesc(org)).hasSize(1);
        assertThat(openWorkItems(org)).hasSize(1);
    }

    @Test
    void theSameArticleUnderADifferentOrgIsIsolatedNotDeduped() {
        // Dedup is org+channel-scoped: a different tenant collecting an article with the
        // same native id gets its own inquiry and its own OPEN work item.
        UUID otherOrg = UUID.randomUUID();
        UUID otherAccount = UUID.randomUUID();
        CanonicalInquiry mine =
                Cafe24InquiryArticleMapper.toCanonicalInquiry(6, row(3003L, "본문", "N"), 1);
        CanonicalInquiry theirs =
                Cafe24InquiryArticleMapper.toCanonicalInquiry(6, row(3003L, "본문", "N"), 1);

        ingestion.ingestInquiries(org, channel, account, List.of(mine));
        ingestion.ingestInquiries(otherOrg, channel, otherAccount, List.of(theirs));

        assertThat(inquiries.findTop50ByOrgIdOrderByReceivedAtDesc(org)).hasSize(1);
        assertThat(inquiries.findTop50ByOrgIdOrderByReceivedAtDesc(otherOrg)).hasSize(1);

        List<InquiryWorkItem> mineOpen = openWorkItems(org);
        List<InquiryWorkItem> theirsOpen = openWorkItems(otherOrg);
        assertThat(mineOpen).hasSize(1);
        assertThat(theirsOpen).hasSize(1);
        assertThat(mineOpen.get(0).getSellerAccountId()).isEqualTo(account);
        assertThat(theirsOpen.get(0).getSellerAccountId()).isEqualTo(otherAccount);
    }

    @Test
    void answeredInquiryC_persistsAsAnsweredHistoryButOpensNoWorkItem() {
        // Cafe24 reply_status 'C' (처리완료): kept as Inquiry history, NOT a seller task.
        CanonicalInquiry answered =
                Cafe24InquiryArticleMapper.toCanonicalInquiry(6, row(283L, "이미 답변된 문의", "C"), 1);
        IngestOutcome out = ingestion.ingestInquiries(org, channel, account, List.of(answered));

        assertThat(out.success()).isEqualTo(1);
        List<Inquiry> rows = inquiries.findTop50ByOrgIdOrderByReceivedAtDesc(org);
        assertThat(rows).hasSize(1);
        assertThat(rows.get(0).getStatus()).isEqualTo("ANSWERED");
        assertThat(rows.get(0).getInformStatus()).isEqualTo("C"); // raw token preserved
        assertThat(openWorkItems(org)).isEmpty(); // no OPEN task for an already-answered inquiry
    }

    @Test
    void inProgressInquiryP_opensOneOpenWorkItemStillActionable() {
        // 'P' (처리중) is still actionable → UNANSWERED → opens a work item (channel-neutral,
        // mirroring ESM 처리중 → UNANSWERED).
        //
        // FAIL-CLOSED ON A CONTRACT THAT CONTRADICTS ITSELF (product-owner, 2026-08-26). The vendored
        // reference defines 'P' twice and differently: the property table says 처리중 (in progress),
        // while the LIST-filter table says 「P: Answer」 — and 'C', which the property table defines as
        // 처리완료, does not appear as a filter value at all. We follow the property table, because the
        // two possible mistakes are not symmetric: reading P as unanswered leaves a seller's answered
        // inquiry in the queue, which they can see and correct, while reading it as answered hides an
        // UNANSWERED customer question from the person who owes them a reply. Only deterministic
        // answer evidence — a proven shop comment, or a reply article — may move this row.
        CanonicalInquiry inProgress =
                Cafe24InquiryArticleMapper.toCanonicalInquiry(6, row(284L, "처리중 문의", "P"), 1);
        IngestOutcome out = ingestion.ingestInquiries(org, channel, account, List.of(inProgress));

        assertThat(out.success()).isEqualTo(1);
        assertThat(inquiries.findTop50ByOrgIdOrderByReceivedAtDesc(org).get(0).getStatus())
                .as("'P' alone never answers an inquiry")
                .isEqualTo("UNANSWERED");
        assertThat(openWorkItems(org)).hasSize(1);
    }

    @Test
    void aProposedWorkItemIsClosedWhenTheSourceItselfSaysTheCustomerWasAnswered() {
        // The stale state measured on 2026-08-26: the seller answered on Cafe24, the comment lane saw
        // it, and the work item stayed PROPOSED because a proactive draft had been attached. PROPOSED
        // holds an AI draft and nothing else — no approval, no intent, no execution — so external
        // source truth outranks a draft nobody agreed to send (product-owner).
        fetchAndIngestWithComment(3690L, "N", "buyer01");
        InquiryWorkItem item = openWorkItems(org).get(0);
        item.setPhase(InquiryWorkItemPhase.PROPOSED);
        workItems.save(item);

        fetchAndIngestWithComment(3690L, "N", "samplemall");

        assertThat(workItems.findById(item.getId()).orElseThrow().getPhase())
                .isEqualTo(InquiryWorkItemPhase.COMPLETED);
    }

    @Test
    void aWorkItemTheSellerHasCommittedTo_isNeverClosedByAnObservation() {
        // From APPROVED onward a person has committed to something, and ACTION_PENDING / EXECUTED are
        // mid-flight against the channel: closing those from an observation would race our own send
        // and could discard a verification that is about to arrive.
        for (InquiryWorkItemPhase phase : List.of(InquiryWorkItemPhase.APPROVED,
                InquiryWorkItemPhase.ACTION_PENDING, InquiryWorkItemPhase.EXECUTED)) {
            long articleNo = 3700L + phase.ordinal();
            fetchAndIngestWithComment(articleNo, "N", "buyer01");
            InquiryWorkItem item = openWorkItems(org).stream()
                    .filter(w -> w.getPhase() == InquiryWorkItemPhase.OPEN)
                    .reduce((a, b) -> b).orElseThrow();
            item.setPhase(phase);
            workItems.save(item);

            fetchAndIngestWithComment(articleNo, "N", "samplemall");

            assertThat(workItems.findById(item.getId()).orElseThrow().getPhase())
                    .as("%s belongs to the execution lifecycle, not to an observation", phase)
                    .isEqualTo(phase);
        }
    }

    @Test
    void blankReplyStatus_staysUnansweredAndOpensWorkItem() {
        // Blank/unknown stays conservative (UNANSWERED), so it opens a work item.
        CanonicalInquiry blank =
                Cafe24InquiryArticleMapper.toCanonicalInquiry(6, row(285L, "빈 상태 문의", null), 1);
        IngestOutcome out = ingestion.ingestInquiries(org, channel, account, List.of(blank));

        assertThat(out.success()).isEqualTo(1);
        assertThat(inquiries.findTop50ByOrgIdOrderByReceivedAtDesc(org).get(0).getStatus())
                .isEqualTo("UNANSWERED");
        assertThat(openWorkItems(org)).hasSize(1);
    }

    @Test
    void replyArticle_isStoredAsHistoryButOpensNoWorkItemAndLeavesCurrentTruth() {
        // The shape the live proof found: a247 hangs off a246, carries a body, and carries no
        // reply_status of its own. Before the parent pointer was projected this was stored as a
        // customer waiting for an answer — and the text it was waiting on was the shop's own.
        CanonicalInquiry root =
                Cafe24InquiryArticleMapper.toCanonicalInquiry(6, row(246L, "문의 본문", "C"), 1);
        CanonicalInquiry child = Cafe24InquiryArticleMapper.toCanonicalInquiry(
                6, replyRow(247L, 246L, "답변 본문"), 2);

        ingestion.ingestInquiries(org, channel, account, List.of(root, child));

        assertThat(inquiries.findByOrgIdAndChannelIdAndExternalId(org, channel, "cafe24:b6:a247"))
                .as("excluded is not deleted — the row is stored, with its relation")
                .isPresent()
                .get()
                .satisfies(stored -> {
                    assertThat(stored.getThreadRole()).isEqualTo("REPLY");
                    assertThat(stored.getThreadParentExternalId()).isEqualTo("cafe24:b6:a246");
                    assertThat(stored.getOperationalState())
                            .isEqualTo(InquiryOperationalState.EXCLUDED_THREAD_REPLY);
                });
        assertThat(openWorkItems(org))
                .as("neither row is a seller task: the parent is answered, the child is not a question")
                .isEmpty();
        assertThat(inquiries.findTop50ByOrgIdOrderByReceivedAtDesc(org))
                .as("current truth holds the question only")
                .extracting(Inquiry::getExternalId)
                .containsExactly("cafe24:b6:a246");
    }

    @Test
    void replyArticleAnswerBodyIsNeverPromotedOntoTheParent() {
        CanonicalInquiry root =
                Cafe24InquiryArticleMapper.toCanonicalInquiry(6, row(246L, "문의 본문", "C"), 1);
        CanonicalInquiry child = Cafe24InquiryArticleMapper.toCanonicalInquiry(
                6, replyRow(247L, 246L, "답변 본문"), 2);

        ingestion.ingestInquiries(org, channel, account, List.of(root, child));

        assertThat(inquiries.findByOrgIdAndChannelIdAndExternalId(org, channel, "cafe24:b6:a246"))
                .get()
                .satisfies(parent -> {
                    assertThat(parent.getAnswerBody())
                            .as("the child's text is an answer only if the SHOP wrote it, and that is unproven")
                            .isNull();
                    assertThat(parent.getAnsweredAt()).isNull();
                    assertThat(parent.getStatus())
                            .as("reply_status=C is what the source proved, and it is still honoured")
                            .isEqualTo("ANSWERED");
                });
    }

    @Test
    void aRowStoredBeforeTheProjectionExistedIsReclassifiedByAReRead() {
        // The historical backlog, in miniature: stored with no role, then re-read once the parent
        // pointer is projected. The upsert must NOTICE that — an unchanged body is not an unchanged row.
        Inquiry legacy = new Inquiry();
        legacy.setOrgId(org);
        legacy.setChannelId(channel);
        legacy.setSellerAccountId(account);
        legacy.setTitle("제목");
        legacy.setBody("답변 본문");
        legacy.setStatus("UNANSWERED");
        legacy.setReceivedAt(java.time.Instant.parse("2026-06-20T01:00:00Z"));
        legacy.setExternalId("cafe24:b6:a247");
        UUID legacyId = inquiries.save(legacy).getId();

        ingestion.ingestInquiries(org, channel, account, List.of(
                Cafe24InquiryArticleMapper.toCanonicalInquiry(6, replyRow(247L, 246L, "답변 본문"), 1)));

        assertThat(inquiries.findById(legacyId)).get().satisfies(after -> {
            assertThat(after.getThreadRole()).isEqualTo("REPLY");
            assertThat(after.getOperationalState())
                    .isEqualTo(InquiryOperationalState.EXCLUDED_THREAD_REPLY);
        });
    }

    @Test
    void aReplyToAReplyIsAlsoNotACustomerQuestion() {
        // The live re-read found one of these — a176 → a177 → a191, depth 2. Had the rule required a
        // reply's parent to be a root, this row would have come back into the queue as a question.
        CanonicalInquiry root =
                Cafe24InquiryArticleMapper.toCanonicalInquiry(6, row(176L, "문의 본문", "C"), 1);
        CanonicalInquiry child = Cafe24InquiryArticleMapper.toCanonicalInquiry(
                6, replyRow(177L, 176L, "답글 본문"), 2);
        CanonicalInquiry grandchild = Cafe24InquiryArticleMapper.toCanonicalInquiry(
                6, nestedReplyRow(191L, 177L, "답글의 답글 본문"), 3);

        ingestion.ingestInquiries(org, channel, account, List.of(root, child, grandchild));

        assertThat(inquiries.findByOrgIdAndChannelIdAndExternalId(org, channel, "cafe24:b6:a191"))
                .get()
                .satisfies(stored -> {
                    assertThat(stored.getThreadRole()).isEqualTo("REPLY");
                    assertThat(stored.getThreadParentExternalId())
                            .as("the parent is the reply it hangs off, not the root of the thread")
                            .isEqualTo("cafe24:b6:a177");
                    assertThat(stored.getOperationalState())
                            .isEqualTo(InquiryOperationalState.EXCLUDED_THREAD_REPLY);
                });
        assertThat(openWorkItems(org)).isEmpty();
        assertThat(inquiries.findTop50ByOrgIdOrderByReceivedAtDesc(org))
                .extracting(Inquiry::getExternalId)
                .containsExactly("cafe24:b6:a176");
    }

    private static Cafe24BoardArticleRow row(long articleNo, String content, String reply) {
        return new Cafe24BoardArticleRow(articleNo, "제목", content, 77L, null,
                "2026-06-20T10:00:00+09:00", null, reply);
    }

    /** A child article as the platform returns one: a parent pointer, depth 1, no reply_status. */
    private static Cafe24BoardArticleRow replyRow(long articleNo, long parentNo, String content) {
        return new Cafe24BoardArticleRow(articleNo, "제목", content, 77L, null,
                "2026-06-21T10:00:00+09:00", null, null, "F", null, parentNo, 1, 1);
    }

    /** A reply hanging off another reply — depth 2, the deepest the live re-read observed. */
    private static Cafe24BoardArticleRow nestedReplyRow(long articleNo, long parentNo, String content) {
        return new Cafe24BoardArticleRow(articleNo, "제목", content, 77L, null,
                "2026-06-22T10:00:00+09:00", null, null, "F", null, parentNo, 2, 1);
    }
}
