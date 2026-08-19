package com.sellerops.agent.llm;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * The production transport bean.
 *
 * <p>Unconditional, unlike {@code PublishExecutionWiring}: the transport is inert without a key and
 * an org, and {@link AgentDraftService} is the only thing that can reach it. Making the BEAN
 * conditional would move the gate to bean presence and leave two places that decide whether the
 * capability is on — which is how a deployment ends up with the flag off and the capability
 * reachable, or the reverse.
 */
@Configuration
public class AgentLlmConfiguration {

    @Bean
    AgentLlmTransport agentLlmTransport() {
        return new JdkAgentLlmTransport();
    }
}
