package com.sellerops.responsibility.aside;

import com.sellerops.common.ApiException;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * <b>Handing one bounded job to one installed helper, and reading back what it came to.</b>
 *
 * <p>Three moves — enqueue, claim, settle — and every one of them narrows rather than widens:
 *
 * <ul>
 *   <li><b>enqueue</b> is idempotent on {@code (device, clientJobId)}, so a retried hand-out re-finds its job
 *   instead of queueing a second one, and it refuses while that device already has live work.</li>
 *   <li><b>claim</b> is single-use: a conditional UPDATE moves the row out of QUEUED, so two helpers racing
 *   cannot both be told yes, and an expired job is not claimable at all.</li>
 *   <li><b>settle</b> accepts a closed outcome token and a count only when something was actually observed.</li>
 * </ul>
 *
 * <p>The organisation and device are arguments here because the caller derived them from a validated device
 * token, never from a request body. Every read is filtered by them, so a helper asking for work can only be
 * answered with work queued for itself.
 *
 * <p>Nothing in this class names a URL, a marketplace, a prompt or a credential — there is no such column and
 * no such parameter. What may run is the {@link AsideRecipe} allow-list, and the helper resolves that name to
 * its own loopback surface, refusing any other target locally.
 */
@Service
public class ScheduledAsideJobService {

    private static final Logger log = LoggerFactory.getLogger(ScheduledAsideJobService.class);

    private final ScheduledAsideJobRepository jobs;
    private final Clock clock;
    private final AsideMarketplaceAccess marketplaceAccess;
    private final AsideMarketplaceTarget marketplaceTargets;

    @org.springframework.beans.factory.annotation.Autowired
    public ScheduledAsideJobService(ScheduledAsideJobRepository jobs, AsideMarketplaceAccess marketplaceAccess,
                                    org.springframework.beans.factory.ObjectProvider<AsideMarketplaceTarget> targets) {
        this(jobs, Clock.systemUTC(), marketplaceAccess, AsideMarketplaceTarget.firstOf(targets.orderedStream().toList()));
    }

    public ScheduledAsideJobService(ScheduledAsideJobRepository jobs, Clock clock) {
        // A build with no marketplace lane at all: the gate refuses every marketplace recipe by construction and
        // there is nothing to resolve a store with. The loopback lane behaves exactly as it did before.
        this(jobs, clock, new AsideMarketplaceAccess(false, java.util.Set.of(), java.util.Set.of()), null);
    }

    public ScheduledAsideJobService(ScheduledAsideJobRepository jobs, Clock clock,
                                    AsideMarketplaceAccess marketplaceAccess, AsideMarketplaceTarget targets) {
        this.jobs = jobs;
        this.clock = clock;
        this.marketplaceAccess = marketplaceAccess;
        this.marketplaceTargets = targets;
    }

    /**
     * What a helper is told when it asks for work: the recipe name, and — only for a recipe that reads a
     * marketplace — which of this organisation's stores, as a slot and a digest. Null target for every loopback
     * recipe, which is the shape this record had when there was only one kind.
     */
    public record ClaimedJob(UUID jobId, AsideRecipe recipe, Instant leaseUntil, AsideMarketplaceTarget.Target target) {
    }

    /**
     * Queue one job for one device. Idempotent: the same {@code clientJobId} returns the job already queued,
     * which is what makes a retry safe without the caller having to know whether its first attempt landed.
     *
     * @throws ApiException when this device already has different live work — one helper is one desk, and a
     *                      queue of browser jobs for someone's machine is the thing this design refuses to be
     */
    @Transactional
    public ScheduledAsideJob enqueue(UUID orgId, UUID deviceId, UUID runId, String clientJobId, AsideRecipe recipe) {
        if (clientJobId == null || clientJobId.isBlank() || clientJobId.length() > 64) {
            throw ApiException.badRequest("작업 식별자가 필요합니다.");
        }
        if (recipe == null) {
            throw ApiException.badRequest("실행할 수 있는 작업이 아닙니다.");
        }
        // <b>The one choke point for «may a browser be pointed at a real store on this desk».</b> Every job in
        // this system is created here, so asking here means code that forgot to ask cannot queue one anyway —
        // the same reason the recipe allow-list is a schema CHECK and not a convention.
        if (!marketplaceAccess.allows(recipe, orgId)) {
            throw ApiException.conflict("이 계정에서는 채널 화면을 자동으로 확인하도록 설정되어 있지 않습니다.");
        }
        Instant now = clock.instant();
        jobs.expireStale(now);
        Optional<ScheduledAsideJob> existing = jobs.findByDeviceIdAndClientJobId(deviceId, clientJobId)
                .filter(j -> orgId.equals(j.getOrgId()));
        if (existing.isPresent()) {
            return existing.get();
        }
        if (hasLiveWork(deviceId, now)) {
            throw ApiException.conflict("이 컴퓨터에서 이미 확인 작업이 진행 중입니다.");
        }
        return jobs.save(ScheduledAsideJob.queued(orgId, deviceId, runId, clientJobId, recipe, now));
    }

    /**
     * Give this device its queued job, exactly once. Empty means «nothing for you» — which is also the honest
     * answer for a job that expired before anyone took it.
     */
    @Transactional
    public Optional<ClaimedJob> claim(UUID orgId, UUID deviceId) {
        Instant now = clock.instant();
        jobs.expireStale(now);
        for (ScheduledAsideJob candidate : jobs.claimableFor(deviceId, now)) {
            if (!orgId.equals(candidate.getOrgId())) {
                continue; // a device belongs to one organisation; this cannot happen, and if it did it is not ours
            }
            Instant leaseUntil = now.plus(ScheduledAsideJob.LEASE);
            if (jobs.claim(candidate.getId(), deviceId, now, leaseUntil) == 1) {
                log.info("aside job: claimed job={} recipe={}", candidate.getId(), candidate.getRecipe());
                return Optional.of(new ClaimedJob(candidate.getId(), candidate.getRecipe(), leaseUntil,
                        targetFor(orgId, candidate.getRecipe())));
            }
        }
        return Optional.empty();
    }

    /**
     * Record what the helper reported. Only a job this device holds under a live lease may be settled, and only
     * an {@link AsideJobOutcome#OBSERVED} may carry a count — every other outcome means no number exists, which
     * is the same rule the observation schema enforces one layer down.
     */
    @Transactional
    public ScheduledAsideJob settle(UUID orgId, UUID deviceId, UUID jobId, AsideJobOutcome outcome, Integer count,
                                    String digest) {
        if (outcome == null) {
            throw ApiException.badRequest("작업 결과가 필요합니다.");
        }
        if (digest != null && !digest.matches("[0-9a-f]{64}")) {
            // A digest is 64 hex characters or it is not a digest. Anything else is text from somewhere, and
            // text from a helper has no place on this row.
            throw ApiException.badRequest("작업 결과 형식이 올바르지 않습니다.");
        }
        Instant now = clock.instant();
        ScheduledAsideJob job = jobs.findByIdAndDeviceId(jobId, deviceId)
                .filter(j -> orgId.equals(j.getOrgId()))
                .orElseThrow(() -> ApiException.notFound("해당 작업을 찾을 수 없습니다."));
        if (job.getStatus() != ScheduledAsideJobStatus.CLAIMED) {
            // A job that was never claimed, already reported, or timed out is not one this report can describe.
            throw ApiException.conflict("이미 끝난 작업입니다.");
        }
        if (job.getLeaseUntil() != null && !job.getLeaseUntil().isAfter(now)) {
            throw ApiException.conflict("작업 시간이 지났습니다.");
        }
        int observed = count == null || count < 0 ? 0 : count;
        job.settle(outcome, outcome == AsideJobOutcome.OBSERVED ? observed : null, digest, now);
        log.info("aside job: settled job={} outcome={}", job.getId(), outcome);
        return jobs.save(job);
    }

    /** The jobs one run handed out — how the observation later learns what became of its device work. */
    public List<ScheduledAsideJob> forRun(UUID runId) {
        return jobs.findByRunIdOrderByCreatedAtAsc(runId);
    }

    /** The current state of one job, for a caller waiting on it. Read-only; no side effect on the row. */
    public Optional<ScheduledAsideJob> byId(UUID jobId) {
        return jobs.findById(jobId);
    }

    /**
     * Which store a claimed marketplace job reads — resolved at claim time, never stored on the row.
     *
     * <p>Not stored on purpose. A slot and a store digest written into a job row when it was queued would be a
     * second copy of facts the account already owns, and the copy is the one that is wrong after the seller
     * changes their 업체코드. Resolving at claim means the helper is handed what is true at the moment it reads.
     *
     * <p>A loopback recipe is never asked, and a build with no marketplace lane resolves nothing. Null is not a
     * pass downstream: the helper's identity assertion answers UNRESOLVED without an expectation and drops the
     * page's rows unread.
     */
    private AsideMarketplaceTarget.Target targetFor(UUID orgId, AsideRecipe recipe) {
        if (marketplaceTargets == null || recipe == null || !recipe.readsMarketplace()) {
            return null;
        }
        return marketplaceTargets.resolve(orgId, recipe).orElse(null);
    }

    private boolean hasLiveWork(UUID deviceId, Instant now) {
        return !jobs.claimableFor(deviceId, now).isEmpty()
                || jobs.findAll().stream().anyMatch(j -> deviceId.equals(j.getDeviceId())
                        && j.getStatus() == ScheduledAsideJobStatus.CLAIMED
                        && j.getLeaseUntil() != null && j.getLeaseUntil().isAfter(now));
    }
}
