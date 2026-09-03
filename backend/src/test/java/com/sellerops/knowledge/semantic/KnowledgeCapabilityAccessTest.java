package com.sellerops.knowledge.semantic;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.sellerops.agent.access.AgentCapabilityAccess;
import com.sellerops.selleraccount.SellerAccountRepository;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * <b>A switch that is on, keyed, and reaches nobody is a defect, not a posture.</b>
 * Retrieval Runtime Closure v1 §5.
 *
 * <p>The three retrieval capabilities read their own allow-list directly, while the Agent's plan,
 * draft and judge capabilities ask {@link AgentCapabilityAccess} — the seam Pilot Readiness Closure
 * v1 added precisely so that admitting a pilot seller stops meaning "paste a UUID into an
 * environment file and restart". A pilot host therefore had a combination that did nothing and said
 * nothing: {@code SELLEROPS_AGENT_ACCESS_SCOPE=CONNECTED_SELLERS} with
 * {@code SELLEROPS_KNOWLEDGE_INTENT_ENABLED=true} and a key — the boot validator does not complain
 * (the scope is not ALLOW_LIST, so an empty list is expected) and every search silently ran without
 * the capability.
 *
 * <p>The policy only ever widens, and only the ORGANISATION question. The flag, the key and the
 * explicit list stay each capability's own, so a deployment can still run any subset.
 */
class KnowledgeCapabilityAccessTest {

    private static final UUID CONNECTED = UUID.randomUUID();
    private static final UUID SIGNED_UP_ONLY = UUID.randomUUID();

    private static AgentCapabilityAccess connectedSellers() {
        SellerAccountRepository accounts = mock(SellerAccountRepository.class);
        when(accounts.hasConnectedApiAccount(CONNECTED)).thenReturn(true);
        when(accounts.hasConnectedApiAccount(SIGNED_UP_ONLY)).thenReturn(false);
        return new AgentCapabilityAccess("CONNECTED_SELLERS", accounts);
    }

    /** Enabled, keyed, and naming no organisation — the pilot's own configuration. */
    private static KnowledgeEmbeddingProperties embedding() {
        return new KnowledgeEmbeddingProperties(true, "", "m", "k", 1024);
    }

    private static KnowledgeQuestionIntentProperties intent() {
        return new KnowledgeQuestionIntentProperties(true, "", "m", "k", 400, "minimal");
    }

    private static KnowledgeEligibilityProperties eligibility() {
        return new KnowledgeEligibilityProperties(true, "", "m", "k", 600, "minimal");
    }

    @Test
    @DisplayName("under the pilot's policy, a seller who connected a channel is admitted without an env edit")
    void thePolicyAnswersTheOrganisationQuestion() {
        AgentCapabilityAccess policy = connectedSellers();
        assertThat(new KnowledgeEmbeddingService(embedding(), null, policy, null)
                .enabledFor(CONNECTED)).isTrue();
        assertThat(new KnowledgeQuestionIntent(intent(), policy, null).enabledFor(CONNECTED)).isTrue();
        assertThat(new KnowledgeEvidenceEligibility(eligibility(), policy, null)
                .enabledFor(CONNECTED)).isTrue();

        // And a drive-by signup that has connected nothing spends nothing — the hazard the wildcard
        // cannot fence.
        assertThat(new KnowledgeQuestionIntent(intent(), policy, null).enabledFor(SIGNED_UP_ONLY))
                .isFalse();
    }

    /**
     * The default is byte-identical to what shipped: only the organisations written down.
     */
    @Test
    @DisplayName("under the default policy nothing widens — the written-down list still decides")
    void theDefaultIsUnchanged() {
        AgentCapabilityAccess allowList =
                new AgentCapabilityAccess("ALLOW_LIST", mock(SellerAccountRepository.class));
        assertThat(new KnowledgeQuestionIntent(intent(), allowList, null).enabledFor(CONNECTED))
                .isFalse();
        KnowledgeQuestionIntentProperties named =
                new KnowledgeQuestionIntentProperties(true, CONNECTED.toString(), "m", "k", 400, "minimal");
        assertThat(new KnowledgeQuestionIntent(named, allowList, null).enabledFor(CONNECTED)).isTrue();
        // A named organisation stays admitted under every policy.
        assertThat(new KnowledgeQuestionIntent(named, connectedSellers(), null)
                .enabledFor(SIGNED_UP_ONLY)).isFalse();
        assertThat(new KnowledgeQuestionIntent(named, connectedSellers(), null)
                .enabledFor(CONNECTED)).isTrue();
    }

    /**
     * No policy overrides the deployment question: a capability with no flag or no key is off for
     * everyone, whatever the scope says.
     */
    @Test
    @DisplayName("the policy widens the organisation question and nothing else")
    void noPolicyTurnsOnAnUnconfiguredCapability() {
        AgentCapabilityAccess policy = connectedSellers();
        assertThat(new KnowledgeQuestionIntent(
                new KnowledgeQuestionIntentProperties(true, "*", "m", "", 400, "minimal"), policy, null)
                .enabledFor(CONNECTED)).as("no key").isFalse();
        assertThat(new KnowledgeQuestionIntent(
                new KnowledgeQuestionIntentProperties(false, "*", "m", "k", 400, "minimal"), policy, null)
                .enabledFor(CONNECTED)).as("no flag").isFalse();
        assertThat(KnowledgeQuestionIntent.disabled().enabledFor(CONNECTED)).isFalse();
        assertThat(KnowledgeEvidenceEligibility.disabled().enabledFor(CONNECTED)).isFalse();
    }
}
