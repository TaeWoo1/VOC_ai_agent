package com.sellerops.auth.password;

import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.sellerops.common.ApiException;
import com.sellerops.auth.JwtTokenProvider;
import com.sellerops.config.SecurityConfig;
import com.sellerops.organization.OrganizationRepository;
import org.hamcrest.Matchers;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

/**
 * The public reset endpoints through the real {@link SecurityConfig}: no JWT needed, `forgot` is 202 with an
 * empty body no matter what, a bad token is 401, and every answer carries the hardened headers (§2-5).
 */
@WebMvcTest(PasswordResetController.class)
@Import(SecurityConfig.class)
@ActiveProfiles("test")
class PasswordResetControllerTest {

    @Autowired MockMvc mockMvc;
    @MockBean PasswordResetService service;
    @MockBean JwtTokenProvider tokenProvider;
    @MockBean OrganizationRepository organizations;

    @Test
    void configIsPublic() throws Exception {
        when(service.enabled()).thenReturn(true);
        when(service.devOutbox()).thenReturn(true);
        mockMvc.perform(get("/api/auth/password/config"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.enabled").value(true))
                .andExpect(jsonPath("$.devOutbox").value(true));
    }

    @Test
    void forgotIs202WithNoBodyForAnyAddress() throws Exception {
        when(service.requestReset(anyString())).thenReturn(false);
        mockMvc.perform(post("/api/auth/password/forgot").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"nobody@x.io\"}"))
                .andExpect(status().isAccepted())
                .andExpect(content().string(""));
        verify(service).requestReset("nobody@x.io");
    }

    @Test
    void forgotRefusesANonEmailWith400() throws Exception {
        mockMvc.perform(post("/api/auth/password/forgot").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"not-an-email\"}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void spentTokenIs401AndAShortPasswordIs400() throws Exception {
        doThrow(ApiException.unauthorized("링크가 만료되었거나 이미 사용되었습니다.")).when(service).reset("t", "newpass1");
        mockMvc.perform(post("/api/auth/password/reset").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"token\":\"t\",\"newPassword\":\"newpass1\"}"))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(post("/api/auth/password/reset").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"token\":\"t\",\"newPassword\":\"abc\"}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void everyAnswerCarriesTheHardenedHeaders() throws Exception {
        mockMvc.perform(get("/api/auth/password/config"))
                .andExpect(header().string("Content-Security-Policy",
                        Matchers.allOf(Matchers.containsString("default-src 'none'"), Matchers.containsString("frame-ancestors 'none'"))))
                .andExpect(header().string("Referrer-Policy", "no-referrer"))
                .andExpect(header().string("Permissions-Policy", Matchers.containsString("camera=()")))
                .andExpect(header().string("X-Content-Type-Options", "nosniff"))
                .andExpect(header().string("X-Frame-Options", "DENY"));
    }
}
