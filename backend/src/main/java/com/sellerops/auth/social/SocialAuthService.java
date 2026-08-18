package com.sellerops.auth.social;

import com.sellerops.auth.JwtTokenProvider;
import com.sellerops.auth.dto.AuthResponse;
import com.sellerops.auth.social.dto.SocialExchangeResponse;
import com.sellerops.common.ApiException;
import com.sellerops.organization.Organization;
import com.sellerops.organization.OrganizationRepository;
import com.sellerops.user.User;
import com.sellerops.user.UserRepository;
import com.sellerops.user.UserView;
import java.time.Clock;
import java.time.Instant;
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Social login on top of the existing users/org/JWT model — docs/auth_growth_instrumentation_v1.md §2.
 *
 * <ul>
 *   <li>Identity is {@code (provider, subject)}. An email that already belongs to a user is a refusal, never an
 *       automatic link.</li>
 *   <li>The browser only ever carries a one-time code; the JWT is issued by {@link #exchange} in a response body.</li>
 *   <li>A first-time identity creates nothing until 상호명 is given; then org + user + identity are one transaction
 *       whose collision checks are repeated inside it.</li>
 * </ul>
 */
@Service
public class SocialAuthService {

    private static final Logger log = LoggerFactory.getLogger(SocialAuthService.class);

    private final UserIdentityRepository identities;
    private final AuthHandoffRepository handoffs;
    private final UserRepository users;
    private final OrganizationRepository organizations;
    private final JwtTokenProvider tokenProvider;
    private final SocialLoginProperties props;
    private final Clock clock;

    @Autowired
    public SocialAuthService(UserIdentityRepository identities,
                             AuthHandoffRepository handoffs,
                             UserRepository users,
                             OrganizationRepository organizations,
                             JwtTokenProvider tokenProvider,
                             SocialLoginProperties props) {
        this(identities, handoffs, users, organizations, tokenProvider, props, Clock.systemUTC());
    }

    SocialAuthService(UserIdentityRepository identities,
                      AuthHandoffRepository handoffs,
                      UserRepository users,
                      OrganizationRepository organizations,
                      JwtTokenProvider tokenProvider,
                      SocialLoginProperties props,
                      Clock clock) {
        this.identities = identities;
        this.handoffs = handoffs;
        this.users = users;
        this.organizations = organizations;
        this.tokenProvider = tokenProvider;
        this.props = props;
        this.clock = clock;
    }

    /** The provider authenticated the person; decide where the browser goes and mint the one-time code. */
    @Transactional
    public SocialLoginOutcome onProviderAuthenticated(SocialProfile profile) {
        String provider = normalizeProvider(profile.provider());
        String subject = profile.subject();
        if (subject == null || subject.isBlank()) {
            throw ApiException.unauthorized("소셜 로그인 정보를 확인하지 못했습니다.");
        }
        Optional<UserIdentity> linked = identities.findByProviderAndProviderSubject(provider, subject);
        if (linked.isPresent()) {
            String code = AuthCodes.newCode();
            AuthHandoff h = newHandoff(code, AuthHandoff.Purpose.SESSION, provider, subject,
                    profile.email(), profile.name(), props.codeTtlSeconds());
            h.setUserId(linked.get().getUserId());
            handoffs.save(h);
            return SocialLoginOutcome.session(code);
        }
        String email = normalizeEmail(profile.email());
        if (email == null) {
            return SocialLoginOutcome.emailMissing();
        }
        if (users.existsByEmailIgnoreCase(email)) {
            // Fail closed: linking a social identity to an existing account is an explicit, signed-in act (§9),
            // never something an email match does on its own.
            log.info("social login refused: email already registered provider={}", provider);
            return SocialLoginOutcome.emailTaken();
        }
        String code = AuthCodes.newCode();
        handoffs.save(newHandoff(code, AuthHandoff.Purpose.ONBOARDING, provider, subject, email,
                profile.name(), props.codeTtlSeconds()));
        return SocialLoginOutcome.onboarding(code);
    }

    /** Spend a one-time code: SESSION → JWT; ONBOARDING → a fresh one-time onboarding token. */
    @Transactional
    public SocialExchangeResponse exchange(String code) {
        Instant now = clock.instant();
        String hash = AuthCodes.hash(code);
        AuthHandoff h = handoffs.findByCodeHash(hash)
                .filter(x -> x.getPurpose() != AuthHandoff.Purpose.ONBOARDING_TOKEN)
                .orElseThrow(() -> ApiException.unauthorized("로그인 링크가 만료되었습니다. 다시 로그인해 주세요."));
        if (handoffs.consume(hash, h.getPurpose(), now) != 1) {
            throw ApiException.unauthorized("로그인 링크가 만료되었습니다. 다시 로그인해 주세요.");
        }
        if (h.getPurpose() == AuthHandoff.Purpose.SESSION) {
            User user = users.findById(h.getUserId())
                    .orElseThrow(() -> ApiException.unauthorized("계정을 찾을 수 없습니다. 다시 로그인해 주세요."));
            return SocialExchangeResponse.signedIn(tokenProvider.createToken(user.getId(), user.getOrgId(),
                    user.getEmail()), toView(user), h.getProvider());
        }
        // ONBOARDING: the exchange code was the URL-borne secret; the onboarding token lives only in the response
        // body / the browser's session storage, with a longer TTL for typing 상호명.
        String onboardingToken = AuthCodes.newCode();
        handoffs.save(newHandoff(onboardingToken, AuthHandoff.Purpose.ONBOARDING_TOKEN, h.getProvider(),
                h.getProviderSubject(), h.getEmail(), h.getDisplayName(), props.onboardingTtlSeconds()));
        return SocialExchangeResponse.onboardingRequired(onboardingToken, h.getProvider(), h.getEmail(),
                h.getDisplayName());
    }

    /** 상호명 given: org + user + identity in one transaction; both collision checks repeated here. */
    @Transactional
    public AuthResponse completeOnboarding(String onboardingToken, String orgName, String name) {
        Instant now = clock.instant();
        String hash = AuthCodes.hash(onboardingToken);
        AuthHandoff h = handoffs.findByCodeHash(hash)
                .filter(x -> x.getPurpose() == AuthHandoff.Purpose.ONBOARDING_TOKEN)
                .orElseThrow(() -> ApiException.unauthorized("가입 세션이 만료되었습니다. 다시 로그인해 주세요."));
        if (handoffs.consume(hash, AuthHandoff.Purpose.ONBOARDING_TOKEN, now) != 1) {
            throw ApiException.unauthorized("가입 세션이 만료되었습니다. 다시 로그인해 주세요.");
        }
        String email = normalizeEmail(h.getEmail());
        if (email == null) {
            throw ApiException.badRequest("이메일 정보가 없어 가입을 진행할 수 없습니다.");
        }
        if (identities.findByProviderAndProviderSubject(h.getProvider(), h.getProviderSubject()).isPresent()) {
            throw ApiException.conflict("이미 가입된 계정입니다. 다시 로그인해 주세요.");
        }
        if (users.existsByEmailIgnoreCase(email)) {
            throw ApiException.conflict("이미 가입된 이메일입니다. 이메일과 비밀번호로 로그인해 주세요.");
        }
        // From here every write is in this transaction; a unique-constraint race (two tokens for one identity or
        // email completing at once) surfaces as a DataIntegrityViolation and rolls the whole thing back — the
        // second seller sees an error and signs in again, never a half-made account.
        Organization org = new Organization();
        org.setName(orgName.trim());
        org = organizations.save(org);

        User user = new User();
        user.setOrgId(org.getId());
        user.setEmail(email);
        user.setPasswordHash(null);
        user.setName(name.trim());
        user.setRole("OWNER");
        user = users.save(user);

        UserIdentity identity = new UserIdentity();
        identity.setUserId(user.getId());
        identity.setProvider(h.getProvider());
        identity.setProviderSubject(h.getProviderSubject());
        identity.setEmail(email);
        identities.save(identity);

        return new AuthResponse(tokenProvider.createToken(user.getId(), user.getOrgId(), user.getEmail()),
                new UserView(user.getId(), user.getEmail(), user.getName(), user.getRole(), org.getId(),
                        org.getName()));
    }

    /** Housekeeping: rows past their TTL carry nothing anyone can use. */
    @Transactional
    public int purgeExpired() {
        return handoffs.deleteExpiredBefore(clock.instant());
    }

    private AuthHandoff newHandoff(String code, AuthHandoff.Purpose purpose, String provider, String subject,
                                   String email, String displayName, int ttlSeconds) {
        AuthHandoff h = new AuthHandoff();
        h.setCodeHash(AuthCodes.hash(code));
        h.setPurpose(purpose);
        h.setProvider(provider);
        h.setProviderSubject(subject);
        h.setEmail(normalizeEmail(email));
        h.setDisplayName(displayName == null ? null : truncate(displayName.trim(), 120));
        h.setExpiresAt(clock.instant().plusSeconds(ttlSeconds));
        return h;
    }

    private UserView toView(User user) {
        String orgName = organizations.findById(user.getOrgId()).map(Organization::getName).orElse("");
        return new UserView(user.getId(), user.getEmail(), user.getName(), user.getRole(), user.getOrgId(), orgName);
    }

    static String normalizeProvider(String provider) {
        if (provider == null || provider.isBlank()) {
            throw ApiException.unauthorized("소셜 로그인 정보를 확인하지 못했습니다.");
        }
        return provider.trim().toLowerCase(Locale.ROOT);
    }

    static String normalizeEmail(String email) {
        if (email == null) return null;
        String e = email.trim().toLowerCase(Locale.ROOT);
        return e.isEmpty() || !e.contains("@") ? null : e;
    }

    private static String truncate(String s, int max) {
        return s.length() <= max ? s : s.substring(0, max);
    }
}
