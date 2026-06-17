package com.sellerops.auth;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Date;
import java.util.UUID;
import javax.crypto.SecretKey;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/** Signs and verifies JWTs carrying the user + org identity. */
@Component
public class JwtTokenProvider {

    private final SecretKey key;
    private final long expMinutes;

    public JwtTokenProvider(
            @Value("${sellerops.jwt.secret}") String secret,
            @Value("${sellerops.jwt.exp-minutes}") long expMinutes) {
        this.key = Keys.hmacShaKeyFor(secret.getBytes(StandardCharsets.UTF_8));
        this.expMinutes = expMinutes;
    }

    public String createToken(UUID userId, UUID orgId, String email) {
        Instant now = Instant.now();
        return Jwts.builder()
                .subject(userId.toString())
                .claim("orgId", orgId.toString())
                .claim("email", email)
                .issuedAt(Date.from(now))
                .expiration(Date.from(now.plus(expMinutes, ChronoUnit.MINUTES)))
                .signWith(key)
                .compact();
    }

    /** Parse + verify; returns null when the token is missing/invalid/expired. */
    public AuthPrincipal parse(String token) {
        try {
            Claims claims = Jwts.parser()
                    .verifyWith(key)
                    .build()
                    .parseSignedClaims(token)
                    .getPayload();
            return new AuthPrincipal(
                    UUID.fromString(claims.getSubject()),
                    UUID.fromString(claims.get("orgId", String.class)),
                    claims.get("email", String.class));
        } catch (Exception ex) {
            return null;
        }
    }
}
