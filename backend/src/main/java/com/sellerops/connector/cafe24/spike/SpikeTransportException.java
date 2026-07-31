package com.sellerops.connector.cafe24.spike;

/**
 * A network / non-200 / unexpected-shape failure from the spike transport. This is a
 * HALT signal — the engine stops immediately with no retry and no article PUT. The
 * message carries only a coarse, secret-free category (never a token or response
 * body).
 */
public class SpikeTransportException extends RuntimeException {

    public SpikeTransportException(String message) {
        super(message);
    }
}
