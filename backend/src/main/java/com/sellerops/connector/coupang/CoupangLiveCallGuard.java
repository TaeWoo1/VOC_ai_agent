package com.sellerops.connector.coupang;

import java.net.URI;
import java.util.Locale;
import java.util.Set;

/**
 * The backend interlock that keeps a live Coupang marketplace call from ever happening without an
 * armed, operator-minted live-run approval id.
 *
 * <p>Unlike the NAVER/ESM live flows — driven by a collector CLI whose approval gate lives in
 * {@code collector/src/cli/live-run-approval.ts} — the Coupang connector calls the marketplace directly
 * from the backend (an HMAC-signed GET). So the interlock must sit at the backend HTTP choke point that
 * every Coupang request flows through: {@link CoupangOrdersClient#signedGet}. This is the code half of
 * {@code docs/sellerops_live_approval_contract.md}; the manifest/approval half is prepared by
 * {@code tools/coupang-local/} (bootstrap → preflight).
 *
 * <p><b>Fail closed.</b> A request whose base-URL host is a real (non-loopback, non-test) host is allowed
 * ONLY when a non-blank {@code liveApprovalId} is configured
 * ({@code sellerops.connector.coupang.live-approval-id}, injected from
 * {@code SELLEROPS_CONNECTOR_COUPANG_LIVE_APPROVAL_ID} for an approved run). A loopback / {@code localhost}
 * / {@code *.test} / {@code *.local} base URL — the offline unit-test and stub shape — never requires it,
 * so the offline suite runs untouched. Any other host with a blank approval id, or an un-parseable base
 * URL, throws {@link CoupangLiveApprovalRequiredException}.
 *
 * <p>The id is an ENVIRONMENT-binding token (like the walkthrough run id), never a credential. The
 * operator confirms the running backend is armed with the manifest's approval id via the sanitized
 * {@code /api/connect/coupang/setup} readiness before granting — closing the gap where a green health
 * check looked like an approved run.
 */
public final class CoupangLiveCallGuard {

    private CoupangLiveCallGuard() {
    }

    /** Hosts that are unambiguously the local loopback — offline, never a real marketplace call. */
    private static final Set<String> LOOPBACK_HOSTS = Set.of("localhost", "127.0.0.1", "::1", "[::1]");

    /**
     * True when {@code baseUrl}'s host is an offline/loopback/test host that needs no live approval.
     * An un-parseable or host-less base URL is deliberately NOT offline — it fails closed (requires
     * approval), so a malformed override can never silently open a live path.
     */
    static boolean isOfflineHost(String baseUrl) {
        String host = hostOf(baseUrl);
        if (host == null || host.isBlank()) {
            return false;
        }
        host = host.toLowerCase(Locale.ROOT);
        if (LOOPBACK_HOSTS.contains(host)) {
            return true;
        }
        return host.endsWith(".localhost") || host.endsWith(".test") || host.endsWith(".local");
    }

    private static String hostOf(String baseUrl) {
        if (baseUrl == null || baseUrl.isBlank()) {
            return null;
        }
        try {
            return URI.create(baseUrl.trim()).getHost();
        } catch (Exception e) {
            return null;
        }
    }

    /**
     * Backstop the live gate before any signed request leaves the process. A no-op for an
     * offline/loopback base URL; for a real host, throws {@link CoupangLiveApprovalRequiredException}
     * unless a non-blank approval id is armed.
     *
     * <p>This is the <b>WRITE-strength</b> check (the original single gate): only the per-run live
     * approval id opens it. It stays the default for any caller that does not say otherwise, so a new
     * call site is WRITE-gated unless it explicitly declares itself a READ.
     */
    static void ensureLiveCallAllowed(String baseUrl, String liveApprovalId) {
        ensureLiveWriteAllowed(baseUrl, liveApprovalId);
    }

    /**
     * WRITE gate — a marketplace-mutating call (inquiry reply POST). Opens ONLY on the per-run live
     * approval id ({@code SELLEROPS_CONNECTOR_COUPANG_LIVE_APPROVAL_ID}). The Self-Pilot standing READ
     * grant is deliberately not a parameter here: there is no way to hand it to this method, so no
     * configuration can ever make a write ride on a read grant.
     */
    static void ensureLiveWriteAllowed(String baseUrl, String liveApprovalId) {
        if (isOfflineHost(baseUrl)) {
            return;
        }
        if (liveApprovalId == null || liveApprovalId.isBlank()) {
            throw new CoupangLiveApprovalRequiredException(
                    "쿠팡 라이브 API 호출이 승인 없이 시도되었습니다. 운영자 승인이 설정된 런에서만 실행됩니다 "
                    + "(SELLEROPS_CONNECTOR_COUPANG_LIVE_APPROVAL_ID). 자세한 내용: 라이브 승인 계약 문서.");
        }
    }

    /**
     * READ gate — a read-only signed GET (orders, inquiries, credential probes, answered-check). Opens on
     * EITHER the per-run live approval id OR the Self-Pilot Runtime's <b>standing READ grant</b>
     * ({@code SELLEROPS_SELF_PILOT_READ_GRANT_ID}; product-owner decision 2026-08-18 — routine READ on the
     * operator's own org runs without a per-run ceremony, contract §6a). Still fails closed when neither
     * is armed.
     */
    static void ensureLiveReadAllowed(String baseUrl, String liveApprovalId, String standingReadGrantId) {
        if (isOfflineHost(baseUrl)) {
            return;
        }
        if (standingReadGrantId != null && !standingReadGrantId.isBlank()) {
            return;
        }
        if (liveApprovalId == null || liveApprovalId.isBlank()) {
            throw new CoupangLiveApprovalRequiredException(
                    "쿠팡 라이브 API 읽기 호출이 승인 없이 시도되었습니다. 운영자 승인이 설정된 런"
                    + "(SELLEROPS_CONNECTOR_COUPANG_LIVE_APPROVAL_ID) 또는 셀프 파일럿 읽기 그랜트"
                    + "(SELLEROPS_SELF_PILOT_READ_GRANT_ID)가 필요합니다. 자세한 내용: 라이브 승인 계약 문서 §6a.");
        }
    }
}
