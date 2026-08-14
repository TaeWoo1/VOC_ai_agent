package com.sellerops.review;

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
     *  without invalidating existing hashes.
     *
     *  <p>Defaults to 1 (v1) at the object level, not just in the DB: the column is
     *  {@code not null default 1} (V8), but Hibernate always emits the field in the INSERT,
     *  so a null field value became an explicit {@code NULL} and violated the constraint —
     *  which is what broke the demo-content seeder. The object default keeps every write path
     *  (seeder + any future non-import insert) carrying a valid version. Import paths that key
     *  on a different formula still set it explicitly. */
    @Column(name = "dedup_key_version")
    private Integer dedupKeyVersion = 1;

    /** What the CHANNEL says about whether the seller already answered — never SellerOps' own
     *  record of a guided reply (that lives in {@code review_reply_outcome}). Set from an import
     *  only, and only ever forward: see {@link ReviewReplyState#isProgress}. */
    @Enumerated(EnumType.STRING)
    @Column(name = "reply_state", nullable = false)
    private ReviewReplyState replyState = ReviewReplyState.UNKNOWN;

    /** The purchased option the review is about (Coupang 옵션ID / vendorItemId). Catalog identity, never a
     *  buyer; null for sources with no option concept. Deliberately NOT part of {@code content_hash} — see
     *  {@code V37__review_source_option_and_media.sql}. */
    @Column(name = "source_option_id")
    private String sourceOptionId;

    /** Photos/videos on the review itself, never the product thumbnail beside it. 0 when unreported. */
    @Column(name = "media_count", nullable = false)
    private int mediaCount;

    /** When the channel says the reply was posted. Date-granular (the shared DateParse path
     *  quantises to UTC start-of-day) and diagnostic only — nothing gates on it. */
    @Column(name = "replied_at")
    private Instant repliedAt;
}
