package com.sellerops.responsibility.aside;

import com.sellerops.auth.device.HelperDevice;
import com.sellerops.auth.device.HelperDeviceRepository;
import com.sellerops.responsibility.SourceCompleteness;
import com.sellerops.responsibility.SourceFailureReason;
import com.sellerops.responsibility.SourceObservation;
import com.sellerops.responsibility.IdentityVerdict;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * <b>One scheduled observation carried by an installed helper instead of by a channel's API.</b>
 *
 * <p>The shape deliberately mirrors {@code ResponsibilitySourceObserver}: hand out the work, wait a bounded
 * time, and return a {@link SourceObservation} that states its own completeness. What changes is who does the
 * reading — a browser on the seller's desk, driven by a published recipe, against a surface this repository
 * serves itself.
 *
 * <p><b>The rule this class exists to keep.</b> A helper that is asleep, offline, unlinked or simply never
 * answered has told us <em>nothing</em>, and nothing is not zero. Every such path returns {@link
 * SourceCompleteness#NONE} with a reason and no count — which the observation record enforces in its
 * constructor and the schema enforces again in SQL. «확인하지 못함» and «0건» stay different rows.
 *
 * <p><b>How «nothing changed» is known without keeping what was on the page.</b> The helper reports a digest of
 * the surface's own item refs — ids this repository published to itself. Same digest as the previous settled
 * observation ⇒ nothing new; different ⇒ the counts say by how much. No customer text, no page content and no
 * marketplace data is involved at any point, because the surface has none.
 *
 * <p><b>PILOT_ACCEPTED_LIMITATION — this wait blocks the run thread.</b> {@code aside.wait-seconds} (default 120)
 * is spent inside the run, exactly as {@code adopt-wait-seconds} is for a channel collection: the run holds its
 * lease, heartbeats, and does nothing else meanwhile. For the first pilot that is accepted rather than designed
 * away — one organisation, one device, one recipe, and a bound that is an order of magnitude under the lease.
 * It is written down because it is a real cost, not because it is hidden: a deployment running many
 * organisations would feel it, and the answer then is an asynchronous hand-off (the job row already survives a
 * restart and is claimable by id), NOT a longer wait. Do not rebuild that until a pilot measurement asks for it.
 */
@Component
public class AsideSourceObserver {

    private static final Logger log = LoggerFactory.getLogger(AsideSourceObserver.class);

    /** The data type a device-carried fixture observation records. Not a {@code DataType}: it is not a channel. */
    public static final String DATA_TYPE = "CUSTOMER_OPERATIONS_FIXTURE";

    private final ScheduledAsideJobService jobs;
    private final HelperDeviceRepository devices;
    private final Duration wait;
    private final Duration poll;
    private final Clock clock;
    private final boolean enabled;
    private final Set<UUID> enabledOrgs;

    @org.springframework.beans.factory.annotation.Autowired
    public AsideSourceObserver(ScheduledAsideJobService jobs, HelperDeviceRepository devices,
                               @Value("${sellerops.responsibility.aside.enabled:false}") boolean enabled,
                               @Value("${sellerops.responsibility.aside.enabled-org-ids:}") String orgIds,
                               @Value("${sellerops.responsibility.aside.wait-seconds:120}") long waitSeconds) {
        this(jobs, devices, Duration.ofSeconds(waitSeconds), Duration.ofSeconds(2), Clock.systemUTC(), enabled,
                parseOrgs(orgIds));
    }

    public AsideSourceObserver(ScheduledAsideJobService jobs, HelperDeviceRepository devices, Duration wait,
                               Duration poll, Clock clock) {
        this(jobs, devices, wait, poll, clock, true, Set.of());
    }

    public AsideSourceObserver(ScheduledAsideJobService jobs, HelperDeviceRepository devices, Duration wait,
                               Duration poll, Clock clock, boolean enabled, Set<UUID> enabledOrgs) {
        this.jobs = jobs;
        this.devices = devices;
        this.wait = wait;
        this.poll = poll;
        this.clock = clock;
        this.enabled = enabled;
        this.enabledOrgs = Set.copyOf(enabledOrgs);
    }

    /**
     * Whether an unattended device read is opened for this organisation at all.
     *
     * <p>Two gates, both required, and the second is an explicit list of organisation ids — the same posture the
     * runtime rollout takes. A build containing this code runs nothing on anyone's machine; a deployment that
     * turns the flag on still runs nothing until an organisation is named. Blank is nobody, and there is no
     * wildcard to widen it with.
     */
    public boolean enabledFor(UUID orgId) {
        return enabled && orgId != null && enabledOrgs.contains(orgId);
    }

    private static Set<UUID> parseOrgs(String raw) {
        if (raw == null || raw.isBlank()) {
            return Set.of();
        }
        Set<UUID> parsed = new java.util.LinkedHashSet<>();
        for (String token : raw.split(",")) {
            String trimmed = token.trim();
            if (trimmed.isEmpty()) {
                continue;
            }
            if ("*".equals(trimmed)) {
                // A wildcard would mean «every seller's computer», which is not a thing this switch may say.
                throw new IllegalStateException("sellerops.responsibility.aside.enabled-org-ids에 와일드카드는 쓸 수 없습니다.");
            }
            try {
                parsed.add(UUID.fromString(trimmed));
            } catch (IllegalArgumentException e) {
                // A typo must not silently become «nobody»: that reads as «off» and hides a misconfiguration.
                throw new IllegalStateException("sellerops.responsibility.aside.enabled-org-ids 값이 조직 id가 아닙니다.");
            }
        }
        return parsed;
    }

    /** What the previous settled observation of this surface came to — the baseline a diff is taken against. */
    public record Prior(String digest, Integer count) {
        public static final Prior NONE = new Prior(null, null);
    }

    /**
     * Hand the run's observation to this organisation's linked helper and wait for it, bounded.
     *
     * @param clientJobId a stable id for this run's work, so a retried attempt re-finds its job rather than
     *                    queueing a second one on someone's machine
     */
    public SourceObservation observe(UUID orgId, UUID runId, String clientJobId, AsideRecipe recipe, Prior prior) {
        Optional<HelperDevice> device = linkedDevice(orgId);
        if (device.isEmpty()) {
            // No installed helper is linked, or its grant is revoked/expired. Nothing was read, and saying so is
            // the whole point: an unattended lane with nobody home reports absence, never an empty surface.
            return none(recipe, SourceFailureReason.DEVICE_OFFLINE);
        }
        UUID deviceId = device.get().getId();
        ScheduledAsideJob job;
        try {
            job = jobs.enqueue(orgId, deviceId, runId, clientJobId, recipe);
        } catch (RuntimeException e) {
            log.info("aside source: 작업을 맡기지 못했습니다 org={} 사유={}", orgId, e.getClass().getSimpleName());
            return none(recipe, SourceFailureReason.EXECUTION_FAILED);
        }
        ScheduledAsideJob settled = await(job);
        if (settled == null) {
            return none(recipe, SourceFailureReason.DEVICE_OFFLINE);
        }
        return switch (settled.getStatus()) {
            case SETTLED -> fromOutcome(settled, prior);
            // Taken but never reported on: the helper picked it up and stopped. Bounded, and still not a zero.
            case CLAIMED -> none(recipe, SourceFailureReason.TIMEOUT);
            // Nobody took it before it expired, or it is still queued: the helper is not listening.
            default -> none(recipe, SourceFailureReason.DEVICE_OFFLINE);
        };
    }

    private SourceObservation fromOutcome(ScheduledAsideJob job, Prior prior) {
        AsideJobOutcome outcome = job.getOutcome();
        AsideRecipe recipe = job.getRecipe();
        if (outcome != AsideJobOutcome.OBSERVED) {
            return switch (outcome) {
                // The channel's sign-in wall. The seller signs in on their own browser; nothing here can.
                case AUTH_REQUIRED -> none(recipe, SourceFailureReason.AUTH_REQUIRED);
                // Read, and not provably this store: refused at delivery, nothing stored, and the row says so.
                case STORE_UNRESOLVED -> noneWithIdentity(recipe,
                        job.getIdentityVerdict() == IdentityVerdict.MISMATCH
                                ? SourceFailureReason.STORE_MISMATCH : SourceFailureReason.STORE_UNRESOLVED,
                        job.getIdentityVerdict() == null ? IdentityVerdict.UNRESOLVED : job.getIdentityVerdict());
                // It opened something and could not establish that it was ours. Not «nothing there».
                case SURFACE_UNREADABLE -> none(recipe, SourceFailureReason.EXECUTION_FAILED);
                case EXECUTOR_UNAVAILABLE -> none(recipe, SourceFailureReason.DEVICE_OFFLINE);
                // The helper's own screen refused the target. A configuration fact, not a channel failure.
                case REFUSED -> none(recipe, SourceFailureReason.CONFIGURATION_REQUIRED);
                default -> none(recipe, SourceFailureReason.EXECUTION_FAILED);
            };
        }
        int observed = job.getObservedCount() == null ? 0 : job.getObservedCount();
        String digest = job.getContentDigest();
        if (recipe != null && recipe.readsMarketplace()) {
            return fromMarketplaceDelivery(job, observed, prior, digest);
        }
        boolean unchanged = digest != null && digest.equals(prior.digest());
        int before = prior.count() == null ? 0 : prior.count();
        int newCount = unchanged ? 0 : Math.max(0, observed - before);
        int changedCount = unchanged ? 0 : Math.abs(observed - before);
        return new SourceObservation(SourceCompleteness.COMPLETE, observed, newCount, changedCount, null,
                IdentityVerdict.NOT_APPLICABLE, recipe.name(), job.getSettledAt(), null,
                prior.digest(), digest);
    }

    /**
     * <b>A marketplace read is counted by what ingest did, and bounded by what the screen showed.</b>
     *
     * <p>Two differences from the loopback recipe, both about telling the truth:
     *
     * <ul>
     *   <li><b>{@code BOUNDED}, never {@code COMPLETE}.</b> The read covers the screen's own period, not the store's
     *   whole history. A zero here is «nothing in the window», and the row cannot be read as more.</li>
     *   <li><b>new / changed are the spine's numbers.</b> New is the canonical rows this read inserted; changed is
     *   the stored reviews whose reply state it advanced. A digest difference would say «the page is different»,
     *   which is true every time a review ages out of the window and is not a new review.</li>
     * </ul>
     *
     * <p>An OBSERVED report with no recorded delivery means the helper claimed a reading the backend never
     * stored — that is a disagreement, and it is recorded as a failure with no counts rather than trusted.
     */
    private SourceObservation fromMarketplaceDelivery(ScheduledAsideJob job, int observed, Prior prior,
                                                      String digest) {
        if (job.getIdentityVerdict() != IdentityVerdict.MATCH || job.getInsertedCount() == null
                || job.getChangedCount() == null) {
            return none(job.getRecipe(), SourceFailureReason.EXECUTION_FAILED);
        }
        // The coverage the backend judged at delivery, when the recipe's page can fall short of its bound. A read that
        // could not rule out a gap behind its page is PARTIAL — its rows are stored, but it is not a settled baseline.
        SourceCompleteness coverage = job.getDeliveryCompleteness() == SourceCompleteness.PARTIAL
                ? SourceCompleteness.PARTIAL : SourceCompleteness.BOUNDED;
        return new SourceObservation(coverage, observed, job.getInsertedCount(),
                job.getChangedCount(), null, IdentityVerdict.MATCH, job.getRecipe().name(), job.getSettledAt(),
                null, prior.digest(), digest);
    }

    /** Poll the job row until it settles or the bound passes. Returns the last state seen, or null if none. */
    private ScheduledAsideJob await(ScheduledAsideJob queued) {
        Instant deadline = clock.instant().plus(wait);
        ScheduledAsideJob latest = queued;
        while (true) {
            latest = jobs.byId(queued.getId()).orElse(latest);
            if (latest.getStatus() == ScheduledAsideJobStatus.SETTLED) {
                return latest;
            }
            if (!clock.instant().isBefore(deadline)) {
                return latest;
            }
            try {
                Thread.sleep(poll.toMillis());
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return latest;
            }
        }
    }

    /** The organisation's live helper, if it has one. Revoked and expired links are not helpers. */
    private Optional<HelperDevice> linkedDevice(UUID orgId) {
        Instant now = clock.instant();
        return devices.findByOrgIdAndRevokedAtIsNullOrderByCreatedAtDesc(orgId).stream()
                .filter(d -> d.getExpiresAt() != null && d.getExpiresAt().isAfter(now))
                .findFirst();
    }

    /**
     * Nothing was read, and the row says which recipe it was that read nothing.
     *
     * <p>The recipe is passed rather than assumed. It used to name the single published value, which was true
     * while there was one; with a second recipe that constant would have labelled a failed marketplace read as a
     * fixture read — a row that is wrong about what was attempted, in exactly the situation an operator is trying
     * to diagnose. Counts stay null: «확인하지 못함» is never «0건».
     */
    private static SourceObservation none(AsideRecipe recipe, SourceFailureReason reason) {
        return noneWithIdentity(recipe, reason, IdentityVerdict.NOT_APPLICABLE);
    }

    /** As {@link #none}, for a read that reached a store and could not prove it — the verdict is part of the row. */
    private static SourceObservation noneWithIdentity(AsideRecipe recipe, SourceFailureReason reason,
                                                      IdentityVerdict verdict) {
        return new SourceObservation(SourceCompleteness.NONE, null, null, null, reason, verdict,
                recipe == null ? null : recipe.name(),
                null, null, null, null);
    }
}
