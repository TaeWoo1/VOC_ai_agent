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
 *
 * <p><b>Pilot Release Closure v1 §2 reversed the widening for these three, and the reversal is the
 * point of the tests below.</b> The trap above was real and the seam is the right one; what was
 * wrong was the answer it gave here. {@code CONNECTED_SELLERS} means «a seller who connected a
 * channel may use the Agent», and these three capabilities are not the Agent — they send the
 * CUSTOMER'S question to a vendor on paths that call no model. A seller who finished an OAuth
 * consent asked for collection, not for that, so admission stays a written-down decision.
 *
 * <p>The trap stays shut by the other half of the change: {@code PilotConfigValidator} now REFUSES
 * to boot a knowledge capability that is enabled and keyed and names no organisation, under every
 * scope. Silence was the defect; the fix is a refusal, not a widening.
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
    @DisplayName("connecting a channel does NOT admit a seller to retrieval — being named does")
    void thePolicyDoesNotWidenTheseThree() {
        AgentCapabilityAccess policy = connectedSellers();
        // Enabled, keyed, naming nobody: a connected seller is still not a subject of these calls.
        assertThat(new KnowledgeEmbeddingService(embedding(), null, policy, null)
                .enabledFor(CONNECTED)).isFalse();
        assertThat(new KnowledgeQuestionIntent(intent(), policy, null).enabledFor(CONNECTED)).isFalse();
        assertThat(new KnowledgeEvidenceEligibility(eligibility(), policy, null)
                .enabledFor(CONNECTED)).isFalse();

        // Written down: admitted, under the very same policy.
        assertThat(new KnowledgeQuestionIntent(
                new KnowledgeQuestionIntentProperties(true, CONNECTED.toString(), "m", "k", 400, "minimal"),
                policy, null).enabledFor(CONNECTED)).isTrue();

        // And a drive-by signup that has connected nothing spends nothing — still true, now for the
        // stronger reason that nothing but the list can admit it.
        assertThat(new KnowledgeQuestionIntent(intent(), policy, null).enabledFor(SIGNED_UP_ONLY))
                .isFalse();
    }

    /**
     * The declaration itself, so the reversal cannot be undone by a quiet edit to one capability:
     * all three decline the widening, while the Agent's own capabilities keep it (that half is
     * asserted where the policy lives, {@code AgentCapabilityAccessTest}). The boot refusal that
     * keeps the original trap shut is asserted in {@code PilotConfigValidatorTest}.
     */
    @Test
    @DisplayName("all three decline the deployment-wide widening")
    void allThreeDeclineTheWidening() {
        assertThat(embedding().admitsPolicyWidening()).isFalse();
        assertThat(intent().admitsPolicyWidening()).isFalse();
        assertThat(eligibility().admitsPolicyWidening()).isFalse();
        // Enabled and keyed while naming nobody is the shape the validator refuses.
        assertThat(intent().isDeployed()).isTrue();
        assertThat(intent().namesAnyOrg()).isFalse();
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
        // A named organisation stays admitted under every policy — and an unnamed one is refused
        // under every policy, which is what changed.
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
        // The wildcard is still the wildcard: it is the capability's OWN list saying "everyone",
        // which no scope had to widen and this change does not touch.
        assertThat(new KnowledgeQuestionIntent(
                new KnowledgeQuestionIntentProperties(true, "*", "m", "k", 400, "minimal"), policy, null)
                .enabledFor(SIGNED_UP_ONLY)).as("explicit wildcard").isTrue();
        assertThat(KnowledgeQuestionIntent.disabled().enabledFor(CONNECTED)).isFalse();
        assertThat(KnowledgeEvidenceEligibility.disabled().enabledFor(CONNECTED)).isFalse();
    }
}
