package com.sellerops.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.sellerops.auth.consent.AccountConsent;
import com.sellerops.auth.dto.SignupRequest;
import com.sellerops.organization.Organization;
import com.sellerops.organization.OrganizationRepository;
import com.sellerops.user.User;
import com.sellerops.user.UserRepository;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.security.crypto.password.PasswordEncoder;

/** Sign-up writes the account consent record (docs/service_readiness_v1.md §2-4). */
class AuthServiceTest {

    @Test
    void signupRecordsTermsVersionAndOptionalMarketingConsent() {
        OrganizationRepository orgs = mock(OrganizationRepository.class);
        UserRepository users = mock(UserRepository.class);
        PasswordEncoder encoder = mock(PasswordEncoder.class);
        JwtTokenProvider jwt = mock(JwtTokenProvider.class);
        when(orgs.save(any())).thenAnswer(inv -> { Organization o = inv.getArgument(0); o.setId(UUID.randomUUID()); return o; });
        when(users.save(any())).thenAnswer(inv -> { User u = inv.getArgument(0); u.setId(UUID.randomUUID()); return u; });
        when(encoder.encode("secret1")).thenReturn("$2a$x");
        when(jwt.createToken(any(), any(), any())).thenReturn("jwt");
        AuthService service = new AuthService(orgs, users, encoder, jwt);

        service.signup(new SignupRequest("a@x.io", "secret1", "A", "O", true, null));
        service.signup(new SignupRequest("b@x.io", "secret1", "B", "O", true, true));

        ArgumentCaptor<User> saved = ArgumentCaptor.forClass(User.class);
        verify(users, org.mockito.Mockito.times(2)).save(saved.capture());
        User a = saved.getAllValues().get(0);
        User b = saved.getAllValues().get(1);
        assertThat(a.getTermsAcceptedAt()).isNotNull();
        assertThat(a.getTermsVersion()).isEqualTo(AccountConsent.TERMS_VERSION);
        assertThat(a.getMarketingConsentAt()).isNull();
        assertThat(b.getMarketingConsentAt()).isNotNull();
    }
}
