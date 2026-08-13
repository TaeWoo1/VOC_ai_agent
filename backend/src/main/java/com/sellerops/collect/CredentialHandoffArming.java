package com.sellerops.collect;

import com.sellerops.collect.dto.CredentialHandoffRunBinding;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Locale;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.regex.Pattern;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * **The backend half of the credential-handoff interlock: one armed run identity, used once.**
 *
 * <h2>Why this exists beside {@code CoupangLiveCallGuard}</h2>
 *
 * That guard asks one question — "is SOME approval id armed" — and it is the right question for the thing it
 * protects: a read-only marketplace GET. It is the wrong question for this path, which reads three secrets off
 * a seller's screen and writes them into the vault. A single non-blank string cannot say WHICH run was
 * approved, WHICH commit it was approved at, or that it has not already been used.
 *
 * <p>So the credential handoff is armed separately, with the whole identity the operator's grant was bound to,
 * and a live-call approval id can no longer stand in for it. That is the point of the separation: the old knob
 * still opens the read-only gateway call and can no longer open this.
 *
 * <h2>What it enforces</h2>
 *
 * <ol>
 *   <li><b>Shape.</b> Every field must match the form the bootstrap mints. An arbitrary string cannot arm this,
 *       which is what makes "arm it by hand" a refusal rather than a shortcut.</li>
 *   <li><b>Phase.</b> Only {@link #PHASE_CREDENTIAL_HANDOFF}. The calibration bootstrap mints an
 *       identically-shaped approval id for a run that reads no value; without this check its grant would arm
 *       the run that reads three.</li>
 *   <li><b>Freshness.</b> An arming older than {@link #ARMING_TTL} is refused. The operator's grant is
 *       single-use and single-sitting; a backend left armed overnight is not what they agreed to.</li>
 *   <li><b>Identity match.</b> The caller must PRESENT the same quadruple. The agent knows it because the run
 *       env it sourced is the one the manifest was prepared from — so a second agent, a different run, or a
 *       rebuilt branch cannot use an arming it was not part of.</li>
 *   <li><b>One shot.</b> CLAIMED atomically immediately before the store. A run gets one handoff; a second is
 *       refused here, before the vault, in addition to the never-overwrite rule that already refuses a second
 *       credential on the same account after.</li>
 * </ol>
 *
 * <h2>What "consumed" is tied to, precisely</h2>
 *
 * The store, not the verification — and on the NEAR side of it, atomically. Once the credential is in the vault
 * the seller has a connection, and the read-only check that follows can fail for reasons that have nothing to do
 * with the credential. So a failed verification does NOT return the arming: retrying would mean reading three
 * secrets a second time to replace something already stored, and replacement is the renewal path's job, with
 * its own atomicity and its own rollback.
 *
 * <p>A store that THREW is the one exception, and barely one: nothing was stored, so nothing was spent (see
 * {@link #releaseUnusedClaim}). That keeps the manifest's promise — a refusal before the store leaves the
 * handoff retryable — true in the case where the refusal comes from inside the store itself.
 *
 * <p>A refusal BEFORE the store consumes nothing, because nothing happened: an unknown slot, a channel
 * mismatch, an existing credential, or a failed identity check all leave the arming intact for the retry the
 * operator can legitimately make.
 *
 * <p>Process-lifetime by construction — the state is in memory, so a restarted backend is an unarmed backend.
 * That matches the manifest, which says a restart REVOKES the approval.
 */
@Component
public class CredentialHandoffArming {

    /** The one phase this arming may carry. A calibration grant is a grant for a run that reads no value. */
    public static final String PHASE_CREDENTIAL_HANDOFF = "COUPANG_WING_CREDENTIAL_HANDOFF";

    /**
     * How long an arming stays usable. One seated sitting — the same hour the preflight's own identity TTL
     * allows, so the two cannot disagree about whether the operator is still at the desk.
     */
    public static final Duration ARMING_TTL = Duration.ofHours(1);

    private static final Pattern APPROVAL_ID = Pattern.compile("^apr-[0-9a-f]{12}$");
    private static final Pattern RUN_ID = Pattern.compile("^wt-[0-9a-f]{12}$");
    private static final Pattern GIT_COMMIT = Pattern.compile("^[0-9a-f]{7,40}$");

    /** Safe reason codes. They travel to the agent and into the record; none is derived from a secret. */
    public static final String REASON_NOT_ARMED = "HANDOFF_NOT_ARMED";
    public static final String REASON_ARMING_MALFORMED = "HANDOFF_ARMING_MALFORMED";
    public static final String REASON_ARMING_WRONG_PHASE = "HANDOFF_ARMING_WRONG_PHASE";
    public static final String REASON_ARMING_EXPIRED = "HANDOFF_ARMING_EXPIRED";
    public static final String REASON_ARMING_CONSUMED = "HANDOFF_ARMING_CONSUMED";
    public static final String REASON_BINDING_ABSENT = "HANDOFF_RUN_BINDING_ABSENT";
    public static final String REASON_BINDING_MISMATCH = "HANDOFF_RUN_BINDING_MISMATCH";

    private final String approvalId;
    private final String runId;
    private final String gitCommit;
    private final String phase;
    private final long armedAtEpochSeconds;
    private final Clock clock;
    private final AtomicBoolean consumed = new AtomicBoolean(false);

    /**
     * `@Autowired` is REQUIRED here, not decoration: this class has a second, package-private constructor for
     * the clock seam, and with two candidates and no annotation Spring looks for a default constructor, finds
     * none, and fails every context that reaches the handoff service. The whole backend suite caught it.
     */
    @Autowired
    public CredentialHandoffArming(
            @Value("${sellerops.credential-handoff.approval-id:}") String approvalId,
            @Value("${sellerops.credential-handoff.run-id:}") String runId,
            @Value("${sellerops.credential-handoff.git-commit:}") String gitCommit,
            @Value("${sellerops.credential-handoff.phase:}") String phase,
            @Value("${sellerops.credential-handoff.armed-at-epoch-seconds:0}") long armedAtEpochSeconds) {
        this(approvalId, runId, gitCommit, phase, armedAtEpochSeconds, Clock.systemUTC());
    }

    /** Test seam: an explicit clock, so freshness is a property this suite can actually exercise. */
    CredentialHandoffArming(String approvalId, String runId, String gitCommit, String phase,
                            long armedAtEpochSeconds, Clock clock) {
        this.approvalId = trimmed(approvalId);
        this.runId = trimmed(runId);
        this.gitCommit = lower(trimmed(gitCommit));
        this.phase = trimmed(phase);
        this.armedAtEpochSeconds = armedAtEpochSeconds;
        this.clock = clock;
    }

    private static String trimmed(String v) {
        return v == null ? "" : v.trim();
    }

    private static String lower(String v) {
        return v.toLowerCase(Locale.ROOT);
    }

    /** True only when EVERY field is present and well-formed — a partial arming arms nothing. */
    private boolean shapeOk() {
        return APPROVAL_ID.matcher(approvalId).matches()
                && RUN_ID.matcher(runId).matches()
                && GIT_COMMIT.matcher(gitCommit).matches()
                && !phase.isBlank();
    }

    private boolean anyFieldSet() {
        return !approvalId.isBlank() || !runId.isBlank() || !gitCommit.isBlank() || !phase.isBlank();
    }

    private boolean expired() {
        if (armedAtEpochSeconds <= 0) {
            return true;
        }
        Instant armedAt = Instant.ofEpochSecond(armedAtEpochSeconds);
        Instant now = clock.instant();
        // Also refuse an arming stamped in the FUTURE: a clock that disagrees by more than the window is not a
        // clock this may reason about, and skewing it forward would otherwise extend the window indefinitely.
        return now.isBefore(armedAt) || now.isAfter(armedAt.plus(ARMING_TTL));
    }

    /**
     * Why this handoff may not proceed, or {@code null} when it may. Evaluated in the order a reader would
     * ask the questions: is anything armed, is it well-formed, is it the right phase, is it still fresh, has
     * it been used, did the caller present an identity, and is it the same one.
     *
     * <p>Returns a reason rather than throwing so the caller decides the HTTP shape and the wording, and so a
     * test can name the exact refusal instead of matching a message.
     */
    public String refusalFor(CredentialHandoffRunBinding presented) {
        if (!anyFieldSet()) {
            return REASON_NOT_ARMED;
        }
        if (!shapeOk()) {
            return REASON_ARMING_MALFORMED;
        }
        if (!PHASE_CREDENTIAL_HANDOFF.equals(phase)) {
            return REASON_ARMING_WRONG_PHASE;
        }
        if (expired()) {
            return REASON_ARMING_EXPIRED;
        }
        if (consumed.get()) {
            return REASON_ARMING_CONSUMED;
        }
        if (presented == null || presented.isBlank()) {
            return REASON_BINDING_ABSENT;
        }
        if (!approvalId.equals(trimmed(presented.approvalId()))
                || !runId.equals(trimmed(presented.runId()))
                || !gitCommit.equals(lower(trimmed(presented.gitCommit())))
                || !phase.equals(trimmed(presented.phase()))) {
            return REASON_BINDING_MISMATCH;
        }
        return null;
    }

    /**
     * **Claim the arming, atomically.** Called immediately BEFORE the store it authorizes, never after.
     *
     * The ordering is the whole point, and it was wrong at first: {@link #refusalFor} only READS the consumed
     * flag, so consuming after the store left a window in which two concurrent requests both passed the check
     * and both stored. The database's unique constraint on `seller_account_id` closes that for ONE account and
     * does nothing for two — two slots, one arming, two credentials, and the manifest says a run gets one.
     *
     * Returns whether THIS call was the one that claimed it. A caller that ignores the result has put back the
     * race it was given this method to avoid.
     */
    public boolean claim() {
        return consumed.compareAndSet(false, true);
    }

    /**
     * Hand a CLAIMED arming back, for the one case that justifies it: the store it was claimed for threw, so
     * nothing was stored and the operator's one handoff was never actually spent.
     *
     * Deliberately narrow, and package-private. It is not "undo", and it must never become reachable from a
     * path where a credential might have been written — the manifest promises that a refusal before the store
     * leaves the handoff retryable AND that once stored it is spent, and both halves are load-bearing.
     */
    void releaseUnusedClaim() {
        consumed.set(false);
    }

    /** Whether an arming is currently usable — shape, phase, freshness and one-shot, but no caller identity. */
    public boolean isArmed() {
        return anyFieldSet() && shapeOk() && PHASE_CREDENTIAL_HANDOFF.equals(phase) && !expired() && !consumed.get();
    }

    /**
     * The sanitized readiness the preflight matches against the manifest it is about to display. Prefixes only:
     * enough to bind a run, and the ids are environment tokens rather than secrets either way.
     */
    public Readiness readiness() {
        boolean armed = isArmed();
        return new Readiness(
                armed,
                consumed.get(),
                armed ? prefix(approvalId) : null,
                armed ? prefix(runId) : null,
                armed ? phase : null);
    }

    private static String prefix(String v) {
        return v.length() <= PREFIX_LENGTH ? v : v.substring(0, PREFIX_LENGTH);
    }

    /** Enough to bind this run to the manifest the operator is looking at, and no more. */
    public static final int PREFIX_LENGTH = 12;

    /**
     * Value-free arming readiness for {@code /api/connect/coupang/setup}.
     *
     * @param armed           whether a credential handoff would pass the interlock right now
     * @param consumed        whether this process has already spent its one handoff
     * @param approvalIdPrefix short prefix of the armed approval id, or null when unarmed
     * @param runIdPrefix      short prefix of the armed run id, or null when unarmed
     * @param phase            the armed phase, or null when unarmed
     */
    public record Readiness(boolean armed, boolean consumed, String approvalIdPrefix, String runIdPrefix,
                            String phase) {
    }
}
