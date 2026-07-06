package com.sellerops.inquiry.esmimport;

import com.sellerops.common.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;

/**
 * One durable, audited ESM inquiry import. The unique key
 * {@code (org_id, seller_account_id, marketplace, file_hash)} makes a re-confirm of
 * the very same file idempotent: it resolves to the existing batch instead of
 * inserting a second one, and the domain dedup ensures no duplicate inquiries.
 */
@Getter
@Setter
@Entity
@Table(name = "inquiry_import_batch",
        uniqueConstraints = @UniqueConstraint(
                name = "uq_inquiry_import_batch_file",
                columnNames = {"org_id", "seller_account_id", "marketplace", "file_hash"}))
public class InquiryImportBatch extends BaseEntity {

    @Column(name = "org_id", nullable = false)
    private UUID orgId;

    @Column(name = "seller_account_id", nullable = false)
    private UUID sellerAccountId;

    @Column(name = "channel_id", nullable = false)
    private UUID channelId;

    @Enumerated(EnumType.STRING)
    @Column(name = "marketplace", nullable = false)
    private EsmMarketplace marketplace;

    @Column(name = "source_filename", columnDefinition = "text")
    private String sourceFilename;

    @Column(name = "file_hash", nullable = false)
    private String fileHash;

    @Column(name = "header_signature", nullable = false)
    private String headerSignature;

    /** The file-intrinsic canonical result hash — proves a replay is the same import contract. */
    @Column(name = "canonical_preview_hash", nullable = false)
    private String canonicalPreviewHash;

    @Column(name = "row_count", nullable = false)
    private int rowCount;

    @Column(name = "uploaded_by", nullable = false)
    private UUID uploadedBy;

    @Column(name = "inserted", nullable = false)
    private int inserted;

    @Column(name = "status_updated", nullable = false)
    private int statusUpdated;

    @Column(name = "skipped", nullable = false)
    private int skipped;

    @Column(name = "rejected", nullable = false)
    private int rejected;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false)
    private InquiryImportBatchStatus status;
}
