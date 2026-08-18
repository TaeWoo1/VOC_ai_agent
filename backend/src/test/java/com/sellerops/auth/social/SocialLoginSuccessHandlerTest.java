package com.sellerops.auth.social;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.core.oidc.OidcIdToken;
import org.springframework.security.oauth2.core.oidc.user.DefaultOidcUser;
import org.springframework.security.oauth2.core.user.DefaultOAuth2User;

class SocialLoginSuccessHandlerTest {

    @Test
    void googleOidcProfileUsesSubAndVerifiedEmail() {
        var idToken = new OidcIdToken("t", null, null, Map.of("sub", "g-123", "email", "a@gmail.com",
                "email_verified", true, "name", "A"));
        var user = new DefaultOidcUser(List.of(new SimpleGrantedAuthority("ROLE_USER")), idToken);
        SocialProfile p = SocialLoginSuccessHandler.extract("google", user);
        assertThat(p).isEqualTo(new SocialProfile("google", "g-123", "a@gmail.com", "A"));
    }

    @Test
    void googleUnverifiedEmailIsDropped() {
        var idToken = new OidcIdToken("t", null, null, Map.of("sub", "g-1", "email", "a@gmail.com", "email_verified", false));
        var user = new DefaultOidcUser(List.of(new SimpleGrantedAuthority("ROLE_USER")), idToken);
        assertThat(SocialLoginSuccessHandler.extract("google", user).email()).isNull();
        assertThat(SocialLoginSuccessHandler.extract("google", user).subject()).isEqualTo("g-1");
    }

    @Test
    void naverProfileIsUnwrappedFromResponse() {
        var user = new DefaultOAuth2User(List.of(new SimpleGrantedAuthority("ROLE_USER")),
                Map.of("resultcode", "00", "response", Map.of("id", "n-77", "email", "b@naver.com", "name", "B")),
                "response");
        assertThat(SocialLoginSuccessHandler.extract("naver", user))
                .isEqualTo(new SocialProfile("naver", "n-77", "b@naver.com", "B"));
    }

    @Test
    void naverWithoutResponseYieldsNoSubject() {
        var user = new DefaultOAuth2User(List.of(new SimpleGrantedAuthority("ROLE_USER")), Map.of("x", "y"), "x");
        assertThat(SocialLoginSuccessHandler.extract("naver", user).subject()).isNull();
    }
}
