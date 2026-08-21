package com.sellerops.collect;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.community.Cafe24CommunityArticleRepository;
import com.sellerops.connector.ChannelConnectionStatusRepository;
import com.sellerops.connector.ConnectorCapabilities;
import com.sellerops.connector.ConnectorRegistry;
import com.sellerops.connector.DataType;
import com.sellerops.connector.FetchPage;
import com.sellerops.connector.FetchRequest;
import com.sellerops.connector.PullConnector;
import com.sellerops.ingest.IngestionService;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.inquiry.workitem.InquiryWorkItemAuditRepository;
import com.sellerops.inquiry.workitem.InquiryWorkItemRepository;
import com.sellerops.inquiry.workitem.InquiryWorkItemWriter;
import com.sellerops.order.ChannelOrderIngestionService;
import com.sellerops.order.ChannelOrderRepository;
import com.sellerops.order.ChannelOrderStatusEventRepository;
import com.sellerops.order.OrderDailySummaryRepository;
import com.sellerops.product.ProductRepository;
import com.sellerops.product.ProductService;
import com.sellerops.review.ReviewRepository;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import com.sellerops.sync.SyncCursorRepository;
import com.sellerops.sync.SyncJob;
import com.sellerops.sync.SyncJobRepository;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.PlatformTransactionManager;

/**
 * A historical backfill must never redefine where routine collection starts.
 *
 * <p><b>The bug this pins is not hypothetical.</b> {@code sync_cursors} held one row per (account,
 * data type) and the backfill seed was written into it, so a one-off "collect 2025-03-23..25"
 * permanently became the definition of routine collection: every later scheduled run decoded that
 * window and swept a closed range in the past. The demo org's Cafe24 INQUIRY cursor was found parked
 * at {@code b6:o2:s2025-03-23:e2025-03-25} with an hourly schedule enabled — which is why 3,201
 * inquiries collected on 2026-07-06 were never re-observed once, and why not one reply-status change
 * on any of them could ever land, though the upsert that would have applied it shipped in V34.
 *
 * <p>The fix is two lanes in one table. What has to be true is continuity: a routine run after a
 * backfill resumes from where <em>routine</em> collection left off, never from inside the operator's
 * window — and the backfill keeps its own resumable place, so a multi-page sweep still works.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class SyncCursorLaneTest {

    @Autowired SellerAccountRepository sellerAccounts;
    @Autowired ChannelRepository channels;
    @Autowired ReviewRepository reviews;
    @Autowired InquiryRepository inquiries;
    @Autowired OrderDailySummaryRepository orders;
    @Autowired ProductRepository products;
    @Autowired Cafe24CommunityArticleRepository communityArticles;
    @Autowired InquiryWorkItemRepository workItems;
    @Autowired InquiryWorkItemAuditRepository audits;
    @Autowired SyncJobRepository syncJobs;
    @Autowired SyncCursorRepository cursors;
    @Autowired ChannelConnectionStatusRepository connectionStatus;
    @Autowired ChannelOrderRepository channelOrders;
    @Autowired ChannelOrderStatusEventRepository channelOrderStatusEvents;
    @Autowired PlatformTransactionManager txManager;

    private final UUID org = UUID.randomUUID();
    private RecordingConnector connector;
    private SyncRunExecutor executor;
    private UUID accountId;

    @BeforeEach
    void setUp() {
        connector = new RecordingConnector();
        IngestionService ingestion = new IngestionService(reviews, inquiries, orders,
                new ProductService(products), communityArticles, channels,
                new InquiryWorkItemWriter(inquiries, workItems, audits, txManager));
        executor = new SyncRunExecutor(sellerAccounts, channels, new ConnectorRegistry(List.of(connector)),
                ingestion, new ChannelOrderIngestionService(channelOrders, channelOrderStatusEvents, txManager),
                syncJobs, cursors, connectionStatus);

        Channel ch = new Channel();
        ch.setCode("CAFE24");
        ch.setNameKo("카페24");
        ch.setStatus(ChannelStatus.AVAILABLE);
        ch.setSupportsInquiry(true);
        ch.setSortOrder(0);
        UUID channelId = channels.save(ch).getId();

        SellerAccount acc = new SellerAccount();
        acc.setOrgId(org);
        acc.setChannelId(channelId);
        acc.setConnectionStatus(ChannelStatus.CONNECTED);
        acc.setFileUpload(false);
        accountId = sellerAccounts.save(acc).getId();
    }

    @Test
    @DisplayName("routine → backfill → routine: the routine lane resumes where routine left off")
    void backfillDoesNotRedefineRoutineCollection() {
        SyncJob first = executor.execute(org, accountId, DataType.INQUIRY, "MANUAL");
        assertThat(first.getStatus()).isEqualTo("SUCCESS");
        assertThat(routine()).isEqualTo("routine:1");

        // The operator backfills a closed window in the past.
        SyncJob backfillJob = executor.execute(org, accountId, DataType.INQUIRY, "MANUAL",
                BackfillWindow.of(LocalDate.parse("2025-03-23"), LocalDate.parse("2025-03-25")));
        assertThat(backfillJob.getStatus()).isEqualTo("SUCCESS");

        assertThat(backfill())
                .as("the backfill keeps its own resumable place, inside its own window")
                .isEqualTo("b6:o1:s2025-03-23:e2025-03-25");
        assertThat(routine())
                .as("THE INVARIANT: the historical run did not touch where routine collection starts")
                .isEqualTo("routine:1");

        // The next scheduled run.
        executor.execute(org, accountId, DataType.INQUIRY, "MANUAL");

        assertThat(connector.cursorsSeen)
                .as("the routine run resumed from routine progress, never from the operator's window")
                .containsExactly(null, "b6:o0:s2025-03-23:e2025-03-25", "routine:1");
        assertThat(routine()).isEqualTo("routine:2");
        assertThat(backfill())
                .as("and the routine run did not disturb the backfill lane either")
                .isEqualTo("b6:o1:s2025-03-23:e2025-03-25");
    }

    @Test
    @DisplayName("a backfill on a never-collected account still leaves the routine lane unwritten")
    void backfillFirstLeavesRoutineUnseeded() {
        executor.execute(org, accountId, DataType.INQUIRY, "MANUAL",
                BackfillWindow.of(LocalDate.parse("2025-03-23"), LocalDate.parse("2025-03-25")));

        assertThat(cursorValue(SyncRunExecutor.BACKFILL_CURSOR_KEY)).isPresent();
        assertThat(cursorValue(SyncRunExecutor.CURSOR_KEY))
                .as("routine collection has recorded no progress, and says so by being absent")
                .isEmpty();

        executor.execute(org, accountId, DataType.INQUIRY, "MANUAL");

        assertThat(connector.cursorsSeen.get(1))
                .as("the first routine run starts unbounded at the beginning, not inside the window")
                .isNull();
    }

    private String routine() {
        return cursorValue(SyncRunExecutor.CURSOR_KEY).orElseThrow();
    }

    private String backfill() {
        return cursorValue(SyncRunExecutor.BACKFILL_CURSOR_KEY).orElseThrow();
    }

    private Optional<String> cursorValue(String key) {
        return cursors.findByOrgIdAndSellerAccountIdAndDataTypeAndCursorKey(
                        org, accountId, DataType.INQUIRY.name(), key)
                .map(com.sellerops.sync.SyncCursor::getCursorValue);
    }

    /**
     * A connector that records the cursor it was handed and advances two independent counters — one
     * for the windowed shape, one for the plain one. It stores nothing: this test is about where the
     * place is kept, not about what lands.
     */
    private static final class RecordingConnector implements PullConnector {

        private final List<String> cursorsSeen = new ArrayList<>();
        private int routineSteps = 0;

        @Override
        public String kind() {
            return "LANE_FAKE";
        }

        @Override
        public Set<String> dedicatedChannels() {
            return Set.of("CAFE24");
        }

        @Override
        public ConnectorCapabilities capabilities(String channelCode) {
            return new ConnectorCapabilities("API", Set.of(DataType.INQUIRY),
                    Map.of(DataType.INQUIRY, "CONFIRMED"), "lane fake");
        }

        @Override
        public Optional<String> backfillCursor(DataType dataType, LocalDate startDate, LocalDate endDate) {
            return Optional.of("b6:o0:s" + startDate + ":e" + endDate);
        }

        @Override
        public FetchPage fetch(FetchRequest request) {
            cursorsSeen.add(request.cursorValue());
            String value = request.cursorValue();
            String next;
            if (value != null && value.startsWith("b6:o")) {
                // Windowed: advance the offset, keep the window — the Cafe24 article cursor's shape.
                int offset = Integer.parseInt(value.substring(4, value.indexOf(':', 4)));
                next = "b6:o" + (offset + 1) + value.substring(value.indexOf(':', 4));
            } else {
                next = "routine:" + (++routineSteps);
            }
            return FetchPage.of(DataType.INQUIRY, List.of(), next, false, kind());
        }
    }
}
