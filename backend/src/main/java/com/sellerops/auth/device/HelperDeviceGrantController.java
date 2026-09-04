package com.sellerops.auth.device;

import jakarta.validation.constraints.NotBlank;
import java.time.Instant;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * The public half of the device grant (permitAll under {@code /api/auth/**}) — the two calls a helper makes
 * before it has any credential. Shapes follow RFC 8628 so the helper's client is ordinary: {@code code} issues
 * {@code device_code}/{@code user_code}, {@code token} polls and answers {@code authorization_pending} /
 * {@code expired_token} / {@code access_denied} as 400s with an {@code error} field, or the token once.
 */
@RestController
@RequestMapping("/api/auth/device")
public class HelperDeviceGrantController {

    public record CodeRequest(@NotBlank String deviceName, String helperVersion) {}

    public record CodeResponse(String deviceCode, String userCode, Instant expiresAt, int interval) {}

    public record TokenRequest(@NotBlank String deviceCode) {}

    public record TokenResponse(String token, Instant expiresAt) {}

    public record TokenPending(String error) {}

    private final HelperDeviceService service;

    public HelperDeviceGrantController(HelperDeviceService service) {
        this.service = service;
    }

    @PostMapping("/code")
    public CodeResponse code(@RequestBody @jakarta.validation.Valid CodeRequest request) {
        HelperDeviceService.Started s = service.start(request.deviceName(), request.helperVersion());
        return new CodeResponse(s.deviceCode(), s.userCode(), s.expiresAt(), s.intervalSeconds());
    }

    @PostMapping("/token")
    public ResponseEntity<?> token(@RequestBody @jakarta.validation.Valid TokenRequest request) {
        HelperDeviceService.Verdict v = service.redeem(request.deviceCode());
        return switch (v.outcome()) {
            case APPROVED -> ResponseEntity.ok(new TokenResponse(v.redeemed().token(), v.redeemed().expiresAt()));
            case AUTHORIZATION_PENDING -> ResponseEntity.status(HttpStatus.BAD_REQUEST)
                    .body(new TokenPending("authorization_pending"));
            case EXPIRED_TOKEN -> ResponseEntity.status(HttpStatus.BAD_REQUEST).body(new TokenPending("expired_token"));
            case ACCESS_DENIED -> ResponseEntity.status(HttpStatus.BAD_REQUEST).body(new TokenPending("access_denied"));
        };
    }
}
