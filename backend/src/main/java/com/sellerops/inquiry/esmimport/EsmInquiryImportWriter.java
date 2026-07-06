package com.sellerops.inquiry.esmimport;

import com.sellerops.ingest.canonical.CanonicalInquiry;
import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.workitem.InquiryWorkItemWriter;
import com.sellerops.product.ProductService;
import java.util.UUID;
import java.util.function.Consumer;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Applies a fully-planned ESM import as <b>one file-level transaction</b>: the import
 * batch, every new inquiry, its OPEN work item + opened-audit, its provenance, every
 * status reconciliation (OPEN→COMPLETED + audit), and the final batch totals all commit
 * or roll back together. An unexpected persistence failure on any accepted row (e.g. a
 * unique conflict) rolls back the whole import — no partial batch, inquiry, provenance,
 * work item, status update, or audit can remain.
 *
 * <p>Everything — including product resolution/creation — runs inside a single
 * {@link TransactionTemplate}, so a rolled-back import also removes any product it
 * created. Product creation is a transaction-safe {@code ON CONFLICT DO NOTHING} upsert
 * ({@link ProductService#resolveOrCreateWithinTransaction}), so a concurrent creation of
 * the same product number never poisons the atomic unit. The nested {@code
 * TransactionTemplate}s inside {@link InquiryWorkItemWriter} and {@link
 * EsmInquiryReconciler} participate in this transaction (propagation REQUIRED), so the
 * guarantee holds across them.
 */
@Component
@ConditionalOnProperty(name = "sellerops.inquiry-import.esm.enabled", havingValue = "true")
public class EsmInquiryImportWriter {

    private final InquiryImportBatchRepository batches;
    private final InquiryImportProvenanceRepository provenances;
    private final ProductService productService;
    private final InquiryWorkItemWriter workItemWriter;
    private final EsmInquiryReconciler reconciler;
    private final TransactionTemplate tx;

    public EsmInquiryImportWriter(InquiryImportBatchRepository batches,
                                  InquiryImportProvenanceRepository provenances,
                                  ProductService productService, InquiryWorkItemWriter workItemWriter,
                                  EsmInquiryReconciler reconciler,
                                  PlatformTransactionManager transactionManager) {
        this.batches = batches;
        this.provenances = provenances;
        this.productService = productService;
        this.workItemWriter = workItemWriter;
        this.reconciler = reconciler;
        this.tx = new TransactionTemplate(transactionManager);
    }

    public record ApplyResult(UUID batchId, int inserted, int statusUpdated, int skipped, int rejected) {
    }

    public ApplyResult apply(EsmImportContext ctx, java.util.List<PlannedRow> rows) {
        int unchanged = (int) rows.stream().filter(r -> r.disp() == EsmRowDisposition.UNCHANGED_DUPLICATE).count();
        int invalid = (int) rows.stream().filter(r -> r.disp() == EsmRowDisposition.INVALID).count();

        ApplyResult result = tx.execute(status -> {
            InquiryImportBatch batch = batches.save(newBatch(ctx));
            UUID batchId = batch.getId();

            int inserted = 0;
            for (PlannedRow pr : rows) {
                if (!isNew(pr)) {
                    continue;
                }
                CanonicalInquiry c = pr.row().canonical();
                // Product identity is 상품번호 (SKU); resolved transaction-safely so a new
                // product rolls back with the import and a race never poisons the tx.
                UUID productId = productService
                        .resolveOrCreateWithinTransaction(ctx.orgId(), c.productName(), c.sku()).getId();
                Inquiry inquiry = buildInquiry(ctx, c, productId);
                EsmImportProvenanceData d = pr.row().provenance();
                Consumer<UUID> provenanceHook =
                        inquiryId -> provenances.save(toProvenance(ctx, inquiryId, batchId, d));
                if (pr.disp() == EsmRowDisposition.NEW_UNANSWERED) {
                    workItemWriter.openConnectorInquiry(inquiry, ctx.sellerAccountId(), provenanceHook);
                } else {
                    workItemWriter.saveHistoryInquiry(inquiry, provenanceHook);
                }
                inserted++;
            }

            int plannedUpdates = 0;
            int statusUpdated = 0;
            for (PlannedRow pr : rows) {
                if (pr.disp() == EsmRowDisposition.STATUS_UPDATE) {
                    plannedUpdates++;
                    if (reconciler.reconcileAnswered(pr.existingInquiryId(), batchId)) {
                        statusUpdated++;
                    }
                }
            }

            int skipped = unchanged + (plannedUpdates - statusUpdated);
            batch.setInserted(inserted);
            batch.setStatusUpdated(statusUpdated);
            batch.setSkipped(skipped);
            batch.setRejected(invalid);
            batch.setStatus(InquiryImportBatchStatus.COMPLETED);
            batches.save(batch);
            return new ApplyResult(batchId, inserted, statusUpdated, skipped, invalid);
        });
        return result;
    }

    private static boolean isNew(PlannedRow pr) {
        return pr.disp() == EsmRowDisposition.NEW_UNANSWERED || pr.disp() == EsmRowDisposition.NEW_ANSWERED;
    }

    private static Inquiry buildInquiry(EsmImportContext ctx, CanonicalInquiry c, UUID productId) {
        Inquiry inquiry = new Inquiry();
        inquiry.setOrgId(ctx.orgId());
        inquiry.setChannelId(ctx.channelId());
        inquiry.setSellerAccountId(ctx.sellerAccountId());
        inquiry.setProductId(productId);
        // Buyer PII is never carried into the inquiry.
        inquiry.setTitle(c.title());
        inquiry.setBody(c.body());
        inquiry.setStatus(c.status());
        inquiry.setInformStatus(c.informStatus());
        inquiry.setReceivedAt(c.receivedAt());
        inquiry.setExternalId(c.externalId());
        return inquiry;
    }

    private static InquiryImportProvenance toProvenance(EsmImportContext ctx, UUID inquiryId, UUID batchId,
                                                        EsmImportProvenanceData d) {
        InquiryImportProvenance e = new InquiryImportProvenance();
        e.setOrgId(ctx.orgId());
        e.setInquiryId(inquiryId);
        e.setImportBatchId(batchId);
        e.setSourceFilename(ctx.filename());
        e.setSourceRow(d.sourceRow());
        e.setMarketplace(ctx.marketplace());
        e.setRegistrationKind(d.registrationKind());
        e.setInquiryType(d.inquiryType());
        e.setOriginalProductRef(d.originalProductRef());
        e.setOriginalOrderRef(d.originalOrderRef());
        e.setOrderType(d.orderType());
        e.setReceivedAtRaw(d.receivedAtRaw());
        e.setProcessedAtRaw(d.processedAtRaw());
        e.setFingerprint(d.fingerprint());
        e.setFingerprintVersion(d.fingerprintVersion());
        return e;
    }

    private static InquiryImportBatch newBatch(EsmImportContext ctx) {
        InquiryImportBatch b = new InquiryImportBatch();
        b.setOrgId(ctx.orgId());
        b.setSellerAccountId(ctx.sellerAccountId());
        b.setChannelId(ctx.channelId());
        b.setMarketplace(ctx.marketplace());
        b.setSourceFilename(ctx.filename());
        b.setFileHash(ctx.fileHash());
        b.setHeaderSignature(ctx.headerSignature());
        b.setCanonicalPreviewHash(ctx.canonicalPreviewHash());
        b.setRowCount(ctx.rowCount());
        b.setUploadedBy(ctx.uploadedBy());
        b.setStatus(InquiryImportBatchStatus.COMPLETED);
        return b;
    }
}
