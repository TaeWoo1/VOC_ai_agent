package com.sellerops.attention.reply;

import jakarta.persistence.EntityManager;
import org.springframework.stereotype.Component;

/**
 * The shared, globally-monotonic position source for the two explicit reply-work events — dismissal
 * (작업에서 제외) and restore (복원). Both draw from one DB sequence ({@code reply_work_event_seq}), so
 * "which explicit action is latest" is a total order rather than a wall-clock comparison: two events
 * in the same clock tick still order deterministically by seq.
 *
 * <p>Sourced at write time (not a column default, not a Hibernate id generator) so it works uniformly
 * for both tables while their primary keys stay UUIDs, matching the rest of this package. Production
 * creates the sequence in Flyway V26; the offline H2 test schema creates the same object via
 * {@code schema.sql} (Flyway is disabled under test).
 */
@Component
public class ReplyWorkEventSequence {

    private final EntityManager em;

    /** Spring injects the shared {@link EntityManager} proxy; tests pass the JPA test EM directly. */
    public ReplyWorkEventSequence(EntityManager em) {
        this.em = em;
    }

    /** The next position — strictly greater than every position handed out before it. */
    public long next() {
        // Portable across PostgreSQL and H2 (PostgreSQL-compatibility mode): both resolve nextval().
        Object value = em.createNativeQuery("select nextval('reply_work_event_seq')").getSingleResult();
        return ((Number) value).longValue();
    }
}
