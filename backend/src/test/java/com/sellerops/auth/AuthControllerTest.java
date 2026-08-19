package com.sellerops.auth;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.sellerops.auth.dto.AuthResponse;
import com.sellerops.auth.JwtTokenProvider;
import com.sellerops.config.SecurityConfig;
import com.sellerops.organization.OrganizationRepository;
import com.sellerops.user.UserView;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

/** Sign-up requires the 필수 consent (docs/service_readiness_v1.md §2-4); the optional one is optional. */
@WebMvcTest(AuthController.class)
@Import(SecurityConfig.class)
@ActiveProfiles("test")
class AuthControllerTest {

    @Autowired MockMvc mockMvc;
    @MockBean AuthService authService;
    @MockBean JwtTokenProvider tokenProvider;
    @MockBean OrganizationRepository organizations;

    private static final String BASE = "\"email\":\"a@x.io\",\"password\":\"secret1\",\"name\":\"A\",\"orgName\":\"O\"";

    @Test
    void signupWithoutTermsIs400() throws Exception {
        mockMvc.perform(post("/api/auth/signup").contentType(MediaType.APPLICATION_JSON)
                        .content("{" + BASE + "}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("동의")));
        mockMvc.perform(post("/api/auth/signup").contentType(MediaType.APPLICATION_JSON)
                        .content("{" + BASE + ",\"termsAccepted\":false}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void signupWithTermsSucceedsWithOrWithoutMarketing() throws Exception {
        UUID id = UUID.randomUUID();
        when(authService.signup(any())).thenReturn(new AuthResponse("jwt",
                new UserView(id, "a@x.io", "A", "OWNER", id, "O")));
        mockMvc.perform(post("/api/auth/signup").contentType(MediaType.APPLICATION_JSON)
                        .content("{" + BASE + ",\"termsAccepted\":true}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.token").value("jwt"));
        mockMvc.perform(post("/api/auth/signup").contentType(MediaType.APPLICATION_JSON)
                        .content("{" + BASE + ",\"termsAccepted\":true,\"marketingConsent\":true}"))
                .andExpect(status().isOk());
    }
}
