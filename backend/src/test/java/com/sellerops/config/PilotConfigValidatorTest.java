package com.sellerops.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

/**
 * <b>A connector that is on but cannot work must say so at boot</b> — Pilot Runtime Foundation v1
 * §4 / §15-H / §15-I.
 *
 * <p>The two halves are equally load-bearing. A deployment that talks to no Coupang must start
 * perfectly with no Coupang secret (otherwise the honest default posture is unbootable), and a
 * deployment that switched a channel on while its required values are blank must stop — because the
 * alternative is a screen that offers 「연결하기」 and fails at the moment the seller presses it,
 * after the consent, on the last step.
 */
class PilotConfigValidatorTest {

    private static final String HTTPS = "https://pilot.example.com/api/connect/cafe24/callback";
    private static final String LOOPBACK = "http://localhost:8080/api/connect/cafe24/callback";

    private PilotConfigValidator v(boolean naver, boolean coupang, boolean cafe24, String vault,
                                   String egress, String id, String secret, String redirect) {
        return new PilotConfigValidator(naver, coupang, cafe24, vault, egress, id, secret, redirect,
                "ALLOW_LIST", false, java.util.List.of());
    }

    /** An AI capability with three switches, everything else off. */
    private PilotConfigValidator agent(String scope, boolean enabled, String key, String orgIds) {
        return new PilotConfigValidator(false, false, false, "", "", "", "", "",
                scope, false, java.util.List.of(capability(enabled, key, orgIds)));
    }

    /** One AI capability, described the way the real property beans describe themselves. */
    private com.sellerops.agent.access.AgentCapabilityGate capability(boolean enabled, String key, String orgIds) {
        return new com.sellerops.agent.access.AgentCapabilityGate() {
            @Override public String capabilityName() { return "SELLEROPS_AGENT_PLAN"; }
            @Override public boolean isEnabled() { return enabled; }
            @Override public boolean isDeployed() { return enabled && !key.isBlank(); }
            @Override public boolean namesAnyOrg() { return !orgIds.isBlank(); }
            @Override public boolean isConfiguredFor(java.util.UUID orgId) { return !orgIds.isBlank(); }
        };
    }

    @Test
    void planCapabilityOff_needsNothing() {
        assertThat(agent("ALLOW_LIST", false, "", "").problems())
                .as("a capability nobody turned on is not a misconfiguration").isEmpty();
    }

    @Test
    void planEnabledWithoutKey_refusesToBoot() {
        assertThat(agent("ALLOW_LIST", true, "", "*").problems())
                .singleElement().asString().contains("SELLEROPS_AGENT_PLAN_API_KEY");
    }

    @Test
    void planEnabledAndKeyedButNoOrgMayUseIt_refusesToBoot() {
        assertThat(agent("ALLOW_LIST", true, "sk-key", "").problems())
                .as("the pilot trap: switched on, and off for every seller")
                .singleElement().asString().contains("SELLEROPS_AGENT_ACCESS_SCOPE");
    }

    @Test
    void connectedSellersScope_needsNoWrittenDownOrgList() {
        assertThat(agent("CONNECTED_SELLERS", true, "sk-key", "").problems())
                .as("the database answers who may use it — an empty list is the correct state")
                .isEmpty();
    }

    /**
     * Pilot Release Closure v1 §2 — a capability that declines the deployment-wide widening (the
     * three knowledge-retrieval ones) is held to its own list under EVERY scope, so the pilot trap
     * («on, keyed, and off for everybody, silently») has to be shut here instead. The advice differs
     * too: telling this operator to set CONNECTED_SELLERS would be advice that does nothing.
     */
    @Test
    void aCapabilityThatDeclinesTheWidening_stillNeedsAWrittenDownOrgList() {
        PilotConfigValidator narrow = new PilotConfigValidator(false, false, false, "", "", "", "", "",
                "CONNECTED_SELLERS", false, java.util.List.of(narrowCapability(true, "sk-key", "")));
        assertThat(narrow.problems()).singleElement().asString()
                .contains("SELLEROPS_KNOWLEDGE_INTENT_ORG_IDS")
                .doesNotContain("CONNECTED_SELLERS");
        assertThatThrownBy(narrow::validate).isInstanceOf(IllegalStateException.class);

        PilotConfigValidator named = new PilotConfigValidator(false, false, false, "", "", "", "", "",
                "CONNECTED_SELLERS", false,
                java.util.List.of(narrowCapability(true, "sk-key", "11111111-1111-1111-1111-111111111111")));
        assertThat(named.problems()).as("named: the correct pilot configuration").isEmpty();
    }

    /** Same shape as {@link #capability}, but declining the policy widening. */
    private com.sellerops.agent.access.AgentCapabilityGate narrowCapability(
            boolean enabled, String key, String orgIds) {
        return new com.sellerops.agent.access.AgentCapabilityGate() {
            @Override public String capabilityName() { return "SELLEROPS_KNOWLEDGE_INTENT"; }
            @Override public boolean isEnabled() { return enabled; }
            @Override public boolean isDeployed() { return enabled && !key.isBlank(); }
            @Override public boolean namesAnyOrg() { return !orgIds.isBlank(); }
            @Override public boolean isConfiguredFor(java.util.UUID orgId) { return !orgIds.isBlank(); }
            @Override public boolean admitsPolicyWidening() { return false; }
        };
    }

    /** H — nothing is on, nothing is configured, and that is a correct deployment. */
    @Test
    void everyConnectorOff_bootsWithNoSecretsAtAll() {
        PilotConfigValidator validator = v(false, false, false, "", "", "", "", "");
        assertThat(validator.problems()).isEmpty();
        validator.validate();
    }

    /** H — and a connector that is off does not drag its own missing configuration in. */
    @Test
    void oneConnectorOn_doesNotDemandAnotherConnectorsConfiguration() {
        assertThat(v(true, false, false, "key", "203.0.113.7", "", "", "").problems()).isEmpty();
    }

    /** I — the vault is what every connector ends in, so any of them turning on requires it. */
    @Test
    void anyConnectorOnWithNoVaultKey_isRefused() {
        assertThat(v(false, true, false, "", "", "", "", "").problems())
                .anySatisfy(p -> assertThat(p).contains("SELLEROPS_VAULT_MASTER_KEY"));
        assertThatThrownBy(() -> v(false, true, false, "", "", "", "", "").validate())
                .isInstanceOf(IllegalStateException.class);
    }

    /**
     * The offline fixture and a real marketplace connector, in one database. Both switches are doing
     * what they were set to do, which is why nothing else in the system will ever complain: the
     * synthesized rows and the collected rows land in the same tables as {@code data_origin=REAL} and
     * become inseparable. Refusing at boot is the only moment the two are still distinguishable.
     */
    @Test
    void theOfflineMockAndARealConnectorMayNotBeOnTogether() {
        PilotConfigValidator mixed = new PilotConfigValidator(false, false, true, "key", "",
                "id", "secret", HTTPS, "ALLOW_LIST", true, java.util.List.of());

        assertThat(mixed.problems())
                .anySatisfy(p -> assertThat(p).contains("SELLEROPS_CONNECTOR_MOCK_ENABLED"));
        assertThatThrownBy(mixed::validate).isInstanceOf(IllegalStateException.class);
    }

    /** A local stack running the fixture alone is exactly what the fixture is for. */
    @Test
    void theOfflineMockAloneIsNotAProblem() {
        assertThat(new PilotConfigValidator(false, false, false, "", "", "", "", "",
                "ALLOW_LIST", true, java.util.List.of()).problems()).isEmpty();
    }

    /** I — NAVER without an advertised call IP tells the seller to register a value we cannot name. */
    @Test
    void naverOnWithNoAdvertisedEgressIp_isRefused() {
        assertThat(v(true, false, false, "key", "", "", "", "").problems())
                .anySatisfy(p -> assertThat(p).contains("ADVERTISED_EGRESS_IPS"));
    }

    /** I — Cafe24 without app credentials cannot even begin a consent. */
    @Test
    void cafe24OnWithNoAppCredentials_isRefused() {
        assertThat(v(false, false, true, "key", "", "", "", HTTPS).problems())
                .anySatisfy(p -> assertThat(p).contains("CAFE24_CLIENT_ID"));
    }

    /**
     * I — and the callback default is a problem, not a convenience: the registered URI, the authorize
     * URL and the token exchange must be byte-identical, and the exchange reads this property.
     */
    @Test
    void cafe24CallbackMustBeAReachableHttpsAddress() {
        assertThat(PilotConfigValidator.redirectUriProblem(HTTPS)).isNull();
        assertThat(PilotConfigValidator.redirectUriProblem(LOOPBACK)).isNotNull();
        assertThat(PilotConfigValidator.redirectUriProblem("http://pilot.example.com/cb")).isNotNull();
        assertThat(PilotConfigValidator.redirectUriProblem("")).isNotNull();
        assertThat(PilotConfigValidator.redirectUriProblem("not a url")).isNotNull();
    }

    /** A fully configured pilot host passes, and the message never carries a value. */
    @Test
    void aFullyConfiguredPilotHostPasses() {
        PilotConfigValidator validator =
                v(true, true, true, "key", "203.0.113.7", "cid", "csecret", HTTPS);
        assertThat(validator.problems()).isEmpty();
        validator.validate();
    }

    @Test
    void theMessageNamesEnvironmentVariablesAndNeverValues() {
        String message = String.join("\n", v(true, false, true, "", "", "", "", LOOPBACK).problems());
        assertThat(message).contains("SELLEROPS_");
        assertThat(message).doesNotContain("localhost:8080");
    }
}
