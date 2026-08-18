package com.sellerops.auth.social.dto;

import jakarta.validation.constraints.NotBlank;

public record SocialExchangeRequest(@NotBlank String code) {
}
