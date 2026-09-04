package com.sellerops.auth.device;

import com.sellerops.auth.social.AuthCodes;

/**
 * The helper token's shape. The prefix is what lets {@link HelperDeviceAuthFilter} recognise a device token
 * before any parsing happens — a JWT never starts with it, and a device token is never handed to the JWT
 * parser — so "which credential is this" is a prefix test, not a guess.
 */
public final class HelperDeviceTokens {

    public static final String PREFIX = "rvh_";

    private HelperDeviceTokens() {}

    public static String mint() {
        return PREFIX + AuthCodes.newCode();
    }

    public static boolean looksLikeDeviceToken(String bearer) {
        return bearer != null && bearer.startsWith(PREFIX);
    }

    public static String hash(String token) {
        return AuthCodes.hash(token);
    }
}
