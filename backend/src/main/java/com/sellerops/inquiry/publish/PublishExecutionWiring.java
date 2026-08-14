package com.sellerops.inquiry.publish;

import com.sellerops.connector.coupang.CoupangInquiryReplyClient;
import com.sellerops.connector.coupang.CoupangSigner;
import com.sellerops.connector.coupang.JdkCoupangHttpClient;
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

    /**
     * The Coupang answer transport — its own HTTP client and signer, not the collection client's.
     *
     * <p>Separate on purpose: the collection client is a read path that may be paging a 30-day sweep
     * when a seller confirms a reply, and the only WRITE this connector has should not share an
     * object whose whole design assumes it can retry. They still hold to the same per-vendor pace and
     * the same live-call guard, which is where sharing actually matters.
     */
    @Bean
    CoupangInquiryReplyClient coupangInquiryReplyClient(
            @Value("${sellerops.connector.coupang.base-url:https://api-gateway.coupang.com}") String baseUrl,
            @Value("${sellerops.connector.coupang.live-approval-id:}") String liveApprovalId) {
        return new CoupangInquiryReplyClient(new JdkCoupangHttpClient(), new CoupangSigner(Clock.systemUTC()),
                baseUrl, liveApprovalId, Clock.systemUTC());
    }

    /**
     * The Coupang channel reply adapter.
     *
     * <p>{@code reply-by} is the WING operator id Coupang stamps an answer with. SellerOps does not
     * hold it — the credential handoff stores 업체코드 / Access Key / Secret Key and nothing else — so
     * it is configured explicitly and defaults to blank. Blank means the adapter refuses to publish
     * rather than sending a request that would be rejected: an unconfigured deployment must look like
     * an unconfigured deployment, not like Coupang turning the seller's reply down.
     */
    @Bean
    ChannelReplyAdapter coupangChannelReplyAdapter(
            CoupangInquiryReplyClient replyClient, CredentialVault vault,
            @Value("${sellerops.connector.coupang.reply-by:}") String replyBy) {
        return new CoupangChannelReplyAdapter(replyClient, vault, replyBy);
    }
}
