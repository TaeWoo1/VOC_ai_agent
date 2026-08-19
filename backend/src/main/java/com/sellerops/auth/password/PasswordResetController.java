package com.sellerops.auth.password;

import com.sellerops.auth.password.dto.ForgotPasswordRequest;
import com.sellerops.auth.password.dto.PasswordResetConfigView;
import com.sellerops.auth.password.dto.ResetPasswordRequest;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** `/api/auth/password/*` — public (docs/service_readiness_v1.md §3). */
@RestController
@RequestMapping("/api/auth/password")
public class PasswordResetController {

    private final PasswordResetService service;

    public PasswordResetController(PasswordResetService service) {
        this.service = service;
    }

    /** Whether the reset entry should exist on the login page at all, and whether mails go to the dev outbox. */
    @GetMapping("/config")
    public PasswordResetConfigView config() {
        return new PasswordResetConfigView(service.enabled(), service.devOutbox());
    }

    /** Always 202 with no body — nothing about the address is answered. */
    @PostMapping("/forgot")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public void forgot(@Valid @RequestBody ForgotPasswordRequest request) {
        service.requestReset(request.email());
    }

    @PostMapping("/reset")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void reset(@Valid @RequestBody ResetPasswordRequest request) {
        service.reset(request.token(), request.newPassword());
    }
}
