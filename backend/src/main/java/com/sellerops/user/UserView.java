package com.sellerops.user;

import java.util.UUID;

/** Public projection of a user + their organization. */
public record UserView(
        UUID id,
        String email,
        String name,
        String role,
        UUID orgId,
        String orgName) {
}
