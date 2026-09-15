package com.sellerops.responsibility;

import com.sellerops.common.ApiException;
import com.sellerops.responsibility.dto.ResponsibilityView;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * The seller's side of a responsibility: take it on, pause it, resume it, stop it, and read what was done.
 *
 * <p>Every transition locks the responsibility row, so it serializes with the materializer (which locks the same
 * row) — a pause cannot race a window being created.
 *
 * <ul>
 *   <li><b>activate</b> — ACTIVE; the window open now gets its run (trigger ACTIVATION) immediately, and the
 *   schedule continues from the next boundary. Idempotent: activating an ACTIVE responsibility creates nothing.</li>
 *   <li><b>pause / stop</b> — no new run is created (the materializer only sees ACTIVE, and the schema refuses a
 *   next window for anything else); queued runs are cancelled; a run already working stops before its next
 *   source.</li>
 *   <li><b>resume</b> — ACTIVE again; the current window is worked (a run cancelled by the pause is reopened —
 *   the same logical run). Windows that passed while paused are not runs: nobody was responsible for them.</li>
 * </ul>
 */
@Service
public class ResponsibilityService {

    static final ResponsibilityTemplate TEMPLATE = ResponsibilityTemplate.CUSTOMER_OPERATIONS_V1;

    private final ResponsibilityRepository responsibilities;
    private final ResponsibilityRunRepository runs;
    private final ResponsibilityRunSourceRepository sourceRows;
    private final ResponsibilitySources sources;
    private final TransactionTemplate tx;
    private final Clock clock;

    @Autowired
    public ResponsibilityService(ResponsibilityRepository responsibilities, ResponsibilityRunRepository runs,
                                 ResponsibilityRunSourceRepository sourceRows, ResponsibilitySources sources,
                                 PlatformTransactionManager txManager) {
        this(responsibilities, runs, sourceRows, sources, txManager, Clock.systemUTC());
    }

    public ResponsibilityService(ResponsibilityRepository responsibilities, ResponsibilityRunRepository runs,
                                 ResponsibilityRunSourceRepository sourceRows, ResponsibilitySources sources,
                                 PlatformTransactionManager txManager, Clock clock) {
        this.responsibilities = responsibilities;
        this.runs = runs;
        this.sourceRows = sourceRows;
        this.sources = sources;
        this.tx = new TransactionTemplate(txManager);
        this.clock = clock;
    }

    public ResponsibilityView view(UUID orgId) {
        Optional<Responsibility> found = responsibilities.findByOrgIdAndTemplateCode(orgId, TEMPLATE);
        if (found.isEmpty()) {
            return ResponsibilityView.notActivated(TEMPLATE);
        }
        Responsibility r = found.get();
        List<ResponsibilityRun> recent = runs.findTop20ByResponsibilityIdOrderByWindowStartDesc(r.getId());
        Map<UUID, List<ResponsibilityRunSource>> byRun = recent.isEmpty() ? Map.of()
                : sourceRows.findByRunIdInOrderByAttemptAscCreatedAtAsc(
                                recent.stream().map(ResponsibilityRun::getId).toList())
                        .stream().collect(Collectors.groupingBy(ResponsibilityRunSource::getRunId));
        return ResponsibilityView.of(TEMPLATE, r, recent, byRun);
    }

    public ResponsibilityView activate(UUID orgId, UUID userId) {
        Instant now = now();
        try {
            tx.executeWithoutResult(status -> {
                if (sources.resolve(orgId, TEMPLATE).isEmpty()) {
                    throw ApiException.conflict("카페24를 먼저 연결해 주세요. 고객 운영 관리는 카페24 문의와 리뷰를 확인합니다.");
                }
                Responsibility r = responsibilities.findForUpdate(orgId, TEMPLATE).orElse(null);
                RunTrigger trigger = RunTrigger.ACTIVATION;
                if (r == null) {
                    r = new Responsibility();
                    r.setOrgId(orgId);
                    r.setTemplateCode(TEMPLATE);
                } else if (r.getStatus() == ResponsibilityStatus.ACTIVE) {
                    return;
                } else if (r.getStatus() == ResponsibilityStatus.PAUSED) {
                    trigger = RunTrigger.RESUME;
                }
                if (trigger == RunTrigger.ACTIVATION) {
                    r.setActivatedBy(userId);
                    r.setActivatedAt(now);
                }
                startWorking(r, trigger, now);
            });
        } catch (DataIntegrityViolationException concurrentFirstActivation) {
            // Two first activations raced on the unique (org, template); the other one created it.
        }
        return view(orgId);
    }

    public ResponsibilityView resume(UUID orgId) {
        Instant now = now();
        tx.executeWithoutResult(status -> {
            Responsibility r = responsibilities.findForUpdate(orgId, TEMPLATE)
                    .orElseThrow(() -> ApiException.notFound("맡긴 고객 운영 관리가 없습니다."));
            if (r.getStatus() == ResponsibilityStatus.ACTIVE) {
                return;
            }
            if (r.getStatus() != ResponsibilityStatus.PAUSED) {
                throw ApiException.conflict("중지된 고객 운영 관리는 다시 맡겨 주세요.");
            }
            startWorking(r, RunTrigger.RESUME, now);
        });
        return view(orgId);
    }

    public ResponsibilityView pause(UUID orgId) {
        return handBack(orgId, ResponsibilityStatus.PAUSED);
    }

    public ResponsibilityView stop(UUID orgId) {
        return handBack(orgId, ResponsibilityStatus.STOPPED);
    }

    private ResponsibilityView handBack(UUID orgId, ResponsibilityStatus target) {
        Instant now = now();
        tx.executeWithoutResult(status -> {
            Responsibility r = responsibilities.findForUpdate(orgId, TEMPLATE)
                    .orElseThrow(() -> ApiException.notFound("맡긴 고객 운영 관리가 없습니다."));
            if (r.getStatus() == target || r.getStatus() == ResponsibilityStatus.STOPPED) {
                return;
            }
            r.setStatus(target);
            r.setNextRunAt(null);
            if (target == ResponsibilityStatus.PAUSED) {
                r.setPausedAt(now);
            } else {
                r.setStoppedAt(now);
            }
            responsibilities.save(r);
            RunFailureReason reason = target == ResponsibilityStatus.PAUSED
                    ? RunFailureReason.RESPONSIBILITY_PAUSED
                    : RunFailureReason.RESPONSIBILITY_STOPPED;
            for (ResponsibilityRun run : runs.findByResponsibilityIdAndStatusIn(r.getId(),
                    List.of(RunStatus.PENDING, RunStatus.PARTIAL, RunStatus.FAILED))) {
                if (run.getStatus() == RunStatus.PENDING) {
                    run.cancel(reason, now);
                } else {
                    run.setNextAttemptAt(null);
                }
                runs.save(run);
            }
            // A RUNNING run is left to its holder, which checks the status before each source and cancels itself.
        });
        return view(orgId);
    }

    private void startWorking(Responsibility r, RunTrigger trigger, Instant now) {
        Instant window = ResponsibilityWindows.slotStart(now);
        r.setStatus(ResponsibilityStatus.ACTIVE);
        r.setTemplateVersion(TEMPLATE.version());
        r.setPausedAt(null);
        r.setStoppedAt(null);
        r.setNextRunAt(ResponsibilityWindows.slotEnd(window));
        Responsibility saved = responsibilities.saveAndFlush(r);
        Optional<ResponsibilityRun> existing = runs.findByResponsibilityIdAndWindowStart(saved.getId(), window);
        if (existing.isEmpty()) {
            runs.save(ResponsibilityRun.materialized(saved, window, trigger));
        } else if (existing.get().getStatus() == RunStatus.CANCELLED) {
            existing.get().reopen();
            runs.save(existing.get());
        }
    }

    private Instant now() {
        return clock.instant().truncatedTo(ChronoUnit.MICROS);
    }
}
