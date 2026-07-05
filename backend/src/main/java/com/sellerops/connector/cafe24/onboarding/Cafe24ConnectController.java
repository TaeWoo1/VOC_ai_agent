package com.sellerops.connector.cafe24.onboarding;

import com.sellerops.auth.AuthPrincipal;
import com.sellerops.connector.cafe24.onboarding.Cafe24OnboardingService.CompletionResult;
import com.sellerops.connector.cafe24.onboarding.Cafe24OnboardingService.StartResult;
import com.sellerops.connector.cafe24.onboarding.dto.Cafe24ConnectStartRequest;
import com.sellerops.connector.cafe24.onboarding.dto.Cafe24ConnectStartResponse;
import jakarta.validation.Valid;
import java.net.URI;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.util.UriComponentsBuilder;

/**
 * The "Connect Cafe24" endpoints. Present only behind {@code
 * sellerops.connector.cafe24.enabled=true} (flag off ⇒ 404).
 *
 * <ul>
 *   <li>{@code POST /api/connect/cafe24/start} — authenticated. Returns the Cafe24
 *       consent URL the frontend redirects the browser to.</li>
 *   <li>{@code GET /api/connect/cafe24/callback} — the Cafe24 redirect target; NOT
 *       JWT-authenticated (it is a top-level browser navigation), so identity is
 *       recovered entirely from the single-use, tenant-bound {@code state}. Always
 *       302-redirects to a sanitized frontend result URL — the {@code code} and any
 *       token never reach the URL, a response body, or a log.</li>
 * </ul>
 */
@RestController
@RequestMapping("/api/connect/cafe24")
@ConditionalOnProperty(name = "sellerops.connector.cafe24.enabled", havingValue = "true")
public class Cafe24ConnectController {

    private final Cafe24OnboardingService onboarding;
    private final String resultRedirectUrl;

    public Cafe24ConnectController(
            Cafe24OnboardingService onboarding,
            @Value("${sellerops.connector.cafe24.oauth.result-redirect-url:http://localhost:3000/connect/cafe24/result}")
            String resultRedirectUrl) {
        this.onboarding = onboarding;
        this.resultRedirectUrl = resultRedirectUrl;
    }

    @PostMapping("/start")
    public Cafe24ConnectStartResponse start(@AuthenticationPrincipal AuthPrincipal principal,
                                            @Valid @RequestBody Cafe24ConnectStartRequest request) {
        StartResult result = onboarding.start(principal.orgId(), principal.userId(), request.mallId());
        return new Cafe24ConnectStartResponse(
                result.sellerAccountId(), result.connectionStatus(), result.authorizationUrl());
    }

    @GetMapping("/callback")
    public ResponseEntity<Void> callback(@RequestParam(required = false) String code,
                                         @RequestParam(required = false) String state,
                                         @RequestParam(required = false) String error) {
        CompletionResult result = onboarding.complete(state, code, error);
        UriComponentsBuilder location = UriComponentsBuilder.fromUriString(resultRedirectUrl)
                .queryParam("status", result.status().name().toLowerCase());
        if (result.sellerAccountId() != null) {
            location.queryParam("accountId", result.sellerAccountId());
        }
        return ResponseEntity.status(HttpStatus.FOUND)
                .location(URI.create(location.toUriString()))
                .build();
    }
}
