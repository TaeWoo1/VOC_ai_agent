package com.sellerops.connector.cafe24.spike;

/**
 * The comment POST was rejected by Cafe24 (a 4xx / field-mismatch response). Unlike
 * {@link SpikeTransportException} this is a capability signal, not a transient
 * failure: it maps to verdict C ({@link SpikeVerdict#GUIDED_HANDOFF_REMAINS}). The
 * message carries only a coarse category (e.g. the HTTP status class), never the
 * response body or any field value.
 */
public class SpikeCommentRejectedException extends RuntimeException {

    public SpikeCommentRejectedException(String message) {
        super(message);
    }
}
