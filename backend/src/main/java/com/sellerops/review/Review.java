package com.sellerops.review;

import com.sellerops.common.BaseEntity;
import com.sellerops.common.DataOrigin;
import com.sellerops.common.RealDataOnly;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;
import org.hibernate.annotations.Filter;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
@Entity
@Table(name = "reviews")
@Filter(name = RealDataOnly.NAME, condition = RealDataOnly.CONDITION)
public class Review extends BaseEntity {
    /**
     * Whether this row is the seller's own data or something the product manufactured about itself.
     * Enforced at read time by the auto-enabled {@code realDataOnly} filter above, so an ordinary
     * query cannot pick up synthetic rows by forgetting to exclude them.
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "data_origin", nullable = false)
    private DataOrigin dataOrigin = DataOrigin.REAL;

    public DataOrigin getDataOrigin() {
        return dataOrigin;
    }

    public void setDataOrigin(DataOrigin dataOrigin) {
        this.dataOrigin = dataOrigin;
    }


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

    /**
     * The channel's own product identifier for this review (Coupang 노출상품ID), verbatim (V105).
     *
     * <p><b>It sits BESIDE {@link #productId}, never instead of it.</b> A review whose ref names a listing
     * this org holds carries both; one whose ref names nothing this org holds carries this and a null
     * product — and that is the point: the review is stored, readable and decidable, and the single thing
     * we cannot say is which catalogue product it belongs to. Two such reviews with different refs stay
     * two different unresolved products; nothing rounds them up into one shared bucket.
     *
     * <p>It is also the reconcile key. When a catalogue arrives later, {@code channel_products} joined on
     * {@code (channel_id, source_product_ref)} answers the question without re-reading the marketplace.
     */
    @Column(name = "source_product_ref")
    private String sourceProductRef;

    /**
     * The product name the channel printed beside this review (V105).
     *
     * <p>Kept because it is the only thing by which a seller can recognise an unresolved review. It is a
     * SOURCE fact and not a product: nothing resolves by it, nothing creates a product from it, and it is
     * never promoted into {@code products.name} — the channel's label and the seller's catalogue entry are
     * different objects, and matching them by name is exactly what merged two sellers' products before.
     */
    @Column(name = "source_product_name")
    private String sourceProductName;

    /**
     * Photos/videos on the review itself, never the product thumbnail beside it.
     *
     * <p><b>Read it with {@link #mediaCountObserved}.</b> This field alone cannot say whether a 0 is
     * an answer: until Media Semantics Closeout v1 it meant «none» and «nobody counted» at once, and
     * 4,800 of the 4,832 zeros in the database were the second one wearing the first one's clothes.
     */
    @Column(name = "media_count", nullable = false)
    private int mediaCount;

    /**
     * Whether {@link #mediaCount} is a reading rather than a default (V101).
     *
     * <p>{@code false} is UNKNOWN — nobody looked, or the reader that ran could not have seen media
     * if it were there. {@code true} with 0 is «we looked and there is none»; {@code true} with a
     * count is «we looked and here is how many». Only the middle case may ever be rendered as an
     * absence, which is the same rule {@code ChannelDataState} states for collection.
     *
     * <p><b>No product surface reads this yet, and that is the design.</b> The first reader is
     * whatever consumes media; until then the field exists so a measurement can tell a zero apart
     * from a silence — which is precisely what no measurement could do before it. It holds no URL,
     * no filename and no reference.
     */
    @Column(name = "media_count_observed", nullable = false)
    private boolean mediaCountObserved;

    /** When the channel says the reply was posted. Date-granular (the shared DateParse path
     *  quantises to UTC start-of-day) and diagnostic only — nothing gates on it. */
    @Column(name = "replied_at")
    private Instant repliedAt;

    /**
     * The {@code sync_jobs} row of the run that INSERTED this review — the acquisition provenance
     * {@code ExecutableIdentityResolver} reads (V83). Written at ingest time only, by the path that
     * opened the run; never backfilled and never rewritten by a duplicate. Null on rows predating the
     * column and on rows written by a path that records no run, and a null reads as {@code NONE}: a
     * review whose provenance cannot be proven is a review that cannot be sent to a channel.
     */
    @Column(name = "acquisition_sync_job_id")
    private UUID acquisitionSyncJobId;
}
