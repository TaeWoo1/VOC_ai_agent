package com.sellerops.knowledge.semantic;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The memo behind the reuse: correct because of its KEY, bounded because of its clock.
 * (Retrieval Runtime Closure v1 §3)
 */
class SearchMemoTest {

    @Test
    @DisplayName("the same input is paid for once; a different input is a different answer")
    void theKeyIsTheContent() {
        SearchMemo<String> memo = new SearchMemo<>();
        AtomicInteger calls = new AtomicInteger();
        assertThat(memo.get("a", () -> "A" + calls.incrementAndGet())).isEqualTo("A1");
        assertThat(memo.get("a", () -> "A" + calls.incrementAndGet())).isEqualTo("A1");
        assertThat(calls).hasValue(1);
        // A changed key — an edited passage, a new model, another question — is not a hit.
        assertThat(memo.get("b", () -> "A" + calls.incrementAndGet())).isEqualTo("A2");
        assertThat(calls).hasValue(2);
        assertThat(memo.holds("a")).isTrue();
        assertThat(memo.holds("c")).isFalse();
    }

    /**
     * «The vendor said nothing» is an answer too.
     *
     * <p>A refusal and «this sentence asks for nothing» both arrive as null and the caller handles
     * them identically. Not remembering them would mean the three lanes of one draft each re-ask a
     * vendor that just declined, which is the exact round trip this exists to remove.
     */
    @Test
    @DisplayName("a null answer is remembered rather than re-asked")
    void silenceIsAnAnswer() {
        SearchMemo<String> memo = new SearchMemo<>();
        AtomicInteger calls = new AtomicInteger();
        assertThat(memo.get("a", () -> {
            calls.incrementAndGet();
            return null;
        })).isNull();
        assertThat(memo.get("a", () -> {
            calls.incrementAndGet();
            return null;
        })).isNull();
        assertThat(calls).hasValue(1);
    }

    @Test
    @DisplayName("bounded on both axes — a clock for retention, a count for memory")
    void itIsBounded() {
        SearchMemo<String> tiny = new SearchMemo<>(Duration.ofMinutes(5), 2);
        tiny.get("a", () -> "A");
        tiny.get("b", () -> "B");
        tiny.get("c", () -> "C");
        assertThat(tiny.size()).isEqualTo(2);
        assertThat(tiny.holds("a")).as("the oldest is dropped").isFalse();
        assertThat(tiny.holds("c")).isTrue();

        // The clock is RETENTION, not invalidation: with an expired entry the answer is recomputed,
        // and it is recomputed to the same thing, because the key is what it depends on.
        SearchMemo<String> forgetful = new SearchMemo<>(Duration.ZERO, 200);
        AtomicInteger calls = new AtomicInteger();
        forgetful.get("a", () -> "A" + calls.incrementAndGet());
        forgetful.get("a", () -> "A" + calls.incrementAndGet());
        assertThat(calls).hasValue(2);
        assertThat(forgetful.holds("a")).isFalse();
    }

    /** The shipped bounds, asserted so a change to either is a decision. */
    @Test
    @DisplayName("the shipped retention is five minutes and two hundred answers")
    void theShippedBounds() {
        assertThat(SearchMemo.RETENTION).isEqualTo(Duration.ofMinutes(5));
        assertThat(SearchMemo.MAX_ENTRIES).isEqualTo(200);
    }
}
