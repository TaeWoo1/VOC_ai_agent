package com.sellerops.auth.social;

/**
 * What the success handler extracts from a provider's authentication: the identity key
 * {@code (provider, subject)} plus the profile bits used for onboarding prefill. {@code email} is null when the
 * provider did not report a verified email; {@code name} may be null.
 */
public record SocialProfile(String provider, String subject, String email, String name) {
}
