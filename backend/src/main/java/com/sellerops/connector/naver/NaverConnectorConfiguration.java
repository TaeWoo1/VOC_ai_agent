package com.sellerops.connector.naver;

import com.sellerops.credential.CredentialVault;
import java.time.Clock;
import java.time.Duration;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Wires the real Naver connector strictly behind the feature flag. With
 * {@code sellerops.connector.naver.enabled=false} (the default) none of these
 * beans exist: the registry sees only the mock connector and runtime behavior
 * is byte-identical to Phase 3B. Flipping the flag is a deliberate operator
 * act, and even then nothing collects until Slice 1b turns a data type on.
 */
@Configuration
@ConditionalOnProperty(name = "sellerops.connector.naver.enabled", havingValue = "true")
public class NaverConnectorConfiguration {

    /**
     * The single HTTP boundary shared by the token and order clients, wrapped in
     * a pacing decorator so all Naver calls — token mint, last-changed, detail,
     * pagination — are spaced under Naver's per-second meter by one process-wide
     * pacer. {@code min-request-interval-millis=0} disables pacing.
     */
    @Bean
    NaverHttpClient naverHttpClient(
            @Value("${sellerops.connector.naver.min-request-interval-millis:1000}") long minRequestIntervalMillis,
            @Value("${sellerops.connector.naver.exhaustion-backoff-millis:1000}") long exhaustionBackoffMillis) {
        if (minRequestIntervalMillis < 0) {
            throw new IllegalStateException(
                    "네이버 요청 최소 간격(min-request-interval-millis)은 0 이상이어야 합니다 (설정값: "
                            + minRequestIntervalMillis + ").");
        }
        if (exhaustionBackoffMillis < 0) {
            throw new IllegalStateException(
                    "네이버 요청량 소진 백오프(exhaustion-backoff-millis)는 0 이상이어야 합니다 (설정값: "
                            + exhaustionBackoffMillis + ").");
        }
        NaverRequestPacer pacer = new NaverRequestPacer(
                Clock.systemUTC(), new ThreadSleeper(),
                Duration.ofMillis(minRequestIntervalMillis), Duration.ofMillis(exhaustionBackoffMillis));
        return new PacingNaverHttpClient(new JdkNaverHttpClient(), pacer);
    }

    @Bean
    NaverTokenClient naverTokenClient(
            NaverHttpClient http,
            @Value("${sellerops.connector.naver.base-url:https://api.commerce.naver.com}") String baseUrl) {
        return new NaverTokenClient(http, Clock.systemUTC(), baseUrl);
    }

    @Bean
    NaverOrdersClient naverOrdersClient(
            NaverHttpClient http,
            @Value("${sellerops.connector.naver.base-url:https://api.commerce.naver.com}") String baseUrl,
            @Value("${sellerops.connector.naver.order-detail-batch-size:100}") int orderDetailBatchSize) {
        // The official productOrderIds-per-request maximum is unconfirmed; 300 is
        // the commonly cited ceiling, so configuration must stay at or below it.
        if (orderDetailBatchSize < 1 || orderDetailBatchSize > 300) {
            throw new IllegalStateException(
                    "네이버 주문 상세 조회 배치 크기는 1~300 사이여야 합니다 (설정값: " + orderDetailBatchSize + ").");
        }
        return new NaverOrdersClient(http, Clock.systemUTC(), baseUrl, orderDetailBatchSize);
    }

    @Bean
    NaverProductsClient naverProductsClient(
            NaverHttpClient http,
            @Value("${sellerops.connector.naver.base-url:https://api.commerce.naver.com}") String baseUrl) {
        return new NaverProductsClient(http, Clock.systemUTC(), baseUrl);
    }

    /**
     * 상품 문의 (GET /v1/contents/qnas) — its own flag, default off.
     *
     * <p>Per-source flags are not fussiness. They are what lets a live proof measure ONE resource:
     * with only this one on, a bounded run makes 상품 문의 calls and nothing else, so a 403, a page
     * count and an attribution rate all belong to a single endpoint. They are also the fence — the
     * bean's absence is what keeps {@code NaverApiConnector} from advertising INQUIRY at all.
     */
    @Bean
    @ConditionalOnProperty(name = "sellerops.connector.naver.inquiry.product-qna.enabled",
            havingValue = "true")
    NaverProductQnaClient naverProductQnaClient(
            NaverHttpClient http,
            @Value("${sellerops.connector.naver.base-url:https://api.commerce.naver.com}") String baseUrl) {
        return new NaverProductQnaClient(http, baseUrl);
    }

    /** 고객 문의 (GET /v1/pay-user/inquiries) — its own flag, default off. */
    @Bean
    @ConditionalOnProperty(name = "sellerops.connector.naver.inquiry.customer.enabled",
            havingValue = "true")
    NaverCustomerInquiriesClient naverCustomerInquiriesClient(
            NaverHttpClient http,
            @Value("${sellerops.connector.naver.base-url:https://api.commerce.naver.com}") String baseUrl) {
        return new NaverCustomerInquiriesClient(http, baseUrl);
    }

    /**
     * The lane driver. Always present when the NAVER connector is; it reports
     * {@code hasAnySource() == false} when neither source flag is on, and the connector then does not
     * advertise INQUIRY — so a deployment with both flags off behaves exactly as it did before.
     */
    @Bean
    NaverInquiryCollector naverInquiryCollector(
            org.springframework.beans.factory.ObjectProvider<NaverProductQnaClient> qnaClient,
            org.springframework.beans.factory.ObjectProvider<NaverCustomerInquiriesClient> customerClient) {
        return new NaverInquiryCollector(
                qnaClient.getIfAvailable(), customerClient.getIfAvailable(), Clock.systemUTC());
    }

    @Bean
    NaverApiConnector naverApiConnector(NaverTokenClient tokenClient, NaverOrdersClient ordersClient,
                                        NaverProductsClient productsClient,
                                        NaverInquiryCollector inquiryCollector,
                                        CredentialVault vault) {
        return new NaverApiConnector(tokenClient, ordersClient, productsClient, inquiryCollector, vault);
    }
}
