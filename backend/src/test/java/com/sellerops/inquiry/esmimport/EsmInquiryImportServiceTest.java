package com.sellerops.inquiry.esmimport;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.common.ApiException;
import com.sellerops.credential.CredentialVault;
import com.sellerops.credential.DecryptedCredential;
import com.sellerops.ingest.parse.FileParser;
import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.inquiry.esmimport.dto.EsmInquiryConfirmResponse;
import com.sellerops.inquiry.esmimport.dto.EsmInquiryPreviewResponse;
import com.sellerops.inquiry.workitem.InquiryWorkItem;
import com.sellerops.inquiry.workitem.InquiryWorkItemAudit;
import com.sellerops.inquiry.workitem.InquiryWorkItemAuditRepository;
import com.sellerops.inquiry.workitem.InquiryWorkItemEvent;
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
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.PlatformTransactionManager;

/**
 * End-to-end ESM import on H2: preview writes nothing; confirm applies the whole file in
 * one transaction (UNANSWERED → one OPEN work item, ANSWERED → history), reconciles
 * later-answered overlaps, writes provenance, replays idempotently, and fails closed on
 * any drift.
 */
@DataJpaTest
@ActiveProfiles("test")
class EsmInquiryImportServiceTest {

    @Autowired InquiryRepository inquiries;
    @Autowired ProductRepository products;
    @Autowired ChannelRepository channels;
    @Autowired InquiryWorkItemRepository workItems;
    @Autowired InquiryWorkItemAuditRepository audits;
    @Autowired SellerAccountRepository sellerAccounts;
    @Autowired InquiryImportBatchRepository batches;
    @Autowired InquiryImportProvenanceRepository provenances;
    @Autowired PlatformTransactionManager txManager;

    private EsmInquiryImportService service;
    private CredentialVault vault;

    private final UUID orgId = UUID.randomUUID();
    private UUID channelId;
    private UUID accountId;
    private final Instant now = Instant.parse("2026-07-06T00:00:00Z");

    private static final String SELLER = "SELLER123";

    @BeforeEach
    void setUp() {
        Channel gmarket = new Channel();
        gmarket.setCode("GMARKET");
        gmarket.setNameKo("G마켓/옥션");
        gmarket.setStatus(ChannelStatus.AVAILABLE);
        gmarket.setSupportsInquiry(true);
        channelId = channels.save(gmarket).getId();

        SellerAccount account = new SellerAccount();
        account.setOrgId(orgId);
        account.setChannelId(channelId);
        account.setConnectionStatus(ChannelStatus.CONNECTED);
        account.setFileUpload(false);
        accountId = sellerAccounts.save(account).getId();

        InquiryWorkItemWriter wiWriter = new InquiryWorkItemWriter(inquiries, workItems, audits, txManager);
        EsmInquiryReconciler reconciler =
                new EsmInquiryReconciler(inquiries, workItems, audits, txManager);
        EsmInquiryImportWriter importWriter = new EsmInquiryImportWriter(batches, provenances,
                new ProductService(products), wiWriter, reconciler, txManager);
        vault = mock(CredentialVault.class);
        lenient().when(vault.hasCredential(orgId, accountId)).thenReturn(true);
        lenient().when(vault.open(orgId, accountId)).thenReturn(new DecryptedCredential(
                "esm", "JWT_HS256", Map.of("gmarket_seller_id", SELLER), null, null));

        service = new EsmInquiryImportService(new FileParser(), new EsmInquiryRowMapper(),
                inquiries, workItems, batches, sellerAccounts, channels, vault,
                new PreviewTokenService("integration-test-secret-abcdefghij"), importWriter);
    }

    private byte[] oneUnanswered() {
        return EsmInquiryWorkbooks.build(List.<String[]>of(
                EsmInquiryWorkbooks.unanswered(SELLER, "배송 언제 오나요", "2026-07-01 09:00:00")));
    }

    private EsmInquiryPreviewResponse preview(byte[] bytes) {
        return service.preview(orgId, channelId, accountId, EsmMarketplace.GMARKET,
                "문의 관리.xlsx", bytes, now);
    }

    private EsmInquiryConfirmResponse confirm(byte[] bytes) {
        return service.confirm(orgId, UUID.randomUUID(), preview(bytes).previewToken(),
                EsmInquiryImportService.CONFIRM_VALUE, "문의 관리.xlsx", bytes, now);
    }

    private long reconcileAudits() {
        return audits.findAll().stream()
                .filter(a -> a.getEventType() == InquiryWorkItemEvent.VERIFICATION_RECORDED)
                .count();
    }

    // ---- preview ---------------------------------------------------------------

    @Test
    void previewWritesNothing() {
        EsmInquiryPreviewResponse resp = preview(oneUnanswered());
        assertThat(resp.newUnanswered()).isEqualTo(1);
        assertThat(resp.previewToken()).isNotBlank();
        assertThat(inquiries.count()).isZero();
        assertThat(batches.count()).isZero();
        assertThat(provenances.count()).isZero();
        assertThat(workItems.count()).isZero();
        assertThat(products.count()).isZero();          // preview performs no product writes
    }

    @Test
    void fileImportAccountStatusIsAcceptedByPreview() {
        // A truthful file-import account (FILE_UPLOAD_SUPPORTED, not CONNECTED) is selectable.
        SellerAccount acct = sellerAccounts.findByIdAndOrgId(accountId, orgId).orElseThrow();
        acct.setConnectionStatus(ChannelStatus.FILE_UPLOAD_SUPPORTED);
        acct.setFileUpload(true);
        sellerAccounts.save(acct);

        EsmInquiryPreviewResponse resp = preview(oneUnanswered());
        assertThat(resp.newUnanswered()).isEqualTo(1);
        assertThat(inquiries.count()).isZero();
    }

    @Test
    void marketplaceIsRequired() {
        assertThatThrownBy(() -> service.preview(orgId, channelId, accountId, null,
                "문의 관리.xlsx", oneUnanswered(), now)).isInstanceOf(ApiException.class);
    }

    @Test
    void sellingIdMismatchFailsClosed() {
        when(vault.open(orgId, accountId)).thenReturn(new DecryptedCredential(
                "esm", "JWT_HS256", Map.of("gmarket_seller_id", "OTHER"), null, null));
        assertThatThrownBy(() -> preview(oneUnanswered())).isInstanceOf(ApiException.class);
        assertThat(inquiries.count()).isZero();
    }

    @Test
    void mixedSellingIdsFailClosed() {
        byte[] mixed = EsmInquiryWorkbooks.build(List.of(
                EsmInquiryWorkbooks.unanswered(SELLER, "본문1", "2026-07-01 09:00:00"),
                EsmInquiryWorkbooks.unanswered("OTHER999", "본문2", "2026-07-01 10:00:00")));
        assertThatThrownBy(() -> preview(mixed)).isInstanceOf(ApiException.class);
    }

    @Test
    void blankSellingIdRejectsEntireFile() {
        byte[] blank = EsmInquiryWorkbooks.build(List.<String[]>of(
                EsmInquiryWorkbooks.unanswered("", "본문", "2026-07-01 09:00:00")));
        assertThatThrownBy(() -> preview(blank)).isInstanceOf(ApiException.class);
        assertThat(inquiries.count()).isZero();
    }

    @Test
    void missingAccountIdentityFailsClosed() {
        when(vault.hasCredential(orgId, accountId)).thenReturn(false);
        assertThatThrownBy(() -> preview(oneUnanswered())).isInstanceOf(ApiException.class);
    }

    // ---- confirm: inserts ------------------------------------------------------

    @Test
    void confirmInsertsUnansweredAndOpensOneOpenWorkItem() {
        EsmInquiryConfirmResponse resp = confirm(oneUnanswered());

        assertThat(resp.inserted()).isEqualTo(1);
        assertThat(resp.statusUpdated()).isZero();
        assertThat(resp.idempotentReplay()).isFalse();
        assertThat(inquiries.count()).isEqualTo(1);
        assertThat(provenances.count()).isEqualTo(1);
        assertThat(batches.count()).isEqualTo(1);

        Inquiry inquiry = inquiries.findAll().get(0);
        assertThat(inquiry.getStatus()).isEqualTo("UNANSWERED");
        assertThat(inquiry.getSellerAccountId()).isEqualTo(accountId);
        assertThat(inquiry.getAuthor()).isNull();                       // buyer id never persisted
        assertThat(inquiry.getBody()).doesNotContain("buyer");

        List<InquiryWorkItem> items = workItems.findAll();
        assertThat(items).hasSize(1);
        assertThat(items.get(0).getPhase()).isEqualTo(InquiryWorkItemPhase.OPEN);
    }

    @Test
    void confirmAnsweredCreatesHistoryButNoWorkItem() {
        byte[] bytes = EsmInquiryWorkbooks.build(List.<String[]>of(EsmInquiryWorkbooks.answered(
                SELLER, "환불 처리됐나요", "2026-07-01 09:00:00", "2026-07-01 11:00:00")));
        EsmInquiryConfirmResponse resp = confirm(bytes);

        assertThat(resp.inserted()).isEqualTo(1);
        assertThat(inquiries.findAll().get(0).getStatus()).isEqualTo("ANSWERED");
        assertThat(workItems.count()).isZero();
        assertThat(provenances.count()).isEqualTo(1);
    }

    @Test
    void importCreatesProductInsideTransactionAndPreviewCreatedNone() {
        preview(oneUnanswered());
        assertThat(products.count()).isZero();          // preview created no product
        confirm(oneUnanswered());
        assertThat(products.count()).isEqualTo(1);       // created by the confirm transaction
        assertThat(products.findByOrgIdAndSku(orgId, "1000000001")).isPresent();
    }

    @Test
    void sameProductNumberAcrossRowsAndImportsResolvesToOneProduct() {
        String[] a = EsmInquiryWorkbooks.unanswered(SELLER, "질문 A", "2026-07-01 09:00:00");
        a[EsmInquiryWorkbooks.PRODUCT_REF] = "5550001";
        String[] b = EsmInquiryWorkbooks.unanswered(SELLER, "질문 B", "2026-07-01 10:00:00");
        b[EsmInquiryWorkbooks.PRODUCT_REF] = "5550001";
        confirm(EsmInquiryWorkbooks.build(List.of(a, b)));
        assertThat(products.count()).isEqualTo(1);       // same 상품번호 across rows → one product

        String[] c = EsmInquiryWorkbooks.unanswered(SELLER, "질문 C", "2026-07-01 11:00:00");
        c[EsmInquiryWorkbooks.PRODUCT_REF] = "5550001";
        confirm(EsmInquiryWorkbooks.build(List.<String[]>of(c)));
        assertThat(products.count()).isEqualTo(1);       // reused across a later import too
        assertThat(inquiries.count()).isEqualTo(3);
    }

    @Test
    void productIdentityUsesProductNumberNotName() {
        // Same 상품명, different 상품번호 → two products (never merged by display name).
        String[] a = EsmInquiryWorkbooks.unanswered(SELLER, "질문 A", "2026-07-01 09:00:00");
        a[EsmInquiryWorkbooks.PRODUCT_NAME] = "같은 이름";
        a[EsmInquiryWorkbooks.PRODUCT_REF] = "0001";
        String[] b = EsmInquiryWorkbooks.unanswered(SELLER, "질문 B", "2026-07-01 10:00:00");
        b[EsmInquiryWorkbooks.PRODUCT_NAME] = "같은 이름";
        b[EsmInquiryWorkbooks.PRODUCT_REF] = "0002";

        confirm(EsmInquiryWorkbooks.build(List.of(a, b)));

        assertThat(products.count()).isEqualTo(2);
        assertThat(products.findByOrgIdAndSku(orgId, "0001")).isPresent();   // leading zero preserved
        assertThat(products.findByOrgIdAndSku(orgId, "0002")).isPresent();
    }

    // ---- confirm: reconciliation of later-answered overlap ---------------------

    private byte[] file1Unanswered() {
        return EsmInquiryWorkbooks.build(List.<String[]>of(
                EsmInquiryWorkbooks.unanswered(SELLER, "공통 문의", "2026-07-01 09:00:00")));
    }

    private byte[] file2AnsweredSameFingerprint() {
        return EsmInquiryWorkbooks.build(List.<String[]>of(EsmInquiryWorkbooks.answered(
                SELLER, "공통 문의", "2026-07-01 09:00:00", "2026-07-01 11:00:00")));
    }

    @Test
    void laterAnsweredOverlapCompletesOpenWorkItemWithOneBatchLinkedAudit() {
        confirm(file1Unanswered());
        UUID workItemId = workItems.findAll().get(0).getId();

        EsmInquiryPreviewResponse preview = preview(file2AnsweredSameFingerprint());
        assertThat(preview.statusUpdates()).isEqualTo(1);
        assertThat(preview.newUnanswered()).isZero();
        assertThat(preview.unchangedDuplicates()).isZero();

        EsmInquiryConfirmResponse resp = confirm(file2AnsweredSameFingerprint());
        assertThat(resp.statusUpdated()).isEqualTo(1);
        assertThat(resp.inserted()).isZero();

        assertThat(inquiries.findAll().get(0).getStatus()).isEqualTo("ANSWERED");
        assertThat(workItems.findById(workItemId).orElseThrow().getPhase())
                .isEqualTo(InquiryWorkItemPhase.COMPLETED);
        assertThat(inquiries.count()).isEqualTo(1);   // no new inquiry

        List<InquiryWorkItemAudit> reconAudits = audits.findByWorkItemIdOrderByCreatedAtAsc(workItemId)
                .stream().filter(a -> a.getEventType() == InquiryWorkItemEvent.VERIFICATION_RECORDED).toList();
        assertThat(reconAudits).hasSize(1);
        InquiryWorkItemAudit a = reconAudits.get(0);
        assertThat(a.getPhaseFrom()).isEqualTo(InquiryWorkItemPhase.OPEN);
        assertThat(a.getPhaseTo()).isEqualTo(InquiryWorkItemPhase.COMPLETED);
        assertThat(a.getActor()).isEqualTo("SYSTEM:ESM_FILE_IMPORT");
        assertThat(a.getImportBatchId()).isEqualTo(resp.batchId());
    }

    @Test
    void replayingAnsweredOverlapCreatesNoSecondAudit() {
        confirm(file1Unanswered());
        byte[] answered = file2AnsweredSameFingerprint();   // one file, re-uploaded byte-identically
        EsmInquiryConfirmResponse update = confirm(answered);
        assertThat(update.statusUpdated()).isEqualTo(1);
        assertThat(reconcileAudits()).isEqualTo(1);

        // Re-confirming the same answered file resolves to its batch — no second audit.
        EsmInquiryConfirmResponse replay = confirm(answered);
        assertThat(replay.idempotentReplay()).isTrue();
        assertThat(replay.batchId()).isEqualTo(update.batchId());
        assertThat(replay.statusUpdated()).isEqualTo(1);   // durable prior total
        assertThat(reconcileAudits()).isEqualTo(1);
    }

    @Test
    void answeredThenUnansweredNeverDowngradesOrReopens() {
        confirm(file2AnsweredSameFingerprint());   // inquiry ANSWERED, no work item
        assertThat(workItems.count()).isZero();

        EsmInquiryConfirmResponse resp = confirm(file1Unanswered());
        assertThat(resp.statusUpdated()).isZero();
        assertThat(resp.inserted()).isZero();
        assertThat(inquiries.findAll().get(0).getStatus()).isEqualTo("ANSWERED");   // no downgrade
        assertThat(workItems.count()).isZero();                                     // no reopen
    }

    @Test
    void dismissedWorkItemIsNeverReopenedByAnsweredImport() {
        confirm(file1Unanswered());
        InquiryWorkItem wi = workItems.findAll().get(0);
        wi.setPhase(InquiryWorkItemPhase.DISMISSED);     // simulate a prior spam dismissal
        workItems.save(wi);

        EsmInquiryPreviewResponse preview = preview(file2AnsweredSameFingerprint());
        assertThat(preview.statusUpdates()).isZero();
        assertThat(preview.unchangedDuplicates()).isEqualTo(1);

        confirm(file2AnsweredSameFingerprint());
        assertThat(workItems.findById(wi.getId()).orElseThrow().getPhase())
                .isEqualTo(InquiryWorkItemPhase.DISMISSED);
        assertThat(inquiries.findAll().get(0).getStatus()).isEqualTo("UNANSWERED");
        assertThat(reconcileAudits()).isZero();
    }

    // ---- confirm: idempotency & drift ------------------------------------------

    @Test
    void duplicateConfirmReturnsDurablePriorResultWithNoNewWrites() {
        byte[] bytes = oneUnanswered();                 // one file, re-uploaded byte-identically
        EsmInquiryConfirmResponse first = confirm(bytes);
        EsmInquiryConfirmResponse replay = confirm(bytes);   // re-preview + re-confirm

        assertThat(replay.idempotentReplay()).isTrue();
        assertThat(replay.batchId()).isEqualTo(first.batchId());       // same batch
        assertThat(replay.inserted()).isEqualTo(1);                    // durable prior total
        assertThat(replay.skipped()).isZero();
        // No new rows or audits of any kind.
        assertThat(inquiries.count()).isEqualTo(1);
        assertThat(provenances.count()).isEqualTo(1);
        assertThat(batches.count()).isEqualTo(1);
        assertThat(workItems.count()).isEqualTo(1);
    }

    @Test
    void overlappingFilesDoNotDuplicateSharedRows() {
        byte[] fileA = EsmInquiryWorkbooks.build(List.of(
                EsmInquiryWorkbooks.unanswered(SELLER, "질문 A", "2026-07-01 09:00:00"),
                EsmInquiryWorkbooks.unanswered(SELLER, "질문 공통", "2026-07-01 10:00:00")));
        byte[] fileB = EsmInquiryWorkbooks.build(List.of(
                EsmInquiryWorkbooks.unanswered(SELLER, "질문 공통", "2026-07-01 10:00:00"),
                EsmInquiryWorkbooks.unanswered(SELLER, "질문 B", "2026-07-01 11:00:00")));

        assertThat(confirm(fileA).inserted()).isEqualTo(2);
        EsmInquiryConfirmResponse b = confirm(fileB);
        assertThat(b.inserted()).isEqualTo(1);
        assertThat(b.skipped()).isEqualTo(1);
        assertThat(inquiries.count()).isEqualTo(3);
    }

    @Test
    void confirmWithChangedFileAbortsWithZeroWrites() {
        String token = preview(oneUnanswered()).previewToken();
        byte[] fileB = EsmInquiryWorkbooks.build(List.<String[]>of(
                EsmInquiryWorkbooks.unanswered(SELLER, "완전히 다른 질문", "2026-07-02 09:00:00")));

        assertThatThrownBy(() -> service.confirm(orgId, UUID.randomUUID(), token,
                EsmInquiryImportService.CONFIRM_VALUE, "문의 관리.xlsx", fileB, now))
                .isInstanceOf(ApiException.class);
        assertThat(inquiries.count()).isZero();
        assertThat(batches.count()).isZero();
    }

    @Test
    void dbStateChangeAfterPreviewInvalidatesConfirm() {
        confirm(file1Unanswered());
        InquiryWorkItem wi = workItems.findAll().get(0);

        // Preview the answered overlap against the OPEN state, then mutate the DB.
        String token = preview(file2AnsweredSameFingerprint()).previewToken();
        wi.setPhase(InquiryWorkItemPhase.COMPLETED);   // out-of-band change after preview
        workItems.save(wi);

        assertThatThrownBy(() -> service.confirm(orgId, UUID.randomUUID(), token,
                EsmInquiryImportService.CONFIRM_VALUE, "문의 관리.xlsx",
                file2AnsweredSameFingerprint(), now)).isInstanceOf(ApiException.class);
        assertThat(reconcileAudits()).isZero();
    }

    @Test
    void confirmRejectsWrongConfirmationValue() {
        byte[] bytes = oneUnanswered();
        String token = preview(bytes).previewToken();
        assertThatThrownBy(() -> service.confirm(orgId, UUID.randomUUID(), token, "WRONG",
                "문의 관리.xlsx", bytes, now)).isInstanceOf(ApiException.class);
        assertThat(inquiries.count()).isZero();
    }

    @Test
    void confirmRejectsTokenFromAnotherOrg() {
        byte[] bytes = oneUnanswered();
        String token = preview(bytes).previewToken();
        assertThatThrownBy(() -> service.confirm(UUID.randomUUID(), UUID.randomUUID(), token,
                EsmInquiryImportService.CONFIRM_VALUE, "문의 관리.xlsx", bytes, now))
                .isInstanceOf(ApiException.class);
    }
}
