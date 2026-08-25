package com.sellerops.inquiry.publish;

import com.sellerops.connector.coupang.CoupangInquiryReplyClient;
import com.sellerops.connector.coupang.CoupangSigner;
import com.sellerops.connector.coupang.JdkCoupangHttpClient;
import com.sellerops.connector.cafe24.Cafe24Authorizer;
import com.sellerops.connector.cafe24.Cafe24BoardArticlesClient;
import com.sellerops.connector.cafe24.Cafe24HttpClient;
import com.sellerops.connector.cafe24.Cafe24ReplyArticleClient;
import com.sellerops.connector.esm.EsmHttpClient;
import com.sellerops.connector.esm.EsmJwtSigner;
import com.sellerops.connector.esm.JdkEsmHttpClient;
import com.sellerops.connector.naver.NaverCustomerInquiriesClient;
import com.sellerops.connector.naver.NaverProductQnaClient;
import com.sellerops.connector.naver.NaverTokenClient;
import com.sellerops.credential.CredentialVault;
import com.sellerops.inquiry.publish.cafe24.Cafe24AnswerExecutionGrant;
import com.sellerops.inquiry.publish.cafe24.Cafe24ChannelReplyAdapter;
import com.sellerops.inquiry.publish.naver.JdkNaverAnswerHttpClient;
import com.sellerops.inquiry.publish.naver.NaverAnswerHttpClient;
import com.sellerops.inquiry.publish.naver.NaverCustomerInquiryAnswerClient;
import com.sellerops.inquiry.publish.naver.NaverCustomerInquiryReplyAdapter;
import com.sellerops.inquiry.publish.naver.NaverProductQnaAnswerClient;
import com.sellerops.inquiry.publish.naver.NaverProductQnaReplyAdapter;
import java.time.Clock;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Wires the REAL reply transports and registers the {@link ChannelReplyAdapter}s — ESM+,
 * Coupang and NAVER's two inquiry subtypes — ONLY when
 * {@code sellerops.inquiry.publish.execution-enabled=true}. Off by
 * default no adapter bean exists, so the {@link ChannelReplyAdapterRegistry} resolves empty
 * and the core fails closed — that absence IS the fail-closed default (there is no separate
 * disabled transport). The Coupang adapter additionally requires its own connector flag, so
 * a deployment that does not talk to Coupang has no Coupang adapter at all.
 *
 * <p>Each base URL is configurable ({@code sellerops.connector.esm.base-url} /
 * {@code sellerops.connector.coupang.base-url}, defaulting to the official hosts) — no test
 * environment is hardcoded. This exposes no general inquiry-collection capability; the HTTP
 * clients here are used only for the send-time answer call and the send-time re-query.
 */
@Configuration
@ConditionalOnProperty(name = "sellerops.inquiry.publish.execution-enabled", havingValue = "true")
public class PublishExecutionWiring {

    private final EsmHttpClient http = new JdkEsmHttpClient();
    private final EsmJwtSigner signer = new EsmJwtSigner(Clock.systemUTC());
    private final NaverAnswerHttpClient naverAnswerHttp = new JdkNaverAnswerHttpClient();

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
    @ConditionalOnProperty(name = "sellerops.connector.coupang.enabled", havingValue = "true")
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
     *
     * <p><b>Two flags, both required.</b> The publish-execution flag says replies may be sent at all;
     * the connector flag says this deployment talks to Coupang. Registering on the first alone would
     * leave a live Coupang adapter in a deployment whose Coupang connector is switched off, where a
     * work item left from an earlier enablement could still dispatch. The live-call guard would refuse
     * it at the transport — but a bean that should not exist is a worse place to be caught than a bean
     * that does not exist.
     */
    @Bean
    @ConditionalOnProperty(name = "sellerops.connector.coupang.enabled", havingValue = "true")
    ChannelReplyAdapter coupangChannelReplyAdapter(
            CoupangInquiryReplyClient replyClient, CredentialVault vault,
            @Value("${sellerops.connector.coupang.reply-by:}") String replyBy) {
        return new CoupangChannelReplyAdapter(replyClient, vault, replyBy);
    }

    // ── NAVER. Two adapters, because NAVER has two inquiry resources with two contracts.
    //
    // Both are registered only when the publish-execution flag is on AND the NAVER connector is on,
    // for the same reason the Coupang pair is: a live reply adapter in a deployment whose connector
    // is switched off is a bean that should not exist. Neither can send to a real host without an
    // armed live-run approval id (NaverAnswerLiveGuard), which is the flag that stays off.

    @Bean
    @ConditionalOnProperty(name = "sellerops.connector.naver.enabled", havingValue = "true")
    NaverProductQnaAnswerClient naverProductQnaAnswerClient(
            @Value("${sellerops.connector.naver.base-url:https://api.commerce.naver.com}") String baseUrl,
            @Value("${sellerops.inquiry.publish.naver.live-approval-id:}") String liveApprovalId) {
        return new NaverProductQnaAnswerClient(naverAnswerHttp, baseUrl, liveApprovalId);
    }

    @Bean
    @ConditionalOnProperty(name = "sellerops.connector.naver.enabled", havingValue = "true")
    NaverCustomerInquiryAnswerClient naverCustomerInquiryAnswerClient(
            @Value("${sellerops.connector.naver.base-url:https://api.commerce.naver.com}") String baseUrl,
            @Value("${sellerops.inquiry.publish.naver.live-approval-id:}") String liveApprovalId) {
        return new NaverCustomerInquiryAnswerClient(naverAnswerHttp, baseUrl, liveApprovalId);
    }

    /**
     * 상품 문의 — {@code PUT /v1/contents/qnas/&#123;questionId&#125;}.
     *
     * <p>The READ client beside it is the collection one: verification is a re-read, and re-reading
     * through a second implementation would let the two disagree about what "answered" means.
     */
    @Bean
    @ConditionalOnProperty(name = "sellerops.connector.naver.enabled", havingValue = "true")
    ChannelReplyAdapter naverProductQnaReplyAdapter(NaverProductQnaAnswerClient answerClient,
                                                    NaverProductQnaClient readClient,
                                                    NaverTokenClient tokenClient,
                                                    CredentialVault vault) {
        return new NaverProductQnaReplyAdapter(answerClient, readClient, tokenClient, vault,
                Clock.systemUTC());
    }

    /** 고객 문의 — {@code POST /v1/pay-merchant/inquiries/&#123;inquiryNo&#125;/answer}. */
    @Bean
    @ConditionalOnProperty(name = "sellerops.connector.naver.enabled", havingValue = "true")
    ChannelReplyAdapter naverCustomerInquiryReplyAdapter(NaverCustomerInquiryAnswerClient answerClient,
                                                         NaverCustomerInquiriesClient readClient,
                                                         NaverTokenClient tokenClient,
                                                         CredentialVault vault) {
        return new NaverCustomerInquiryReplyAdapter(answerClient, readClient, tokenClient, vault,
                Clock.systemUTC());
    }

    // ── Cafe24. An answer here is an ARTICLE hanging off the question, so the write is a POST to
    // the same boards resource the collector reads — proven STANDARD_BOARD_REPLY_ARTICLE by an
    // approved bounded READ, and shaped by Cafe24ReplyRequestShape.
    //
    // Three independent things must all be true before a byte leaves: this flag, the Cafe24
    // connector flag, and — at runtime, per seller — a recorded mall.write_community grant. The
    // adapter also refuses without a configured client_ip, and the transport refuses any real host
    // without an armed live-run approval id. None of those has a default that says yes.

    /**
     * The Cafe24 reply-article write client — its own object, not the collection client.
     *
     * <p>{@code live-approval-id} is the environment-binding token from
     * {@code docs/sellerops_live_approval_contract.md}. Blank (the default) means every non-offline
     * host is refused before the request is built, which is what keeps an offline-implemented adapter
     * from becoming a live one by someone flipping two flags.
     */
    @Bean
    @ConditionalOnProperty(name = "sellerops.connector.cafe24.enabled", havingValue = "true")
    Cafe24ReplyArticleClient cafe24ReplyArticleClient(
            Cafe24HttpClient http,
            @Value("${sellerops.inquiry.publish.cafe24.live-approval-id:}") String liveApprovalId) {
        return new Cafe24ReplyArticleClient(http, liveApprovalId);
    }

    /**
     * The Cafe24 channel reply adapter.
     *
     * <p>{@code client-ip} is the Action Executor's egress address and defaults to blank. Blank means
     * the adapter refuses to publish: the contract marks the field REQUIRED, SellerOps does not hold
     * it, no observed value may be reused (a past writer's address is not the client making this
     * request), and it is never looked up at runtime. An unconfigured deployment must look
     * unconfigured rather than send a fabricated address.
     *
     * <p>{@code shop-no} is the same shape of fact for a different reason. It defaults to 0, which
     * the adapter refuses, because the value must come from an OBSERVATION of the target article
     * rather than from the contract's documented default of 1 — a default adopted silently would
     * make an unobserved shop indistinguishable from a decided one.
     */
    @Bean
    @ConditionalOnProperty(name = "sellerops.connector.cafe24.enabled", havingValue = "true")
    ChannelReplyAdapter cafe24ChannelReplyAdapter(
            Cafe24ReplyArticleClient writeClient, Cafe24BoardArticlesClient readClient,
            Cafe24Authorizer authorizer, Cafe24AnswerExecutionGrant grant,
            @Value("${sellerops.inquiry.publish.cafe24.client-ip:}") String clientIp,
            @Value("${sellerops.inquiry.publish.cafe24.shop-no:0}") int shopNo) {
        return new Cafe24ChannelReplyAdapter(writeClient, readClient, authorizer, grant, clientIp,
                shopNo);
    }
}
