package com.sellerops.config;

import java.net.URI;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

/**
 * <b>A connector that is switched on but cannot work must not boot quietly</b> — Pilot Runtime
 * Foundation v1 §4.
 *
 * <p>The failure this exists for is not a crash. It is a deployment that starts, serves every
 * screen, offers 「연결하기」, and then fails at the moment a seller presses it — because the vault has
 * no master key to seal the credential with, or the OAuth callback still points at
 * {@code localhost}. Every one of those is knowable at boot and none of them was said at boot.
 *
 * <p><b>Only enabled connectors are checked.</b> A deployment that does not talk to Coupang has no
 * Coupang configuration and must start perfectly — the absence of a secret for a connector nobody
 * turned on is not a defect, and treating it as one would make the honest default posture
 * unbootable. The check is therefore per connector flag, never global.
 *
 * <p><b>What it is not.</b> Not a configuration framework, not a schema, not a registry — one class
 * with one list of conditions, each of which was chosen because it produces a half-working runtime
 * rather than an error. It names the environment variable to set and nothing else: no value, no
 * key, no secret and no IP is read into the message.
 *
 * <p>It runs at {@code ApplicationReadyEvent} rather than in a constructor so that the message is
 * the last thing in the log rather than buried in a bean-creation stack, and it throws — a
 * misconfigured pilot host stopping is the point.
 */
@Component
public class PilotConfigValidator {

    private final boolean naverEnabled;
    private final boolean coupangEnabled;
    private final boolean cafe24Enabled;
    private final String vaultMasterKey;
    private final String naverAdvertisedEgressIps;
    private final String cafe24ClientId;
    private final String cafe24ClientSecret;
    private final String cafe24RedirectUri;

    public PilotConfigValidator(
            @Value("${sellerops.connector.naver.enabled:false}") boolean naverEnabled,
            @Value("${sellerops.connector.coupang.enabled:false}") boolean coupangEnabled,
            @Value("${sellerops.connector.cafe24.enabled:false}") boolean cafe24Enabled,
            @Value("${sellerops.vault.master-key-base64:}") String vaultMasterKey,
            @Value("${sellerops.connector.naver.advertised-egress-ips:}") String naverAdvertisedEgressIps,
            @Value("${sellerops.connector.cafe24.oauth.client-id:}") String cafe24ClientId,
            @Value("${sellerops.connector.cafe24.oauth.client-secret:}") String cafe24ClientSecret,
            @Value("${sellerops.connector.cafe24.oauth.redirect-uri:}") String cafe24RedirectUri) {
        this.naverEnabled = naverEnabled;
        this.coupangEnabled = coupangEnabled;
        this.cafe24Enabled = cafe24Enabled;
        this.vaultMasterKey = vaultMasterKey;
        this.naverAdvertisedEgressIps = naverAdvertisedEgressIps;
        this.cafe24ClientId = cafe24ClientId;
        this.cafe24ClientSecret = cafe24ClientSecret;
        this.cafe24RedirectUri = cafe24RedirectUri;
    }

    @EventListener(ApplicationReadyEvent.class)
    public void validate() {
        List<String> problems = problems();
        if (!problems.isEmpty()) {
            throw new IllegalStateException(
                    "이 배포는 채널을 켰지만 실제로 연결할 수 없는 설정입니다. 다음을 채운 뒤 다시 시작하세요:\n  - "
                            + String.join("\n  - ", problems));
        }
    }

    /** The conditions, in one list, so a test can read them without starting a context. */
    List<String> problems() {
        List<String> problems = new ArrayList<>();
        boolean anyConnector = naverEnabled || coupangEnabled || cafe24Enabled;

        // A connector's whole job ends in a sealed credential. With no master key the vault fails
        // closed at the moment the seller submits — after the OAuth consent, on the last screen.
        if (anyConnector && blank(vaultMasterKey)) {
            problems.add("SELLEROPS_VAULT_MASTER_KEY — 채널을 켰지만 자격 증명을 봉인할 마스터 키가 없습니다.");
        }

        // The NAVER app refuses calls from an unregistered address, and the connect screen tells the
        // seller to register "SellerOps 고정 호출 IP" — a value this deployment has to know to name.
        // Blank means the screen shows generic guidance and the first order sync fails on call IP.
        if (naverEnabled && blank(naverAdvertisedEgressIps)) {
            problems.add("SELLEROPS_CONNECTOR_NAVER_ADVERTISED_EGRESS_IPS — "
                    + "네이버를 켰지만 판매자에게 등록하라고 안내할 고정 호출 IP가 설정되지 않았습니다.");
        }

        if (cafe24Enabled) {
            if (blank(cafe24ClientId) || blank(cafe24ClientSecret)) {
                problems.add("SELLEROPS_CONNECTOR_CAFE24_CLIENT_ID / _CLIENT_SECRET — "
                        + "카페24를 켰지만 앱 자격 정보가 없어 OAuth 동의를 시작할 수 없습니다.");
            }
            String redirectProblem = redirectUriProblem(cafe24RedirectUri);
            if (redirectProblem != null) {
                problems.add("SELLEROPS_CONNECTOR_CAFE24_REDIRECT_URI — " + redirectProblem);
            }
        }
        return problems;
    }

    /**
     * The callback has to be an address Cafe24 can actually reach: an absolute HTTPS URL.
     *
     * <p><b>The loopback default is a problem, not a development convenience.</b> The registered
     * redirect URI, the authorize URL and the token exchange must be byte-identical, and the token
     * exchange reads this very property — so a deployment whose Cafe24 connector is ON while this
     * still says {@code http://localhost:8080/...} cannot complete a consent anywhere, including on
     * the developer's own machine. Saying so at boot costs one line; discovering it costs a seller
     * their OAuth consent.
     */
    static String redirectUriProblem(String raw) {
        if (blank(raw)) {
            return "카페24 OAuth callback 주소가 비어 있습니다.";
        }
        URI uri;
        try {
            uri = URI.create(raw.trim());
        } catch (IllegalArgumentException e) {
            return "카페24 OAuth callback 주소가 올바른 URL이 아닙니다.";
        }
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
        String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase(Locale.ROOT);
        if (host.isEmpty()) {
            return "카페24 OAuth callback 주소에 호스트가 없습니다.";
        }
        boolean loopback = host.equals("localhost") || host.equals("127.0.0.1") || host.equals("::1");
        if (loopback) {
            return "카페24 OAuth callback 주소가 아직 기본값(로컬 주소)입니다 — 카페24가 도달할 수 없습니다.";
        }
        if (!scheme.equals("https")) {
            return "카페24 OAuth callback 주소는 HTTPS여야 합니다 (외부에서 도달할 수 없는 주소입니다).";
        }
        return null;
    }

    private static boolean blank(String v) {
        return v == null || v.isBlank();
    }
}
