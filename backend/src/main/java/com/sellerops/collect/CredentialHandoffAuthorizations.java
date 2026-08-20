package com.sellerops.collect;

import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.HexFormat;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;
import org.springframework.stereotype.Component;

/**
 * **The seller-grade half of the credential-handoff interlock: one authorization, issued to one seller, for one
 * account, on one run, used once.**
 *
 * <h2>Why this exists beside {@link CredentialHandoffArming}</h2>
 *
 * The arming beside it is an OPERATOR interlock: four environment tokens injected at boot, checked against what
 * the agent's own run env carries. It is exactly right for a seated live proof and structurally unusable by a
 * seller — arming it means setting environment variables and restarting the backend, which is not a thing a
 * seller does, and a product flow that needed it would have to invent a way to arm it from a web request. That
 * invention is the thing this class exists to avoid: a seller-triggered path into an operator's interlock would
 * be a way to arm the operator's grant from the network.
 *
 * <p>So the product path gets its own, and it is bound to MORE than the operator one, not less. The arming knows
 * which run and which commit were approved; it knows nothing about who is asking, which organisation they belong
 * to, or which seller account the credential is for. This knows all of that, and refuses on any of it.
 *
 * <h2>What an authorization is bound to</h2>
 *
 * <ol>
 *   <li><b>The authenticated caller.</b> Org AND user, both from the JWT at issue time and both re-checked at
 *       use. A second seller in the same organisation cannot spend another's authorization.</li>
 *   <li><b>The seller account.</b> Resolved server-side from the opaque slot before the authorization exists, so
 *       an authorization can never be pointed at a different account afterwards.</li>
 *   <li><b>The channel.</b> Coupang here, checked again by the service against the account's real channel.</li>
 *   <li><b>The run.</b> The Action Window issuance run the seller is actually in. A handoff belongs to the walk
 *       that produced the key; a different run — even the same seller, the same account, minutes later — is a
 *       different sitting and needs its own authorization.</li>
 *   <li><b>A short life.</b> {@link #TTL}. Long enough to press a barrier and read a screen, short enough that
 *       an authorization left behind is not a standing permission.</li>
 *   <li><b>One use.</b> Claimed atomically immediately before the store, exactly as the operator arming is, and
 *       never returned by a failed verification.</li>
 * </ol>
 *
 * <h2>It is a capability, and it is treated like one</h2>
 *
 * The id is the thing the agent presents, so it is minted from {@link SecureRandom}, compared whole, and never
 * logged — only its refusal reason is. It is NOT a bearer for anything else: it authorizes exactly one endpoint
 * for exactly one stored credential, and every other check in {@link AgentCredentialHandoffService} still runs
 * after it. An authorization that resolved but whose account already holds a credential is still refused.
 *
 * <p>In memory by construction, like the arming: a restarted backend has issued nothing. With a five-minute TTL
 * that is not a limitation worth a table — a seller whose backend restarted mid-handoff re-presses the barrier.
 */
@Component
public class CredentialHandoffAuthorizations {

    /**
     * How long an authorization stays usable. The seller presses a barrier, the agent reads one screen, and the
     * request goes out — that is seconds of work. Five minutes is slack for a person reading the disclosure,
     * not a window for a credential to be handed over later by something else.
     */
    public static final Duration TTL = Duration.ofMinutes(5);

    /**
     * Cap on simultaneously-live authorizations. One live authorization is one seller mid-handoff, so more than
     * a handful at once is already abnormal for a deployment of this size; the cap is what keeps a caller that
     * asks in a loop from growing this map without bound. Refusing a NEW authorization is visible and
     * self-healing as the TTL drains, and it never touches one already issued.
     */
    static final int MAX_LIVE = 64;

    /** Safe reason codes — they travel to the agent and into the record. None is derived from a secret. */
    public static final String REASON_ABSENT = "HANDOFF_AUTHORIZATION_ABSENT";
    public static final String REASON_UNKNOWN = "HANDOFF_AUTHORIZATION_UNKNOWN";
    public static final String REASON_EXPIRED = "HANDOFF_AUTHORIZATION_EXPIRED";
    public static final String REASON_CONSUMED = "HANDOFF_AUTHORIZATION_CONSUMED";
    public static final String REASON_MISMATCH = "HANDOFF_AUTHORIZATION_MISMATCH";
    public static final String REASON_AT_CAPACITY = "HANDOFF_AUTHORIZATION_AT_CAPACITY";

    private static final int ID_BYTES = 16;

    /**
     * **The raw capability is never stored.** The map is keyed by the SHA-256 of the id, exactly as the pairing
     * registry keeps only a token hash: a heap dump, a debugger, or a future `toString` on this component can
     * then reveal which authorizations exist and for whom, but not the value that spends them. The id itself
     * exists in the issue response, in the browser that asked for it, and in the one request that presents it.
     *
     * <p>It is not a password — there is no user-chosen entropy to protect and no offline attack to slow down —
     * so a plain digest is the right primitive and a KDF would be cargo. What it buys is precisely that the
     * server does not hold a spendable copy of every live capability.
     */
    private static String digest(String raw) {
        try {
            byte[] out = MessageDigest.getInstance("SHA-256").digest(raw.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(out);
        } catch (NoSuchAlgorithmException e) {
            // SHA-256 is mandated by the platform; if it is absent this process cannot safely hold capabilities.
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }

    /** Normalize then hash. A presented id is compared only as a digest, never as text. */
    private static String keyFor(String authorizationId) {
        return digest(authorizationId.trim().toLowerCase(Locale.ROOT));
    }

    private final Map<String, Entry> live = new ConcurrentHashMap<>();
    private final SecureRandom random;
    private final Clock clock;

    public CredentialHandoffAuthorizations() {
        this(new SecureRandom(), Clock.systemUTC());
    }

    /** Test seam: injected randomness and clock, so expiry and collision behaviour are actually exercisable. */
    CredentialHandoffAuthorizations(SecureRandom random, Clock clock) {
        this.random = random;
        this.clock = clock;
    }

    /**
     * What an authorization is for. Every field is an identity or a code — there is no secret in here, which is
     * why this record is safe to compare, hold, and (except the id, which is a capability) print.
     */
    record Binding(UUID orgId, UUID userId, UUID sellerAccountId, String channelCode, String runId) {

        boolean matches(Binding other) {
            return other != null
                    && orgId.equals(other.orgId)
                    && userId.equals(other.userId)
                    && sellerAccountId.equals(other.sellerAccountId)
                    && channelCode.equals(other.channelCode)
                    && runId.equals(other.runId);
        }
    }

    private static final class Entry {
        private final Binding binding;
        private final Instant expiresAt;
        private final AtomicBoolean consumed = new AtomicBoolean(false);

        private Entry(Binding binding, Instant expiresAt) {
            this.binding = binding;
            this.expiresAt = expiresAt;
        }
    }

    /**
     * Issue an authorization for exactly this seller, account, channel and run.
     *
     * <p>The caller has already resolved the account inside the org and guarded the channel — this does not
     * re-derive either, because a second place that decides which account an authorization is for is a second
     * place that can decide wrongly. It binds what it is given and mints the capability.
     *
     * @return the opaque id the agent presents, or {@code null} when the cap is reached (nothing is issued).
     */
    public String issue(Binding binding) {
        sweep();
        if (live.size() >= MAX_LIVE) {
            return null;
        }
        byte[] raw = new byte[ID_BYTES];
        random.nextBytes(raw);
        String id = HexFormat.of().formatHex(raw);
        // The DIGEST is the key. `id` is returned to the caller and then forgotten by this component.
        live.put(digest(id), new Entry(binding, clock.instant().plus(TTL)));
        return id;
    }

    /**
     * Why this authorization may not be spent on this request, or {@code null} when it may.
     *
     * <p>Read-only: the one-shot is CHECKED here and CLAIMED in {@link #claim(String)}, immediately before the
     * store it authorizes — the same ordering the operator arming uses, and for the same reason. Checking and
     * acting later is a window, and this is the one path where that window costs a second credential.
     *
     * <p>An unknown id and an id belonging to someone else give DIFFERENT reasons on purpose: neither reveals
     * anything a caller does not already hold (they presented the id), and telling them apart is what lets an
     * operator distinguish "expired, press again" from "this is not your authorization".
     */
    public String refusalFor(String authorizationId, Binding presented) {
        if (authorizationId == null || authorizationId.isBlank()) {
            return REASON_ABSENT;
        }
        Entry entry = live.get(keyFor(authorizationId));
        if (entry == null) {
            return REASON_UNKNOWN;
        }
        if (clock.instant().isAfter(entry.expiresAt)) {
            return REASON_EXPIRED;
        }
        if (entry.consumed.get()) {
            return REASON_CONSUMED;
        }
        if (!entry.binding.matches(presented)) {
            return REASON_MISMATCH;
        }
        return null;
    }

    /**
     * **The half of the check that needs no seller account** — existence, freshness, one-shot, and that the
     * CALLER is the seller it was issued to.
     *
     * <p>Split out so the service can keep its fail-closed order intact. Its interlock runs before the slot is
     * resolved precisely so an unauthorized caller cannot learn whether a slot exists — but a seller
     * authorization is bound to the ACCOUNT, which is only known after that resolution. Asking the
     * caller-shaped half first preserves the original property: an unknown, expired, spent or foreign
     * authorization is refused with nothing about the seller's data having been touched.
     */
    public String refusalForCaller(String authorizationId, UUID orgId, UUID userId) {
        if (authorizationId == null || authorizationId.isBlank()) {
            return REASON_ABSENT;
        }
        Entry entry = live.get(keyFor(authorizationId));
        if (entry == null) {
            return REASON_UNKNOWN;
        }
        if (clock.instant().isAfter(entry.expiresAt)) {
            return REASON_EXPIRED;
        }
        if (entry.consumed.get()) {
            return REASON_CONSUMED;
        }
        if (!entry.binding.orgId().equals(orgId) || !entry.binding.userId().equals(userId)) {
            return REASON_MISMATCH;
        }
        return null;
    }

    /**
     * The binding behind a LIVE, unspent authorization — what the capability filter needs to know who is
     * calling, and nothing more. Absent for an id that is unknown, expired or already spent, so a filter built
     * on this cannot authenticate a request that the interlock is going to refuse anyway.
     *
     * <p>Read-only: it neither claims nor extends anything. The one-shot is still spent at the store.
     */
    Binding liveBindingOf(String authorizationId) {
        if (authorizationId == null || authorizationId.isBlank()) {
            return null;
        }
        Entry entry = live.get(keyFor(authorizationId));
        if (entry == null || clock.instant().isAfter(entry.expiresAt) || entry.consumed.get()) {
            return null;
        }
        return entry.binding;
    }

    /**
     * **Claim it, atomically.** Called immediately BEFORE the store it authorizes, never after. Returns whether
     * THIS call was the one that claimed it; a caller that ignores the result has put back the race this method
     * exists to remove.
     */
    public boolean claim(String authorizationId) {
        Entry entry = authorizationId == null || authorizationId.isBlank() ? null : live.get(keyFor(authorizationId));
        return entry != null && entry.consumed.compareAndSet(false, true);
    }

    /**
     * Hand a CLAIMED authorization back, for the one case that justifies it: the store it was claimed for threw,
     * so nothing was stored and the seller's one handoff was never actually spent.
     *
     * <p>Deliberately narrow, and package-private — it is not "undo", and it must never become reachable from a
     * path where a credential might have been written.
     */
    void releaseUnusedClaim(String authorizationId) {
        Entry entry = authorizationId == null || authorizationId.isBlank() ? null : live.get(keyFor(authorizationId));
        if (entry != null) {
            entry.consumed.set(false);
        }
    }

    /** Drop what has aged out. Bounded cleanup, run opportunistically before every issue. */
    private void sweep() {
        Instant now = clock.instant();
        live.entrySet().removeIf(e -> now.isAfter(e.getValue().expiresAt));
    }

    /** Live count — for tests and for a capacity refusal that can say what it refused on. Never the ids. */
    int liveCount() {
        sweep();
        return live.size();
    }
}
