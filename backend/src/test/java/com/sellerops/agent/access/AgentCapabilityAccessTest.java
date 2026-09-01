package com.sellerops.agent.access;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.sellerops.selleraccount.SellerAccountRepository;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/**
 * Pilot Readiness Closure v1 §2 — admitting a seller must not be an environment edit.
 *
 * <p>What these fix in place is the DIRECTION the policy may move: it widens the organisation
 * question and nothing else. A capability with no key stays off under every scope; an organisation
 * written into a capability's own list stays admitted under every scope; and the default scope
 * reproduces the behaviour that existed before this class, so no deployment changes by upgrading.
 */
class AgentCapabilityAccessTest {

    private static final UUID ORG = UUID.fromString("11111111-1111-4111-8111-111111111111");
    private static final UUID OTHER = UUID.fromString("22222222-2222-4222-8222-222222222222");

    /** A capability whose configuration is exactly "deployed, and this list of orgs". */
    private static AgentCapabilityGate gate(boolean deployed, UUID... listed) {
        return new AgentCapabilityGate() {
            @Override
            public String capabilityName() {
                return "SELLEROPS_AGENT_PLAN";
            }

            @Override
            public boolean isEnabled() {
                return deployed;
            }

            @Override
            public boolean namesAnyOrg() {
                return listed.length > 0;
            }

            @Override
            public boolean isDeployed() {
                return deployed;
            }

            @Override
            public boolean isConfiguredFor(UUID orgId) {
                for (UUID id : listed) {
                    if (id.equals(orgId)) {
                        return true;
                    }
                }
                return false;
            }
        };
    }

    @Test
    void defaultScopeIsTheAllowListThatExistedBefore() {
        AgentCapabilityAccess access = new AgentCapabilityAccess("", mock(SellerAccountRepository.class));

        assertThat(access.scope()).isEqualTo(AgentCapabilityAccess.Scope.ALLOW_LIST);
        assertThat(access.allows(gate(true, ORG), ORG)).isTrue();
        assertThat(access.allows(gate(true, ORG), OTHER)).isFalse();
    }

    @Test
    void noKeyMeansOffForEveryone_underEveryScope() {
        SellerAccountRepository accounts = mock(SellerAccountRepository.class);
        for (String scope : new String[] {"ALLOW_LIST", "CONNECTED_SELLERS", "ALL_ORGS"}) {
            AgentCapabilityAccess access = new AgentCapabilityAccess(scope, accounts);
            assertThat(access.decide(gate(false, ORG), ORG))
                    .as("scope %s must not widen a deployment that cannot make the call", scope)
                    .isEqualTo(AgentCapabilityAccess.Decision.NOT_DEPLOYED);
        }
        verifyNoInteractions(accounts);
    }

    @Test
    void connectedSellersAdmitsAnOrgThatFinishedAConnection_withNoEnvEdit() {
        SellerAccountRepository accounts = mock(SellerAccountRepository.class);
        when(accounts.hasConnectedApiAccount(ORG)).thenReturn(true);
        when(accounts.hasConnectedApiAccount(OTHER)).thenReturn(false);
        AgentCapabilityAccess access = new AgentCapabilityAccess("CONNECTED_SELLERS", accounts);

        assertThat(access.allows(gate(true), ORG)).as("connected ⇒ admitted, listed nowhere").isTrue();
        assertThat(access.decide(gate(true), OTHER))
                .as("connected nothing ⇒ the seller's own next step, not an operator's")
                .isEqualTo(AgentCapabilityAccess.Decision.NEEDS_CHANNEL_CONNECTION);
    }

    @Test
    void anExplicitlyListedOrgStaysAdmittedEvenWhenItHasConnectedNothing() {
        SellerAccountRepository accounts = mock(SellerAccountRepository.class);
        when(accounts.hasConnectedApiAccount(ORG)).thenReturn(false);

        assertThat(new AgentCapabilityAccess("CONNECTED_SELLERS", accounts).allows(gate(true, ORG), ORG))
                .as("the policy widens; it never takes back what configuration granted").isTrue();
    }

    @Test
    void allOrgsIsTheNameForWhatAStarMeant() {
        SellerAccountRepository accounts = mock(SellerAccountRepository.class);
        assertThat(new AgentCapabilityAccess("ALL_ORGS", accounts).allows(gate(true), OTHER)).isTrue();
        verifyNoInteractions(accounts);
    }

    @Test
    void onlyTheConnectionRefusalCarriesASellerSentence() {
        AgentCapabilityAccess access = new AgentCapabilityAccess("CONNECTED_SELLERS", mock(SellerAccountRepository.class));

        assertThat(access.sellerMessage(AgentCapabilityAccess.Decision.NEEDS_CHANNEL_CONNECTION))
                .contains("판매 채널을 연결");
        assertThat(access.sellerMessage(AgentCapabilityAccess.Decision.NOT_DEPLOYED))
                .as("an operator action has no seller-side remedy to offer").isNull();
        assertThat(access.sellerMessage(AgentCapabilityAccess.Decision.NOT_ADMITTED)).isNull();
        assertThat(access.sellerMessage(AgentCapabilityAccess.Decision.ALLOWED)).isNull();
    }

    @Test
    void aMisspelledScopeIsRefusedRatherThanGuessed() {
        assertThatThrownBy(() -> new AgentCapabilityAccess("CONNECTED_SELLER", mock(SellerAccountRepository.class)))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("SELLEROPS_AGENT_ACCESS_SCOPE");
    }
}
