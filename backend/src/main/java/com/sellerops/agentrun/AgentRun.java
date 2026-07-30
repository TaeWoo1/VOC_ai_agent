package com.sellerops.agentrun;

import com.sellerops.common.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;

/**
 * Durable, sanitized state for one Agent Runtime run — the backend-owned checkpoint that lets the
 * stateless Agent Runtime HTTP service survive a restart and stay correct under concurrent resume.
 *
 * <p>Identity is {@code (org_id, thread_id)} (see the unique constraint): a run is only ever visible
 * or resumable within the org that created it, so a client-supplied thread id can neither collide nor
 * be read across orgs.
 *
 * <p><b>No raw customer text is stored here.</b> {@link #snapshot} is a JSON document holding only the
 * sanitized run snapshot the runtime sends (ids, phase, coarse priority/category, the step trail, and
 * the sanitized outcome or the quote-free issue brief). {@code AgentRunStoreService} additionally
 * rejects a snapshot that carries a raw-content key before it is ever persisted.
 *
 * <p>{@link #version} is an explicit optimistic-lock counter managed by hand (this codebase has no
 * JPA {@code @Version} precedent, and the claim/finalize transitions need version-guarded conditional
 * updates that a managed {@code @Version} would not express). It is never mutated through this setter
 * on the concurrency path — only through the repository's guarded updates.
 */
@Getter
@Setter
@Entity
@Table(
        name = "agent_runs",
        uniqueConstraints = @UniqueConstraint(name = "uq_agent_runs_org_thread", columnNames = {"org_id", "thread_id"}))
public class AgentRun extends BaseEntity {

    @Column(name = "org_id", nullable = false)
    private UUID orgId;

    @Column(name = "thread_id", nullable = false, length = 200)
    private String threadId;

    @Column(name = "domain", nullable = false, length = 16)
    private String domain;

    /** Lock state machine: AWAITING_APPROVAL → RESUMING (claimed) → DONE. */
    @Column(name = "status", nullable = false, length = 24)
    private String status;

    @Column(name = "snapshot", nullable = false, columnDefinition = "text")
    private String snapshot;

    @Column(name = "version", nullable = false)
    private long version;

    /** When the current RESUMING claim was taken; drives the crash-recovery lease. Null unless RESUMING. */
    @Column(name = "claimed_at")
    private java.time.Instant claimedAt;
}
