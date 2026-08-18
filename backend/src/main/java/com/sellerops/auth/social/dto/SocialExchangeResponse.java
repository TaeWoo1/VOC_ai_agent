package com.sellerops.auth.social.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.sellerops.user.UserView;

/**
 * Answer to a one-time code. {@code SIGNED_IN} carries the same token + user as password login;
 * {@code ONBOARDING_REQUIRED} carries an opaque onboarding token (body only, never a URL) and the profile bits
 * the onboarding form prefills for the person themselves.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record SocialExchangeResponse(
        Status status,
        String token,
        UserView user,
        String onboardingToken,
        String provider,
        String email,
        String name) {

    public enum Status { SIGNED_IN, ONBOARDING_REQUIRED }

    public static SocialExchangeResponse signedIn(String token, UserView user, String provider) {
        return new SocialExchangeResponse(Status.SIGNED_IN, token, user, null, provider, null, null);
    }

    public static SocialExchangeResponse onboardingRequired(String onboardingToken, String provider,
                                                            String email, String name) {
        return new SocialExchangeResponse(Status.ONBOARDING_REQUIRED, null, null, onboardingToken, provider,
                email, name);
    }
}
