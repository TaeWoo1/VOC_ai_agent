package com.sellerops.inquiry.publish;

import com.sellerops.connector.esm.EsmHttpClient;
import com.sellerops.connector.esm.EsmJwtSigner;
import com.sellerops.connector.esm.JdkEsmHttpClient;
import com.sellerops.credential.CredentialVault;
import java.time.Clock;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Wires the REAL ESM reply transport and registers the ESM {@link ChannelReplyAdapter}
 * ONLY when {@code sellerops.inquiry.publish.execution-enabled=true}. Off by default no
 * ESM adapter bean exists, so the {@link ChannelReplyAdapterRegistry} resolves empty and
 * the core fails closed — that absence IS the fail-closed default (there is no separate
 * disabled transport). The ESM base URL is configurable ({@code
 * sellerops.connector.esm.base-url}, default the official Sell-API host) — no test
 * environment is hardcoded. This exposes no general ESM inquiry-collection capability;
 * the HTTP client here is used only for the send-time answer POST and the send-time
 * re-query.
 */
@Configuration
@ConditionalOnProperty(name = "sellerops.inquiry.publish.execution-enabled", havingValue = "true")
public class PublishExecutionWiring {

    private final EsmHttpClient http = new JdkEsmHttpClient();
    private final EsmJwtSigner signer = new EsmJwtSigner(Clock.systemUTC());

    @Bean
    EsmAnswerClient esmAnswerClient(CredentialVault vault,
                                    @Value("${sellerops.connector.esm.base-url:https://sa2.esmplus.com}") String baseUrl) {
        return new HttpEsmAnswerClient(http, signer, vault, baseUrl);
    }

    @Bean
    EsmReplyTokenResolver esmReplyTokenResolver(CredentialVault vault,
                                                @Value("${sellerops.connector.esm.base-url:https://sa2.esmplus.com}") String baseUrl) {
        return new ProductionEsmReplyTokenResolver(new EsmInquiryReQuery(http, signer, vault, baseUrl));
    }

    @Bean
    EsmInformStatusProbe esmInformStatusProbe(CredentialVault vault,
                                              @Value("${sellerops.connector.esm.base-url:https://sa2.esmplus.com}") String baseUrl) {
        return new ProductionEsmInformStatusProbe(new EsmInquiryReQuery(http, signer, vault, baseUrl));
    }

    /** The ESM channel reply adapter — the only place ESM-specific publish/verify rules live. */
    @Bean
    ChannelReplyAdapter esmChannelReplyAdapter(EsmAnswerClient answerClient, EsmReplyTokenResolver tokenResolver,
                                               EsmInformStatusProbe informProbe, CredentialVault vault) {
        return new EsmChannelReplyAdapter(answerClient, tokenResolver, informProbe, vault);
    }
}
