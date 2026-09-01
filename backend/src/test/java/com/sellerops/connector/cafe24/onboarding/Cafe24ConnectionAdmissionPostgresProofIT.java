package com.sellerops.connector.cafe24.onboarding;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.agent.access.AgentCapabilityAccess;
import com.sellerops.agent.llm.operator.AgentPlanProperties;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.connector.cafe24.Cafe24HttpClient;
import com.sellerops.credential.ConnectorCredentialRepository;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.http.MediaType;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

/**
 * <b>Signup → refused → the product's own connection flow → admitted, in one running process.</b>
 * Pilot Connection &amp; External Proof Gate v1 §2.
 *
 * <p>{@link com.sellerops.agent.access.ConnectionAdmissionTest} fixes the same contract at service
 * level and runs in ordinary CI. This one answers the question that class cannot: whether the whole
 * deployed shape agrees — real Flyway over real PostgreSQL, the real Spring context booted the way a
 * pilot host boots it ({@code SELLEROPS_AGENT_ACCESS_SCOPE=CONNECTED_SELLERS}, an allow-list naming
 * nobody, the demo seeder off, the offline mock connector off), the real HTTP endpoints with real
 * JWT authentication, the real {@code PilotConfigValidator} passing at ApplicationReady, and the real
 * partial-index-backed {@code seller_accounts} table underneath.
 *
 * <p><b>Opt-in only.</b> Gated by {@code SELLEROPS_PG_PROOF=1}; without it the class is skipped, so
 * CI and the ordinary H2 gate are unaffected. Point it at a disposable database with
 * {@code SELLEROPS_PG_URL} — never a real one.
 *
 * <h2>Exactly what is faked, and what stays external</h2>
 *
 * <p>One bean: {@link Cafe24HttpClient}, which its own docblock calls "the single, fakeable HTTP
 * boundary of the Cafe24 connector". Everything on this side of it is the product — the connect
 * controller, the state guard, the mall-identity gate, the token request this repository builds, the
 * credential sealing, the status transition, the admission query and the access policy.
 *
 * <p>The app credentials in the properties below are placeholders and are never sent anywhere: the
 * stub asserts a Basic header exists and answers locally. What stays external and is <b>not</b>
 * claimed here: a real mall's consent screen, the authorization code it issues, and whether that
 * mall's token endpoint accepts the request this client builds. Their live proof is a first pilot
 * seller's first connection.
 *
 * <p>The Agent's side of the ending is asserted on the real policy bean rather than by calling
 * {@code POST /api/agent/plan} a second time. Past the gate that endpoint issues a paid request to
 * the model vendor, and a test must not buy one to learn something the gate already answered — the
 * refusal, which costs nothing, IS asserted over HTTP.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.MOCK)
@EnabledIfEnvironmentVariable(named = "SELLEROPS_PG_PROOF", matches = "1")
class Cafe24ConnectionAdmissionPostgresProofIT {

    private static final String MALL = "pilotproofmall";
    private static final AtomicInteger TOKEN_EXCHANGES = new AtomicInteger();

    @DynamicPropertySource
    static void pilotShapedDeployment(DynamicPropertyRegistry registry) {
        String url = System.getenv().getOrDefault("SELLEROPS_PG_URL",
                "jdbc:postgresql://localhost:55432/sellerops");
        registry.add("spring.datasource.url", () -> url);
        registry.add("spring.datasource.username", () -> "sellerops");
        registry.add("spring.datasource.password", () -> "sellerops_local_pw");
        registry.add("spring.flyway.enabled", () -> "true");
        registry.add("spring.jpa.hibernate.ddl-auto", () -> "none");

        // A pilot host: no demo organisation, no demo content, the channel catalogue present because
        // it is product reference data and the only producer of the `channels` table.
        registry.add("sellerops.seed.enabled", () -> "false");
        registry.add("sellerops.seed.demo-content", () -> "false");

        // The fence this package closed: neither the fixture connector nor the generic fallback.
        registry.add("sellerops.connector.mock.enabled", () -> "false");
        registry.add("sellerops.connector.mock-fallback.enabled", () -> "false");

        // Cafe24 on, configured the way PilotConfigValidator demands — app credentials are
        // placeholders and never leave the process, the callback is an absolute HTTPS address.
        registry.add("sellerops.connector.cafe24.enabled", () -> "true");
        registry.add("sellerops.connector.cafe24.api-version", () -> "2025-12-01");
        registry.add("sellerops.connector.cafe24.oauth.client-id", () -> "proof-client-id");
        registry.add("sellerops.connector.cafe24.oauth.client-secret", () -> "proof-client-secret");
        registry.add("sellerops.connector.cafe24.oauth.redirect-uri",
                () -> "https://pilot.example.com/api/connect/cafe24/callback");
        registry.add("sellerops.connector.cafe24.oauth.result-redirect-url",
                () -> "https://pilot.example.com/connect/cafe24/result");
        registry.add("sellerops.vault.master-key-base64",
                () -> java.util.Base64.getEncoder().encodeToString(new byte[32]));
        registry.add("sellerops.vault.key-id", () -> "proof-key");

        // The Agent: deployed, and naming no organisation at all. Admission has to come from
        // somewhere other than configuration or this proof proves nothing.
        registry.add("sellerops.agent.access.scope", () -> "CONNECTED_SELLERS");
        registry.add("sellerops.agent.plan.enabled", () -> "true");
        registry.add("sellerops.agent.plan.api-key", () -> "proof-not-a-real-key");
        registry.add("sellerops.agent.plan.org-ids", () -> "");

        // Background work stays off: this proof is about one request path, not a running pilot.
        registry.add("sellerops.self-pilot.enabled", () -> "false");
        registry.add("sellerops.proactive.enabled", () -> "false");
    }

    /** The mall's side of the token exchange — the one boundary this proof does not own. */
    @TestConfiguration
    static class StubbedMallBoundary {
        @Bean
        @Primary
        Cafe24HttpClient stubbedMallHttp() {
            return new Cafe24HttpClient() {
                @Override
                public Response postForm(URI uri, Map<String, String> headers, Map<String, String> form) {
                    TOKEN_EXCHANGES.incrementAndGet();
                    assertThat(uri.getHost()).isEqualTo(MALL + ".cafe24api.com");
                    assertThat(form).containsEntry("grant_type", "authorization_code");
                    assertThat(headers.get("Authorization")).startsWith("Basic ");
                    return new Response(200, """
                            {"access_token":"at","refresh_token":"rt",
                             "expires_at":"2099-01-01T00:00:00.000",
                             "refresh_token_expires_at":"2099-01-01T00:00:00.000",
                             "scopes":["mall.read_community","mall.read_order","mall.read_product"]}
                            """, Map.of());
                }

                @Override
                public Response get(URI uri, Map<String, String> headers) {
                    throw new AssertionError("this proof makes no marketplace read: " + uri.getPath());
                }
            };
        }
    }

    @Autowired WebApplicationContext wac;
    @Autowired SellerAccountRepository accounts;
    @Autowired ConnectorCredentialRepository credentials;
    @Autowired AgentCapabilityAccess access;
    @Autowired AgentPlanProperties plan;

    private final ObjectMapper json = new ObjectMapper();

    private MockMvc mvc() {
        return MockMvcBuilders.webAppContextSetup(wac)
                .apply(org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers
                        .springSecurity())
                .build();
    }

    /** A brand-new seller, created the way a real one is: the product's own signup endpoint. */
    private String signUp(MockMvc mvc, String slug) throws Exception {
        String body = json.writeValueAsString(Map.of(
                "email", slug + "@example.com",
                "password", "proof-password-1",
                "name", "파일럿 판매자",
                "orgName", "파일럿 " + slug,
                "termsAccepted", true));
        MvcResult result = mvc.perform(post("/api/auth/signup")
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andReturn();
        assertThat(result.getResponse().getStatus()).isEqualTo(200);
        return json.readTree(result.getResponse().getContentAsString(StandardCharsets.UTF_8)).get("token").asText();
    }

    /** What the Agent tells this seller when they ask it something. */
    private JsonNode askTheAgent(MockMvc mvc, String token) throws Exception {
        MvcResult result = mvc.perform(post("/api/agent/plan")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"goalText\":\"오늘 확인할 일 알려줘\",\"toolCatalogue\":[]}"))
                .andReturn();
        assertThat(result.getResponse().getStatus()).isEqualTo(200);
        return json.readTree(result.getResponse().getContentAsString(StandardCharsets.UTF_8));
    }

    private static String stateParam(String authorizationUrl) {
        for (String pair : URI.create(authorizationUrl).getRawQuery().split("&")) {
            if (pair.startsWith("state=")) {
                return java.net.URLDecoder.decode(pair.substring("state=".length()), StandardCharsets.UTF_8);
            }
        }
        throw new AssertionError("the consent URL carried no state");
    }

    @Test
    void aNewSellerIsRefused_connects_andIsWorkingInTheSameProcess() throws Exception {
        MockMvc mvc = mvc();
        int exchangesBefore = TOKEN_EXCHANGES.get();
        long credentialsBefore = credentials.count();
        String slug = "pilotproof-" + UUID.randomUUID().toString().substring(0, 8);
        String token = signUp(mvc, slug);

        // 1 — the Agent is on for this deployment and off for this seller, and it says whose move it is.
        JsonNode refused = askTheAgent(mvc, token);
        assertThat(refused.get("available").asBoolean()).isFalse();
        assertThat(refused.get("unavailableMessage").asText()).contains("판매 채널을 연결");

        // 2 — the seller starts the real connection flow through the real endpoint.
        MvcResult started = mvc.perform(post("/api/connect/cafe24/start")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"mallId\":\"" + MALL + "\"}"))
                .andReturn();
        assertThat(started.getResponse().getStatus()).isEqualTo(200);
        JsonNode start = json.readTree(started.getResponse().getContentAsString(StandardCharsets.UTF_8));
        UUID accountId = UUID.fromString(start.get("sellerAccountId").asText());
        assertThat(start.get("connectionStatus").asText()).isEqualTo("PENDING");
        String authorizationUrl = start.get("authorizationUrl").asText();
        assertThat(authorizationUrl).startsWith("https://" + MALL + ".cafe24api.com/api/v2/oauth/authorize");

        SellerAccount account = accounts.findById(accountId).orElseThrow();
        UUID org = account.getOrgId();
        assertThat(access.allows(plan, org)).as("starting is not finishing").isFalse();

        // 3 — the mall redirects the seller's browser back. Unauthenticated by design: identity comes
        //     from the single-use state, and this is a top-level navigation.
        MvcResult callback = mvc.perform(get("/api/connect/cafe24/callback")
                        .param("code", "authorization-code-from-mall")
                        .param("state", stateParam(authorizationUrl))
                        .param("mall_id", MALL))
                .andReturn();
        assertThat(callback.getResponse().getStatus()).isEqualTo(302);
        assertThat(callback.getResponse().getHeader("Location")).contains("status=connected");
        // Nothing secret rode the redirect back to the browser.
        assertThat(callback.getResponse().getHeader("Location")).doesNotContain("authorization-code-from-mall");

        // 4 — the row the admission query reads was written by the flow.
        SellerAccount connected = accounts.findById(accountId).orElseThrow();
        assertThat(connected.getConnectionStatus()).isEqualTo(ChannelStatus.CONNECTED);
        assertThat(connected.isFileUpload()).isFalse();
        assertThat(TOKEN_EXCHANGES.get() - exchangesBefore).as("exactly one token exchange").isEqualTo(1);
        assertThat(credentials.count() - credentialsBefore).as("one sealed credential").isEqualTo(1);

        // 5 — admitted. Same process, same configuration, nothing restarted and nothing edited.
        assertThat(access.decide(plan, org)).isEqualTo(AgentCapabilityAccess.Decision.ALLOWED);
        assertThat(access.sellerMessage(access.decide(plan, org))).isNull();
    }

    @Test
    void aSecondSellerOnTheSameHostIsStillRefused() throws Exception {
        MockMvc mvc = mvc();
        String slug = "pilotproof-b-" + UUID.randomUUID().toString().substring(0, 8);

        JsonNode refused = askTheAgent(mvc, signUp(mvc, slug));

        assertThat(refused.get("available").asBoolean()).isFalse();
        assertThat(refused.get("unavailableMessage").asText()).contains("판매 채널을 연결");
    }
}
