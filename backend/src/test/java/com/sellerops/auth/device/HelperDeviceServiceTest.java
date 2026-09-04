package com.sellerops.auth.device;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.sellerops.auth.AuthPrincipal;
import com.sellerops.common.ApiException;
import com.sellerops.user.User;
import com.sellerops.user.UserRepository;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

/** Start → approve → redeem → authenticate → revoke, with the row holding a hash and never the token. */
class HelperDeviceServiceTest {

    private static final class MutableClock extends Clock {
        Instant now = Instant.parse("2026-09-05T00:00:00Z");
        @Override public java.time.ZoneId getZone() { return ZoneOffset.UTC; }
        @Override public Clock withZone(java.time.ZoneId zone) { return this; }
        @Override public Instant instant() { return now; }
    }

    private final MutableClock clock = new MutableClock();
    private final HelperDeviceRepository devices = mock(HelperDeviceRepository.class);
    private final UserRepository users = mock(UserRepository.class);
    private final HelperDeviceService service =
            new HelperDeviceService(new HelperDeviceGrants(clock), devices, users, clock);
    private final UUID org = UUID.randomUUID();
    private final UUID userId = UUID.randomUUID();
    private final AuthPrincipal seller = new AuthPrincipal(userId, org, "seller@example.invalid");
    private final AtomicReference<HelperDevice> stored = new AtomicReference<>();

    @BeforeEach
    void wire() {
        when(devices.save(any())).thenAnswer(inv -> {
            HelperDevice d = inv.getArgument(0);
            stored.set(d);
            return d;
        });
        when(devices.findByTokenHash(any())).thenAnswer(inv ->
                Optional.ofNullable(stored.get()).filter(d -> d.getTokenHash().equals(inv.getArgument(0))));
        User user = new User();
        user.setOrgId(org);
        user.setEmail("seller@example.invalid");
        when(users.findById(userId)).thenReturn(Optional.of(user));
    }

    private String linkedToken() {
        var started = service.start("Mac (arm64)", "0.2.0");
        assertThat(service.redeem(started.deviceCode()).outcome())
                .isEqualTo(HelperDeviceGrants.PollOutcome.AUTHORIZATION_PENDING);
        service.approve(seller, started.userCode());
        var verdict = service.redeem(started.deviceCode());
        assertThat(verdict.outcome()).isEqualTo(HelperDeviceGrants.PollOutcome.APPROVED);
        return verdict.redeemed().token();
    }

    @Test
    void theRowKeepsAHashAndTheTokenOpensTheSellersIdentity() {
        String token = linkedToken();
        assertThat(token).startsWith(HelperDeviceTokens.PREFIX);
        HelperDevice row = stored.get();
        assertThat(row.getTokenHash()).isEqualTo(HelperDeviceTokens.hash(token)).isNotEqualTo(token).hasSize(64);
        assertThat(row.getOrgId()).isEqualTo(org);
        assertThat(row.getUserId()).isEqualTo(userId);
        assertThat(row.getDeviceName()).isEqualTo("Mac (arm64)");
        assertThat(row.getExpiresAt()).isEqualTo(clock.now.plus(HelperDeviceService.TOKEN_LIFETIME));

        var auth = service.authenticate(token).orElseThrow();
        assertThat(auth.principal()).isEqualTo(seller);
        assertThat(service.authenticate("rvh_something-else")).isEmpty();
        assertThat(service.authenticate("not-a-device-token")).isEmpty();
    }

    @Test
    void approveNeedsAPendingCodeAndTheSameCodeCannotBeApprovedTwice() {
        assertThatThrownBy(() -> service.approve(seller, "ZZZZZZZZ")).isInstanceOf(ApiException.class);
        var started = service.start("Mac", null);
        service.approve(seller, started.userCode());
        assertThatThrownBy(() -> service.approve(seller, started.userCode())).isInstanceOf(ApiException.class);
    }

    @Test
    void aRevokedOrExpiredTokenAuthenticatesNothing() {
        String token = linkedToken();
        HelperDevice row = stored.get();
        row.setRevokedAt(clock.now);
        assertThat(service.authenticate(token)).isEmpty();
        row.setRevokedAt(null);
        clock.now = row.getExpiresAt().plus(Duration.ofSeconds(1));
        assertThat(service.authenticate(token)).isEmpty();
    }

    @Test
    void useIsRecordedAtMostOnceAMinute() {
        String token = linkedToken();
        HelperDevice row = stored.get();
        row.setLastUsedAt(null);
        service.authenticate(token);
        row.setLastUsedAt(clock.now);
        clock.now = clock.now.plus(Duration.ofSeconds(30));
        service.authenticate(token);
        verify(devices, times(1)).touch(any(), any());
        clock.now = clock.now.plus(Duration.ofSeconds(31));
        service.authenticate(token);
        verify(devices, times(2)).touch(any(), any());
    }

    @Test
    void aDeviceNameOutsideTheClosedShapeIsRefusedBeforeAnyGrantExists() {
        assertThatThrownBy(() -> service.start("Mac <script>", null)).isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> service.start("", null)).isInstanceOf(ApiException.class);
        verify(devices, never()).save(any());
        ArgumentCaptor<HelperDevice> none = ArgumentCaptor.forClass(HelperDevice.class);
        verify(devices, never()).save(none.capture());
    }
}
