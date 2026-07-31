package com.sellerops.connector.cafe24.spike;

import com.sellerops.connector.cafe24.Cafe24HttpClient;
import com.sellerops.credential.CredentialVault;
import com.sellerops.selleraccount.SellerAccountRepository;
import java.util.Locale;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Wires the board-6 reply spike strictly behind its own flag, on top of the connector
 * flag. With {@code sellerops.connector.cafe24.spike.reply.enabled=false} (the
 * default) none of these beans exist and runtime behavior is byte-identical to before
 * — there is no comment-write code anywhere in the reachable graph.
 *
 * <p>This configuration reuses the connector's {@link Cafe24HttpClient} bean (present
 * only when {@code sellerops.connector.cafe24.enabled=true}), so the operator must
 * enable both flags together; the reply spike never issues an admin call against an
 * unspecified API version (the transport fails closed on a blank version).
 */
@Configuration
@ConditionalOnProperty(name = "sellerops.connector.cafe24.spike.reply.enabled", havingValue = "true")
public class Cafe24ReplySpikeConfiguration {

    @Bean
    SpikeTokenClient spikeTokenClient(Cafe24HttpClient http) {
        return new SpikeTokenClient(http);
    }

    @Bean
    SpikeReplyTransport spikeReplyTransport(
            Cafe24HttpClient http,
            @Value("${sellerops.connector.cafe24.api-version:}") String apiVersion) {
        return new JdkSpikeReplyTransport(http, apiVersion);
    }

    @Bean
    SpikeAuthorizer spikeAuthorizer(
            SpikeTokenClient tokenClient, CredentialVault vault,
            @Value("${sellerops.connector.cafe24.oauth.client-id:}") String appClientId,
            @Value("${sellerops.connector.cafe24.oauth.client-secret:}") String appClientSecret) {
        return new VaultSpikeAuthorizer(tokenClient, vault, appClientId, appClientSecret);
    }

    @Bean
    SpikeReplyEngine spikeReplyEngine(
            SpikeReplyTransport transport,
            @Value("${sellerops.connector.cafe24.spike.reply.approval:}") String approval) {
        return new SpikeReplyEngine(transport, approval);
    }

    @Bean
    Cafe24ReplySpikeRunner cafe24ReplySpikeRunner(
            SpikeReplyEngine engine, SpikeReplyTransport transport, SpikeAuthorizer authorizer,
            SellerAccountRepository accounts,
            @Value("${sellerops.connector.cafe24.spike.reply.account-id:}") String accountId,
            @Value("${sellerops.connector.cafe24.spike.reply.article-no:0}") long articleNo,
            @Value("${sellerops.connector.cafe24.spike.reply.command-id:}") String commandId,
            @Value("${sellerops.connector.cafe24.spike.reply.execute-write:false}") boolean executeWrite,
            @Value("${sellerops.connector.cafe24.spike.reply.content-source:FIXED}") String contentSource,
            @Value("${sellerops.connector.cafe24.spike.reply.operator-content:}") String operatorContent,
            @Value("${sellerops.connector.cafe24.spike.reply.approval:}") String approval) {
        return new Cafe24ReplySpikeRunner(engine, transport, authorizer, accounts,
                accountId, articleNo, commandId, executeWrite,
                parseContentSource(contentSource), operatorContent, approval);
    }

    private static SpikeReplyCommand.ContentSource parseContentSource(String raw) {
        if (raw != null && "OPERATOR".equals(raw.strip().toUpperCase(Locale.ROOT))) {
            return SpikeReplyCommand.ContentSource.OPERATOR;
        }
        return SpikeReplyCommand.ContentSource.FIXED;
    }
}
