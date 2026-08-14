package com.sellerops.connector.coupang;

/**
 * The request left this process and no response came back.
 *
 * <p>This exists as its own type because it is the one failure that must never be treated as
 * "nothing happened". A read that ends this way can simply be re-read. A <b>write</b> that ends this
 * way may have already posted a reply visible to a customer — so the honest outcome is
 * DELIVERY_UNKNOWN, verified by re-query, and never a resend.
 *
 * <p>An {@link IllegalStateException} would have been indistinguishable from the connector's many
 * other fail-closed states, all of which mean "nothing was sent". That is exactly the distinction a
 * reply path cannot afford to lose, and a shared exception type is how it would have been lost.
 *
 * <p>Carries no request material: the headers hold the CEA signature and the body holds the seller's
 * reply text.
 */
public class CoupangTransportAmbiguityException extends RuntimeException {

    public CoupangTransportAmbiguityException(String message) {
        super(message);
    }
}
