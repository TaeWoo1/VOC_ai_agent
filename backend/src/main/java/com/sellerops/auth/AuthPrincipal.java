package com.sellerops.auth;

import java.util.UUID;

/** Authenticated caller, derived from the JWT and set as the security principal. */
public record AuthPrincipal(UUID userId, UUID orgId, String email) {
}
