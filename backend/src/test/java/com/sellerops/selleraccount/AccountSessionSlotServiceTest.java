package com.sellerops.selleraccount;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * The invariants the account-scoped session runtime rests on: the slot is stable and opaque (so a profile
 * is reused across restarts and never carries an identity), distinct accounts never share one (so their
 * cookies cannot mix), and a readiness observation lands only on its own account (so one account's expiry
 * never bleeds into another's state).
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class AccountSessionSlotServiceTest {

    @Autowired AccountSessionSlotRepository slots;

    private final Clock clock = Clock.fixed(Instant.parse("2026-07-27T00:00:00Z"), ZoneOffset.UTC);
    private final UUID org = UUID.randomUUID();
    private final UUID channel = UUID.randomUUID();

    private AccountSessionSlotService service() {
        return new AccountSessionSlotService(slots, clock);
    }

    @Test
    void mintsAStableOpaqueSlotPerAccountAndReusesItAcrossResolves() {
        AccountSessionSlotService svc = service();
        UUID account = UUID.randomUUID();

        String first = svc.resolveSlot(org, account, channel);
        String second = svc.resolveSlot(org, account, channel);

        assertThat(first).isEqualTo(second);            // stable — same slot means same profile after a restart
        assertThat(slots.count()).isEqualTo(1);         // find-or-create, not create-every-time
        assertThat(first).matches("[0-9a-f]{24}");      // opaque 24-hex surrogate
        // Not the account id, and not reversible to it: nothing on the wire or on the agent's path is identity.
        assertThat(first).doesNotContain(account.toString()).isNotEqualTo(account.toString());
    }

    @Test
    void differentAccountsNeverShareASlot() {
        AccountSessionSlotService svc = service();
        String a = svc.resolveSlot(org, UUID.randomUUID(), channel);
        String b = svc.resolveSlot(org, UUID.randomUUID(), channel);
        assertThat(a).isNotEqualTo(b);                  // distinct slots -> distinct profiles -> no cookie mixing
    }

    @Test
    void aFreshSlotIsUnobservedNeverAGuessedReady() {
        AccountSessionSlotService svc = service();
        UUID account = UUID.randomUUID();
        svc.resolveSlot(org, account, channel);
        AccountSessionSlot slot = slots.findBySellerAccountId(account).orElseThrow();
        assertThat(slot.getReadinessState()).isEqualTo(SessionReadinessState.UNOBSERVED_EXTERNAL);
        assertThat(slot.getLastObservedAt()).isNull();
        assertThat(slot.getReadinessReason()).isNull();
    }

    @Test
    void recordReadinessPersistsStateReasonAndTimeForThatAccountOnly() {
        AccountSessionSlotService svc = service();
        UUID accountA = UUID.randomUUID();
        UUID accountB = UUID.randomUUID();
        svc.resolveSlot(org, accountA, channel);
        svc.resolveSlot(org, accountB, channel);

        svc.recordReadiness(org, accountA, channel,
                SessionReadinessState.READY, SessionProbeReason.MANUAL_RECHECK);

        AccountSessionSlot a = slots.findBySellerAccountId(accountA).orElseThrow();
        assertThat(a.getReadinessState()).isEqualTo(SessionReadinessState.READY);
        assertThat(a.getReadinessReason()).isEqualTo(SessionProbeReason.MANUAL_RECHECK);
        assertThat(a.getLastObservedAt()).isEqualTo(Instant.parse("2026-07-27T00:00:00Z"));
        // Account B is untouched — one account's expiry/re-login never changes another's session state.
        AccountSessionSlot b = slots.findBySellerAccountId(accountB).orElseThrow();
        assertThat(b.getReadinessState()).isEqualTo(SessionReadinessState.UNOBSERVED_EXTERNAL);
        assertThat(b.getLastObservedAt()).isNull();
    }

    @Test
    void recordReadinessCreatesTheSlotWhenNoneExistsYet() {
        AccountSessionSlotService svc = service();
        UUID account = UUID.randomUUID();
        svc.recordReadiness(org, account, channel,
                SessionReadinessState.EXPIRED, SessionProbeReason.SESSION_FAILURE);
        AccountSessionSlot slot = slots.findBySellerAccountId(account).orElseThrow();
        assertThat(slot.getReadinessState()).isEqualTo(SessionReadinessState.EXPIRED);
        assertThat(slot.getAccountSlot()).matches("[0-9a-f]{24}");
    }
}
