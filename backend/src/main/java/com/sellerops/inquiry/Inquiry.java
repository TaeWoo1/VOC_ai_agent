package com.sellerops.inquiry;

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
@Table(name = "inquiries")
@Filter(name = RealDataOnly.NAME, condition = RealDataOnly.CONDITION)
public class Inquiry extends BaseEntity {
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
     * Which resource of the channel produced this row — see {@link InquirySourceSubtype}.
     *
     * <p>Null on every row whose channel has exactly one inquiry resource, and on every row ingested
     * before the column existed. It is never inferred: a subtype is written by the mapper that made
     * the call, because that is the only place that knows which call it was.
     */
    @Column(name = "source_subtype", length = 32)
    private String sourceSubtype;

    /**
     * The channel's own product identifier, verbatim, as the source stated it.
     *
     * <p>Not a canonical product id and never used as one: {@code product_id} is the attribution and
     * this is the evidence for it. Keeping both separates two facts that used to collapse into one.
     * A row with a ref and no {@code product_id} says "the channel named a listing we do not hold" —
     * a catalogue gap, repairable by a catalogue read. A row with neither says "the channel named no
     * listing at all", which on a Cafe24 board-6 article is the ordinary case and nothing to repair.
     *
     * <p>Before it existed the two were indistinguishable, because the identifier was spent on
     * resolve-or-create and then discarded. Null on every row ingested before this column.
     */
    @Column(name = "source_product_ref", length = 64)
    private String sourceProductRef;

    /**
     * How {@link #productId} was decided — {@link InquiryProductBinding}, or null when nothing is
     * bound.
     *
     * <p>Kept as a string rather than an enum column so an unrecognized value from a future
     * migration reads as "not one of the ones I know" instead of blowing up a whole page of the
     * queue. Read through {@link #productBinding()}.
     */
    @Column(name = "product_binding", length = 16)
    private String productBinding;

    /** When the current binding was made. Null for bindings older than the column. */
    @Column(name = "product_bound_at")
    private Instant productBoundAt;

    /**
     * Who made the current binding, for a {@link InquiryProductBinding#USER_CONFIRMED} one.
     *
     * <p>Null for a source match — nobody made it — and the full history of who changed what lives in
     * {@code inquiry_product_binding_events} rather than here, because this column only ever holds
     * the latest answer.
     */
    @Column(name = "product_bound_by")
    private UUID productBoundBy;

    /**
     * The channel's own order identifier for this inquiry, verbatim, as the source stated it.
     *
     * <p><b>A reference, not a state.</b> Whether that order is paid, shipped or cancelled changes
     * without anyone editing this row, so it is not stored here — {@code InquiryOrderFactReader}
     * reads it from {@code channel_orders} at the moment it is needed. What is stored is the one
     * thing that does NOT change: which order the customer was asking about.
     *
     * <p>Null on every row whose source named no order, which today is every Cafe24 board-6 article
     * and every NAVER 상품 문의. Never derived from the inquiry body — see {@link InquiryOrderBinding}.
     */
    @Column(name = "source_order_ref", length = 120)
    private String sourceOrderRef;

    /**
     * The source's own structural role for this row — {@link com.sellerops.ingest.canonical.SourceThreadRole},
     * or null for a source that publishes no thread structure.
     *
     * <p>A string column for the same reason {@code product_binding} is one: an unrecognized value
     * from a future migration should read as "not one I know" rather than fail a page of the queue.
     * Read through {@link #threadRole()}.
     */
    @Column(name = "thread_role", length = 16)
    private String threadRole;

    /**
     * The parent's {@code external_id}, in this source's own identifier space — set only on a REPLY.
     *
     * <p>The relation lives here rather than in a table of its own because it is one value pointing
     * at a key this table already carries, exactly like {@link #sourceOrderRef}. A join table would
     * add a second place for the same fact to be wrong.
     */
    @Column(name = "thread_parent_external_id", length = 200)
    private String threadParentExternalId;

    /** The source-declared thread role, or null when absent or unrecognized. */
    public com.sellerops.ingest.canonical.SourceThreadRole threadRole() {
        if (threadRole == null) {
            return null;
        }
        try {
            return com.sellerops.ingest.canonical.SourceThreadRole.valueOf(threadRole);
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    /**
     * How {@link #sourceOrderRef} came to be here — {@link InquiryOrderBinding}, or null.
     *
     * <p>A string column for the same reason {@code product_binding} is one: an unrecognized value
     * from a future migration should read as "not one I know" rather than fail a page of the queue.
     * Read through {@link #orderBinding()}.
     */
    @Column(name = "order_binding", length = 16)
    private String orderBinding;

    /** The current order binding kind, or null when nothing is bound or the value is unrecognized. */
    public InquiryOrderBinding orderBinding() {
        if (orderBinding == null) {
            return null;
        }
        try {
            return InquiryOrderBinding.valueOf(orderBinding);
        } catch (IllegalArgumentException unknown) {
            return null;
        }
    }

    /** The current binding kind, or null when the stored value is absent or unrecognized. */
    public InquiryProductBinding productBinding() {
        if (productBinding == null) {
            return null;
        }
        try {
            return InquiryProductBinding.valueOf(productBinding);
        } catch (IllegalArgumentException unknown) {
            return null;
        }
    }

    /**
     * The answer the seller already published on the platform, when the source carries it.
     *
     * <p>Null for every source whose API returns only an answered flag, and for every row collected
     * before this column existed. It is the difference between "이 문의는 처리됐다" and "이 문의에
     * 무엇이라고 답했다": a reply draft written without the second one can propose an answer the seller
     * already gave. Never fabricated from the flag.
     */
    @Column(name = "answer_body", columnDefinition = "text")
    private String answerBody;

    /** When the source says that answer was registered. Null when the source states none. */
    @Column(name = "answered_at")
    private Instant answeredAt;

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
