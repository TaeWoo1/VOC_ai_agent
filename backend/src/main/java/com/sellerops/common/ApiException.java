package com.sellerops.common;

import org.springframework.http.HttpStatus;

/** Domain error carrying an HTTP status; rendered by {@link GlobalExceptionHandler}. */
public class ApiException extends RuntimeException {

    private final HttpStatus status;

    /**
     * A stable, closed-vocabulary name for THIS failure, when the caller has to branch on it.
     *
     * <p>Null for the ordinary case, where a message a person reads is the whole answer. It exists
     * because one 409 can mean "you are out of date, reload" and another can mean "you are about to
     * overrule the channel, say so again", and a screen that tells those apart by matching Korean
     * prose will get it wrong the first time someone rewrites the sentence.
     */
    private final String code;

    public ApiException(HttpStatus status, String message) {
        this(status, null, message);
    }

    public ApiException(HttpStatus status, String code, String message) {
        super(message);
        this.status = status;
        this.code = code;
    }

    public HttpStatus getStatus() {
        return status;
    }

    public String getCode() {
        return code;
    }

    public static ApiException badRequest(String message) {
        return new ApiException(HttpStatus.BAD_REQUEST, message);
    }

    public static ApiException unauthorized(String message) {
        return new ApiException(HttpStatus.UNAUTHORIZED, message);
    }

    public static ApiException forbidden(String message) {
        return new ApiException(HttpStatus.FORBIDDEN, message);
    }

    public static ApiException notFound(String message) {
        return new ApiException(HttpStatus.NOT_FOUND, message);
    }

    public static ApiException conflict(String message) {
        return new ApiException(HttpStatus.CONFLICT, message);
    }

    /** A conflict the caller is expected to branch on — see {@link #getCode()}. */
    public static ApiException conflict(String code, String message) {
        return new ApiException(HttpStatus.CONFLICT, code, message);
    }
}
