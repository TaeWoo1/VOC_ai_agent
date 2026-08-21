package com.sellerops.collect;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.collect.CredentialHandoffAuthorizations.Binding;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/**
 * **The seller-grade interlock, on its own.** No Spring, no database, no vault — a capability store with an
 * injected clock, so every refusal it can give is a property this suite actually exercises rather than a branch
 * that is only ever taken in production.
 *
 * What is under test is that an authorization is spendable by exactly the seller, account, channel and run it was
 * issued for, exactly once, for a few minutes. Everything else about the handoff — the vault, the validator, the
 * connector check, the never-overwrite rule — is unchanged and tested where it lives.
 */
class CredentialHandoffAuthorizationsTest {

    private static final Instant T0 = Instant.parse("2026-08-20T09:00:00Z");

    private static final UUID ORG = UUID.randomUUID();
    private static final UUID USER = UUID.randomUUID();
    private static final UUID ACCOUNT = UUID.randomUUID();
    private static final String RUN = "run_c0ffee01";

    /** A clock the test moves by hand. */
    private static final class Movable extends Clock {
        private Instant now = T0;

        @Override public ZoneOffset getZone() { return ZoneOffset.UTC; }
        @Override public Clock withZone(java.time.ZoneId zone) { return this; }
        @Override public Instant instant() { return now; }

        void advance(Duration d) { now = now.plus(d); }
    }

    private static Binding binding() {
        return new Binding(ORG, USER, ACCOUNT, "COUPANG", RUN);
    }

    private static CredentialHandoffAuthorizations store(Movable clock) {
        return new CredentialHandoffAuthorizations(new SecureRandom(), clock);
    }

    @Test
    void issuesAnOpaqueIdThatTheMatchingRequestMaySpend() {
        CredentialHandoffAuthorizations auth = store(new Movable());
        String id = auth.issue(binding());

        // A capability, not a guessable handle: 128 bits of hex, and nothing about the seller in it.
        assertThat(id).matches("^[0-9a-f]{32}$");
        assertThat(id).doesNotContain(ORG.toString().substring(0, 8));
        assertThat(auth.refusalFor(id, binding())).isNull();
    }

    @Test
    void anAbsentOrUnknownIdIsRefusedAndTheyAreDIFFERENTAnswers() {
        CredentialHandoffAuthorizations auth = store(new Movable());
        assertThat(auth.refusalFor(null, binding())).isEqualTo(CredentialHandoffAuthorizations.REASON_ABSENT);
        assertThat(auth.refusalFor("   ", binding())).isEqualTo(CredentialHandoffAuthorizations.REASON_ABSENT);
        // "you sent nothing" and "that is not one of ours" need different fixes, so they are different reasons.
        assertThat(auth.refusalFor("0".repeat(32), binding()))
                .isEqualTo(CredentialHandoffAuthorizations.REASON_UNKNOWN);
    }

    @Test
    void eachBoundFieldIsLoadBearing_aChangeInAnyOneOfThemRefuses() {
        // The point of binding five things is that dropping any one leaves a way to reuse a grant. Each row here
        // is one such way, and each must be closed.
        CredentialHandoffAuthorizations auth = store(new Movable());
        String id = auth.issue(binding());

        Binding[] wrong = {
            new Binding(UUID.randomUUID(), USER, ACCOUNT, "COUPANG", RUN),   // another organisation
            new Binding(ORG, UUID.randomUUID(), ACCOUNT, "COUPANG", RUN),    // another seller in the same org
            new Binding(ORG, USER, UUID.randomUUID(), "COUPANG", RUN),       // this seller's OTHER account
            new Binding(ORG, USER, ACCOUNT, "NAVER", RUN),                   // a different channel
            new Binding(ORG, USER, ACCOUNT, "COUPANG", "run_somethingelse"), // a later sitting
        };
        for (Binding b : wrong) {
            assertThat(auth.refusalFor(id, b))
                    .as("binding %s", b)
                    .isEqualTo(CredentialHandoffAuthorizations.REASON_MISMATCH);
        }
        // …and the real one still works, so the rejections above are about the binding and not about the id.
        assertThat(auth.refusalFor(id, binding())).isNull();
    }

    @Test
    void itExpires_andAnExpiredAuthorizationCannotBeClaimed() {
        Movable clock = new Movable();
        CredentialHandoffAuthorizations auth = store(clock);
        String id = auth.issue(binding());

        clock.advance(CredentialHandoffAuthorizations.TTL.minusSeconds(1));
        assertThat(auth.refusalFor(id, binding())).isNull();

        clock.advance(Duration.ofSeconds(2));
        assertThat(auth.refusalFor(id, binding())).isEqualTo(CredentialHandoffAuthorizations.REASON_EXPIRED);
    }

    @Test
    void oneUse_andTheSecondClaimLosesEvenWhenTheCheckPassedForBoth() {
        // Exactly the race the operator arming was fixed for: `refusalFor` only READS the flag, so two callers
        // can both pass it. Only one may claim.
        CredentialHandoffAuthorizations auth = store(new Movable());
        String id = auth.issue(binding());

        assertThat(auth.refusalFor(id, binding())).isNull();
        assertThat(auth.refusalFor(id, binding())).isNull();

        assertThat(auth.claim(id)).isTrue();
        assertThat(auth.claim(id)).isFalse();
        assertThat(auth.refusalFor(id, binding())).isEqualTo(CredentialHandoffAuthorizations.REASON_CONSUMED);
    }

    @Test
    void aStoreThatThrewHandsTheClaimBack_becauseNothingWasStored() {
        CredentialHandoffAuthorizations auth = store(new Movable());
        String id = auth.issue(binding());

        assertThat(auth.claim(id)).isTrue();
        auth.releaseUnusedClaim(id);

        // Spendable again — and only because nothing was written. The service calls this on exactly one path.
        assertThat(auth.refusalFor(id, binding())).isNull();
        assertThat(auth.claim(id)).isTrue();
    }

    @Test
    void theCallerShapedHalfAnswersWithoutAnAccount_andStillRefusesAForeignCaller() {
        // The service asks this BEFORE resolving the slot, so an unauthorized caller cannot learn whether a slot
        // exists. It must therefore be able to refuse on identity alone.
        CredentialHandoffAuthorizations auth = store(new Movable());
        String id = auth.issue(binding());

        assertThat(auth.refusalForCaller(id, ORG, USER)).isNull();
        assertThat(auth.refusalForCaller(id, UUID.randomUUID(), USER))
                .isEqualTo(CredentialHandoffAuthorizations.REASON_MISMATCH);
        assertThat(auth.refusalForCaller(id, ORG, UUID.randomUUID()))
                .isEqualTo(CredentialHandoffAuthorizations.REASON_MISMATCH);
    }

    @Test
    void issuedIdsAreDistinct_soOneSellersAuthorizationIsNeverAnothers() {
        CredentialHandoffAuthorizations auth = store(new Movable());
        String a = auth.issue(binding());
        String b = auth.issue(new Binding(ORG, USER, UUID.randomUUID(), "COUPANG", RUN));
        assertThat(a).isNotEqualTo(b);
        assertThat(auth.refusalFor(b, binding())).isEqualTo(CredentialHandoffAuthorizations.REASON_MISMATCH);
    }

    @Test
    void theLiveMapIsBounded_andExpiredEntriesFreeTheirSlots() {
        // DISTINCT bindings, because one binding can no longer occupy more than one slot — a repeated ask for
        // the same seller/account/run supersedes itself (see `repeatedAsksForOneBindingCannotFillTheStore`).
        // Filling the map is therefore what it says on the tin: that many sellers mid-handoff at once.
        Movable clock = new Movable();
        CredentialHandoffAuthorizations auth = store(clock);
        for (int i = 0; i < CredentialHandoffAuthorizations.MAX_LIVE; i++) {
            assertThat(auth.issue(new Binding(ORG, USER, UUID.randomUUID(), "COUPANG", RUN))).isNotNull();
        }
        // At capacity nothing is issued — a refusal, never an eviction of someone else's live authorization.
        assertThat(auth.issue(binding())).isNull();

        clock.advance(CredentialHandoffAuthorizations.TTL.plusSeconds(1));
        assertThat(auth.liveCount()).isZero();
        assertThat(auth.issue(binding())).isNotNull();
    }

    /* ───────────────── at most one LIVE capability per binding ───────────────── */

    @Test
    void aSecondIssueForTheSameBindingSupersedesTheFirst() {
        // One seller, one account, one run, one consent — but the ASK can arrive more than once for it: a
        // second SellerOps tab attached to the same run, a refresh that re-observes the consent, a retried
        // request. Each used to leave another spendable capability behind for its full five minutes.
        //
        // The handoff was already at-most-once (the runtime latches one per run, and the claim is a CAS), so
        // nothing was ever stored twice. "At most one credential written" and "at most one live write
        // authorization" are different properties, and this is the second one.
        CredentialHandoffAuthorizations auth = store(new Movable());

        String first = auth.issue(binding());
        String second = auth.issue(binding());

        assertThat(second).isNotEqualTo(first);
        assertThat(auth.refusalFor(second, binding())).isNull();
        assertThat(auth.refusalFor(first, binding()))
                .isEqualTo(CredentialHandoffAuthorizations.REASON_UNKNOWN);
        assertThat(auth.liveCount()).isEqualTo(1);
    }

    @Test
    void supersedingIsPerBinding_aDifferentRunOrAccountIsUntouched() {
        // The revocation must be as narrow as the binding is. Two sellers mid-handoff, or one seller on two
        // runs, are two separate consents and both capabilities stay live.
        CredentialHandoffAuthorizations auth = store(new Movable());
        Binding otherRun = new Binding(ORG, USER, ACCOUNT, "COUPANG", "run_0therrun1");
        Binding otherAccount = new Binding(ORG, USER, UUID.randomUUID(), "COUPANG", RUN);

        String a = auth.issue(binding());
        String b = auth.issue(otherRun);
        String c = auth.issue(otherAccount);

        assertThat(auth.refusalFor(a, binding())).isNull();
        assertThat(auth.refusalFor(b, otherRun)).isNull();
        assertThat(auth.refusalFor(c, otherAccount)).isNull();
        assertThat(auth.liveCount()).isEqualTo(3);
    }

    @Test
    void repeatedAsksForOneBindingCannotFillTheStore() {
        // The cap exists so a caller asking in a loop cannot grow the map without bound. Superseding makes that
        // stronger than a refusal at 64: the loop never gets there, because it never holds more than one.
        CredentialHandoffAuthorizations auth = store(new Movable());

        String last = null;
        for (int i = 0; i < CredentialHandoffAuthorizations.MAX_LIVE * 2; i++) {
            last = auth.issue(binding());
            assertThat(last).isNotNull();
        }

        assertThat(auth.liveCount()).isEqualTo(1);
        assertThat(auth.refusalFor(last, binding())).isNull();
    }

    @Test
    void supersedingSurvivesTheSweep_theIndexDoesNotOutliveWhatItPointsAt() {
        // The index points INTO the live map, so an entry that ages out leaves a pointer to nothing. If those
        // are not dropped the index becomes the unbounded map the cap exists to prevent.
        Movable clock = new Movable();
        CredentialHandoffAuthorizations auth = store(clock);
        auth.issue(binding());

        clock.advance(CredentialHandoffAuthorizations.TTL.plusSeconds(1));
        assertThat(auth.liveCount()).isZero();

        // …and a fresh ask after the sweep still works, rather than superseding a ghost.
        String after = auth.issue(binding());
        assertThat(auth.refusalFor(after, binding())).isNull();
        assertThat(auth.liveCount()).isEqualTo(1);
    }
}
