package com.sellerops.connector.coupang;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

/**
 * The backend live-run interlock. A real Coupang gateway host may be called ONLY when an approval id is
 * armed; loopback / {@code *.test} / {@code *.local} base URLs (the offline unit-test + stub shape) never
 * require one, so the offline suite is never blocked. An un-parseable base URL fails closed.
 */
class CoupangLiveCallGuardTest {

    private static final String REAL = "https://api-gateway.coupang.com";

    // --- offline hosts: exempt (no approval needed even with a blank id) ---

    @Test
    void loopbackAndTestHostsAreOfflineAndNeedNoApproval() {
        for (String offline : new String[] {
                "http://localhost:18090", "http://127.0.0.1:8080", "http://[::1]:8080",
                "https://coupang-stub.test", "https://gw.local", "http://mock.localhost:9000"}) {
            assertThat(CoupangLiveCallGuard.isOfflineHost(offline)).as(offline).isTrue();
            // Blank / null approval id is fine for an offline host — never throws.
            assertThatCode(() -> CoupangLiveCallGuard.ensureLiveCallAllowed(offline, ""))
                    .as(offline).doesNotThrowAnyException();
            assertThatCode(() -> CoupangLiveCallGuard.ensureLiveCallAllowed(offline, null))
                    .as(offline).doesNotThrowAnyException();
        }
    }

    // --- real hosts: require an armed approval id --------------------------

    @Test
    void realGatewayHostIsNotOfflineAndFailsClosedWithoutApproval() {
        assertThat(CoupangLiveCallGuard.isOfflineHost(REAL)).isFalse();
        assertThatThrownBy(() -> CoupangLiveCallGuard.ensureLiveCallAllowed(REAL, ""))
                .isInstanceOf(CoupangLiveApprovalRequiredException.class);
        assertThatThrownBy(() -> CoupangLiveCallGuard.ensureLiveCallAllowed(REAL, "   "))
                .isInstanceOf(CoupangLiveApprovalRequiredException.class);
        assertThatThrownBy(() -> CoupangLiveCallGuard.ensureLiveCallAllowed(REAL, null))
                .isInstanceOf(CoupangLiveApprovalRequiredException.class);
    }

    @Test
    void realGatewayHostWithArmedApprovalIsAllowed() {
        assertThatCode(() -> CoupangLiveCallGuard.ensureLiveCallAllowed(REAL, "apr-abc123"))
                .doesNotThrowAnyException();
    }

    @Test
    void aNonCoupangRealHostAlsoRequiresApproval() {
        // Fail-closed by default: ANY non-loopback/non-test host requires approval, so a typo'd or
        // unexpected real host can never silently open a live path.
        assertThat(CoupangLiveCallGuard.isOfflineHost("https://example.com")).isFalse();
        assertThatThrownBy(() -> CoupangLiveCallGuard.ensureLiveCallAllowed("https://example.com", ""))
                .isInstanceOf(CoupangLiveApprovalRequiredException.class);
    }

    // --- un-parseable / host-less base URLs: fail closed ------------------

    @Test
    void unparseableOrHostlessBaseUrlIsNotOfflineAndFailsClosed() {
        for (String bad : new String[] {"not a url", "", "   ", "://missing-scheme", "file:///tmp/x"}) {
            assertThat(CoupangLiveCallGuard.isOfflineHost(bad)).as(bad).isFalse();
            assertThatThrownBy(() -> CoupangLiveCallGuard.ensureLiveCallAllowed(bad, ""))
                    .as(bad).isInstanceOf(CoupangLiveApprovalRequiredException.class);
        }
    }

    @Test
    void caseInsensitiveOnHost() {
        assertThat(CoupangLiveCallGuard.isOfflineHost("http://LOCALHOST:18090")).isTrue();
        assertThat(CoupangLiveCallGuard.isOfflineHost("https://STUB.TEST")).isTrue();
    }

    // --- Self-Pilot Runtime v1: READ gate accepts the standing read grant; WRITE gate never does ---

    @Test
    void readGateOpensOnEitherPerRunApprovalOrStandingReadGrant() {
        assertThatCode(() -> CoupangLiveCallGuard.ensureLiveReadAllowed(REAL, "apr-abc123", ""))
                .doesNotThrowAnyException();
        assertThatCode(() -> CoupangLiveCallGuard.ensureLiveReadAllowed(REAL, "", "spr-0123abcd"))
                .doesNotThrowAnyException();
        assertThatCode(() -> CoupangLiveCallGuard.ensureLiveReadAllowed(REAL, null, "spr-0123abcd"))
                .doesNotThrowAnyException();
    }

    @Test
    void readGateStillFailsClosedWhenNeitherIsArmed() {
        assertThatThrownBy(() -> CoupangLiveCallGuard.ensureLiveReadAllowed(REAL, "", ""))
                .isInstanceOf(CoupangLiveApprovalRequiredException.class);
        assertThatThrownBy(() -> CoupangLiveCallGuard.ensureLiveReadAllowed(REAL, null, null))
                .isInstanceOf(CoupangLiveApprovalRequiredException.class);
        assertThatThrownBy(() -> CoupangLiveCallGuard.ensureLiveReadAllowed(REAL, "  ", "  "))
                .isInstanceOf(CoupangLiveApprovalRequiredException.class);
    }

    @Test
    void writeGateHasNoParameterForTheReadGrantAndRefusesWithoutPerRunApproval() {
        // The write gate's signature cannot even receive a read grant — the only key is the per-run id.
        assertThatThrownBy(() -> CoupangLiveCallGuard.ensureLiveWriteAllowed(REAL, ""))
                .isInstanceOf(CoupangLiveApprovalRequiredException.class);
        assertThatCode(() -> CoupangLiveCallGuard.ensureLiveWriteAllowed(REAL, "apr-abc123"))
                .doesNotThrowAnyException();
        // The legacy single gate IS the write gate.
        assertThatThrownBy(() -> CoupangLiveCallGuard.ensureLiveCallAllowed(REAL, ""))
                .isInstanceOf(CoupangLiveApprovalRequiredException.class);
    }

    @Test
    void offlineHostsNeedNeitherKeyOnTheReadGate() {
        assertThatCode(() -> CoupangLiveCallGuard.ensureLiveReadAllowed("http://127.0.0.1:18090", "", ""))
                .doesNotThrowAnyException();
    }
}
