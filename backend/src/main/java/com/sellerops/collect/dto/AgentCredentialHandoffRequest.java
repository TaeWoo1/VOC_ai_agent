package com.sellerops.collect.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Pattern;
import java.util.Map;

/**
 * The Local Agent's credential handoff: the values a seller just issued on the marketplace, handed straight
 * to the vault by the agent that read them, under the seller's own trusted confirmation.
 *
 * <p><b>The slot selects; the JWT authorizes.</b> {@code accountSlot} is the opaque, stable
 * {@code account_session_slot.account_slot} — the same key the Action Window wire already carries instead of a
 * seller-account id. It is long-lived and reused, so it is deliberately NOT a capability: the org comes from the
 * authenticated principal and the slot is resolved within it, so a slot from another org reads as absent.
 *
 * <p>{@code channelCode} is a GUARD, not a routing key. The account's real channel is read from the database;
 * a request whose declared channel disagrees is refused rather than stored, so a mixed-up slot can never put
 * Coupang keys on a NAVER account.
 *
 * <p>No expiry field: v1 stores {@code null} (unknown), because no expiry has been measured on the issued
 * screen and an inferred one would be a fabricated date in front of a renewal alert. The operator path for an
 * exact date already exists at {@code POST /credentials/expiry}. See
 * {@code docs/coupang_credential_handoff_v1.md} §7.
 */
public record AgentCredentialHandoffRequest(
        @NotBlank @Pattern(regexp = "^[0-9a-f]{24}$", message = "계정 슬롯 형식이 올바르지 않습니다.")
        String accountSlot,
        @NotBlank @Pattern(regexp = "^[A-Z0-9_]{2,32}$", message = "채널 코드 형식이 올바르지 않습니다.")
        String channelCode,
        @NotEmpty Map<String, String> secrets) {

    /** Masked — a request object must never be able to put a credential in a log line or a stack trace. */
    @Override
    public String toString() {
        return "AgentCredentialHandoffRequest[accountSlot=<masked>, channelCode=" + channelCode
                + ", secrets=<masked:" + (secrets != null ? secrets.size() : 0) + ">]";
    }
}
