package com.sellerops.knowledge.semantic;

import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.function.Supplier;

/**
 * One answer, remembered for as long as the thing it answers has not changed.
 * (Retrieval Runtime Closure v1, 2026-09-03)
 *
 * <p><b>The key is content, and that is what makes it correct.</b> Every caller composes its key
 * from what the answer actually depends on — the model that produced it, the question that was
 * asked, and, where the answer is about the seller's passages, those passages as they read. So an
 * edited document, a retired source, a new source, a changed question and a changed model all
 * produce a DIFFERENT key rather than a stale hit. Nothing here has to be invalidated, because
 * nothing here can be wrong: a hit means the exact same input was already paid for.
 *
 * <p><b>The clock is retention, not correctness.</b> These answers are derived from customer
 * wording, and this repository keeps one copy of that — the row the channel wrote. So the memo
 * forgets on a bound, and the bound is a data-minimisation property rather than a cache-invalidation
 * strategy: with an infinite bound every answer here would still be correct, and this process would
 * be holding a growing set of restatements of customers' sentences for no reader. Both axes are
 * bounded; a process restart loses all of it and costs one call.
 *
 * <p><b>What this is NOT.</b> It is not where the product's consistency comes from. A draft version's
 * evidence is fixed because it is WRITTEN DOWN beside that version ({@code review_draft_evidence},
 * {@code inquiry_draft_evidence}) and read back on every reopen — see
 * {@code docs/retrieval_runtime_closure_v1.md} §1. This only stops one unit of work from paying a
 * vendor three times for the same sentence, which is a defect rather than a price.
 */
final class SearchMemo<V> {

    /**
     * How long an answer derived from a customer's sentence may sit in memory.
     *
     * <p>Sized by the unit of work it exists for, not by a guess about a second visit: one draft
     * searches three lanes (product knowledge, operating policy, past answers) with one question,
     * and a seller who presses 「다시 준비하기」 does so while still reading the first draft.
     */
    static final Duration RETENTION = Duration.ofMinutes(5);

    /** How many answers are held before the oldest is dropped. */
    static final int MAX_ENTRIES = 200;

    private final Duration retention;
    private final int maxEntries;
    private final Map<String, Entry<V>> entries = new LinkedHashMap<>();

    private record Entry<V>(V value, Instant at) {
    }

    SearchMemo() {
        this(RETENTION, MAX_ENTRIES);
    }

    SearchMemo(Duration retention, int maxEntries) {
        this.retention = retention;
        this.maxEntries = maxEntries;
    }

    /**
     * The remembered answer for this key, or the supplier's — computed OUTSIDE the lock.
     *
     * <p>Two callers asking the same question at the same moment therefore both pay, which is the
     * right trade: holding a lock across a vendor round trip would let one slow call block every
     * other search in the process.
     *
     * <p>A null answer is remembered too. «The vendor said this sentence asks for nothing» and «the
     * vendor refused» are both answers the caller handles identically, and re-asking on every lane
     * of the same draft is exactly the round trip this exists to remove.
     */
    V get(String key, Supplier<V> compute) {
        Instant now = Instant.now();
        synchronized (entries) {
            Entry<V> hit = entries.get(key);
            if (hit != null && Duration.between(hit.at(), now).compareTo(retention) < 0) {
                return hit.value();
            }
        }
        V value = compute.get();
        synchronized (entries) {
            entries.remove(key);
            entries.put(key, new Entry<>(value, now));
            while (entries.size() > maxEntries) {
                entries.remove(entries.keySet().iterator().next());
            }
        }
        return value;
    }

    /** Whether this key is currently remembered — for the tests that assert a call was not made. */
    boolean holds(String key) {
        synchronized (entries) {
            Entry<V> hit = entries.get(key);
            return hit != null
                    && Duration.between(hit.at(), Instant.now()).compareTo(retention) < 0;
        }
    }

    /** How many answers are held. Bounded by {@link #MAX_ENTRIES}; used by the bound's own test. */
    int size() {
        synchronized (entries) {
            return entries.size();
        }
    }
}
