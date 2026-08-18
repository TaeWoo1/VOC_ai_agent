package com.sellerops.auth.social;

import java.util.ArrayList;
import java.util.List;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Condition;
import org.springframework.context.annotation.ConditionContext;
import org.springframework.context.annotation.Conditional;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.type.AnnotatedTypeMetadata;
import org.springframework.security.config.oauth2.client.CommonOAuth2Provider;
import org.springframework.security.oauth2.client.registration.ClientRegistration;
import org.springframework.security.oauth2.client.registration.ClientRegistrationRepository;
import org.springframework.security.oauth2.client.registration.InMemoryClientRegistrationRepository;
import org.springframework.security.oauth2.core.AuthorizationGrantType;
import org.springframework.security.oauth2.core.ClientAuthenticationMethod;

/**
 * Spring Security OAuth2 client registrations for the providers the deployer configured. When neither is,
 * this configuration is skipped entirely: no {@code ClientRegistrationRepository}, no {@code oauth2Login()} in
 * the chain (see {@code SecurityConfig}), no {@code /oauth2/**} endpoints — the auth surface is exactly the
 * email/password one it was before this unit.
 *
 * <p>Redirect URI template is Spring's default {@code {baseUrl}/login/oauth2/code/{registrationId}}; the base
 * URL is the public origin the browser used (through the dev proxy that is {@code http://localhost:5173}),
 * which is what must be registered at the Google / NAVER developer console
 * (docs/auth_growth_instrumentation_v1.md §3).
 */
@Configuration
@Conditional(SocialLoginConfiguration.AnyProviderConfigured.class)
public class SocialLoginConfiguration {

    static final String NAVER_AUTHORIZATION_URI = "https://nid.naver.com/oauth2.0/authorize";
    static final String NAVER_TOKEN_URI = "https://nid.naver.com/oauth2.0/token";
    static final String NAVER_USER_INFO_URI = "https://openapi.naver.com/v1/nid/me";
    /** NAVER wraps the profile in {@code {"resultcode","message","response":{id,email,name,...}}}. */
    static final String NAVER_USER_NAME_ATTRIBUTE = "response";

    @Bean
    public ClientRegistrationRepository clientRegistrationRepository(SocialLoginProperties props) {
        return new InMemoryClientRegistrationRepository(registrations(props));
    }

    static List<ClientRegistration> registrations(SocialLoginProperties props) {
        List<ClientRegistration> list = new ArrayList<>();
        if (props.googleConfigured()) {
            list.add(CommonOAuth2Provider.GOOGLE.getBuilder(SocialLoginProperties.GOOGLE)
                    .clientId(props.googleClientId())
                    .clientSecret(props.googleClientSecret())
                    .build());
        }
        if (props.naverConfigured()) {
            list.add(ClientRegistration.withRegistrationId(SocialLoginProperties.NAVER)
                    .clientId(props.naverClientId())
                    .clientSecret(props.naverClientSecret())
                    .clientAuthenticationMethod(ClientAuthenticationMethod.CLIENT_SECRET_POST)
                    .authorizationGrantType(AuthorizationGrantType.AUTHORIZATION_CODE)
                    .redirectUri("{baseUrl}/{action}/oauth2/code/{registrationId}")
                    .authorizationUri(NAVER_AUTHORIZATION_URI)
                    .tokenUri(NAVER_TOKEN_URI)
                    .userInfoUri(NAVER_USER_INFO_URI)
                    .userNameAttributeName(NAVER_USER_NAME_ATTRIBUTE)
                    .clientName("NAVER")
                    .build());
        }
        return list;
    }

    /** True when at least one provider has both client id and secret. */
    static final class AnyProviderConfigured implements Condition {
        @Override
        public boolean matches(ConditionContext context, AnnotatedTypeMetadata metadata) {
            var env = context.getEnvironment();
            return configured(env.getProperty("sellerops.oauth.google.client-id"),
                    env.getProperty("sellerops.oauth.google.client-secret"))
                    || configured(env.getProperty("sellerops.oauth.naver.client-id"),
                    env.getProperty("sellerops.oauth.naver.client-secret"));
        }

        private static boolean configured(String id, String secret) {
            return id != null && !id.isBlank() && secret != null && !secret.isBlank();
        }
    }
}
