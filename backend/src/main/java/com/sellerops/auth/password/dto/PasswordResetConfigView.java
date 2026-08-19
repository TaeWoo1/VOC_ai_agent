package com.sellerops.auth.password.dto;

/** `enabled` = a mailed link can reach someone; `devOutbox` = it lands in the local backend log (dev only). */
public record PasswordResetConfigView(boolean enabled, boolean devOutbox) {
}
