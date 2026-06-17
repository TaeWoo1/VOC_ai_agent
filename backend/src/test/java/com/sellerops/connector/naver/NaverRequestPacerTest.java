package com.sellerops.connector.naver;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Duration;
import java.time.Instant;
import org.junit.jupiter.api.Test;

/**
 * The pacer's spacing arithmetic, exercised with a fake clock the recording
 * sleeper advances — so the logic is identical to production but nothing really
 * sleeps. Spacing is measured between call starts.
 */
class NaverRequestPacerTest {

    private static final Instant T0 = Instant.parse("2026-06-14T00:00:00Z");
    private static final Duration ONE_SECOND = Duration.ofSeconds(1);

    private final MutableTestClock clock = new MutableTestClock(T0);
    private final RecordingSleeper sleeper = new RecordingSleeper(clock);

    private NaverRequestPacer pacer(Duration interval) {
        return new NaverRequestPacer(clock, sleeper, interval, ONE_SECOND);
    }

    private NaverRequestPacer pacer(Duration interval, Duration backoff) {
        return new NaverRequestPacer(clock, sleeper, interval, backoff);
    }

    private static NaverRateLimitSnapshot exhausted() {
        return new NaverRateLimitSnapshot(2, 4, 0, null, null, null);
    }

    private static NaverRateLimitSnapshot healthy() {
        return new NaverRateLimitSnapshot(2, 4, 2, "SECONDS", 1000, 999);
    }

    @Test
    void firstAcquireNeverSleeps() {
        pacer(ONE_SECOND).acquire();

        assertThat(sleeper.waits).isEmpty();
    }

    @Test
    void backToBackAcquiresAreSpacedByTheFullInterval() {
        NaverRequestPacer pacer = pacer(ONE_SECOND);

        pacer.acquire(); // T0, no sleep
        pacer.acquire(); // clock still T0 → must wait the whole interval

        assertThat(sleeper.waits).containsExactly(ONE_SECOND);
    }

    @Test
    void acquireOnlySleepsTheRemainderOfThePartiallyElapsedInterval() {
        NaverRequestPacer pacer = pacer(ONE_SECOND);

        pacer.acquire();                       // T0
        clock.advance(Duration.ofMillis(400)); // 0.4s of real work happened
        pacer.acquire();                       // only 0.6s left to wait

        assertThat(sleeper.waits).containsExactly(Duration.ofMillis(600));
    }

    @Test
    void acquireAfterTheIntervalAlreadyElapsedDoesNotSleep() {
        NaverRequestPacer pacer = pacer(ONE_SECOND);

        pacer.acquire();                     // T0
        clock.advance(Duration.ofSeconds(2)); // more than the interval has passed
        pacer.acquire();                     // no wait needed

        assertThat(sleeper.waits).isEmpty();
    }

    @Test
    void eachConsecutiveBurstCallIsSpacedFromThePrevious() {
        NaverRequestPacer pacer = pacer(ONE_SECOND);

        pacer.acquire(); // T0, no sleep
        pacer.acquire(); // +1s
        pacer.acquire(); // +1s

        assertThat(sleeper.waits).containsExactly(ONE_SECOND, ONE_SECOND);
    }

    @Test
    void zeroIntervalDisablesPacingEntirely() {
        NaverRequestPacer pacer = pacer(Duration.ZERO);

        pacer.acquire();
        pacer.acquire();
        pacer.acquire();

        assertThat(sleeper.waits).isEmpty();
    }

    @Test
    void negativeIntervalIsRejectedAtConstruction() {
        assertThatThrownBy(() -> pacer(Duration.ofMillis(-1)))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void negativeBackoffIsRejectedAtConstruction() {
        assertThatThrownBy(() -> pacer(ONE_SECOND, Duration.ofMillis(-1)))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void observingAnExhaustedMeterMakesTheNextCallWaitTheFullBackoff() {
        NaverRequestPacer pacer = pacer(Duration.ofMillis(200), Duration.ofSeconds(5));

        pacer.acquire();              // T0, no sleep; next allowed at T0+200ms
        pacer.observe(exhausted());   // meter empty → next allowed pushed to T0+5s
        pacer.acquire();              // must wait the full backoff, not the 200ms floor

        assertThat(sleeper.waits).containsExactly(Duration.ofSeconds(5));
    }

    @Test
    void observingAHealthyMeterAddsNoExtraDelay() {
        NaverRequestPacer pacer = pacer(ONE_SECOND, Duration.ofSeconds(5));

        pacer.acquire();            // T0
        pacer.observe(healthy());   // remaining > 0 → no backoff
        pacer.acquire();            // only the ordinary floor interval

        assertThat(sleeper.waits).containsExactly(ONE_SECOND);
    }

    @Test
    void observingAbsentHeadersIsANoOp() {
        NaverRequestPacer pacer = pacer(ONE_SECOND, Duration.ofSeconds(5));

        pacer.acquire();
        pacer.observe(NaverRateLimitSnapshot.EMPTY);
        pacer.acquire();

        assertThat(sleeper.waits).containsExactly(ONE_SECOND);
    }

    @Test
    void exhaustionBackoffAppliesEvenWhenFloorPacingIsDisabled() {
        NaverRequestPacer pacer = pacer(Duration.ZERO, Duration.ofSeconds(3));

        pacer.acquire();            // no floor pacing
        pacer.observe(exhausted()); // headers still force a wait
        pacer.acquire();

        assertThat(sleeper.waits).containsExactly(Duration.ofSeconds(3));
    }
}
