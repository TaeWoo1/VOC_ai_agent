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
        @NotEmpty Map<String, String> secrets,
        CredentialHandoffRunBinding runBinding,
        /**
         * **The seller path's one-shot authorization**, issued by
         * {@code POST /api/agent/credential-handoff/authorize} to this seller, for this account, on this run.
         *
         * <p>Present INSTEAD of {@code runBinding}, never as well: the two are different interlocks for
         * different callers — an operator's seated live proof, and a seller in the product — and a request that
         * presented both would be asking the backend to pick which grant it is spending.
         *
         * <p>It is a capability, so it is compared whole and never logged. It authorizes exactly one stored
         * credential and nothing else; every other gate in the service still runs after it.
         */
        @Pattern(regexp = "^[0-9a-f]{32}$", message = "연결 정보 전달 승인 형식이 올바르지 않습니다.")
        String authorizationId,
        /**
         * The Action Window run this handoff belongs to — the walk that produced the key. Checked against what
         * the authorization was issued for, so a handoff cannot be carried from one sitting into another.
         */
        String runId) {

    /**
     * **The OPERATOR path's shape**: a run binding and no authorization.
     *
     * Kept as a real constructor rather than left to call sites passing two nulls, because "this caller presents
     * no seller authorization" is a statement worth being able to read — and because the seated live-proof
     * harness that uses this path is live-proven and should not have to change shape to accommodate a second
     * kind of caller arriving beside it.
     */
    public AgentCredentialHandoffRequest(String accountSlot, String channelCode, Map<String, String> secrets,
                                         CredentialHandoffRunBinding runBinding) {
        this(accountSlot, channelCode, secrets, runBinding, null, null);
    }

    /**
     * Masked — a request object must never be able to put a credential in a log line or a stack trace.
     *
     * <p>The run binding is printed in full and deliberately so: it is the identity a reader diagnosing a
     * refused handoff needs, and it holds nothing secret (two opaque environment ids, a commit, a phase).
     */
    @Override
    public String toString() {
        return "AgentCredentialHandoffRequest[accountSlot=<masked>, channelCode=" + channelCode
                + ", secrets=<masked:" + (secrets != null ? secrets.size() : 0) + ">"
                + ", runBinding=" + runBinding
                // The authorization is a CAPABILITY: whoever holds it can spend this handoff, so it is masked
                // exactly like the secrets. Its presence is the only thing worth printing.
                + ", authorizationId=<masked:" + (authorizationId != null && !authorizationId.isBlank()) + ">"
                + ", runId=" + runId + "]";
    }
}
