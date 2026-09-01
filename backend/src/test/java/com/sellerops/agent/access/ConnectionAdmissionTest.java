package com.sellerops.agent.access;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.connector.cafe24.Cafe24ApiConnector;
import com.sellerops.connector.cafe24.Cafe24HttpClient;
import com.sellerops.connector.cafe24.onboarding.Cafe24OAuthClient;
import com.sellerops.connector.cafe24.onboarding.Cafe24OAuthStateRepository;
import com.sellerops.connector.cafe24.onboarding.Cafe24OnboardingService;
import com.sellerops.connector.cafe24.onboarding.Cafe24ScopeContract;
import com.sellerops.credential.ConnectorCredentialRepository;
import com.sellerops.credential.CredentialVault;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.util.Base64;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.PlatformTransactionManager;

/**
 * <b>The connection flow — not an operator, and not a hand-written row — is what admits an
 * organisation</b>. Pilot Connection &amp; External Proof Gate v1 §1.
 *
 * <p>Pilot Readiness Closure v1 shipped {@code CONNECTED_SELLERS} and proved the policy that READS a
 * connected account. It could not prove the flow that WRITES one: no safe test mall exists, so the
 * fixture was inserted straight into the database, and the honest report said so. What that leaves
 * unproven is not a detail — it is the whole claim. "A seller connects a channel and the Agent starts
 * working" is false if the connection flow lands in a state the admission query does not recognise,
 * and a hand-inserted row cannot tell the difference because it was written to match.
 *
 * <p>This closes it without a marketplace. The service under test is the real
 * {@link Cafe24OnboardingService}, over the real repositories, sealing a real credential through the
 * real {@link CredentialVault}, and the admission answer comes from the real
 * {@link AgentCapabilityAccess} over the real repository query. <b>One thing is faked and it is the
 * one thing that must be:</b> {@link Cafe24HttpClient}, which the interface's own docblock calls "the
 * single, fakeable HTTP boundary of the Cafe24 connector — every outbound call the connector ever
 * makes goes through this interface". The mall's token response is external; everything between the
 * seller's consent redirect and the Agent's admission decision is ours, and all of it runs here.
 *
 * <p>What remains external, stated plainly: a real mall's consent screen, the authorization code it
 * issues, and whether that mall's token endpoint answers the request this client builds. The live
 * proof of those three is a first pilot seller's first connection, and this test does not claim it.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class ConnectionAdmissionTest {

    /** A 32-byte AES key. Test-only material, generated here, never a deployment's key. */
    private static final String TEST_KEY = Base64.getEncoder().encodeToString(new byte[32]);
    private static final String MALL = "pilotmall";

    @Autowired SellerAccountRepository accounts;
    @Autowired ChannelRepository channels;
    @Autowired Cafe24OAuthStateRepository states;
    @Autowired ConnectorCredentialRepository credentials;
    @Autowired PlatformTransactionManager txManager;

    private final UUID org = UUID.randomUUID();
    private final UUID user = UUID.randomUUID();

    /** The marketplace's side of the token exchange, and nothing else. */
    private static final class MallTokenEndpoint implements Cafe24HttpClient {
        private final boolean succeed;
        int calls = 0;
        URI lastUri;

        MallTokenEndpoint(boolean succeed) {
            this.succeed = succeed;
        }

        @Override
        public Response postForm(URI uri, Map<String, String> headers, Map<String, String> form) {
            calls++;
            lastUri = uri;
            // The request the product actually built, asserted here rather than printed: an
            // authorization-code grant, carrying app credentials in the Basic header.
            assertThat(form).containsEntry("grant_type", "authorization_code");
            assertThat(headers.get("Authorization")).startsWith("Basic ");
            if (!succeed) {
                return new Response(401, "{\"error\":\"invalid_client\"}", Map.of());
            }
            return new Response(200, """
                    {"access_token":"at-test","refresh_token":"rt-test",
                     "expires_at":"2099-01-01T00:00:00.000",
                     "refresh_token_expires_at":"2099-01-01T00:00:00.000",
                     "scopes":["mall.read_community","mall.read_order","mall.read_product"]}
                    """, Map.of());
        }

        @Override
        public Response get(URI uri, Map<String, String> headers) {
            throw new AssertionError("the onboarding flow makes no GET");
        }
    }

    private Cafe24OnboardingService onboarding(MallTokenEndpoint mall) {
        Channel cafe24 = channels.findByCode(Cafe24ApiConnector.CHANNEL_CODE).orElseGet(() -> {
            Channel c = new Channel();
            c.setCode(Cafe24ApiConnector.CHANNEL_CODE);
            c.setNameKo("카페24");
            c.setStatus(ChannelStatus.AVAILABLE);
            c.setSupportsInquiry(true);
            c.setSupportsReview(true);
            c.setSupportsOrder(true);
            c.setSupportsSales(true);
            c.setSupportsProduct(true);
            c.setSortOrder(0);
            return channels.save(c);
        });
        assertThat(cafe24.getId()).isNotNull();
        return new Cafe24OnboardingService(accounts, channels, states,
                new CredentialVault(credentials, new ObjectMapper(), TEST_KEY, "test-key"),
                new Cafe24OAuthClient(mall), txManager, Clock.systemUTC(),
                "app-client-id", "app-client-secret",
                "https://pilot.example.com/api/connect/cafe24/callback",
                new Cafe24ScopeContract("mall.read_community,mall.read_order,mall.read_product", ""),
                600L);
    }

    /** The CSRF/replay guard the product put in the consent URL — read back the way Cafe24 returns it. */
    private static String stateParam(String authorizationUrl) {
        for (String pair : URI.create(authorizationUrl).getRawQuery().split("&")) {
            if (pair.startsWith("state=")) {
                return java.net.URLDecoder.decode(pair.substring("state=".length()), StandardCharsets.UTF_8);
            }
        }
        throw new AssertionError("the consent URL carried no state");
    }

    /** The policy a pilot host runs, over the real repository query. */
    private AgentCapabilityAccess pilotPolicy() {
        return new AgentCapabilityAccess("CONNECTED_SELLERS", accounts);
    }

    /** A capability that is deployed and names no organisation — the pilot posture exactly. */
    private static AgentCapabilityGate deployedNamingNobody() {
        return new AgentCapabilityGate() {
            @Override public String capabilityName() { return "SELLEROPS_AGENT_PLAN"; }
            @Override public boolean isEnabled() { return true; }
            @Override public boolean isDeployed() { return true; }
            @Override public boolean namesAnyOrg() { return false; }
            @Override public boolean isConfiguredFor(UUID orgId) { return false; }
        };
    }

    @Test
    void aSellerWhoFinishesTheOAuthFlowIsAdmitted_withNoOperatorAction() {
        MallTokenEndpoint mall = new MallTokenEndpoint(true);
        Cafe24OnboardingService service = onboarding(mall);
        AgentCapabilityAccess policy = pilotPolicy();
        AgentCapabilityGate plan = deployedNamingNobody();

        // 1 — a brand-new organisation. The Agent is on for this deployment and off for this seller,
        //     and the refusal is the seller's own next step rather than an operator's.
        assertThat(policy.decide(plan, org)).isEqualTo(AgentCapabilityAccess.Decision.NEEDS_CHANNEL_CONNECTION);
        assertThat(policy.sellerMessage(policy.decide(plan, org))).contains("판매 채널을 연결");

        // 2 — the seller starts the connection. An account exists; it is not connected to anything.
        Cafe24OnboardingService.StartResult start = service.start(org, user, MALL);
        assertThat(start.connectionStatus()).isEqualTo(ChannelStatus.PENDING);
        assertThat(policy.allows(plan, org)).as("starting is not finishing").isFalse();

        // 3 — the mall redirects back with a code. This is the product's own callback handling.
        Cafe24OnboardingService.CompletionResult done =
                service.complete(stateParam(start.authorizationUrl()), "auth-code-from-mall", null, MALL);

        assertThat(done.status()).isEqualTo(Cafe24OnboardingService.CompletionStatus.CONNECTED);
        assertThat(mall.calls).as("exactly one token exchange").isEqualTo(1);
        assertThat(mall.lastUri.getHost()).isEqualTo(MALL + ".cafe24api.com");

        // 4 — the row the admission query reads was written by the flow, not by this test.
        SellerAccount account = accounts.findById(done.sellerAccountId()).orElseThrow();
        assertThat(account.getConnectionStatus()).isEqualTo(ChannelStatus.CONNECTED);
        assertThat(account.isFileUpload()).as("a file-upload account is not a connection").isFalse();
        assertThat(credentials.count()).as("the credential was sealed").isEqualTo(1);

        // 5 — the same policy object, the same process, no configuration touched in between.
        assertThat(policy.decide(plan, org)).isEqualTo(AgentCapabilityAccess.Decision.ALLOWED);
        assertThat(policy.sellerMessage(policy.decide(plan, org)))
                .as("an admitted seller is told nothing; they are simply working").isNull();
    }

    @Test
    void aFailedExchangeAdmitsNobody() {
        MallTokenEndpoint mall = new MallTokenEndpoint(false);
        Cafe24OnboardingService service = onboarding(mall);
        AgentCapabilityAccess policy = pilotPolicy();
        AgentCapabilityGate plan = deployedNamingNobody();

        Cafe24OnboardingService.StartResult start = service.start(org, user, MALL);
        Cafe24OnboardingService.CompletionResult done =
                service.complete(stateParam(start.authorizationUrl()), "auth-code-from-mall", null, MALL);

        assertThat(done.status()).isEqualTo(Cafe24OnboardingService.CompletionStatus.RECONNECT_REQUIRED);
        assertThat(accounts.findById(done.sellerAccountId()).orElseThrow().getConnectionStatus())
                .isEqualTo(ChannelStatus.RECONNECT_REQUIRED);
        assertThat(credentials.count()).as("no credential is written by a failed attempt").isZero();
        assertThat(policy.allows(plan, org))
                .as("a connection that did not complete is not a connection").isFalse();
    }

    @Test
    void oneOrgFinishingAConnectionAdmitsOnlyThatOrg() {
        Cafe24OnboardingService service = onboarding(new MallTokenEndpoint(true));
        AgentCapabilityAccess policy = pilotPolicy();
        AgentCapabilityGate plan = deployedNamingNobody();
        UUID otherOrg = UUID.randomUUID();

        Cafe24OnboardingService.StartResult start = service.start(org, user, MALL);
        service.complete(stateParam(start.authorizationUrl()), "auth-code-from-mall", null, MALL);

        assertThat(policy.allows(plan, org)).isTrue();
        assertThat(policy.decide(plan, otherOrg))
                .isEqualTo(AgentCapabilityAccess.Decision.NEEDS_CHANNEL_CONNECTION);
    }

    /**
     * The manual file-upload path also reaches {@code CONNECTED}, and deliberately does not admit:
     * a seller who uploaded a spreadsheet has given the Agent nothing to keep current, and the
     * admission predicate has excluded file-upload accounts since Self-Pilot Runtime v1. Asserted
     * here because it is the one way the two states could quietly converge.
     */
    @Test
    void aFileUploadAccountIsConnectedAndStillNotAdmitted() {
        Channel channel = channels.save(fileChannel());
        SellerAccount manual = new SellerAccount();
        manual.setOrgId(org);
        manual.setChannelId(channel.getId());
        manual.setConnectionStatus(ChannelStatus.CONNECTED);
        manual.setFileUpload(true);
        accounts.save(manual);

        assertThat(pilotPolicy().decide(deployedNamingNobody(), org))
                .isEqualTo(AgentCapabilityAccess.Decision.NEEDS_CHANNEL_CONNECTION);
    }

    private static Channel fileChannel() {
        Channel c = new Channel();
        c.setCode("FILE_UPLOAD");
        c.setNameKo("파일 업로드");
        c.setStatus(ChannelStatus.AVAILABLE);
        c.setSupportsInquiry(true);
        c.setSupportsReview(true);
        c.setSupportsOrder(true);
        c.setSupportsSales(true);
        c.setSupportsProduct(true);
        c.setSortOrder(99);
        return c;
    }
}
