package com.sellerops.responsibility.aside;

import com.sellerops.common.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;

/**
 * <b>One job an installed helper may run with nobody watching.</b>
 *
 * <p>The safety of an unattended browser job is decided by what the job is allowed to say, and this row can
 * say very little: which organisation, which device, which <em>published recipe</em>, and for how long. There
 * is no column for a URL, a prompt, a script or a credential — the recipe id is the entire instruction, and the
 * helper resolves it to a surface this repository owns. A job therefore cannot name a marketplace, because it
 * cannot name anything.
 *
 * <p>The org and device are never taken from the request. They come from the device token the auth filter has
 * already validated, so a helper can only ever claim work queued for itself.
 *
 * @see ScheduledAsideJobRepository for the single-use claim, which mirrors the run lease
 */
@Getter
@Setter
@Entity
@Table(name = "scheduled_aside_job")
public class ScheduledAsideJob extends BaseEntity {

    /** How long a queued job waits before it is no longer worth running. */
    public static final Duration TTL = Duration.ofMinutes(10);
    /** How long one claim holds. A helper that dies mid-job frees it by expiry, never by asking. */
    public static final Duration LEASE = Duration.ofMinutes(5);

    @Column(name = "org_id", nullable = false)
    private UUID orgId;

    @Column(name = "device_id", nullable = false)
    private UUID deviceId;

    /** The run whose observation this job serves, when it has one. */
    @Column(name = "run_id")
    private UUID runId;

    /** The caller's own id for this hand-out — makes a retried enqueue find its job instead of making a second. */
    @Column(name = "client_job_id", nullable = false, length = 64)
    private String clientJobId;

    @Enumerated(EnumType.STRING)
    @Column(name = "recipe", nullable = false, length = 64)
    private AsideRecipe recipe;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 16)
    private ScheduledAsideJobStatus status;

    @Column(name = "lease_until")
    private Instant leaseUntil;

    @Column(name = "expires_at", nullable = false)
    private Instant expiresAt;

    @Column(name = "claimed_at")
    private Instant claimedAt;

    @Column(name = "settled_at")
    private Instant settledAt;

    @Enumerated(EnumType.STRING)
    @Column(name = "outcome", length = 32)
    private AsideJobOutcome outcome;

    /** Items the owned surface printed. Null unless {@link AsideJobOutcome#OBSERVED} — see the schema check. */
    @Column(name = "observed_count")
    private Integer observedCount;

    /**
     * SHA-256 of the surface's own item refs, sorted. This is how a later run can say «nothing changed» or
     * «exactly this changed» without keeping what the page said: the refs are synthetic ids this repository
     * published to itself, and only their digest is stored.
     */
    @Column(name = "content_digest", length = 64)
    private String contentDigest;

    public static ScheduledAsideJob queued(UUID orgId, UUID deviceId, UUID runId, String clientJobId,
                                           AsideRecipe recipe, Instant now) {
        ScheduledAsideJob job = new ScheduledAsideJob();
        job.setOrgId(orgId);
        job.setDeviceId(deviceId);
        job.setRunId(runId);
        job.setClientJobId(clientJobId);
        job.setRecipe(recipe);
        job.setStatus(ScheduledAsideJobStatus.QUEUED);
        job.setExpiresAt(now.plus(TTL));
        return job;
    }

    /** Whether this job may still be handed out — asked of the row, so an expired one is never claimable. */
    public boolean claimableAt(Instant now) {
        return status == ScheduledAsideJobStatus.QUEUED && expiresAt.isAfter(now);
    }

    /**
     * Reviews a marketplace read INSERTED into canonical storage — counted by ingest, never reported by the helper.
     * Null for every loopback job and for any read whose store was not proved.
     */
    @Column(name = "inserted_count")
    private Integer insertedCount;

    /** Already-stored reviews whose reply state this read advanced. Counted by ingest; same nulls as above. */
    @Column(name = "changed_count")
    private Integer changedCount;

    /**
     * Whether the page this job read was proved to be this account's store — judged by the backend at delivery,
     * so the helper never holds the thing it is compared against. Null means delivery was never attempted.
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "identity_verdict", length = 16)
    private com.sellerops.responsibility.IdentityVerdict identityVerdict;

    /**
     * How far a proved delivery reached, when the recipe's read can fall short of its own bound (the inquiry page).
     * Judged by the backend at delivery. Null means «bounded by construction» for a recipe that never sets it.
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "delivery_completeness", length = 16)
    private com.sellerops.responsibility.SourceCompleteness deliveryCompleteness;

    /** A read whose store could not be proved: the verdict is kept, and no delivery count may exist beside it. */
    public void refuseDelivery(com.sellerops.responsibility.IdentityVerdict verdict) {
        this.identityVerdict = verdict;
        this.insertedCount = null;
        this.changedCount = null;
        this.deliveryCompleteness = null;
    }

    /** A proved read reached canonical storage. The counts are the spine's, written once. */
    public void recordDelivery(int inserted, int changed) {
        this.identityVerdict = com.sellerops.responsibility.IdentityVerdict.MATCH;
        this.insertedCount = inserted;
        this.changedCount = changed;
    }

    /** A proved delivery whose coverage the backend judged: {@code BOUNDED} or {@code PARTIAL}, nothing else. */
    public void recordDelivery(int inserted, int changed, com.sellerops.responsibility.SourceCompleteness coverage) {
        if (coverage != com.sellerops.responsibility.SourceCompleteness.BOUNDED
                && coverage != com.sellerops.responsibility.SourceCompleteness.PARTIAL) {
            throw new IllegalArgumentException("a marketplace delivery is BOUNDED or PARTIAL");
        }
        recordDelivery(inserted, changed);
        this.deliveryCompleteness = coverage;
    }

    /** A settled job states its outcome, and only an observation may carry a count or describe what it saw. */
    public void settle(AsideJobOutcome reported, Integer count, String digest, Instant now) {
        boolean observed = reported == AsideJobOutcome.OBSERVED;
        this.outcome = reported;
        this.observedCount = observed ? count : null;
        this.contentDigest = observed ? digest : null;
        this.status = ScheduledAsideJobStatus.SETTLED;
        this.settledAt = now;
        this.leaseUntil = null;
    }
}
