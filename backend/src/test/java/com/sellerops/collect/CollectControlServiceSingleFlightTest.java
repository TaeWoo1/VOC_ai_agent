package com.sellerops.collect;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.common.ApiException;
import com.sellerops.connector.ConnectorCapabilities;
import com.sellerops.connector.ConnectorRegistry;
import com.sellerops.connector.DataType;
import com.sellerops.connector.FetchPage;
import com.sellerops.connector.FetchRequest;
import com.sellerops.connector.MockApiConnector;
import com.sellerops.connector.PullConnector;
import com.sellerops.connector.naver.onboarding.NaverConnectionLifecycle;
import com.sellerops.credential.ConnectorCredentialRepository;
import com.sellerops.credential.CredentialVault;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.ingest.IngestionService;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.inquiry.workitem.InquiryWorkItemAuditRepository;
import com.sellerops.inquiry.workitem.InquiryWorkItemRepository;
import com.sellerops.inquiry.workitem.InquiryWorkItemWriter;
import com.sellerops.order.OrderDailySummaryRepository;
import com.sellerops.product.ProductRepository;
import com.sellerops.product.ProductService;
import com.sellerops.review.ReviewRepository;
import com.sellerops.selleraccount.AccountSessionSlotRepository;
import com.sellerops.selleraccount.AccountSessionSlotService;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import com.sellerops.sync.SyncCursorRepository;
import com.sellerops.sync.SyncJob;
import com.sellerops.sync.SyncJobRepository;
import com.sellerops.sync.SyncScheduleRepository;
import java.security.SecureRandom;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.http.HttpStatus;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.PlatformTransactionManager;

/**
 * The two caller-side single-flight guards in {@link CollectControlService}, over a real (H2) DB with
 * the {@link SyncRunGate} wired: {@code retry()} must NOT mutate a run it merely coalesced onto (that
 * job belongs to the executor thread running it), and {@code manualBackfill()} must fail closed rather
 * than silently drop the requested window when it coalesces onto an in-flight run.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class CollectControlServiceSingleFlightTest {

    @Autowired SellerAccountRepository sellerAccounts;
    @Autowired ChannelRepository channels;
    @Autowired ReviewRepository reviews;
    @Autowired InquiryRepository inquiries;
    @Autowired OrderDailySummaryRepository orders;
    @Autowired ProductRepository products;
    @Autowired com.sellerops.community.Cafe24CommunityArticleRepository communityArticles;
    @Autowired InquiryWorkItemRepository workItems;
    @Autowired InquiryWorkItemAuditRepository audits;
    @Autowired PlatformTransactionManager txManager;
    @Autowired com.sellerops.order.ChannelOrderRepository channelOrders;
    @Autowired com.sellerops.order.ChannelOrderStatusEventRepository channelOrderStatusEvents;
    @Autowired SyncJobRepository syncJobs;
    @Autowired SyncCursorRepository cursors;
    @Autowired com.sellerops.connector.ChannelConnectionStatusRepository connectionStatus;
    @Autowired SyncScheduleRepository schedules;
    @Autowired com.sellerops.connector.ConnectorCapabilityRepository capabilities;
    @Autowired AccountSessionSlotRepository accountSlotRepo;
    @Autowired ConnectorCredentialRepository credentials;

    private final UUID org = UUID.randomUUID();
    private CollectControlService service;

    @BeforeEach
    void setUp() {
        ConnectorRegistry registry = new ConnectorRegistry(List.of(new MockApiConnector(), new BackfillStubConnector()));
        IngestionService ingestion = new IngestionService(reviews, inquiries, orders,
                new ProductService(products), communityArticles, channels,
                new InquiryWorkItemWriter(inquiries, workItems, audits, txManager));
        com.sellerops.order.ChannelOrderIngestionService orderIngestion =
                new com.sellerops.order.ChannelOrderIngestionService(channelOrders, channelOrderStatusEvents, txManager);
        SyncRunGate gate = new SyncRunGate(sellerAccounts, syncJobs, txManager, 60);
        SyncRunExecutor executor = new SyncRunExecutor(sellerAccounts, channels, registry, ingestion,
                orderIngestion, syncJobs, cursors, connectionStatus, null, null, null, gate);
        byte[] key = new byte[32];
        new SecureRandom().nextBytes(key);
        CredentialVault vault = new CredentialVault(credentials, new ObjectMapper(),
                Base64.getEncoder().encodeToString(key), "local-test-1");
        service = new CollectControlService(sellerAccounts, channels, schedules, syncJobs,
                connectionStatus, capabilities, registry, executor, vault,
                new AccountSessionSlotService(accountSlotRepo),
                new NaverConnectionLifecycle(sellerAccounts, channels, txManager));
    }

    @Test
    void retryCoalescingOntoAnInFlightRunDoesNotMutateTheLiveJob() {
        UUID account = account("GMARKET");
        SyncJob failed = job(account, DataType.INQUIRY, "FAILED", 1, Instant.now().minusSeconds(600));
        SyncJob inFlight = job(account, DataType.INQUIRY, "RUNNING", 1, Instant.now());

        service.retry(org, failed.getId());

        // The in-flight run is untouched: attempt not bumped, status still RUNNING, no clobber.
        SyncJob live = syncJobs.findById(inFlight.getId()).orElseThrow();
        assertThat(live.getStatus()).isEqualTo("RUNNING");
        assertThat(live.getAttempt()).isEqualTo(1);
        // No third job was created (still exactly the FAILED + the RUNNING).
        assertThat(syncJobs.findAll().stream()
                .filter(j -> account.equals(j.getSellerAccountId()) && "INQUIRY".equals(j.getDataType()))
                .count()).isEqualTo(2);
    }

    @Test
    void backfillCoalescingOntoAnInFlightRunFailsClosedInsteadOfDroppingTheWindow() {
        UUID account = account("STUBCH");
        job(account, DataType.ORDER_SUMMARY, "RUNNING", 1, Instant.now());

        assertThatThrownBy(() -> service.manualBackfill(org, account, "ORDER_SUMMARY",
                LocalDate.of(2026, 1, 1), LocalDate.of(2026, 1, 2)))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("이미 수집이 진행 중")
                .satisfies(e -> assertThat(((ApiException) e).getStatus()).isEqualTo(HttpStatus.CONFLICT));

        // The in-flight run is the only ORDER_SUMMARY job; the rejected backfill created nothing.
        assertThat(syncJobs.findRunningBySellerAccountIdAndDataType(account, "ORDER_SUMMARY")).hasSize(1);
        assertThat(syncJobs.findAll().stream()
                .filter(j -> account.equals(j.getSellerAccountId()) && "ORDER_SUMMARY".equals(j.getDataType()))
                .count()).isEqualTo(1);
    }

    // --- helpers ---

    private SyncJob job(UUID account, DataType dataType, String status, int attempt, Instant startedAt) {
        SyncJob j = new SyncJob();
        j.setOrgId(org);
        j.setSellerAccountId(account);
        j.setDataType(dataType.name());
        j.setStatus(status);
        j.setAttempt(attempt);
        j.setTrigger("MANUAL");
        j.setJobType("TEST");
        j.setStartedAt(startedAt);
        return syncJobs.save(j);
    }

    private UUID account(String channelCode) {
        Channel ch = channels.findByCode(channelCode).orElseGet(() -> {
            Channel c = new Channel();
            c.setCode(channelCode);
            c.setNameKo(channelCode);
            c.setStatus(ChannelStatus.AVAILABLE);
            c.setSupportsInquiry(true);
            c.setSupportsReview(true);
            c.setSupportsOrder(true);
            c.setSupportsSales(true);
            c.setSupportsProduct(true);
            c.setSortOrder(0);
            return channels.save(c);
        });
        SellerAccount acc = new SellerAccount();
        acc.setOrgId(org);
        acc.setChannelId(ch.getId());
        acc.setConnectionStatus(ChannelStatus.CONNECTED);
        acc.setFileUpload(false);
        return sellerAccounts.save(acc).getId();
    }

    /** Minimal connector that serves ORDER_SUMMARY on channel STUBCH and supports a windowed backfill. */
    static final class BackfillStubConnector implements PullConnector {
        @Override public String kind() { return "BACKFILL_STUB"; }
        @Override public Set<String> dedicatedChannels() { return Set.of("STUBCH"); }
        @Override public ConnectorCapabilities capabilities(String channelCode) {
            return new ConnectorCapabilities("API", Set.of(DataType.ORDER_SUMMARY), Map.of(), "stub");
        }
        @Override public FetchPage fetch(FetchRequest request) {
            return FetchPage.of(request.dataType(), List.of(), "0", false, kind());
        }
        @Override public Optional<String> backfillCursor(DataType dataType, LocalDate startDate, LocalDate endDate) {
            return Optional.of("0");
        }
    }
}
