package com.sellerops.auth.social;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.client.authentication.OAuth2AuthenticationToken;
import org.springframework.security.oauth2.core.oidc.user.OidcUser;
import org.springframework.security.oauth2.core.user.OAuth2User;
import org.springframework.security.web.authentication.AuthenticationSuccessHandler;
import org.springframework.stereotype.Component;

/**
 * The provider said yes. Extract {@code (provider, subject, email, name)}, let {@link SocialAuthService} decide,
 * and send the browser to the frontend with at most a one-time code. Nothing from the provider is stored in the
 * HTTP session and no JWT is minted here.
 */
@Component
public class SocialLoginSuccessHandler implements AuthenticationSuccessHandler {

    private static final Logger log = LoggerFactory.getLogger(SocialLoginSuccessHandler.class);

    private final SocialAuthService socialAuth;
    private final SocialLoginProperties props;

    public SocialLoginSuccessHandler(SocialAuthService socialAuth, SocialLoginProperties props) {
        this.socialAuth = socialAuth;
        this.props = props;
    }

    @Override
    public void onAuthenticationSuccess(HttpServletRequest request, HttpServletResponse response,
                                        Authentication authentication) throws IOException {
        if (!(authentication instanceof OAuth2AuthenticationToken token)) {
            response.sendRedirect(props.frontendUrl("/login?social=failed"));
            return;
        }
        SocialProfile profile = extract(token.getAuthorizedClientRegistrationId(), token.getPrincipal());
        SocialLoginOutcome outcome = socialAuth.onProviderAuthenticated(profile);
        log.info("social login provider={} outcome={}", profile.provider(), outcome.kind());
        invalidateSession(request);
        response.sendRedirect(props.frontendUrl(outcome.frontendPath()));
    }

    /** Provider-specific claim shapes → one profile. Package-private for tests. */
    static SocialProfile extract(String registrationId, OAuth2User principal) {
        String provider = registrationId == null ? "" : registrationId.toLowerCase();
        if (SocialLoginProperties.GOOGLE.equals(provider)) {
            Map<String, Object> a = principal.getAttributes();
            String subject = principal instanceof OidcUser oidc ? oidc.getSubject() : str(a.get("sub"));
            // Google's OIDC profile carries email_verified; an unverified email is no login identity.
            boolean verified = !Boolean.FALSE.equals(a.get("email_verified"));
            return new SocialProfile(provider, subject, verified ? str(a.get("email")) : null, str(a.get("name")));
        }
        if (SocialLoginProperties.NAVER.equals(provider)) {
            Object wrapped = principal.getAttributes().get(SocialLoginConfiguration.NAVER_USER_NAME_ATTRIBUTE);
            if (wrapped instanceof Map<?, ?> r) {
                return new SocialProfile(provider, str(r.get("id")), str(r.get("email")), str(r.get("name")));
            }
            return new SocialProfile(provider, null, null, null);
        }
        return new SocialProfile(provider, principal.getName(), null, null);
    }

    private static String str(Object o) {
        return o == null ? null : String.valueOf(o);
    }

    private static void invalidateSession(HttpServletRequest request) {
        var session = request.getSession(false);
        if (session != null) {
            session.invalidate();
        }
    }
}
