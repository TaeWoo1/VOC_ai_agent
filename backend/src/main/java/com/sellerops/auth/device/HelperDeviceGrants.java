package com.sellerops.auth.device;

import com.sellerops.auth.social.AuthCodes;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.stereotype.Component;

/**
 * **Pending device grants — the RFC 8628 "device code" half, in memory.**
 *
 * <p>A helper asks for a grant and gets two codes: the {@code deviceCode} it polls with (32 random bytes —
 * unguessable, the helper's own secret) and the {@code userCode} the browser approves (short; the approving
 * request is authenticated with the seller's session, so guessing one only ever binds a stranger's pending
 * helper to the guesser's OWN account — and the cap below bounds how many are ever pending). Both are kept
 * hashed, like every one-time code in this service ({@link AuthCodes}).
 *
 * <p>In memory by construction, like {@code CredentialHandoffAuthorizations}: a grant lives five minutes and
 * a backend restart mid-link costs the seller one more press of 「이 기기 연결」. The pilot topology is one
 * backend process; a second instance would need this in a table, and that is the whole change.
 */
@Component
public class HelperDeviceGrants {

    public static final Duration TTL = Duration.ofMinutes(5);
    /** Seconds the helper is told to wait between polls (RFC 8628 {@code interval}). */
    public static final int POLL_INTERVAL_SECONDS = 3;
    /** Concurrent pending grants across the whole deployment — the human-consent capacity, not a rate limit. */
    public static final int MAX_PENDING = 100;
    /** Unambiguous alphabet, 8 characters: the browser carries it, a person never has to type it (but could). */
    private static final char[] USER_CODE_ALPHABET = "BCDFGHJKLMNPQRSTVWXZ23456789".toCharArray();
    private static final int USER_CODE_LENGTH = 8;

    public enum Status { PENDING, APPROVED, DENIED }

    /** The grant as issued to a helper. The codes appear exactly once, here. */
    public record Issued(String deviceCode, String userCode, Instant expiresAt, int intervalSeconds) {}

    /** What a poll learns. */
    public enum PollOutcome { AUTHORIZATION_PENDING, EXPIRED_TOKEN, ACCESS_DENIED, APPROVED }

    public record Poll(PollOutcome outcome, UUID orgId, UUID userId, String deviceName, String helperVersion) {}

    static final class Grant {
        final String userCodeHash;
        final Instant expiresAt;
        final String deviceName;
        final String helperVersion;
        Status status = Status.PENDING;
        UUID orgId;
        UUID userId;

        Grant(String userCodeHash, Instant expiresAt, String deviceName, String helperVersion) {
            this.userCodeHash = userCodeHash;
            this.expiresAt = expiresAt;
            this.deviceName = deviceName;
            this.helperVersion = helperVersion;
        }
    }

    private final Clock clock;
    private final SecureRandom random = new SecureRandom();
    /** deviceCodeHash → grant. */
    private final Map<String, Grant> byDeviceCode = new HashMap<>();
    /** userCodeHash → deviceCodeHash. */
    private final Map<String, String> byUserCode = new HashMap<>();

    @org.springframework.beans.factory.annotation.Autowired
    public HelperDeviceGrants() {
        this(Clock.systemUTC());
    }

    HelperDeviceGrants(Clock clock) {
        this.clock = clock;
    }

    /** Returns empty when the deployment already holds {@link #MAX_PENDING} live grants. */
    public synchronized Optional<Issued> issue(String deviceName, String helperVersion) {
        Instant now = clock.instant();
        sweep(now);
        if (byDeviceCode.size() >= MAX_PENDING) return Optional.empty();
        String deviceCode = AuthCodes.newCode();
        String userCode;
        do {
            userCode = newUserCode();
        } while (byUserCode.containsKey(AuthCodes.hash(userCode)));
        Instant expiresAt = now.plus(TTL);
        Grant grant = new Grant(AuthCodes.hash(userCode), expiresAt, deviceName, helperVersion);
        byDeviceCode.put(AuthCodes.hash(deviceCode), grant);
        byUserCode.put(grant.userCodeHash, AuthCodes.hash(deviceCode));
        return Optional.of(new Issued(deviceCode, userCode, expiresAt, POLL_INTERVAL_SECONDS));
    }

    /** The seller's session binds a pending grant to itself. False when the code is unknown, spent or expired. */
    public synchronized boolean approve(String userCode, UUID orgId, UUID userId) {
        Instant now = clock.instant();
        sweep(now);
        String deviceCodeHash = byUserCode.get(AuthCodes.hash(normalizeUserCode(userCode)));
        if (deviceCodeHash == null) return false;
        Grant grant = byDeviceCode.get(deviceCodeHash);
        if (grant == null || grant.status != Status.PENDING) return false;
        grant.status = Status.APPROVED;
        grant.orgId = orgId;
        grant.userId = userId;
        return true;
    }

    /**
     * The helper polls. An approved grant is handed over exactly once — it is removed here, so a second poll
     * with the same device code is {@code EXPIRED_TOKEN}, never a second token.
     */
    public synchronized Poll poll(String deviceCode) {
        Instant now = clock.instant();
        sweep(now);
        String hash = AuthCodes.hash(deviceCode);
        Grant grant = byDeviceCode.get(hash);
        if (grant == null) return new Poll(PollOutcome.EXPIRED_TOKEN, null, null, null, null);
        switch (grant.status) {
            case PENDING:
                return new Poll(PollOutcome.AUTHORIZATION_PENDING, null, null, null, null);
            case DENIED:
                remove(hash, grant);
                return new Poll(PollOutcome.ACCESS_DENIED, null, null, null, null);
            default:
                remove(hash, grant);
                return new Poll(PollOutcome.APPROVED, grant.orgId, grant.userId, grant.deviceName,
                        grant.helperVersion);
        }
    }

    public synchronized int pendingCount() {
        sweep(clock.instant());
        return byDeviceCode.size();
    }

    /** Case- and separator-insensitive: 「BCDF-GHJK」 and 「bcdfghjk」 are the same code. */
    public static String normalizeUserCode(String raw) {
        return raw == null ? "" : raw.replaceAll("[\\s-]", "").toUpperCase();
    }

    private String newUserCode() {
        StringBuilder sb = new StringBuilder(USER_CODE_LENGTH);
        for (int i = 0; i < USER_CODE_LENGTH; i++) {
            sb.append(USER_CODE_ALPHABET[random.nextInt(USER_CODE_ALPHABET.length)]);
        }
        return sb.toString();
    }

    private void remove(String deviceCodeHash, Grant grant) {
        byDeviceCode.remove(deviceCodeHash);
        byUserCode.remove(grant.userCodeHash);
    }

    private void sweep(Instant now) {
        Iterator<Map.Entry<String, Grant>> it = byDeviceCode.entrySet().iterator();
        while (it.hasNext()) {
            Map.Entry<String, Grant> e = it.next();
            if (!e.getValue().expiresAt.isAfter(now)) {
                byUserCode.remove(e.getValue().userCodeHash);
                it.remove();
            }
        }
    }
}
