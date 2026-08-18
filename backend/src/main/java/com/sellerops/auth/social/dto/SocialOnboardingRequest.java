package com.sellerops.auth.social.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record SocialOnboardingRequest(
        @NotBlank String onboardingToken,
        @NotBlank @Size(max = 200) String orgName,
        @NotBlank @Size(max = 120) String name) {
}
