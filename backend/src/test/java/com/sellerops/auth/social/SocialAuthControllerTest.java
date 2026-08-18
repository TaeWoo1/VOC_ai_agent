package com.sellerops.auth.social;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.sellerops.auth.JwtTokenProvider;
import com.sellerops.common.ApiException;
import com.sellerops.config.SecurityConfig;
import com.sellerops.organization.OrganizationRepository;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.security.oauth2.client.registration.ClientRegistrationRepository;
import org.springframework.security.oauth2.client.registration.InMemoryClientRegistrationRepository;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

/**
 * The real {@link SecurityConfig} with a Google registration present: the public social endpoints answer
 * without a JWT, the authorize redirect exists and goes to Google, and a spent/unknown code is a 401 — the
 * frontend's "다시 로그인" path, not a 500.
 */
@WebMvcTest(SocialAuthController.class)
@Import({SecurityConfig.class, SocialLoginSuccessHandler.class, SocialLoginFailureHandler.class,
        SocialAuthControllerTest.GoogleOnly.class})
@ActiveProfiles("test")
class SocialAuthControllerTest {

    @TestConfiguration
    static class GoogleOnly {
        @Bean
        SocialLoginProperties socialLoginProperties() {
            return new SocialLoginProperties("gid", "gsecret", "", "", "", 120, 1800);
        }

        @Bean
        ClientRegistrationRepository clientRegistrationRepository(SocialLoginProperties props) {
            return new InMemoryClientRegistrationRepository(SocialLoginConfiguration.registrations(props));
        }
    }

    @Autowired MockMvc mockMvc;
    @MockBean SocialAuthService socialAuth;
    @MockBean JwtTokenProvider tokenProvider;
    @MockBean OrganizationRepository organizations;

    @Test
    void providersIsPublicAndReflectsConfiguration() throws Exception {
        mockMvc.perform(get("/api/auth/social/providers"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.google").value(true))
                .andExpect(jsonPath("$.naver").value(false));
    }

    @Test
    void authorizeRedirectGoesToGoogleWithoutAJwt() throws Exception {
        mockMvc.perform(get("/oauth2/authorization/google"))
                .andExpect(status().is3xxRedirection())
                .andExpect(header().string("Location", org.hamcrest.Matchers.startsWith("https://accounts.google.com/o/oauth2/v2/auth")));
    }

    @Test
    void unconfiguredProviderIsNotAnAuthorizeTarget() throws Exception {
        mockMvc.perform(get("/oauth2/authorization/naver"))
                .andExpect(status().isNotFound());
    }

    @Test
    void spentCodeIs401NotAServerError() throws Exception {
        when(socialAuth.exchange(any())).thenThrow(ApiException.unauthorized("로그인 링크가 만료되었습니다."));
        mockMvc.perform(post("/api/auth/social/exchange").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"code\":\"x\"}"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void onboardingCompleteValidatesTheBody() throws Exception {
        mockMvc.perform(post("/api/auth/social/onboarding/complete").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"onboardingToken\":\"t\",\"orgName\":\"\",\"name\":\"A\"}"))
                .andExpect(status().isBadRequest());
    }
}
