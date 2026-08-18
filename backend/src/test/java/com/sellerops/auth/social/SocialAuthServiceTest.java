package com.sellerops.auth.social;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.sellerops.auth.JwtTokenProvider;
import com.sellerops.auth.dto.AuthResponse;
import com.sellerops.auth.social.dto.SocialExchangeResponse;
import com.sellerops.common.ApiException;
import com.sellerops.organization.Organization;
import com.sellerops.organization.OrganizationRepository;
import com.sellerops.user.User;
import com.sellerops.user.UserRepository;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.http.HttpStatus;

/**
 * The three product-owner amendments of docs/auth_growth_instrumentation_v1.md §2, as behaviour:
 * (1) no JWT in a URL — a one-time code, hashed at rest, spent once; (2) identity = (provider, subject), an
 * email match is a refusal, never a link; (3) no user without an org — nothing is created until 상호명, then
 * org + user + identity together with the collision checks repeated.
 */
class SocialAuthServiceTest {

    private final UserIdentityRepository identities = mock(UserIdentityRepository.class);
    private final AuthHandoffRepository handoffs = mock(AuthHandoffRepository.class);
    private final UserRepository users = mock(UserRepository.class);
    private final OrganizationRepository organizations = mock(OrganizationRepository.class);
    private final JwtTokenProvider tokens = mock(JwtTokenProvider.class);
    private final Instant now = Instant.parse("2026-08-19T01:00:00Z");
    private final SocialLoginProperties props = new SocialLoginProperties("gid", "gsecret", "", "", "", 120, 1800);
    private SocialAuthService service;

    @BeforeEach
    void setUp() {
        service = new SocialAuthService(identities, handoffs, users, organizations, tokens, props,
                Clock.fixed(now, ZoneOffset.UTC));
        when(handoffs.save(any())).thenAnswer(inv -> inv.getArgument(0));
        when(users.save(any())).thenAnswer(inv -> { User u = inv.getArgument(0); u.setId(UUID.randomUUID()); return u; });
        when(organizations.save(any())).thenAnswer(inv -> { Organization o = inv.getArgument(0); o.setId(UUID.randomUUID()); return o; });
        when(identities.save(any())).thenAnswer(inv -> inv.getArgument(0));
    }

    private static UserIdentity identity(UUID userId) {
        UserIdentity i = new UserIdentity();
        i.setUserId(userId);
        i.setProvider("google");
        i.setProviderSubject("sub-1");
        return i;
    }

    @Test
    void linkedIdentityMintsASessionCodeWhoseHashOnlyIsStored() {
        UUID userId = UUID.randomUUID();
        when(identities.findByProviderAndProviderSubject("google", "sub-1")).thenReturn(Optional.of(identity(userId)));

        SocialLoginOutcome outcome = service.onProviderAuthenticated(new SocialProfile("google", "sub-1", "a@x.io", "A"));

        assertThat(outcome.kind()).isEqualTo(SocialLoginOutcome.Kind.SESSION);
        assertThat(outcome.frontendPath()).startsWith("/auth/callback?code=").doesNotContain("eyJ");
        ArgumentCaptor<AuthHandoff> saved = ArgumentCaptor.forClass(AuthHandoff.class);
        verify(handoffs).save(saved.capture());
        assertThat(saved.getValue().getCodeHash()).isEqualTo(AuthCodes.hash(outcome.code())).isNotEqualTo(outcome.code());
        assertThat(saved.getValue().getPurpose()).isEqualTo(AuthHandoff.Purpose.SESSION);
        assertThat(saved.getValue().getUserId()).isEqualTo(userId);
        assertThat(saved.getValue().getExpiresAt()).isEqualTo(now.plusSeconds(120));
        verify(users, never()).save(any());
    }

    @Test
    void firstTimeIdentityWithFreeEmailGoesToOnboardingAndCreatesNoUser() {
        when(identities.findByProviderAndProviderSubject("naver", "n-9")).thenReturn(Optional.empty());
        when(users.existsByEmailIgnoreCase("new@x.io")).thenReturn(false);

        SocialLoginOutcome outcome = service.onProviderAuthenticated(new SocialProfile("naver", "n-9", "New@X.io ", "판매자"));

        assertThat(outcome.kind()).isEqualTo(SocialLoginOutcome.Kind.ONBOARDING);
        ArgumentCaptor<AuthHandoff> saved = ArgumentCaptor.forClass(AuthHandoff.class);
        verify(handoffs).save(saved.capture());
        assertThat(saved.getValue().getPurpose()).isEqualTo(AuthHandoff.Purpose.ONBOARDING);
        assertThat(saved.getValue().getEmail()).isEqualTo("new@x.io");
        assertThat(saved.getValue().getUserId()).isNull();
        verify(users, never()).save(any());
        verify(organizations, never()).save(any());
        verify(identities, never()).save(any());
    }

    @Test
    void emailAlreadyRegisteredIsRefusedNotLinked() {
        when(identities.findByProviderAndProviderSubject("google", "sub-2")).thenReturn(Optional.empty());
        when(users.existsByEmailIgnoreCase("owner@x.io")).thenReturn(true);

        SocialLoginOutcome outcome = service.onProviderAuthenticated(new SocialProfile("google", "sub-2", "owner@x.io", "O"));

        assertThat(outcome.kind()).isEqualTo(SocialLoginOutcome.Kind.EMAIL_TAKEN);
        assertThat(outcome.frontendPath()).isEqualTo("/login?social=email_taken");
        verify(handoffs, never()).save(any());
        verify(identities, never()).save(any());
    }

    @Test
    void missingVerifiedEmailIsRefused() {
        when(identities.findByProviderAndProviderSubject("google", "sub-3")).thenReturn(Optional.empty());

        SocialLoginOutcome outcome = service.onProviderAuthenticated(new SocialProfile("google", "sub-3", null, "N"));

        assertThat(outcome.kind()).isEqualTo(SocialLoginOutcome.Kind.EMAIL_MISSING);
        verify(handoffs, never()).save(any());
    }

    private AuthHandoff handoff(String code, AuthHandoff.Purpose purpose, UUID userId) {
        AuthHandoff h = new AuthHandoff();
        h.setCodeHash(AuthCodes.hash(code));
        h.setPurpose(purpose);
        h.setUserId(userId);
        h.setProvider("google");
        h.setProviderSubject("sub-1");
        h.setEmail("a@x.io");
        h.setDisplayName("A");
        h.setExpiresAt(now.plusSeconds(60));
        return h;
    }

    @Test
    void exchangingASessionCodeIssuesTheExistingJwtAndSpendsTheCodeOnce() {
        UUID userId = UUID.randomUUID();
        UUID orgId = UUID.randomUUID();
        AuthHandoff h = handoff("code-1", AuthHandoff.Purpose.SESSION, userId);
        when(handoffs.findByCodeHash(AuthCodes.hash("code-1"))).thenReturn(Optional.of(h));
        when(handoffs.consume(AuthCodes.hash("code-1"), AuthHandoff.Purpose.SESSION, now)).thenReturn(1, 0);
        User user = new User();
        user.setId(userId); user.setOrgId(orgId); user.setEmail("a@x.io"); user.setName("A"); user.setRole("OWNER");
        when(users.findById(userId)).thenReturn(Optional.of(user));
        Organization org = new Organization(); org.setId(orgId); org.setName("스토어");
        when(organizations.findById(orgId)).thenReturn(Optional.of(org));
        when(tokens.createToken(userId, orgId, "a@x.io")).thenReturn("jwt-1");

        SocialExchangeResponse first = service.exchange("code-1");
        assertThat(first.status()).isEqualTo(SocialExchangeResponse.Status.SIGNED_IN);
        assertThat(first.token()).isEqualTo("jwt-1");
        assertThat(first.user().orgName()).isEqualTo("스토어");
        assertThat(first.provider()).isEqualTo("google");

        assertThatThrownBy(() -> service.exchange("code-1"))
                .isInstanceOf(ApiException.class)
                .satisfies(e -> assertThat(((ApiException) e).getStatus()).isEqualTo(HttpStatus.UNAUTHORIZED));
    }

    @Test
    void unknownCodeIsUnauthorized() {
        when(handoffs.findByCodeHash(any())).thenReturn(Optional.empty());
        assertThatThrownBy(() -> service.exchange("nope")).isInstanceOf(ApiException.class);
    }

    @Test
    void exchangingAnOnboardingCodeMintsABodyOnlyOnboardingToken() {
        AuthHandoff h = handoff("code-2", AuthHandoff.Purpose.ONBOARDING, null);
        when(handoffs.findByCodeHash(AuthCodes.hash("code-2"))).thenReturn(Optional.of(h));
        when(handoffs.consume(AuthCodes.hash("code-2"), AuthHandoff.Purpose.ONBOARDING, now)).thenReturn(1);

        SocialExchangeResponse res = service.exchange("code-2");

        assertThat(res.status()).isEqualTo(SocialExchangeResponse.Status.ONBOARDING_REQUIRED);
        assertThat(res.onboardingToken()).isNotBlank().isNotEqualTo("code-2");
        assertThat(res.email()).isEqualTo("a@x.io");
        assertThat(res.token()).isNull();
        ArgumentCaptor<AuthHandoff> saved = ArgumentCaptor.forClass(AuthHandoff.class);
        verify(handoffs).save(saved.capture());
        assertThat(saved.getValue().getPurpose()).isEqualTo(AuthHandoff.Purpose.ONBOARDING_TOKEN);
        assertThat(saved.getValue().getExpiresAt()).isEqualTo(now.plusSeconds(1800));
        verify(users, never()).save(any());
    }

    @Test
    void anOnboardingTokenCannotBeExchangedAsALoginCode() {
        AuthHandoff h = handoff("tok", AuthHandoff.Purpose.ONBOARDING_TOKEN, null);
        when(handoffs.findByCodeHash(AuthCodes.hash("tok"))).thenReturn(Optional.of(h));
        assertThatThrownBy(() -> service.exchange("tok")).isInstanceOf(ApiException.class);
        verify(handoffs, never()).consume(any(), any(), any());
    }

    @Test
    void completingOnboardingCreatesOrgUserAndIdentityTogether() {
        AuthHandoff h = handoff("tok", AuthHandoff.Purpose.ONBOARDING_TOKEN, null);
        when(handoffs.findByCodeHash(AuthCodes.hash("tok"))).thenReturn(Optional.of(h));
        when(handoffs.consume(AuthCodes.hash("tok"), AuthHandoff.Purpose.ONBOARDING_TOKEN, now)).thenReturn(1);
        when(identities.findByProviderAndProviderSubject("google", "sub-1")).thenReturn(Optional.empty());
        when(users.existsByEmailIgnoreCase("a@x.io")).thenReturn(false);
        when(tokens.createToken(any(), any(), eq("a@x.io"))).thenReturn("jwt-new");

        AuthResponse res = service.completeOnboarding("tok", " 우리 스토어 ", "판매자");

        assertThat(res.token()).isEqualTo("jwt-new");
        assertThat(res.user().orgName()).isEqualTo("우리 스토어");
        assertThat(res.user().role()).isEqualTo("OWNER");
        ArgumentCaptor<User> user = ArgumentCaptor.forClass(User.class);
        verify(users).save(user.capture());
        assertThat(user.getValue().getPasswordHash()).isNull();
        assertThat(user.getValue().getEmail()).isEqualTo("a@x.io");
        ArgumentCaptor<UserIdentity> identity = ArgumentCaptor.forClass(UserIdentity.class);
        verify(identities).save(identity.capture());
        assertThat(identity.getValue().getUserId()).isEqualTo(user.getValue().getId());
        assertThat(identity.getValue().getProvider()).isEqualTo("google");
        assertThat(identity.getValue().getProviderSubject()).isEqualTo("sub-1");
    }

    @Test
    void completingOnboardingRepeatsTheEmailCollisionCheckAndFailsClosed() {
        AuthHandoff h = handoff("tok", AuthHandoff.Purpose.ONBOARDING_TOKEN, null);
        when(handoffs.findByCodeHash(AuthCodes.hash("tok"))).thenReturn(Optional.of(h));
        when(handoffs.consume(any(), any(), any())).thenReturn(1);
        when(identities.findByProviderAndProviderSubject(any(), any())).thenReturn(Optional.empty());
        when(users.existsByEmailIgnoreCase("a@x.io")).thenReturn(true);

        assertThatThrownBy(() -> service.completeOnboarding("tok", "스토어", "A"))
                .isInstanceOf(ApiException.class)
                .satisfies(e -> assertThat(((ApiException) e).getStatus()).isEqualTo(HttpStatus.CONFLICT));
        verify(users, never()).save(any());
        verify(organizations, never()).save(any());
    }

    @Test
    void anExchangeCodeCannotCompleteOnboardingDirectly() {
        AuthHandoff h = handoff("code-2", AuthHandoff.Purpose.ONBOARDING, null);
        when(handoffs.findByCodeHash(AuthCodes.hash("code-2"))).thenReturn(Optional.of(h));
        assertThatThrownBy(() -> service.completeOnboarding("code-2", "스토어", "A")).isInstanceOf(ApiException.class);
        verify(users, never()).save(any());
    }

    @Test
    void expiredOrSpentOnboardingTokenIsRefused() {
        AuthHandoff h = handoff("tok", AuthHandoff.Purpose.ONBOARDING_TOKEN, null);
        when(handoffs.findByCodeHash(AuthCodes.hash("tok"))).thenReturn(Optional.of(h));
        when(handoffs.consume(any(), any(), any())).thenReturn(0);
        assertThatThrownBy(() -> service.completeOnboarding("tok", "스토어", "A")).isInstanceOf(ApiException.class);
        verify(users, never()).save(any());
    }
}
