package com.sellerops.collect;

import com.sellerops.auth.AuthPrincipal;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.List;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.lang.NonNull;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * **One endpoint, one capability, no fallback.**
 *
 * The resident helper reads three secrets off the seller's marketplace screen and must hand them to the
 * backend — and it holds no seller identity, deliberately. Giving it a seller JWT would put a credential that
 * opens every org-scoped route in this service onto a loopback bridge, to authorize one write. So it carries a
 * capability instead: minted by {@link CredentialHandoffAuthorizations} for one org, one user, one account, one
 * channel and one issuance run, good for five minutes and one use, and accepted **here and nowhere else**.
 *
 * <h2>The four rules, and why each is structural rather than a check the caller could skip</h2>
 *
 * <ol>
 *   <li><b>One path.</b> {@link #PATH}, POST only — not a prefix, not a pattern, and explicitly not the
 *       {@code /authorize} route beside it, which mints capabilities and must itself be reached with a real
 *       seller session. A capability can never be spent on anything but the write it was issued for.</li>
 *   <li><b>Its own header.</b> Not {@code Authorization}. Sharing the header with the JWT would make
 *       "which credential is this" a parsing question, and every parsing question eventually gets answered
 *       wrong. A separate header makes "both were presented" a fact you can see rather than infer.</li>
 *   <li><b>Both presented ⇒ refused.</b> A request carrying a JWT and a capability is asking the server to
 *       choose which identity it is acting as. It is answered 401 and goes no further.</li>
 *   <li><b>No fallback, ever.</b> A capability that is unknown, expired or spent ends the request. It does NOT
 *       fall through to the JWT filter to see whether something else might authenticate it — that fallthrough
 *       is exactly how a revoked credential quietly becomes a working one.</li>
 * </ol>
 *
 * <p>The raw capability is never logged and never leaves this request: it is put on a request attribute for the
 * controller to present back to the interlock, and the store it came from keeps only its digest.
 */
@Component
public class CredentialHandoffCapabilityFilter extends OncePerRequestFilter {

    /** The ONLY path this capability opens. Exact match — a prefix would open whatever is added beneath it. */
    public static final String PATH = "/api/agent/credential-handoff";

    /** Deliberately not `Authorization`. See rule 2. */
    public static final String HEADER = "X-SellerOps-Handoff-Authorization";

    /** Where the controller finds the presented capability. Request-scoped; never a field, never a log line. */
    public static final String ATTRIBUTE = "sellerops.credentialHandoffCapability";

    /** Marks the authentication as capability-derived, so nothing can mistake it for a full seller session. */
    public static final String AUTHORITY = "ROLE_CREDENTIAL_HANDOFF_CAPABILITY";

    /**
     * Resolved lazily so this filter can be constructed in a sliced web context that does not carry the store.
     * When it is absent, a presented capability authenticates NOTHING — which is the direction a missing
     * dependency must fail in for a component whose whole job is to admit one write.
     */
    private final ObjectProvider<CredentialHandoffAuthorizations> authorizations;

    public CredentialHandoffCapabilityFilter(ObjectProvider<CredentialHandoffAuthorizations> authorizations) {
        this.authorizations = authorizations;
    }

    @Override
    protected void doFilterInternal(@NonNull HttpServletRequest request, @NonNull HttpServletResponse response,
                                    @NonNull FilterChain chain) throws ServletException, IOException {
        String presented = request.getHeader(HEADER);
        if (presented == null || presented.isBlank()) {
            // No capability: this is the operator's JWT path, or an unauthenticated request the chain refuses.
            chain.doFilter(request, response);
            return;
        }
        if (!HttpMethod.POST.matches(request.getMethod()) || !PATH.equals(request.getRequestURI())) {
            // A capability presented anywhere else is not a weaker credential — it is not a credential at all.
            response.sendError(HttpServletResponse.SC_UNAUTHORIZED);
            return;
        }
        if (request.getHeader(HttpHeaders.AUTHORIZATION) != null) {
            response.sendError(HttpServletResponse.SC_UNAUTHORIZED);
            return;
        }
        CredentialHandoffAuthorizations store = authorizations.getIfAvailable();
        CredentialHandoffAuthorizations.Binding binding = store == null ? null : store.liveBindingOf(presented);
        if (binding == null) {
            // Unknown, expired, or already spent. The request ENDS — it does not continue to another filter.
            response.sendError(HttpServletResponse.SC_UNAUTHORIZED);
            return;
        }
        // Email is absent on purpose: a capability names a seller, it does not carry their identity details.
        AuthPrincipal principal = new AuthPrincipal(binding.userId(), binding.orgId(), null);
        UsernamePasswordAuthenticationToken auth = new UsernamePasswordAuthenticationToken(
                principal, null, List.of(new SimpleGrantedAuthority(AUTHORITY)));
        SecurityContextHolder.getContext().setAuthentication(auth);
        request.setAttribute(ATTRIBUTE, presented);
        try {
            chain.doFilter(request, response);
        } finally {
            // Stateless, like the JWT filter's own contract: nothing about this request survives it.
            SecurityContextHolder.clearContext();
        }
    }
}
