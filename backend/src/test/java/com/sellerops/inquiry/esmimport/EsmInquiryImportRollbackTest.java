package com.sellerops.inquiry.esmimport;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.credential.CredentialVault;
import com.sellerops.credential.DecryptedCredential;
import com.sellerops.ingest.parse.FileParser;
import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.inquiry.workitem.InquiryWorkItem;
import com.sellerops.inquiry.workitem.InquiryWorkItemAuditRepository;
import com.sellerops.inquiry.workitem.InquiryWorkItemPhase;
import com.sellerops.inquiry.workitem.InquiryWorkItemRepository;
import com.sellerops.inquiry.workitem.InquiryWorkItemWriter;
import com.sellerops.product.ProductRepository;
import com.sellerops.product.ProductService;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
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
 * Proves confirm is one file-level transaction: an unexpected persistence failure on an
 * accepted row rolls back the <b>entire</b> import — no partial batch, inquiry, provenance,
 * work item, status update, or audit — and leaves prior committed state untouched.
 *
 * <p>To observe a real (not first-level-cache) rollback, the test method runs
 * non-transactionally ({@link Propagation#NOT_SUPPORTED}) so the writer's own transaction
 * is the only one, on a dedicated in-memory DB. The mid-import failure is injected by a
 * provenance repository that throws on the second save.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
@Transactional(propagation = Propagation.NOT_SUPPORTED)
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class EsmInquiryImportRollbackTest {

    @DynamicPropertySource
    static void isolatedDatabase(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", () ->
                "jdbc:h2:mem:sellerops_esm_import_rollback;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1");
    }

    @Autowired InquiryRepository inquiries;
    @Autowired InquiryWorkItemRepository workItems;
    @Autowired InquiryWorkItemAuditRepository audits;
    @Autowired InquiryImportBatchRepository batches;
    @Autowired InquiryImportProvenanceRepository provenances;
    @Autowired SellerAccountRepository sellerAccounts;
    @Autowired ChannelRepository channels;
    @Autowired ProductRepository products;
    @Autowired PlatformTransactionManager txManager;

    private static final String SELLER = "SELLER123";
    private final Instant now = Instant.parse("2026-07-06T00:00:00Z");

    @Test
    void anAcceptedRowFailureRollsBackTheWholeImportAndLeavesPriorStateIntact() {
        UUID org = UUID.randomUUID();
        Channel gmarket = new Channel();
        gmarket.setCode("GMARKET");
        gmarket.setNameKo("G마켓/옥션");
        gmarket.setStatus(ChannelStatus.AVAILABLE);
        gmarket.setSupportsInquiry(true);
        UUID channelId = channels.save(gmarket).getId();

        SellerAccount account = new SellerAccount();
        account.setOrgId(org);
        account.setChannelId(channelId);
        account.setConnectionStatus(ChannelStatus.CONNECTED);
        account.setFileUpload(false);
        UUID accountId = sellerAccounts.save(account).getId();

        CredentialVault vault = mock(CredentialVault.class);
        lenient().when(vault.hasCredential(org, accountId)).thenReturn(true);
        lenient().when(vault.open(org, accountId)).thenReturn(new DecryptedCredential(
                "esm", "JWT_HS256", Map.of("gmarket_seller_id", SELLER), null, null));

        InquiryWorkItemWriter wiWriter = new InquiryWorkItemWriter(inquiries, workItems, audits, txManager);
        EsmInquiryReconciler reconciler = new EsmInquiryReconciler(inquiries, workItems, audits, txManager);
        ProductService productService = new ProductService(products);
        PreviewTokenService tokens = new PreviewTokenService("rollback-test-secret-32-bytes-abcdefgh");

        // Commit a first import: an existing UNANSWERED inquiry + OPEN work item.
        EsmInquiryImportService normal = service(vault, tokens,
                new EsmInquiryImportWriter(batches, provenances, productService, wiWriter, reconciler, txManager));
        byte[] file1 = EsmInquiryWorkbooks.build(List.<String[]>of(
                EsmInquiryWorkbooks.unanswered(SELLER, "공통 문의", "2026-07-01 09:00:00")));
        confirm(normal, org, channelId, accountId, file1);

        UUID existingInquiryId = inquiries.findAll().get(0).getId();
        UUID existingWorkItemId = workItems.findAll().get(0).getId();
        assertThat(inquiries.count()).isEqualTo(1);
        assertThat(provenances.count()).isEqualTo(1);
        assertThat(batches.count()).isEqualTo(1);
        assertThat(workItems.count()).isEqualTo(1);
        long productsBefore = products.count();       // one product from the first import
        assertThat(productsBefore).isEqualTo(1);

        // A second import whose second new row's provenance save throws.
        AtomicInteger saves = new AtomicInteger();
        InquiryImportProvenanceRepository failing = mock(InquiryImportProvenanceRepository.class);
        when(failing.save(any())).thenAnswer(inv -> {
            if (saves.incrementAndGet() >= 2) {
                throw new RuntimeException("boom: provenance persistence failure");
            }
            return provenances.save(inv.getArgument(0));
        });
        EsmInquiryImportService failingService = service(vault, tokens,
                new EsmInquiryImportWriter(batches, failing, productService, wiWriter, reconciler, txManager));

        // Distinct product numbers so both new rows would create new products.
        String[] rowA = EsmInquiryWorkbooks.unanswered(SELLER, "새 질문 A", "2026-07-02 09:00:00");
        rowA[EsmInquiryWorkbooks.PRODUCT_REF] = "9000000001";
        String[] rowB = EsmInquiryWorkbooks.unanswered(SELLER, "새 질문 B", "2026-07-02 10:00:00");
        rowB[EsmInquiryWorkbooks.PRODUCT_REF] = "9000000002";
        byte[] file2 = EsmInquiryWorkbooks.build(List.of(rowA, rowB,
                EsmInquiryWorkbooks.answered(SELLER, "공통 문의", "2026-07-01 09:00:00", "2026-07-01 11:00:00")));

        assertThatThrownBy(() -> confirm(failingService, org, channelId, accountId, file2))
                .isInstanceOf(RuntimeException.class);

        // Whole failed import rolled back: nothing beyond the first import survives —
        // including the products the failed import created.
        assertThat(inquiries.count()).isEqualTo(1);
        assertThat(provenances.count()).isEqualTo(1);
        assertThat(batches.count()).isEqualTo(1);
        assertThat(workItems.count()).isEqualTo(1);
        assertThat(products.count()).isEqualTo(productsBefore);            // zero new products
        assertThat(products.findByOrgIdAndSku(org, "9000000001")).isEmpty();
        assertThat(products.findByOrgIdAndSku(org, "9000000002")).isEmpty();
        assertThat(audits.findAll().stream()
                .anyMatch(a -> a.getImportBatchId() != null)).isFalse();   // no reconciliation audit

        // Prior committed state is unchanged.
        Inquiry existing = inquiries.findById(existingInquiryId).orElseThrow();
        assertThat(existing.getStatus()).isEqualTo("UNANSWERED");
        assertThat(workItems.findById(existingWorkItemId).orElseThrow().getPhase())
                .isEqualTo(InquiryWorkItemPhase.OPEN);
    }

    private EsmInquiryImportService service(CredentialVault vault, PreviewTokenService tokens,
                                            EsmInquiryImportWriter writer) {
        return new EsmInquiryImportService(new FileParser(), new EsmInquiryRowMapper(),
                inquiries, workItems, batches, sellerAccounts, channels, vault, tokens, writer);
    }

    private void confirm(EsmInquiryImportService service, UUID org, UUID channelId, UUID accountId, byte[] bytes) {
        String token = service.preview(org, channelId, accountId, EsmMarketplace.GMARKET,
                "문의 관리.xlsx", bytes, now).previewToken();
        service.confirm(org, UUID.randomUUID(), token, EsmInquiryImportService.CONFIRM_VALUE,
                "문의 관리.xlsx", bytes, now);
    }
}
