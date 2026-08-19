package com.sellerops.auth.consent;

import com.sellerops.user.User;
import java.time.Instant;

/**
 * The account-level consent record written at sign-up (docs/service_readiness_v1.md §2-4). 필수 = 이용약관 ·
 * 개인정보처리방침 (must be true — the request validation refuses otherwise); 선택 = 마케팅 정보 수신.
 * {@link #TERMS_VERSION} is a DRAFT marker: the real documents are a launch item (§7), and the version flips
 * when they are confirmed — the record itself is what this unit prepares.
 */
public final class AccountConsent {

    public static final String TERMS_VERSION = "draft-2026-08";

    private AccountConsent() {}

    public static void record(User user, boolean marketingConsent, Instant now) {
        user.setTermsAcceptedAt(now);
        user.setTermsVersion(TERMS_VERSION);
        user.setMarketingConsentAt(marketingConsent ? now : null);
    }
}
