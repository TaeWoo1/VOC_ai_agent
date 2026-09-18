package com.sellerops.connector.naver;

/**
 * The NAVER gateway refused the caller's environment ({@code GW.IP_NOT_ALLOWED}): the credential may be fine, the
 * calling IP is not registered. Still an {@link IllegalStateException}, so every existing caller keeps treating it as an
 * ordinary failure that does not change the account's connection state; typed so a caller about to make many requests
 * can stop at the first one.
 */
public class NaverEnvironmentRefusedException extends IllegalStateException {

    public NaverEnvironmentRefusedException(String message) {
        super(message);
    }
}
