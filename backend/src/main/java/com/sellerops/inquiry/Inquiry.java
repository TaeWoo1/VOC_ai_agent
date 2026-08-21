package com.sellerops.inquiry;

import com.sellerops.common.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
@Entity
@Table(name = "inquiries")
public class Inquiry extends BaseEntity {

    @Column(name = "org_id", nullable = false)
    private UUID orgId;

    @Column(name = "channel_id", nullable = false)
    private UUID channelId;

    /**
     * The exact seller connection ({@link com.sellerops.selleraccount.SellerAccount})
     * this inquiry arrived on, when known. Null on legacy / file-upload rows that
     * carry no connection identity; set by connector and ESM-import ingestion.
     */
    @Column(name = "seller_account_id")
    private UUID sellerAccountId;

    @Column(name = "product_id")
    private UUID productId;

    /**
     * Legacy buyer/writer column, kept nullable for compatibility. Buyer PII is no
     * longer persisted — {@link com.sellerops.ingest.IngestionService} never sets
     * it — so it stays {@code null} on all newly ingested rows.
     */
    private String author;

    /** Seller-visible inquiry subject (nullable; absent on legacy upload rows). */
    @Column(name = "title", columnDefinition = "text")
    private String title;

    @Column(nullable = false, columnDefinition = "text")
    private String body;

    /** UNANSWERED or ANSWERED. */
    @Column(nullable = false)
    private String status;

    /**
     * Raw source reply-status token verbatim (e.g. ESM+ {@code 미처리}/{@code
     * 처리완료}); nullable — the file-upload path carries none. Canonical status
     * lives in {@link #status}.
     */
    @Column(name = "inform_status")
    private String informStatus;

    @Column(name = "received_at", nullable = false)
    private Instant receivedAt;

    /** Source-provided id (when the upload carries one); first dedup key. */
    @Column(name = "external_id")
    private String externalId;

    /** Fallback dedup key when no external id: hash of channel+product+date+body. */
    @Column(name = "content_hash")
    private String contentHash;

    /**
     * Cafe24 board-6 비밀글(secret) flag, preserved for the exposure boundary. {@code true} =
     * private inquiry (kept in the work queue but excluded from dashboards / general VOC
     * analysis); {@code false} = public. {@code null} on legacy / non-Cafe24 (ESM, file-upload)
     * rows = not classified, treated as visible everywhere (existing behavior). Set fail-closed
     * by the Cafe24 connector: only a positively-public flag reads {@code false}.
     */
    @Column(name = "is_secret")
    private Boolean secret;

    /**
     * Whether this inquiry belongs to the seller's current operational truth.
     *
     * <p>A projection of the work item's dismissal disposition — see {@link InquiryOperationalState}
     * for why it is stored here and why {@link
     * com.sellerops.inquiry.lifecycle.InquiryOperationalStateProjector} is its only writer. Ingestion
     * never sets it: a re-collected spam post stays excluded, because the seller's decision is about
     * the inquiry and not about how many times the platform served it to us.
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "operational_state", nullable = false)
    private InquiryOperationalState operationalState = InquiryOperationalState.ACTIVE;

    /** When {@link #operationalState} last changed. Null while the row has never left ACTIVE. */
    @Column(name = "operational_state_at")
    private Instant operationalStateAt;

    /**
     * When the source last showed us this row — <b>including runs where nothing about it changed</b>.
     *
     * <p>That inclusion is the entire point. The upsert skips the save when the source matches what is
     * stored, so before this column an unchanged row and a deleted row were the same observation:
     * silence. No reconciliation can distinguish them without a record of having looked. Null on rows
     * ingested before the column existed — and null must never be read as "gone", only as "we have not
     * observed this row since we started recording that we do".
     */
    @Column(name = "last_seen_at")
    private Instant lastSeenAt;
}
