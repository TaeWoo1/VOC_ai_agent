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
        return new PilotConfigValidator(naver, coupang, cafe24, vault, egress, id, secret, redirect);
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
