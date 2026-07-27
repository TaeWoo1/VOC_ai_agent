package com.sellerops.selleraccount;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

/**
 * The wire-parsing must fail CLOSED: an unrecognized session-readiness value is rejected, never quietly
 * mapped to a usable state. A malformed report must not be readable as "the session is fine".
 */
class SessionWireParsingTest {

    @Test
    void parsesEveryKnownReadinessState() {
        for (SessionReadinessState s : SessionReadinessState.values()) {
            assertThat(SessionReadinessState.fromWire(s.name())).isEqualTo(s);
        }
    }

    @Test
    void failsClosedOnUnknownOrNullReadinessState() {
        assertThatThrownBy(() -> SessionReadinessState.fromWire("USABLE"))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> SessionReadinessState.fromWire(null))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void parsesEveryKnownProbeReason() {
        for (SessionProbeReason r : SessionProbeReason.values()) {
            assertThat(SessionProbeReason.fromWire(r.name())).isEqualTo(r);
        }
    }

    @Test
    void failsClosedOnUnknownOrNullProbeReason() {
        assertThatThrownBy(() -> SessionProbeReason.fromWire("WHENEVER"))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> SessionProbeReason.fromWire(null))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
