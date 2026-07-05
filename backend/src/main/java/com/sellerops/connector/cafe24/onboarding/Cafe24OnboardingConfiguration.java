package com.sellerops.connector.cafe24.onboarding;

import com.sellerops.channel.ChannelRepository;
import com.sellerops.connector.cafe24.Cafe24HttpClient;
import com.sellerops.credential.CredentialVault;
import com.sellerops.selleraccount.SellerAccountRepository;
import java.time.Clock;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.transaction.PlatformTransactionManager;

/**
 * Wires the Cafe24 "Connect Cafe24" onboarding flow behind the same feature flag as
 * the connector ({@code sellerops.connector.cafe24.enabled=true}). Flag off ⇒ these
 * beans (and the {@link Cafe24ConnectController} that depends on them) do not exist,
 * so the onboarding endpoints 404 — the flow is a deliberate operator opt-in.
 *
 * <p>The app-level OAuth identity (client id/secret, redirect uri, read-only scopes)
 * is configuration, not per-seller vault material — one registered Cafe24 app serves
 * every mall. Per-seller values (mall id, refresh token) are captured by the flow.
 */
@Configuration
@ConditionalOnProperty(name = "sellerops.connector.cafe24.enabled", havingValue = "true")
public class Cafe24OnboardingConfiguration {

    @Bean
    Cafe24OAuthClient cafe24OAuthClient(Cafe24HttpClient http) {
        return new Cafe24OAuthClient(http);
    }

    @Bean
    Cafe24OnboardingService cafe24OnboardingService(
            SellerAccountRepository accounts, ChannelRepository channels,
            Cafe24OAuthStateRepository states, CredentialVault vault, Cafe24OAuthClient oauthClient,
            PlatformTransactionManager txManager,
            @Value("${sellerops.connector.cafe24.oauth.client-id:}") String clientId,
            @Value("${sellerops.connector.cafe24.oauth.client-secret:}") String clientSecret,
            @Value("${sellerops.connector.cafe24.oauth.redirect-uri:http://localhost:8080/api/connect/cafe24/callback}")
            String redirectUri,
            @Value("${sellerops.connector.cafe24.oauth.scopes:mall.read_community,mall.read_order}") String scopes,
            @Value("${sellerops.connector.cafe24.oauth.state-ttl-seconds:600}") long stateTtlSeconds) {
        return new Cafe24OnboardingService(accounts, channels, states, vault, oauthClient,
                txManager, Clock.systemUTC(), clientId, clientSecret, redirectUri, scopes, stateTtlSeconds);
    }
}
