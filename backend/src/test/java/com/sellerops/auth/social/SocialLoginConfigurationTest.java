package com.sellerops.auth.social;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.client.registration.ClientRegistration;
import org.springframework.security.oauth2.core.ClientAuthenticationMethod;

class SocialLoginConfigurationTest {

    @Test
    void onlyConfiguredProvidersBecomeRegistrations() {
        List<ClientRegistration> onlyGoogle = SocialLoginConfiguration.registrations(
                new SocialLoginProperties("gid", "gs", "", "", "", 120, 1800));
        assertThat(onlyGoogle).extracting(ClientRegistration::getRegistrationId).containsExactly("google");

        List<ClientRegistration> none = SocialLoginConfiguration.registrations(
                new SocialLoginProperties("gid", "", "nid", "", "", 120, 1800));
        assertThat(none).isEmpty();
    }

    @Test
    void naverRegistrationTargetsNidAndUnwrapsResponse() {
        ClientRegistration naver = SocialLoginConfiguration.registrations(
                new SocialLoginProperties("", "", "nid", "ns", "", 120, 1800)).get(0);
        assertThat(naver.getRegistrationId()).isEqualTo("naver");
        assertThat(naver.getProviderDetails().getAuthorizationUri()).isEqualTo("https://nid.naver.com/oauth2.0/authorize");
        assertThat(naver.getProviderDetails().getTokenUri()).isEqualTo("https://nid.naver.com/oauth2.0/token");
        assertThat(naver.getProviderDetails().getUserInfoEndpoint().getUri()).isEqualTo("https://openapi.naver.com/v1/nid/me");
        assertThat(naver.getProviderDetails().getUserInfoEndpoint().getUserNameAttributeName()).isEqualTo("response");
        assertThat(naver.getClientAuthenticationMethod()).isEqualTo(ClientAuthenticationMethod.CLIENT_SECRET_POST);
        assertThat(naver.getRedirectUri()).isEqualTo("{baseUrl}/{action}/oauth2/code/{registrationId}");
    }

    @Test
    void availabilityIsPublicAndOrdered() {
        SocialLoginProperties props = new SocialLoginProperties("gid", "gs", "", "", "https://app.example/", 120, 1800);
        assertThat(props.availability()).containsExactly(java.util.Map.entry("google", true), java.util.Map.entry("naver", false));
        assertThat(props.frontendUrl("/auth/callback?code=x")).isEqualTo("https://app.example/auth/callback?code=x");
    }
}
