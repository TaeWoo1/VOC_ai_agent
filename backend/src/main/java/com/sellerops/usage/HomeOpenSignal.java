package com.sellerops.usage;

import java.time.Clock;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * The whole of the pilot's return-visit instrumentation: <b>one organisation, one day, at most once.</b>
 *
 * <p>First-party by decision (2026-09-13): no vendor sink, no consent banner to negotiate, nothing
 * leaves this deployment. The frontend's {@code analytics} module — which is a no-op without vendor
 * env and is gated on 분석 consent — is untouched and stays untouched; this is not routed through it,
 * because it is not the same kind of thing. An external sink would be told what a person did; this
 * records that an organisation's morning happened.
 *
 * <p><b>Writing is never the caller's problem.</b> {@code REQUIRES_NEW} keeps the insert off any
 * transaction the request already has, and the caller swallows failure: a measurement that can fail a
 * seller's page is a measurement that will one day fail a seller's page, and the number it protects is
 * not worth that. A lost row costs one day in a denominator.
 *
 * <p>The date is Asia/Seoul and it is decided HERE. The alternative — letting the browser say which
 * day it is — would make the seller's clock, and anyone who edits a request, the source of the fact.
 */
@Service
public class HomeOpenSignal {

    static final ZoneId KST = ZoneId.of("Asia/Seoul");

    private final HomeOpenDayRepository days;
    private final Clock clock;

    @Autowired
    public HomeOpenSignal(HomeOpenDayRepository days) {
        this(days, Clock.system(KST));
    }

    /** Tests hand in a fixed clock; the container always uses the one above. */
    HomeOpenSignal(HomeOpenDayRepository days, Clock clock) {
        this.days = days;
        this.clock = clock;
    }

    /**
     * Record that this organisation opened 홈 today. Idempotent within the day; safe to call on every
     * mount. Returns true only when this call is the one that created the day's row — for tests and
     * for the report, never for the screen, which shows nothing about being measured.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public boolean homeOpened(UUID orgId) {
        if (orgId == null) {
            return false;
        }
        LocalDate today = LocalDate.now(clock.withZone(KST));
        if (days.existsByOrgIdAndOpenedOn(orgId, today)) {
            return false;
        }
        try {
            days.save(new HomeOpenDay(orgId, today));
            return true;
        } catch (DataIntegrityViolationException concurrentFirstOpen) {
            // Two tabs opened 홈 in the same instant. The day is recorded either way, which is the
            // entire contract; the loser of the race has nothing to report and nothing to retry.
            return false;
        }
    }

    /** Days this organisation opened 홈. The cohort is applied by the caller, not by this table. */
    public long usageDays(UUID orgId) {
        return days.countByOrgId(orgId);
    }
}
