package com.sellerops.collect;

/**
 * The seller's sentence for a connector's stored {@code lastError} (Local Helper Pilot Packaging v1, §7).
 *
 * <p>The connectors write what they know — a NAVER gateway code, an HTTP status, an exception name —
 * and that string is diagnostics: support needs it verbatim, and a seller cannot act on it. Secondary
 * Workspaces UX Closure v1 refused to surface it for that reason and named the missing piece: a
 * connector-error → seller-sentence mapping owned by the side that knows the codes. This is that mapping,
 * closed and small. Anything it does not recognise gets the one sentence that is always true, and the raw
 * string travels beside it in the same view for the 「기술 정보」 fold — nothing is lost, and nothing a
 * seller reads is a code.
 *
 * <p>The only NAVER code with a documented meaning is {@code GW.IP_NOT_ALLOWED} (the vendored
 * troubleshooting table; {@code NaverGatewayCode}). It is deliberately the one sentence that does NOT ask
 * for a credential: that refusal is about the caller's IP, and telling the seller to re-enter a key would
 * send them to fix the wrong thing.
 */
public final class ConnectorErrorWording {

    static final String DEFAULT = "최근 수집에서 오류가 있었습니다. 다음 수집에서 다시 시도합니다.";

    private ConnectorErrorWording() {
    }

    /** The seller sentence for a stored connector error, or null when there is no error. */
    public static String sellerSentence(String lastError) {
        if (lastError == null || lastError.isBlank()) {
            return null;
        }
        String e = lastError;
        if (e.contains("GW.IP_NOT_ALLOWED")) {
            return "네이버가 이 서버의 호출 IP를 허용하지 않아 수집이 막혔습니다. 네이버 커머스 API 센터에 등록된 호출 IP를 확인해 주세요.";
        }
        if (e.contains("GW.AUTHN") || e.contains("GW.UNAUTHORIZED") || e.contains("CREDENTIAL_REJECTED")
                || e.contains("401") || e.contains("invalid_grant") || e.contains("TOKEN_EXPIRED")) {
            return "채널 인증이 더 이상 유효하지 않습니다. 채널을 다시 연결해 주세요.";
        }
        if (e.contains("GW.FORBIDDEN") || e.contains("403")) {
            return "채널이 이 요청을 거부했습니다. 연결한 계정의 권한을 확인해 주세요.";
        }
        if (e.contains("GW.RATE_LIMIT") || e.contains("GW.QUOTA_LIMIT") || e.contains("429")) {
            return "채널 요청 한도에 걸려 잠시 멈췄습니다. 다음 수집에서 다시 시도합니다.";
        }
        if (e.contains("GW.TIMEOUT") || e.contains("Timeout") || e.contains("timeout") || e.contains("timed out")) {
            return "채널이 제때 응답하지 않았습니다. 다음 수집에서 다시 시도합니다.";
        }
        if (e.contains("UnknownHost") || e.contains("ConnectException") || e.contains("Connection refused")
                || e.contains("502") || e.contains("503") || e.contains("504")) {
            return "채널에 연결할 수 없었습니다. 다음 수집에서 다시 시도합니다.";
        }
        return DEFAULT;
    }
}
