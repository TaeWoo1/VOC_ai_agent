package com.sellerops.auth.social;

/**
 * Where the browser goes after the provider authenticated the person. Only {@link Kind#SESSION} and
 * {@link Kind#ONBOARDING} carry a code; the refusals carry a reason the login page turns into a sentence.
 */
public record SocialLoginOutcome(Kind kind, String code) {

    public enum Kind {
        /** Identity linked → one-time code → JWT. */
        SESSION,
        /** First-time identity → one-time code → onboarding token → 상호명 → org + user + identity. */
        ONBOARDING,
        /** Email already belongs to a SellerOps user; auto-link is forbidden (fail closed). */
        EMAIL_TAKEN,
        /** Provider reported no verified email; users.email is the login identity. */
        EMAIL_MISSING
    }

    public static SocialLoginOutcome session(String code) { return new SocialLoginOutcome(Kind.SESSION, code); }
    public static SocialLoginOutcome onboarding(String code) { return new SocialLoginOutcome(Kind.ONBOARDING, code); }
    public static SocialLoginOutcome emailTaken() { return new SocialLoginOutcome(Kind.EMAIL_TAKEN, null); }
    public static SocialLoginOutcome emailMissing() { return new SocialLoginOutcome(Kind.EMAIL_MISSING, null); }

    /** Frontend path (relative to the public origin) for this outcome. */
    public String frontendPath() {
        return switch (kind) {
            case SESSION, ONBOARDING -> "/auth/callback?code=" + code;
            case EMAIL_TAKEN -> "/login?social=email_taken";
            case EMAIL_MISSING -> "/login?social=email_missing";
        };
    }
}
