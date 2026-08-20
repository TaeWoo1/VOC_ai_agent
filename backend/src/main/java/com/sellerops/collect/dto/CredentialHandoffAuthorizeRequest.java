package com.sellerops.collect.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;

/**
 * Ask for a one-shot authorization to hand a just-issued marketplace credential to the vault.
 *
 * <p>It carries no secret and grants nothing by itself: the org and the user come from the JWT, the account is
 * resolved server-side from the opaque slot, and the authorization that comes back is bound to all of them plus
 * the run named here. Everything this request can say is a pointer at something the caller already has.
 *
 * <p>{@code runId} is the Action Window issuance run the seller is in — the walk that produced the key. It is
 * what makes a handoff belong to one sitting: the same seller, the same account, a different run, is a different
 * handoff and needs its own authorization.
 */
public record CredentialHandoffAuthorizeRequest(
        @NotBlank @Pattern(regexp = "^[0-9a-f]{24}$", message = "계정 슬롯 형식이 올바르지 않습니다.")
        String accountSlot,
        @NotBlank @Pattern(regexp = "^[A-Z0-9_]{2,32}$", message = "채널 코드 형식이 올바르지 않습니다.")
        String channelCode,
        @NotBlank @Pattern(regexp = "^[A-Za-z0-9_-]{1,64}$", message = "실행 식별자 형식이 올바르지 않습니다.")
        String runId) {
}
