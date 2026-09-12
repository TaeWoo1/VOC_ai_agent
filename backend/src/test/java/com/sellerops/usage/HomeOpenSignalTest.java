package com.sellerops.usage;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * The return-visit signal's whole contract: <b>one row per organisation per Asia/Seoul day</b>.
 *
 * <p>Each test here is one sentence from the product-owner decision, because each is a way the number
 * could quietly become a different number: a page that mounts twice would double a usage day; a
 * second seller would land in the first one's count; and a morning between 00:00 and 09:00 KST would
 * be filed under yesterday if the day were derived in UTC — which is the one error that would not
 * change any total, only move visits across the boundary of every weekly figure.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class HomeOpenSignalTest {

    @Autowired HomeOpenDayRepository days;

    private HomeOpenSignal signalAt(Instant instant) {
        return new HomeOpenSignal(days, Clock.fixed(instant, ZoneId.of("UTC")));
    }

    // 1 — opening 홈 nine times on one day is one usage day.
    @Test
    void repeatedOpensOnOneDayAreOneRow() {
        UUID org = UUID.randomUUID();
        HomeOpenSignal signal = signalAt(Instant.parse("2026-09-13T04:00:00Z"));

        assertThat(signal.homeOpened(org)).as("the first open records the day").isTrue();
        for (int i = 0; i < 8; i++) {
            assertThat(signal.homeOpened(org)).as("every later open writes nothing").isFalse();
        }
        assertThat(signal.usageDays(org)).isEqualTo(1);
    }

    // 2 — coming back on another day is another usage day.
    @Test
    void differentDaysAreDifferentUsageDays() {
        UUID org = UUID.randomUUID();
        assertThat(signalAt(Instant.parse("2026-09-13T04:00:00Z")).homeOpened(org)).isTrue();
        assertThat(signalAt(Instant.parse("2026-09-14T04:00:00Z")).homeOpened(org)).isTrue();
        assertThat(signalAt(Instant.parse("2026-09-16T23:30:00Z")).homeOpened(org)).isTrue();

        assertThat(signalAt(Instant.parse("2026-09-16T23:30:00Z")).usageDays(org)).isEqualTo(3);
    }

    // 3 — the day is Asia/Seoul, not UTC. 2026-09-13T22:00Z is already the 14th in Seoul.
    @Test
    void theDayIsSeoulNotUtc() {
        UUID org = UUID.randomUUID();
        signalAt(Instant.parse("2026-09-13T22:00:00Z")).homeOpened(org);

        assertThat(days.existsByOrgIdAndOpenedOn(org, LocalDate.of(2026, 9, 14)))
                .as("22:00Z is 07:00 the next morning in Seoul — the seller's day, not the server's")
                .isTrue();
        assertThat(days.existsByOrgIdAndOpenedOn(org, LocalDate.of(2026, 9, 13))).isFalse();
    }

    // 4 — one seller's mornings are not another's.
    @Test
    void oneOrganisationsDaysAreItsOwn() {
        UUID a = UUID.randomUUID();
        UUID b = UUID.randomUUID();
        HomeOpenSignal signal = signalAt(Instant.parse("2026-09-13T04:00:00Z"));

        signal.homeOpened(a);
        signal.homeOpened(a);

        assertThat(signal.usageDays(a)).isEqualTo(1);
        assertThat(signal.usageDays(b)).isZero();
    }

    // 5 — no organisation, no row. (A request can reach the controller carrying no principal.)
    @Test
    void aMissingOrganisationRecordsNothing() {
        // Counted rather than asserted zero: the signal commits in its own transaction (REQUIRES_NEW,
        // so a measurement never joins the caller's), which is exactly why it must not be rolled back
        // by the request either — and therefore why neighbouring tests' rows are still here.
        long before = days.count();
        assertThat(signalAt(Instant.parse("2026-09-13T04:00:00Z")).homeOpened(null)).isFalse();
        assertThat(days.count()).isEqualTo(before);
    }
}
