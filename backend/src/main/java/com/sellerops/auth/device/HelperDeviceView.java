package com.sellerops.auth.device;

import java.time.Instant;
import java.util.UUID;

/** A linked helper as 설정 › 연결된 기기 shows it. No hash, no token, no user email. */
public record HelperDeviceView(UUID id, String deviceName, String helperVersion, Instant linkedAt,
                               Instant lastUsedAt, Instant expiresAt) {

    static HelperDeviceView of(HelperDevice d) {
        return new HelperDeviceView(d.getId(), d.getDeviceName(), d.getHelperVersion(), d.getCreatedAt(),
                d.getLastUsedAt(), d.getExpiresAt());
    }
}
