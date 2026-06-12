package com.sellerops.connector.naver;

import com.sellerops.credential.CredentialVault;
import java.time.Clock;
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

    @Bean
    NaverHttpClient naverHttpClient() {
        return new JdkNaverHttpClient();
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
    NaverApiConnector naverApiConnector(NaverTokenClient tokenClient, NaverOrdersClient ordersClient,
                                        CredentialVault vault) {
        return new NaverApiConnector(tokenClient, ordersClient, vault);
    }
}
