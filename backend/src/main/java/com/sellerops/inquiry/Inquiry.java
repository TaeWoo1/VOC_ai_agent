package com.sellerops.inquiry;

import com.sellerops.common.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
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
}
