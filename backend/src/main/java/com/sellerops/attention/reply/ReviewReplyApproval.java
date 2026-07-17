package com.sellerops.attention.reply;

import com.sellerops.common.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.Check;

/**
 * The CURRENT approval on one review's reply draft — updated in place as an operator approves
 * and withdraws; every transition is appended to {@link ReviewReplyApprovalAudit}, which is
 * never updated. Same split as {@code ReviewTriage} / {@code ReviewTriageAudit}: one row
 * answers "where does this stand", the trail answers "how did it get there".
 *
 * <p><b>Revocable, unlike {@code InquiryApproval}.</b> There, an approval is immutable and
 * single-use because a dispatch consumes it — it authorizes a send that then happens, and
 * unsaying it afterwards would misdescribe what was sent. Here nothing consumes it. An
 * immutable approval with no dispatch behind it would trap a typo forever: the operator could
 * not edit (the approval freezes the draft) and could not un-approve (immutable), for a reply
 * that never left the building. So this row is mutable and the audit carries the history.
 *
 * <p><b>The binding exists exactly when the approval stands.</b> {@link #approvedVersion} and
 * {@link #approvedFingerprint} are non-null iff {@link #state} is
 * {@link ReviewReplyApprovalState#APPROVED}, enforced by a check constraint in V19 rather than
 * by convention. A withdrawn row keeps no stale binding, because a stale binding is a value
 * that reads as live to any caller that forgets to check the state first — and handing out an
 * approved fingerprint for an approval that does not stand is the one mistake this table must
 * not make. The trail remembers what was approved; the current row carries only what is
 * currently true.
 *
 * <p><b>No {@code seller_account_id} and no {@code channel_id}</b> — see V19. The account is
 * an attribution {@code reviews} cannot support; the channel would be denormalized data with
 * no reader, since this store is only ever read one review at a time, org-scoped.
 */
@Getter
@Setter
@Entity
@Table(name = "review_reply_approval",
        uniqueConstraints = @UniqueConstraint(
                name = "uq_review_reply_approval_review",
                columnNames = {"review_id"}))
// Both mirror V19, and the mirroring is not tidiness: tests generate the schema from these
// annotations (`spring.flyway.enabled=false`, `ddl-auto=create-drop`), so a constraint that
// lives only in the migration is enforced in production and absent under test.
//
// The binding check is the one that matters. ReviewReplyApprovalWriter delegates the invariant
// to it in as many words — "the caller is responsible for not asking for the impossible" — while
// `applyApproval` takes state, version and fingerprint as three independent parameters with
// nothing coupling them. Without this annotation a future second caller passing
// (APPROVED, null, null) would pass every test, then in production throw
// DataIntegrityViolationException at the writer's commit — which ReviewReplyApprovalService
// catches as a RACE, hands to resolveRace, and rethrows as a 500. The violation would be
// misdiagnosed as concurrency rather than reported as the contract breach it is.
//
// The state check is dead by construction (the column is @Enumerated(STRING) over a two-value
// enum, so no violating write exists) and is mirrored anyway, so the entity and the migration
// can be diffed line for line rather than reasoned about.
@Check(name = "chk_review_reply_approval_state",
        constraints = "state in ('APPROVED', 'WITHDRAWN')")
@Check(name = "chk_review_reply_approval_binding",
        constraints = "(state = 'APPROVED' and approved_version is not null "
                + "and approved_fingerprint is not null and approved_version > 0) "
                + "or (state = 'WITHDRAWN' and approved_version is null "
                + "and approved_fingerprint is null)")
public class ReviewReplyApproval extends BaseEntity {

    @Column(name = "org_id", nullable = false)
    private UUID orgId;

    /** The review whose draft this approval is about; UNIQUE — one approval per review. */
    @Column(name = "review_id", nullable = false)
    private UUID reviewId;

    @Enumerated(EnumType.STRING)
    @Column(name = "state", nullable = false, length = 32)
    private ReviewReplyApprovalState state;

    /** The exact draft version approved; null iff {@link #state} is WITHDRAWN. */
    @Column(name = "approved_version")
    private Integer approvedVersion;

    /** The approved version's content fingerprint; null iff {@link #state} is WITHDRAWN. */
    @Column(name = "approved_fingerprint", length = 64)
    private String approvedFingerprint;

    /** Actor tag of whoever set the current state (e.g. {@code SELLER:<userId>}) — no PII. */
    @Column(name = "decided_by", nullable = false, length = 120)
    private String decidedBy;

    /**
     * When the CURRENT state was set — not when the row was last written.
     *
     * <p>Kept explicit rather than reusing {@code BaseEntity.updatedAt}, which is a
     * persistence mechanic: it moves on any write to this row, including one that has nothing
     * to do with the approval. The two agree today and would silently diverge later, so the
     * meaning is stated rather than inferred — same reason {@code ReviewTriage} carries
     * {@code decided_at}.
     */
    @Column(name = "decided_at", nullable = false)
    private Instant decidedAt;
}
