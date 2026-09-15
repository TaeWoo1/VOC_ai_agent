package com.sellerops.connector;

/**
 * A channel call that did not answer within its request timeout.
 *
 * <p>An {@link IllegalStateException} so every existing catch that handled the previous undifferentiated network
 * failure still handles this one. What it adds is the one distinction a caller could not recover from a message:
 * «the channel did not answer in time» is retryable and is not «the channel refused» — and neither is «0건».
 */
public class ConnectorTimeoutException extends IllegalStateException {

    public ConnectorTimeoutException(String message) {
        super(message);
    }
}
