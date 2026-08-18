package com.sellerops.config;

import com.sellerops.auth.JwtAuthFilter;
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
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

@Configuration
public class SecurityConfig {

    private final JwtAuthFilter jwtAuthFilter;
    private final String corsOrigin;
    private final ObjectProvider<ClientRegistrationRepository> clientRegistrations;
    private final ObjectProvider<SocialLoginSuccessHandler> socialSuccess;
    private final ObjectProvider<SocialLoginFailureHandler> socialFailure;

    public SecurityConfig(JwtAuthFilter jwtAuthFilter,
                          @Value("${sellerops.cors.origin}") String corsOrigin,
                          ObjectProvider<ClientRegistrationRepository> clientRegistrations,
                          ObjectProvider<SocialLoginSuccessHandler> socialSuccess,
                          ObjectProvider<SocialLoginFailureHandler> socialFailure) {
        this.jwtAuthFilter = jwtAuthFilter;
        this.corsOrigin = corsOrigin;
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
