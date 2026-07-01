package com.sellerops.review;

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
@Table(name = "reviews")
public class Review extends BaseEntity {

    @Column(name = "org_id", nullable = false)
    private UUID orgId;

    @Column(name = "channel_id", nullable = false)
    private UUID channelId;

    @Column(name = "product_id")
    private UUID productId;

    private Integer rating;

    @Column(nullable = false, columnDefinition = "text")
    private String body;

    @Column(name = "is_negative", nullable = false)
    private boolean negative;

    @Column(name = "received_at", nullable = false)
    private Instant receivedAt;

    /** Source-provided id (when the upload carries one); first dedup key. */
    @Column(name = "external_id")
    private String externalId;

    /** Fallback dedup key when no external id: hash of channel+product+date+body. */
    @Column(name = "content_hash")
    private String contentHash;

    /** Which content_hash formula produced this row: v1 = channel+product+date+body;
     *  v2 (ESM+/GMARKET) also folds in rating. Lets the formula evolve per channel
     *  without invalidating existing hashes. Defaults to 1 in the DB. */
    @Column(name = "dedup_key_version")
    private Integer dedupKeyVersion;
}
