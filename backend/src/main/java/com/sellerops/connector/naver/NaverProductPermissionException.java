package com.sellerops.connector.naver;

/**
 * The seller's NAVER application does not hold the product API permission.
 *
 * <p>Its own type because it is its own operator instruction. "다시 연결하세요" is wrong here — the
 * credential is fine and reconnecting with it changes nothing; what is needed is a permission the seller
 * grants to their application in the 커머스API센터. Collapsing this into a generic auth failure is the
 * mistake {@code Cafe24OAuthException} was split up to avoid, and the same argument applies verbatim.
 *
 * <p>No credential, token, or provider body is ever carried in the message — there is no logger and no
 * body field here by design.
 */
public class NaverProductPermissionException extends RuntimeException {

    private static final long serialVersionUID = 1L;

    public NaverProductPermissionException(String message) {
        super(message);
    }
}
