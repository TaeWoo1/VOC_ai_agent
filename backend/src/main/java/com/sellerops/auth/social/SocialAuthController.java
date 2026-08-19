package com.sellerops.auth.social;

import com.sellerops.auth.dto.AuthResponse;
import com.sellerops.auth.social.dto.SocialExchangeRequest;
import com.sellerops.auth.social.dto.SocialExchangeResponse;
import com.sellerops.auth.social.dto.SocialOnboardingRequest;
import jakarta.validation.Valid;
import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Public (permitAll under /api/auth/**) endpoints of the social login flow — docs/auth_growth_instrumentation_v1.md §3. */
@RestController
@RequestMapping("/api/auth/social")
public class SocialAuthController {

    private final SocialAuthService socialAuth;
    private final SocialLoginProperties props;

    public SocialAuthController(SocialAuthService socialAuth, SocialLoginProperties props) {
        this.socialAuth = socialAuth;
        this.props = props;
    }

    /** Which providers this deployment offers — the login page draws a button only for a {@code true}. */
    @GetMapping("/providers")
    public Map<String, Boolean> providers() {
        return props.availability();
    }

    @PostMapping("/exchange")
    public SocialExchangeResponse exchange(@Valid @RequestBody SocialExchangeRequest request) {
        return socialAuth.exchange(request.code());
    }

    @PostMapping("/onboarding/complete")
    public AuthResponse completeOnboarding(@Valid @RequestBody SocialOnboardingRequest request) {
        return socialAuth.completeOnboarding(request.onboardingToken(), request.orgName(), request.name(),
                request.marketingConsentGiven());
    }
}
