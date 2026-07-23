package com.sellerops.common;

import java.time.Instant;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.multipart.support.MissingServletRequestPartException;

@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(ApiException.class)
    public ResponseEntity<Map<String, Object>> handleApi(ApiException ex) {
        return body(ex.getStatus(), ex.getMessage());
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<Map<String, Object>> handleValidation(MethodArgumentNotValidException ex) {
        String message = ex.getBindingResult().getFieldErrors().stream()
                .findFirst()
                .map(e -> e.getField() + ": " + e.getDefaultMessage())
                .orElse("입력값이 올바르지 않습니다.");
        return body(HttpStatus.BAD_REQUEST, message);
    }

    @ExceptionHandler(MethodArgumentTypeMismatchException.class)
    public ResponseEntity<Map<String, Object>> handleTypeMismatch(MethodArgumentTypeMismatchException ex) {
        // Malformed query/path param (e.g. a non-ISO date or non-UUID) — a client
        // error, not a server fault. Echo only the parameter name, never the value.
        return body(HttpStatus.BAD_REQUEST, "요청 파라미터 형식이 올바르지 않습니다: " + ex.getName());
    }

    @ExceptionHandler(MissingServletRequestPartException.class)
    public ResponseEntity<Map<String, Object>> handleMissingPart(MissingServletRequestPartException ex) {
        // A multipart request without the expected part (e.g. a renamed `file`) — a
        // client error, not a server fault, which the catch-all would otherwise report
        // as 500. Echo only the part NAME, never the part's content.
        return body(HttpStatus.BAD_REQUEST, "필수 파일 항목이 없습니다: " + ex.getRequestPartName());
    }

    @ExceptionHandler(HttpRequestMethodNotSupportedException.class)
    public ResponseEntity<Map<String, Object>> handleMethodNotSupported(HttpRequestMethodNotSupportedException ex) {
        // A wrong HTTP method on a known path (e.g. PUT on a POST-only route) — a client
        // error (405), not a server fault, which the catch-all would otherwise report as
        // 500 and thereby mask as a backend failure. Echo only the offending method name.
        return body(HttpStatus.METHOD_NOT_ALLOWED, "지원하지 않는 요청 방식입니다: " + ex.getMethod());
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<Map<String, Object>> handleOther(Exception ex) {
        return body(HttpStatus.INTERNAL_SERVER_ERROR, "서버 오류가 발생했습니다.");
    }

    private ResponseEntity<Map<String, Object>> body(HttpStatus status, String message) {
        return ResponseEntity.status(status).body(Map.of(
                "timestamp", Instant.now().toString(),
                "status", status.value(),
                "error", status.getReasonPhrase(),
                "message", message == null ? "" : message
        ));
    }
}
