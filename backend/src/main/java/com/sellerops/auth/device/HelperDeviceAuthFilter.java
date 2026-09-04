package com.sellerops.auth.device;

import com.sellerops.auth.AuthPrincipal;
import com.sellerops.organization.OrganizationRepository;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.List;
import java.util.Optional;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.http.HttpMethod;
import org.springframework.lang.NonNull;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.authentication.WebAuthenticationDetailsSource;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * **A helper token opens the helper's routes, and nothing else.**
 *
 * <p>Sits BEFORE {@link com.sellerops.auth.JwtAuthFilter}. A bearer that starts with {@link HelperDeviceTokens#PREFIX}
 * is a device token by construction and is answered here, one way or the other:
 * <ol>
 *   <li><b>Recognised by prefix, never by parsing.</b> A device token is never handed to the JWT parser and a JWT is
 *       never looked up as a device token; the two credentials cannot be confused.</li>
 *   <li><b>Scoped by an allow-list of routes.</b> {@link #ALLOWED} is the set of calls the installed helper makes
 *       (uploads, launch scope/ingest/readiness, channel and account reads, the READ-only agent targets, and its own
 *       device row). A device token on any other route — 설정, 연결된 기기, 문의, the seller's own profile — is 401.
 *       The seller's session can do those; their helper cannot.</li>
 *   <li><b>No fallback.</b> An unknown, revoked or expired token ends the request with 401. It does not fall through
 *       to the JWT filter to see whether something else might authenticate it — that fallthrough is how a revoked
 *       credential quietly becomes a working one ({@code CredentialHandoffCapabilityFilter}, rule 4).</li>
 * </ol>
 *
 * <p>Marked with {@link #AUTHORITY} so nothing downstream can mistake a helper for a seated seller.
 */
@Component
public class HelperDeviceAuthFilter extends OncePerRequestFilter {

    public static final String AUTHORITY = "ROLE_HELPER_DEVICE";

    /** A route the helper may reach with its token. {@code method} null = any method. */
    public record Route(HttpMethod method, String pathPrefix) {
        boolean admits(HttpServletRequest request) {
            if (method != null && !method.matches(request.getMethod())) return false;
            String path = request.getRequestURI();
            return path.equals(pathPrefix) || path.startsWith(pathPrefix.endsWith("/") ? pathPrefix : pathPrefix + "/");
        }
    }

    /**
     * Every route the collector calls with a seller session today (audited 2026-09-05: `grep '/api/' collector/src`).
     * Adding a route here is a product decision about what an installed helper may do unattended.
     */
    public static final List<Route> ALLOWED = List.of(
            new Route(HttpMethod.POST, "/api/uploads"),
            new Route(HttpMethod.GET, "/api/channels"),
            new Route(HttpMethod.POST, "/api/item-analysis"),
            new Route(null, "/api/seller-accounts"),
            new Route(null, "/api/imports/reviews/launches"),
            new Route(HttpMethod.POST, "/api/agent/review-locate-targets"),
            new Route(HttpMethod.POST, "/api/agent/review-handoff"),
            new Route(HttpMethod.POST, "/api/agent/review-acquisition-targets"),
            new Route(HttpMethod.POST, "/api/agent/reply-submission-targets"),
            new Route(HttpMethod.GET, "/api/helper-devices/me"),
            new Route(HttpMethod.DELETE, "/api/helper-devices/me"));

    private final ObjectProvider<HelperDeviceService> devices;
    private final OrganizationRepository organizations;

    public HelperDeviceAuthFilter(ObjectProvider<HelperDeviceService> devices, OrganizationRepository organizations) {
        this.devices = devices;
        this.organizations = organizations;
    }

    @Override
    protected void doFilterInternal(@NonNull HttpServletRequest request, @NonNull HttpServletResponse response,
                                    @NonNull FilterChain chain) throws ServletException, IOException {
        String header = request.getHeader("Authorization");
        if (header == null || !header.startsWith("Bearer ")) {
            chain.doFilter(request, response);
            return;
        }
        String bearer = header.substring(7);
        if (!HelperDeviceTokens.looksLikeDeviceToken(bearer)) {
            chain.doFilter(request, response);
            return;
        }
        if (ALLOWED.stream().noneMatch(r -> r.admits(request))) {
            response.sendError(HttpServletResponse.SC_UNAUTHORIZED);
            return;
        }
        HelperDeviceService service = devices.getIfAvailable();
        Optional<HelperDeviceService.Authenticated> found = service == null ? Optional.empty()
                : service.authenticate(bearer);
        if (found.isEmpty() || !orgExists(found.get().principal())) {
            response.sendError(HttpServletResponse.SC_UNAUTHORIZED);
            return;
        }
        var auth = new UsernamePasswordAuthenticationToken(found.get().principal(), null,
                List.of(new SimpleGrantedAuthority(AUTHORITY)));
        auth.setDetails(new WebAuthenticationDetailsSource().buildDetails(request));
        SecurityContextHolder.getContext().setAuthentication(auth);
        request.setAttribute(DEVICE_ID_ATTRIBUTE, found.get().deviceId());
        chain.doFilter(request, response);
    }

    /** Where {@code /api/helper-devices/me} finds which row is asking. */
    public static final String DEVICE_ID_ATTRIBUTE = "sellerops.helperDeviceId";

    private boolean orgExists(AuthPrincipal principal) {
        return principal.orgId() != null && organizations.existsById(principal.orgId());
    }
}
