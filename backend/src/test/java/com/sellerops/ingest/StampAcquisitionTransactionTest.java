package com.sellerops.ingest;

import static org.assertj.core.api.Assertions.assertThat;

import java.lang.reflect.Method;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.annotation.Transactional;

/**
 * {@code IngestionService.stampAcquisition} runs a {@code @Modifying(flushAutomatically = true)} update, and
 * its production caller — {@code AgentReviewHandoffService.handOff} — is deliberately NOT transactional, so a
 * late failure cannot roll back reviews that were already stored. Without its own transaction the flush throws
 * {@code InvalidDataAccessApiUsageException} and the seller gets a 500 on a handoff whose rows already landed.
 *
 * <p><b>Why a structural test, and why no existing test caught this.</b> Every ingestion test in this package
 * is a {@code @DataJpaTest}, and {@code @DataJpaTest} wraps each test method in a transaction — so the flush
 * always finds one, and the production condition (no transaction at all) is the one condition the suite cannot
 * reproduce. The defect was therefore invisible to a green suite and visible on the first live WING read this
 * branch carried (2026-09-12: read OK, 9 reviews inserted, handoff 500, {@code stored=0} reported to a seller
 * whose rows had in fact been written, and left unstamped).
 *
 * <p>Asserting the annotation is weaker than asserting the behaviour, and it is said plainly rather than
 * dressed up: the behavioural test needs a non-transactional Spring context this suite does not have. What
 * this does guarantee is that the annotation cannot be removed silently.
 */
class StampAcquisitionTransactionTest {

    @Test
    @DisplayName("stampAcquisition carries its own transaction — the flush has nowhere else to find one")
    void hasItsOwnTransaction() throws NoSuchMethodException {
        Method m = IngestionService.class.getMethod("stampAcquisition", java.util.UUID.class, java.util.List.class, java.util.UUID.class);
        assertThat(m.getAnnotation(Transactional.class))
                .as("a flushing @Modifying update called from a non-transactional caller needs its own transaction")
                .isNotNull();
    }

    @Test
    @DisplayName("the caller stays non-transactional on purpose — stored rows survive a later failure")
    void callerIsNotTransactional() throws NoSuchMethodException {
        Method handOff = com.sellerops.collect.AgentReviewHandoffService.class
                .getMethod("handOff", java.util.UUID.class, com.sellerops.collect.dto.AgentReviewHandoffRequest.class);
        assertThat(handOff.getAnnotation(Transactional.class))
                .as("wrapping the whole handoff would roll back reviews that were correctly ingested")
                .isNull();
    }
}
