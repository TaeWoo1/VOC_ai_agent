package com.sellerops.collect.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Pattern;
import java.util.Map;

/**
 * **The PRODUCT path's handoff body — and it names no account, deliberately.**
 *
 * A separate record from {@link AgentCredentialHandoffRequest} rather than the same one with a nullable field,
 * because the two callers authenticate differently and therefore have different contracts. One record whose
 * required fields depend on how you authenticated is a record whose meaning you have to reconstruct at every
 * call site; two records say it once, in the type.
 *
 * <h2>Why there is no {@code accountSlot}</h2>
 *
 * The capability this request is authenticated with was issued FOR one seller account. The account is therefore
 * already known, server-side, from a value the caller cannot alter — so asking the agent to also name it would
 * add a second source for one fact, and a second source is a thing that can disagree. It would also hand the
 * resident helper an identifier it has no reason to hold.
 *
 * <p>A capability-authenticated request that carries {@code accountSlot} anyway is REFUSED rather than
 * reconciled: it means the caller believes it is choosing the account, and the answer to that is no, not
 * "we checked and they matched".
 *
 * <p>{@code channelCode} stays, and stays a GUARD: the account's real channel is read from the database and a
 * request whose declared channel disagrees is refused before the vault is touched — exactly as on the operator
 * path. {@code runId} is the Action Window run the seller is in, checked against what the capability was issued
 * for so a handoff cannot be carried from the walk that produced the key into a later sitting.
 */
public record SellerCredentialHandoffRequest(
        @NotBlank @Pattern(regexp = "^[A-Z0-9_]{2,32}$", message = "채널 코드 형식이 올바르지 않습니다.")
        String channelCode,
        @NotEmpty Map<String, String> secrets,
        @NotBlank @Pattern(regexp = "^[A-Za-z0-9_-]{1,64}$", message = "실행 식별자 형식이 올바르지 않습니다.")
        String runId) {

    /** Masked — a request object must never be able to put a credential in a log line or a stack trace. */
    @Override
    public String toString() {
        return "SellerCredentialHandoffRequest[channelCode=" + channelCode
                + ", secrets=<masked:" + (secrets != null ? secrets.size() : 0) + ">"
                + ", runId=" + runId + "]";
    }
}
