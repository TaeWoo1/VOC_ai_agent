package com.sellerops.config;

import com.sellerops.auth.JwtAuthFilter;
import com.sellerops.auth.device.HelperDeviceAuthFilter;
import com.sellerops.auth.social.SocialLoginFailureHandler;
import com.sellerops.auth.social.SocialLoginSuccessHandler;
import java.util.List;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.oauth2.client.registration.ClientRegistrationRepository;
import org.springframework.security.oauth2.client.web.DefaultOAuth2AuthorizationRequestResolver;
import org.springframework.security.oauth2.client.web.OAuth2AuthorizationRequestRedirectFilter;
import org.springframework.security.oauth2.client.web.OAuth2AuthorizationRequestResolver;
import org.springframework.security.oauth2.core.endpoint.OAuth2AuthorizationRequest;
import com.sellerops.collect.CredentialHandoffCapabilityFilter;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

@Configuration
public class SecurityConfig {

    private final JwtAuthFilter jwtAuthFilter;
    private final ObjectProvider<CredentialHandoffCapabilityFilter> credentialHandoffCapabilityFilter;
    private final ObjectProvider<HelperDeviceAuthFilter> helperDeviceAuthFilter;
    private final String corsOrigin;
    private final ObjectProvider<ClientRegistrationRepository> clientRegistrations;
    private final ObjectProvider<SocialLoginSuccessHandler> socialSuccess;
    private final ObjectProvider<SocialLoginFailureHandler> socialFailure;

    public SecurityConfig(JwtAuthFilter jwtAuthFilter,
                          ObjectProvider<CredentialHandoffCapabilityFilter> credentialHandoffCapabilityFilter,
                          ObjectProvider<HelperDeviceAuthFilter> helperDeviceAuthFilter,
                          @Value("${sellerops.cors.origin}") String corsOrigin,
                          ObjectProvider<ClientRegistrationRepository> clientRegistrations,
                          ObjectProvider<SocialLoginSuccessHandler> socialSuccess,
                          ObjectProvider<SocialLoginFailureHandler> socialFailure) {
        this.jwtAuthFilter = jwtAuthFilter;
        this.corsOrigin = corsOrigin;
        this.credentialHandoffCapabilityFilter = credentialHandoffCapabilityFilter;
        this.helperDeviceAuthFilter = helperDeviceAuthFilter;
        this.clientRegistrations = clientRegistrations;
        this.socialSuccess = socialSuccess;
        this.socialFailure = socialFailure;
    }

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
                .csrf(AbstractHttpConfigurer::disable)
                .cors(cors -> cors.configurationSource(corsConfigurationSource()))
                .sessionManagement(sm -> sm.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                // Security headers (docs/service_readiness_v1.md §2-5) on top of Spring's defaults (nosniff,
                // X-Frame-Options DENY, Cache-Control no-store, HSTS on https, X-XSS-Protection 0). This service
                // answers JSON and OAuth redirects only — nothing here may load a script, be framed, or leak a
                // referrer (an OAuth callback URL carries a one-time code) to anyone.
                .headers(headers -> headers
                        .contentSecurityPolicy(csp -> csp.policyDirectives(
                                "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"))
                        .referrerPolicy(rp -> rp.policy(
                                org.springframework.security.web.header.writers.ReferrerPolicyHeaderWriter
                                        .ReferrerPolicy.NO_REFERRER))
                        .permissionsPolicy(pp -> pp.policy(
                                "camera=(), microphone=(), geolocation=(), payment=()")))
                .authorizeHttpRequests(auth -> auth
                        .requestMatchers(HttpMethod.OPTIONS, "/**").permitAll()
                        .requestMatchers("/api/auth/**", "/actuator/health", "/health").permitAll()
                        // Social login (Google · NAVER): the authorize redirect and the provider's callback are
                        // top-level browser navigations without a JWT. Present only when a provider is
                        // configured (SocialLoginConfiguration); otherwise these paths do not exist.
                        .requestMatchers("/oauth2/**", "/login/oauth2/**").permitAll()
                        // Cafe24 OAuth redirect target: a top-level browser navigation from
                        // cafe24.com carries no JWT — identity is recovered from the single-use,
                        // tenant-bound state inside the handler. The /start endpoint stays authed.
                        .requestMatchers(HttpMethod.GET, "/api/connect/cafe24/callback").permitAll()
                        .anyRequest().authenticated())
                // Return 401 (not the default 403) when no valid token is present.
                .exceptionHandling(e -> e.authenticationEntryPoint(
                        (request, response, ex) ->
                                response.sendError(HttpServletResponse.SC_UNAUTHORIZED)))
                .addFilterBefore(jwtAuthFilter, UsernamePasswordAuthenticationFilter.class);

        // BEFORE the JWT filter, and it owns any request that presents a handoff capability: it either
        // authenticates that one write or ends the request. Placing it first is what makes "no fallback"
        // structural — a refused capability never reaches a filter that might authenticate it another way.
        //
        // Resolved through an ObjectProvider, like the social-login handlers below, so a sliced test context that
        // does not import the collect package still builds a filter chain. Absent ⇒ the capability header
        // authenticates nothing at all and the endpoint is JWT-only, which is the safe direction to be missing in.
        CredentialHandoffCapabilityFilter capabilityFilter = credentialHandoffCapabilityFilter.getIfAvailable();
        if (capabilityFilter != null) {
            http.addFilterBefore(capabilityFilter, JwtAuthFilter.class);
        }
        // Also before the JWT filter, and it owns every bearer that carries the device-token prefix: a helper token
        // is admitted on the helper's routes or the request ends 401 — it never reaches a filter that might read it
        // as something else (docs/helper_device_authentication_v1.md §4). Absent (sliced context) ⇒ a device token
        // authenticates nothing, which is the safe direction to be missing in.
        HelperDeviceAuthFilter deviceFilter = helperDeviceAuthFilter.getIfAvailable();
        if (deviceFilter != null) {
            http.addFilterBefore(deviceFilter, JwtAuthFilter.class);
        }
        // oauth2Login only when the deployer configured a provider — the existing email/password/JWT system
        // is untouched either way; success mints a one-time code, never a session or a JWT in a URL
        // (docs/auth_growth_instrumentation_v1.md §2-1).
        ClientRegistrationRepository registrations = clientRegistrations.getIfAvailable();
        SocialLoginSuccessHandler success = socialSuccess.getIfAvailable();
        SocialLoginFailureHandler failure = socialFailure.getIfAvailable();
        if (registrations != null && success != null && failure != null) {
            // A provider that is not configured is not an authorize target: the default resolver throws
            // (InvalidClientRegistrationIdException, a package-private IllegalArgumentException — a 500 by the
            // time it reaches the browser) for an unknown registration id; answer "no such route" instead.
            var defaultResolver = new DefaultOAuth2AuthorizationRequestResolver(registrations,
                    OAuth2AuthorizationRequestRedirectFilter.DEFAULT_AUTHORIZATION_REQUEST_BASE_URI);
            OAuth2AuthorizationRequestResolver knownProvidersOnly = new OAuth2AuthorizationRequestResolver() {
                @Override
                public OAuth2AuthorizationRequest resolve(HttpServletRequest request) {
                    try {
                        return defaultResolver.resolve(request);
                    } catch (IllegalArgumentException unknown) {
                        return null;
                    }
                }

                @Override
                public OAuth2AuthorizationRequest resolve(HttpServletRequest request, String clientRegistrationId) {
                    try {
                        return defaultResolver.resolve(request, clientRegistrationId);
                    } catch (IllegalArgumentException unknown) {
                        return null;
                    }
                }
            };
            http.oauth2Login(oauth -> oauth
                    .clientRegistrationRepository(registrations)
                    .authorizationEndpoint(a -> a.authorizationRequestResolver(knownProvidersOnly))
                    .successHandler(success)
                    .failureHandler(failure));
        }
        return http.build();
    }

    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }

    @Bean
    public CorsConfigurationSource corsConfigurationSource() {
        CorsConfiguration config = new CorsConfiguration();
        config.setAllowedOrigins(List.of(corsOrigin));
        config.setAllowedMethods(List.of("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"));
        config.setAllowedHeaders(List.of("*"));
        config.setAllowCredentials(true);
        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", config);
        return source;
    }
}
