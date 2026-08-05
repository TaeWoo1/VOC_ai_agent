package com.sellerops.connector.coupang;

/**
 * Fail-closed: a live Coupang API call to a real marketplace gateway was attempted without an armed
 * live-run approval id. The Coupang connector's live path is entirely backend-side (an HMAC-signed GET
 * to {@code api-gateway.coupang.com}), so the operator-approval interlock sits at the backend HTTP
 * choke point ({@link CoupangOrdersClient} / {@link CoupangLiveCallGuard}), not in a collector CLI.
 *
 * <p>An operator-approved run arms the id via {@code SELLEROPS_CONNECTOR_COUPANG_LIVE_APPROVAL_ID}
 * (minted by {@code tools/coupang-local/bootstrap.sh}); offline/loopback base URLs never require it.
 * See {@code docs/sellerops_live_approval_contract.md}.
 *
 * <p>Extends {@link RuntimeException} — NOT {@link IllegalStateException} — deliberately: the credential
 * and order-access probes convert an {@code IllegalStateException} transport failure into an inconclusive
 * {@code UNAVAILABLE} outcome, and a missing approval must never be softened into "inconclusive". It
 * propagates as a hard, visible failure everywhere.
 */
public class CoupangLiveApprovalRequiredException extends RuntimeException {

    public CoupangLiveApprovalRequiredException(String message) {
        super(message);
    }
}
