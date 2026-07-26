package com.sellerops.auth;

import com.sellerops.organization.OrganizationRepository;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.List;
import org.springframework.lang.NonNull;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.authentication.WebAuthenticationDetailsSource;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Reads a bearer token, verifies it, and populates the security context.
 *
 * <p><b>A verified token is not enough: the organization it names must still exist.</b> Every read in this
 * service is org-scoped, so a token for an organization that is gone does not fail — it succeeds and returns
 * NOTHING. On 2026-07-26 that cost a live run its second step: the browser restored a token minted by an
 * earlier disposable database (the dev JWT secret is a fixed default and tokens last 12 hours), every
 * org-scoped read answered `200 []`, and the import screen told the seller
 * "먼저 판매 채널 계정을 연결해 주세요" — true about that organization, and entirely misleading to them.
 *
 * <p>An empty account list and "your session belongs to something that no longer exists" are opposite
 * situations that demand opposite actions, and no screen can tell them apart from the response alone. So the
 * check happens once, here: an unknown org is not authenticated, the request is answered 401, and the
 * frontend's existing unauthenticated path sends the seller to log in — which is the truth.
 *
 * <p>Cost is one primary-key lookup per authenticated request, served from the JPA/second-level cache in
 * practice, against a table with one row per tenant. Cheap enough that the alternative — every screen guessing
 * whether "empty" means empty — is not worth its price.
 */
@Component
public class JwtAuthFilter extends OncePerRequestFilter {

    private final JwtTokenProvider tokenProvider;
    private final OrganizationRepository organizations;

    public JwtAuthFilter(JwtTokenProvider tokenProvider, OrganizationRepository organizations) {
        this.tokenProvider = tokenProvider;
        this.organizations = organizations;
    }

    @Override
    protected void doFilterInternal(
            @NonNull HttpServletRequest request,
            @NonNull HttpServletResponse response,
            @NonNull FilterChain chain) throws ServletException, IOException {

        String header = request.getHeader("Authorization");
        if (header != null && header.startsWith("Bearer ")) {
            AuthPrincipal principal = tokenProvider.parse(header.substring(7));
            if (principal != null
                    && SecurityContextHolder.getContext().getAuthentication() == null
                    && orgExists(principal)) {
                var auth = new UsernamePasswordAuthenticationToken(principal, null, List.of());
                auth.setDetails(new WebAuthenticationDetailsSource().buildDetails(request));
                SecurityContextHolder.getContext().setAuthentication(auth);
            }
        }
        chain.doFilter(request, response);
    }

    /**
     * Does the token's organization still exist?
     *
     * A null orgId is treated as unknown rather than waved through: a principal with no tenant cannot be
     * scoped to one, and authenticating it would let a malformed token read whatever an unscoped query returns.
     */
    private boolean orgExists(AuthPrincipal principal) {
        return principal.orgId() != null && organizations.existsById(principal.orgId());
    }
}
