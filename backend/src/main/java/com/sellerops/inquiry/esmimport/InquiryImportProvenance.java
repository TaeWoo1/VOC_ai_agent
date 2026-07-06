package com.sellerops.inquiry.esmimport;

import com.sellerops.common.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;

/**
 * File-origin provenance for exactly one imported {@link com.sellerops.inquiry.Inquiry}
 * ({@code inquiry_id} is UNIQUE), linked to its {@link InquiryImportBatch}. Written
 * atomically with the inquiry at first import; a duplicate re-import creates neither
 * a new inquiry nor a new provenance row. Carries no content or PII — only structural
 * origin fields.
 */
@Getter
@Setter
@Entity
@Table(name = "inquiry_import_provenance")
public class InquiryImportProvenance extends BaseEntity {

    @Column(name = "org_id", nullable = false)
    private UUID orgId;

    @Column(name = "inquiry_id", nullable = false, unique = true)
    private UUID inquiryId;

    @Column(name = "import_batch_id", nullable = false)
    private UUID importBatchId;

    @Column(name = "source_filename", columnDefinition = "text")
    private String sourceFilename;

    @Column(name = "source_row", nullable = false)
    private int sourceRow;

    @Enumerated(EnumType.STRING)
    @Column(name = "marketplace", nullable = false)
    private EsmMarketplace marketplace;

    @Column(name = "registration_kind")
    private String registrationKind;

    @Column(name = "inquiry_type")
    private String inquiryType;

    @Column(name = "original_product_ref")
    private String originalProductRef;

    @Column(name = "original_order_ref")
    private String originalOrderRef;

    @Column(name = "order_type")
    private String orderType;

    @Column(name = "received_at_raw")
    private String receivedAtRaw;

    @Column(name = "processed_at_raw")
    private String processedAtRaw;

    @Column(name = "fingerprint", nullable = false)
    private String fingerprint;

    @Column(name = "fingerprint_version", nullable = false)
    private int fingerprintVersion;
}
