package com.sellerops.config;

import java.net.URI;
import com.sellerops.agent.access.AgentCapabilityGate;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
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
    private final String agentAccessScope;
    private final boolean mockConnectorEnabled;
    /**
     * The inquiry answer send — the one marketplace WRITE this product performs.
     *
     * <p>Read as properties, the same way the connector switches above are, because these are
     * deployment facts rather than capabilities that describe themselves. They exist here for the
     * reason every other condition does: on their own they produce a half-working runtime.
     */
    private final boolean inquiryPublishEnabled;
    private final String cafe24LiveApprovalId;
    private final String cafe24ClientIp;
    private final int cafe24ShopNo;
    private final String naverLiveApprovalId;
    /**
     * The AI capabilities, as beans that describe themselves.
     *
     * <p><b>Not their property keys.</b> A file that reads {@code sellerops.agent.plan.*} AND
     * {@code sellerops.agent.draft.*} is a file where two separate exposures have become one switch,
     * and {@code AgentDraftBoundaryTest} refuses exactly that shape. Asking each capability three
     * questions about itself keeps this validator able to check all of them while reading none.
     */
    private final List<AgentCapabilityGate> agentCapabilities;

    public PilotConfigValidator(
            @Value("${sellerops.connector.naver.enabled:false}") boolean naverEnabled,
            @Value("${sellerops.connector.coupang.enabled:false}") boolean coupangEnabled,
            @Value("${sellerops.connector.cafe24.enabled:false}") boolean cafe24Enabled,
            @Value("${sellerops.vault.master-key-base64:}") String vaultMasterKey,
            @Value("${sellerops.connector.naver.advertised-egress-ips:}") String naverAdvertisedEgressIps,
            @Value("${sellerops.connector.cafe24.oauth.client-id:}") String cafe24ClientId,
            @Value("${sellerops.connector.cafe24.oauth.client-secret:}") String cafe24ClientSecret,
            @Value("${sellerops.connector.cafe24.oauth.redirect-uri:}") String cafe24RedirectUri,
            @Value("${sellerops.agent.access.scope:ALLOW_LIST}") String agentAccessScope,
            @Value("${sellerops.connector.mock.enabled:false}") boolean mockConnectorEnabled,
            @Value("${sellerops.inquiry.publish.execution-enabled:false}") boolean inquiryPublishEnabled,
            @Value("${sellerops.inquiry.publish.cafe24.live-approval-id:}") String cafe24LiveApprovalId,
            @Value("${sellerops.inquiry.publish.cafe24.client-ip:}") String cafe24ClientIp,
            @Value("${sellerops.inquiry.publish.cafe24.shop-no:0}") int cafe24ShopNo,
            @Value("${sellerops.inquiry.publish.naver.live-approval-id:}") String naverLiveApprovalId,
            List<AgentCapabilityGate> agentCapabilities) {
        this.inquiryPublishEnabled = inquiryPublishEnabled;
        this.cafe24LiveApprovalId = cafe24LiveApprovalId;
        this.cafe24ClientIp = cafe24ClientIp;
        this.cafe24ShopNo = cafe24ShopNo;
        this.naverLiveApprovalId = naverLiveApprovalId;
        this.mockConnectorEnabled = mockConnectorEnabled;
        this.naverEnabled = naverEnabled;
        this.coupangEnabled = coupangEnabled;
        this.cafe24Enabled = cafe24Enabled;
        this.vaultMasterKey = vaultMasterKey;
        this.naverAdvertisedEgressIps = naverAdvertisedEgressIps;
        this.cafe24ClientId = cafe24ClientId;
        this.cafe24ClientSecret = cafe24ClientSecret;
        this.cafe24RedirectUri = cafe24RedirectUri;
        this.agentAccessScope = agentAccessScope;
        this.agentCapabilities = agentCapabilities == null ? List.of() : List.copyOf(agentCapabilities);
    }

    /**
     * Whether this process's settings were checked and found usable. Only {@link #validate} sets it, and only after
     * finding no problem — a reader that must not act on an unvalidated deployment (the live API preflight) asks
     * this rather than trusting listener order alone.
     */
    private volatile boolean passed;

    /**
     * First among the ready listeners (Full MVP live preflight, 2026-09-22): anything else that acts on
     * {@code ApplicationReadyEvent} — a live marketplace read above all — runs only if this has not refused the
     * process. The conditions are unchanged; only their place in the order moved forward.
     */
    @EventListener(ApplicationReadyEvent.class)
    @Order(Ordered.HIGHEST_PRECEDENCE)
    public void validate() {
        List<String> problems = problems();
        if (!problems.isEmpty()) {
            throw new IllegalStateException(
                    "이 배포는 켜 둔 기능을 실제로 사용할 수 없는 설정입니다. "
                            + "아래를 채우거나 해당 기능을 끈 뒤 다시 시작하세요:\n  - "
                            + String.join("\n  - ", problems));
        }
        passed = true;
    }

    public boolean passed() {
        return passed;
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
        // The offline fixture and a real marketplace, in one database, writing into the same tables.
        // Both connectors' rows land as data_origin=REAL, so once they are mixed nothing downstream —
        // no screen, no query, no export — can separate the seller's data from the invented data
        // again. This is the one connector condition that is a problem even though every switch
        // involved is doing exactly what it was set to do, which is why it has to be said at boot.
        if (mockConnectorEnabled && anyConnector) {
            problems.add("SELLEROPS_CONNECTOR_MOCK_ENABLED — "
                    + "오프라인 모의 커넥터와 실제 채널 커넥터가 함께 켜져 있습니다. "
                    + "합성된 리뷰·문의는 판매자가 수집한 행과 구분되지 않으므로 함께 켤 수 없습니다.");
        }
        problems.addAll(inquiryWriteProblems());
        problems.addAll(agentProblems());
        return problems;
    }

    /**
     * <b>A reply send that is switched on but cannot carry anything.</b> Pilot Readiness v3 §2-2 (S1).
     *
     * <p>This is the same failure class as a keyless vault, and it costs more than the others,
     * because of where in the lifecycle it lands. {@code PublishExecutionWiring} registers the Cafe24
     * adapter on {@code execution-enabled} AND the Cafe24 connector flag — <em>the arming values are
     * not part of that condition</em>. So a half-armed deployment has a real adapter bean, the
     * publish core's fail-fast finds one and lets the confirm through, the single-use approval is
     * bound and the work item moves to {@code ACTION_PENDING} — and only then does the adapter refuse
     * on its own blank {@code client_ip} or {@code shop_no = 0} and come back as a retryable failure.
     *
     * <p>Nothing was sent and nothing is corrupt; the lifecycle is behaving exactly as designed.
     * What is wrong is that the seller pressed the one irreversible-looking control in the product
     * and got a failure that no screen can explain and no retry can fix, because the missing value is
     * on the host. Every one of these is knowable at boot, and none of them was said at boot.
     *
     * <p><b>Off is checked for nothing.</b> {@code execution-enabled} is false by default and on that
     * default no adapter bean exists at all, so a deployment that does not send must boot with every
     * value below blank — which is the posture this pilot ships in.
     */
    List<String> inquiryWriteProblems() {
        List<String> problems = new ArrayList<>();
        if (!inquiryPublishEnabled) {
            return problems;
        }
        // Per channel, because the adapter beans are per channel: a Cafe24-only deployment must not
        // be asked for NAVER's approval id, for the same reason it is not asked for NAVER's egress IP.
        if (cafe24Enabled) {
            if (blank(cafe24ClientIp)) {
                problems.add("SELLEROPS_INQUIRY_PUBLISH_CAFE24_CLIENT_IP — "
                        + "답변 등록을 켰지만 카페24가 요구하는 작성자 IP(이 배포의 외부 주소)가 없습니다. "
                        + "승인은 소진되고 전송은 되지 않습니다.");
            }
            if (cafe24ShopNo <= 0) {
                problems.add("SELLEROPS_INQUIRY_PUBLISH_CAFE24_SHOP_NO — "
                        + "답변 등록을 켰지만 어느 상점에 쓸지가 정해지지 않았습니다 "
                        + "(관측된 값이어야 하며 기본값 1을 가정하지 않습니다). 승인은 소진되고 전송은 되지 않습니다.");
            }
            if (blank(cafe24LiveApprovalId)) {
                problems.add("SELLEROPS_INQUIRY_PUBLISH_CAFE24_LIVE_APPROVAL_ID — "
                        + "답변 등록을 켰지만 라이브 실행 승인 ID가 없어 요청이 조립되기 전에 거부됩니다. "
                        + "승인은 소진되고 전송은 되지 않습니다.");
            }
        }
        if (naverEnabled && blank(naverLiveApprovalId)) {
            problems.add("SELLEROPS_INQUIRY_PUBLISH_NAVER_LIVE_APPROVAL_ID — "
                    + "답변 등록을 켰지만 네이버 라이브 실행 승인 ID가 없어 답변이 나갈 수 없습니다. "
                    + "승인은 소진되고 전송은 되지 않습니다.");
        }
        return problems;
    }

    /**
     * <b>An AI capability that is switched on but can reach nobody.</b> Pilot Readiness Closure v1 §4.
     *
     * <p>Same failure class as a keyless vault: the deployment starts, the chat box accepts a
     * sentence, and every free-language turn comes back 「AI 계획 기능이 꺼져 있습니다」 while the
     * operator's configuration says it is on. Two conditions, both unambiguous:
     *
     * <ul>
     *   <li>enabled with no key — the call cannot be made at all;</li>
     *   <li>enabled and keyed, but no organisation may make the call — the list is empty and no
     *       policy widens it. This is exactly the pilot trap: the operator turned the Agent on and
     *       every seller still sees it off. A capability that declines the widening
     *       ({@code admitsPolicyWidening() == false} — the three knowledge-retrieval ones) is held
     *       to its own list under EVERY scope, so this is the only thing that keeps that trap shut
     *       for them once {@code CONNECTED_SELLERS} stops answering on their behalf.</li>
     * </ul>
     *
     * <p>A capability that is OFF is checked for nothing, for the reason every connector is: the
     * honest default posture must boot.
     */
    List<String> agentProblems() {
        List<String> problems = new ArrayList<>();
        boolean allowList = agentAccessScope == null || agentAccessScope.isBlank()
                || agentAccessScope.trim().equalsIgnoreCase("ALLOW_LIST");
        for (AgentCapabilityGate capability : agentCapabilities) {
            if (!capability.isEnabled()) {
                continue;
            }
            String name = capability.capabilityName();
            if (!capability.isDeployed()) {
                problems.add(name + "_API_KEY — 이 AI 기능을 켰지만 호출할 키가 없습니다.");
            } else if (!capability.admitsPolicyWidening() && !capability.namesAnyOrg()) {
                problems.add(name + "_ORG_IDS — 이 AI 기능을 켰지만 사용할 수 있는 조직이 하나도 없습니다 "
                        + "(이 기능은 접근 정책으로 확대되지 않으므로 조직을 직접 나열해야 합니다).");
            } else if (allowList && !capability.namesAnyOrg()) {
                problems.add(name + "_ORG_IDS / SELLEROPS_AGENT_ACCESS_SCOPE — "
                        + "이 AI 기능을 켰지만 사용할 수 있는 조직이 하나도 없습니다 "
                        + "(조직을 나열하거나, 접근 정책을 CONNECTED_SELLERS로 설정하세요).");
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
