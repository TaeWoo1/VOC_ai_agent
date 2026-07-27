package com.sellerops.selleraccount;

import java.security.SecureRandom;
import java.time.Clock;
import java.time.Instant;
import java.util.HexFormat;
import java.util.Optional;
import java.util.UUID;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Owns the opaque, stable per-account {@link AccountSessionSlot} and its durable session readiness.
 *
 * <p>Two callers: the launch-scope resolver, which needs the slot to hand the runtime a per-account key
 * without leaking the seller-account id (see {@link #resolveSlot}); and the runtime's readiness report,
 * which persists what a probe observed so it survives an agent restart (see {@link #recordReadiness}).
 *
 * <p>Slot minting is <b>find-or-create and idempotent</b> — the first resolve for an account mints the
 * slot, every later resolve returns the same one. That stability is the whole point: the agent hashes the
 * slot into a fixed profile directory, so a stable slot means a stable profile across restarts.
 */
@Service
public class AccountSessionSlotService {

    private static final SecureRandom RANDOM = new SecureRandom();

    private final AccountSessionSlotRepository slots;
    private final Clock clock;

    @org.springframework.beans.factory.annotation.Autowired
    public AccountSessionSlotService(AccountSessionSlotRepository slots) {
        this(slots, Clock.systemUTC());
    }

    /** Test seam: an explicit {@link Clock} pins {@code last_observed_at}. */
    AccountSessionSlotService(AccountSessionSlotRepository slots, Clock clock) {
        this.slots = slots;
        this.clock = clock;
    }

    /**
     * The opaque, stable slot for an account — minting it on first use. Idempotent: repeated calls for the
     * same account return the same slot, which is what keeps the runtime's profile directory stable.
     */
    @Transactional
    public String resolveSlot(UUID orgId, UUID sellerAccountId, UUID channelId) {
        return getOrCreate(orgId, sellerAccountId, channelId).getAccountSlot();
    }

    /**
     * Persist what a session-readiness probe observed. Find-or-create so a report can never fail merely
     * because the slot has not been resolved yet; the readiness and the probe moment are recorded together
     * so a stale state can always be told apart from a fresh one by {@code lastObservedAt}.
     */
    @Transactional
    public void recordReadiness(UUID orgId, UUID sellerAccountId, UUID channelId,
                                SessionReadinessState state, SessionProbeReason reason) {
        AccountSessionSlot slot = getOrCreate(orgId, sellerAccountId, channelId);
        slot.setReadinessState(state);
        slot.setReadinessReason(reason);
        slot.setLastObservedAt(Instant.now(clock));
        slots.save(slot);
    }

    /** The slot row for an account, for read-side reconciliation with connection health. */
    @Transactional(readOnly = true)
    public Optional<AccountSessionSlot> findBySellerAccount(UUID sellerAccountId) {
        return slots.findBySellerAccountId(sellerAccountId);
    }

    private AccountSessionSlot getOrCreate(UUID orgId, UUID sellerAccountId, UUID channelId) {
        Optional<AccountSessionSlot> existing = slots.findBySellerAccountId(sellerAccountId);
        if (existing.isPresent()) {
            return existing.get();
        }
        AccountSessionSlot slot = new AccountSessionSlot();
        slot.setOrgId(orgId);
        slot.setSellerAccountId(sellerAccountId);
        slot.setChannelId(channelId);
        slot.setAccountSlot(newAccountSlot());
        slot.setReadinessState(SessionReadinessState.UNOBSERVED_EXTERNAL);
        try {
            return slots.save(slot);
        } catch (DataIntegrityViolationException race) {
            // A concurrent resolve for the same account won the unique index. The slot now exists; use it.
            return slots.findBySellerAccountId(sellerAccountId).orElseThrow(() -> race);
        }
    }

    /**
     * A fresh opaque 24-hex slot. 12 random bytes from a CSPRNG — longer than a per-run launch ref because
     * this key is long-lived and reused, and it must be both unguessable and one-way (not reversible to the
     * seller-account id it stands in for).
     */
    static String newAccountSlot() {
        byte[] bytes = new byte[12];
        RANDOM.nextBytes(bytes);
        return HexFormat.of().formatHex(bytes);
    }
}
