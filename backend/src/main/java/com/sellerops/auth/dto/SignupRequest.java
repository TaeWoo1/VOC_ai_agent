package com.sellerops.auth.dto;

import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

public record SignupRequest(
        @Email @NotBlank String email,
        @NotBlank @Size(min = 6, max = 100) String password,
        @NotBlank String name,
        @NotBlank String orgName,
        /** 필수: 이용약관 · 개인정보처리방침 동의 (docs/service_readiness_v1.md §2-4). */
        @NotNull(message = "이용약관과 개인정보처리방침에 동의해야 가입할 수 있습니다.")
        @AssertTrue(message = "이용약관과 개인정보처리방침에 동의해야 가입할 수 있습니다.") Boolean termsAccepted,
        /** 선택: 마케팅 정보 수신 동의. */
        Boolean marketingConsent) {

    public boolean marketingConsentGiven() {
        return Boolean.TRUE.equals(marketingConsent);
    }
}
