package com.sellerops.auth.device;

import com.sellerops.auth.AuthPrincipal;
import com.sellerops.common.ApiException;
import com.sellerops.user.User;
import com.sellerops.user.UserRepository;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.regex.Pattern;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Helper Device Authentication v1 — the device grant on top of the existing session
 * (docs/helper_device_authentication_v1.md).
 *
 * <p>Three moves and one lookup: a helper {@link #start starts} a grant (no credential — it is a public client
 * on the seller's own machine), the seller's browser session {@link #approve approves} the user code, the helper
 * {@link #redeem redeems} the device code for an opaque token, and from then on every helper request is one
 * {@link #authenticate lookup} by hash. There is no refresh token: the token is looked up on every request, so
 * revocation is immediate and rotation would add a second secret with nothing to buy.
 */
@Service
public class HelperDeviceService {

    /** A linked helper stays linked this long without re-approval; 「다시 연결」 is one press, not a password. */
    public static final Duration TOKEN_LIFETIME = Duration.ofDays(180);
    /** How often {@code last_used_at} is written — a run of many uploads is one write, not many. */
    static final Duration TOUCH_INTERVAL = Duration.ofMinutes(1);
    private static final Pattern DEVICE_NAME = Pattern.compile("[A-Za-z0-9 ._()\\-]{1,80}");
    private static final Pattern VERSION = Pattern.compile("[A-Za-z0-9._\\-]{1,40}");

    public record Started(String deviceCode, String userCode, Instant expiresAt, int intervalSeconds) {}

    public record Redeemed(String token, Instant expiresAt) {}

    public record Verdict(HelperDeviceGrants.PollOutcome outcome, Redeemed redeemed) {}

    /** What the filter learns from a token: whom the helper acts as, and which row it is. */
    public record Authenticated(AuthPrincipal principal, UUID deviceId) {}

    private final HelperDeviceGrants grants;
    private final HelperDeviceRepository devices;
    private final UserRepository users;
    private final Clock clock;

    @org.springframework.beans.factory.annotation.Autowired
    public HelperDeviceService(HelperDeviceGrants grants, HelperDeviceRepository devices, UserRepository users) {
        this(grants, devices, users, Clock.systemUTC());
    }

    HelperDeviceService(HelperDeviceGrants grants, HelperDeviceRepository devices, UserRepository users,
                        Clock clock) {
        this.grants = grants;
        this.devices = devices;
        this.users = users;
        this.clock = clock;
    }

    public Started start(String deviceName, String helperVersion) {
        String name = deviceName == null ? "" : deviceName.trim();
        if (!DEVICE_NAME.matcher(name).matches()) {
            throw ApiException.badRequest("기기 이름이 올바르지 않습니다.");
        }
        String version = helperVersion == null ? null : helperVersion.trim();
        if (version != null && !VERSION.matcher(version).matches()) {
            throw ApiException.badRequest("도우미 버전이 올바르지 않습니다.");
        }
        HelperDeviceGrants.Issued issued = grants.issue(name, version)
                .orElseThrow(() -> new ApiException(org.springframework.http.HttpStatus.SERVICE_UNAVAILABLE,
                        "지금은 연결 요청이 많습니다. 잠시 후 다시 시도해 주세요."));
        return new Started(issued.deviceCode(), issued.userCode(), issued.expiresAt(), issued.intervalSeconds());
    }

    /** The seller's session is the approval; the code names which pending helper. */
    public void approve(AuthPrincipal principal, String userCode) {
        if (!grants.approve(userCode, principal.orgId(), principal.userId())) {
            throw ApiException.notFound("연결 요청을 찾지 못했습니다. 도우미에서 다시 시도해 주세요.");
        }
    }

    @Transactional
    public Verdict redeem(String deviceCode) {
        HelperDeviceGrants.Poll poll = grants.poll(deviceCode == null ? "" : deviceCode);
        if (poll.outcome() != HelperDeviceGrants.PollOutcome.APPROVED) {
            return new Verdict(poll.outcome(), null);
        }
        Instant now = clock.instant();
        String token = HelperDeviceTokens.mint();
        HelperDevice device = new HelperDevice();
        device.setOrgId(poll.orgId());
        device.setUserId(poll.userId());
        device.setTokenHash(HelperDeviceTokens.hash(token));
        device.setDeviceName(poll.deviceName());
        device.setHelperVersion(poll.helperVersion());
        device.setExpiresAt(now.plus(TOKEN_LIFETIME));
        device.setLastUsedAt(null);
        devices.save(device);
        return new Verdict(poll.outcome(), new Redeemed(token, device.getExpiresAt()));
    }

    /**
     * One lookup per request. Empty for unknown, revoked, expired, or a user that no longer exists — the filter
     * treats every empty the same way (401, no fallback), so this method never says why.
     */
    @Transactional
    public Optional<Authenticated> authenticate(String token) {
        if (!HelperDeviceTokens.looksLikeDeviceToken(token)) return Optional.empty();
        Instant now = clock.instant();
        Optional<HelperDevice> found = devices.findByTokenHash(HelperDeviceTokens.hash(token));
        if (found.isEmpty() || !found.get().isActive(now)) return Optional.empty();
        HelperDevice device = found.get();
        Optional<User> user = users.findById(device.getUserId());
        if (user.isEmpty() || !user.get().getOrgId().equals(device.getOrgId())) return Optional.empty();
        if (device.getLastUsedAt() == null || device.getLastUsedAt().plus(TOUCH_INTERVAL).isBefore(now)) {
            devices.touch(device.getId(), now);
        }
        return Optional.of(new Authenticated(
                new AuthPrincipal(device.getUserId(), device.getOrgId(), user.get().getEmail()), device.getId()));
    }

    @Transactional(readOnly = true)
    public List<HelperDeviceView> list(UUID orgId) {
        Instant now = clock.instant();
        return devices.findByOrgIdAndRevokedAtIsNullOrderByCreatedAtDesc(orgId).stream()
                .filter(d -> d.isActive(now))
                .map(HelperDeviceView::of)
                .toList();
    }

    @Transactional(readOnly = true)
    public HelperDeviceView view(UUID orgId, UUID deviceId) {
        return devices.findByIdAndOrgId(deviceId, orgId).map(HelperDeviceView::of)
                .orElseThrow(() -> ApiException.notFound("연결된 기기를 찾지 못했습니다."));
    }

    /** Idempotent: revoking a revoked device is not an error the seller can act on. */
    @Transactional
    public void revoke(UUID orgId, UUID deviceId) {
        HelperDevice device = devices.findByIdAndOrgId(deviceId, orgId)
                .orElseThrow(() -> ApiException.notFound("연결된 기기를 찾지 못했습니다."));
        if (device.getRevokedAt() == null) {
            device.setRevokedAt(clock.instant());
            devices.save(device);
        }
    }
}
