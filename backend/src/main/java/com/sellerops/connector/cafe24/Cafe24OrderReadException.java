package com.sellerops.connector.cafe24;

/**
 * A Cafe24 single-order read that did not come back usable, carrying only the HTTP status.
 *
 * <p>The status is the whole payload. No body, no URI, no order id, no mall id — an order response
 * is mostly a person, and an exception message is the least controlled string in a system: it lands
 * in logs, in stack traces, and sometimes in an error surface a user can see.
 */
public class Cafe24OrderReadException extends RuntimeException {

    private final int statusCode;

    public Cafe24OrderReadException(int statusCode) {
        super("카페24 주문 단건 조회에 실패했습니다 (HTTP " + statusCode + ").");
        this.statusCode = statusCode;
    }

    public int statusCode() {
        return statusCode;
    }

    /** Authorization, as opposed to anything else — the one distinction that changes the remedy. */
    public boolean unauthorized() {
        return statusCode == 401 || statusCode == 403;
    }
}
