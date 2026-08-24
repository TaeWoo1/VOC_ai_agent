package com.sellerops.inquiry.publish;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;

/**
 * Immutable approval binding: one per work item, bound to the exact draft version +
 * {@code approved_fingerprint} the seller confirmed. {@code command_id} is the
 * idempotency key of the confirm command.
 *
 * <p><b>The approval binds a target, not only a text.</b> The fingerprint answers "did the seller
 * read what will be sent"; the five target fields below answer "is this still the place they agreed
 * to send it". They are snapshotted inside the binding transaction and re-compared at dispatch
 * ({@code InquiryPublishService#revalidate}); a moved account, channel, external id, or source
 * subtype fails closed instead of spending the approval somewhere else. A row written before V66
 * carries nulls, which is read as "cannot prove the target is unchanged" — also closed.
 *
 * <p>{@code targetExternalId} is the marketplace's own handle for the inquiry, not a buyer
 * identifier; no buyer name, contact, or content ever lands on this row.
 */
@Getter
@Setter
@Entity
@Table(name = "inquiry_approval",
        uniqueConstraints = @UniqueConstraint(
                name = "uq_inquiry_approval_work_item", columnNames = "work_item_id"))
public class InquiryApproval {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    @Column(updatable = false, nullable = false)
    private UUID id;

    @Column(name = "org_id", nullable = false)
    private UUID orgId;

    @Column(name = "work_item_id", nullable = false)
    private UUID workItemId;

    @Column(name = "approved_draft_version", nullable = false)
    private int approvedDraftVersion;

    @Column(name = "approved_fingerprint", nullable = false, length = 64)
    private String approvedFingerprint;

    @Column(name = "command_id", nullable = false, length = 120)
    private String commandId;

    @Column(name = "approver", nullable = false, length = 120)
    private String approver;

    /** The seller account the approval was granted for. Null only on pre-V66 rows. */
    @Column(name = "seller_account_id")
    private UUID sellerAccountId;

    /** The channel the approval was granted for. Null only on pre-V66 rows. */
    @Column(name = "channel_id")
    private UUID channelId;

    /** The marketplace handle of the approved inquiry — the exact target. Null only on pre-V66 rows. */
    @Column(name = "target_external_id", length = 200)
    private String targetExternalId;

    /**
     * Which source resource the inquiry came from ({@link com.sellerops.inquiry.InquirySourceSubtype}),
     * or null when the channel has only one — a NAVER 상품 문의 and a NAVER 고객 문의 have different
     * identifier spaces and different answer endpoints, so an approval for one is not an approval for
     * the other. A null here is a legitimate value for a single-source channel, so it is compared as a
     * value (null must equal null), never treated as a wildcard.
     */
    @Column(name = "source_subtype", length = 32)
    private String sourceSubtype;

    /** The operation the seller approved (e.g. {@code POST_INQUIRY_REPLY}). Null only on pre-V66 rows. */
    @Column(name = "action_kind", length = 40)
    private String actionKind;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @PrePersist
    void onCreate() {
        if (createdAt == null) {
            createdAt = Instant.now();
        }
    }
}
