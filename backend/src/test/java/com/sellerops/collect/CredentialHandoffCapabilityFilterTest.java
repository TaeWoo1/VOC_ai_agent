package com.sellerops.collect;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.auth.AuthPrincipal;
import com.sellerops.collect.CredentialHandoffAuthorizations.Binding;
import jakarta.servlet.FilterChain;
import org.springframework.beans.factory.ObjectProvider;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.core.context.SecurityContextHolder;

/**
 * **The four rules of the handoff capability**, each as a test, because each is the difference between "the
 * helper can perform one write" and "the helper has a credential".
 *
 * A capability is a bearer: whoever holds it can spend it. What keeps that safe is not its secrecy alone but
 * how narrow the thing it opens is — one path, one method, its own header, no fallback. Those are properties of
 * this filter, so they are tested here rather than inferred from the store beneath it.
 */
class CredentialHandoffCapabilityFilterTest {

    private static final UUID ORG = UUID.randomUUID();
    private static final UUID USER = UUID.randomUUID();

    private final CredentialHandoffAuthorizations authorizations = new CredentialHandoffAuthorizations();
    /** The real bean is an ObjectProvider (a slice context may not carry the store); here it always resolves. */
    private final CredentialHandoffCapabilityFilter filter =
            new CredentialHandoffCapabilityFilter(new SimpleObjectProvider<>(authorizations));

    /** Minimal ObjectProvider — Spring's own test doubles for this are internal. */
    private static final class SimpleObjectProvider<T> implements ObjectProvider<T> {
        private final T value;

        private SimpleObjectProvider(T value) {
            this.value = value;
        }

        @Override
        public T getObject(Object... args) {
            return value;
        }

        @Override
        public T getObject() {
            return value;
        }

        @Override
        public T getIfAvailable() {
            return value;
        }

        @Override
        public T getIfUnique() {
            return value;
        }
    }

    @AfterEach
    void clear() {
        SecurityContextHolder.clearContext();
    }

    private String issued() {
        return authorizations.issue(new Binding(ORG, USER, UUID.randomUUID(), "COUPANG", "run_1"));
    }

    private static MockHttpServletRequest post(String path) {
        MockHttpServletRequest req = new MockHttpServletRequest("POST", path);
        req.setRequestURI(path);
        return req;
    }

    @Test
    void aValidCapabilityAuthenticatesTheSellerItWasIssuedTo_andNothingElse() throws Exception {
        MockHttpServletRequest req = post(CredentialHandoffCapabilityFilter.PATH);
        req.addHeader(CredentialHandoffCapabilityFilter.HEADER, issued());
        MockHttpServletResponse res = new MockHttpServletResponse();
        FilterChain chain = (rq, rs) -> {
            AuthPrincipal principal = (AuthPrincipal) SecurityContextHolder.getContext()
                    .getAuthentication().getPrincipal();
            assertThat(principal.orgId()).isEqualTo(ORG);
            assertThat(principal.userId()).isEqualTo(USER);
            // A capability names a seller; it does not carry their identity details.
            assertThat(principal.email()).isNull();
            assertThat(SecurityContextHolder.getContext().getAuthentication().getAuthorities())
                    .extracting(Object::toString)
                    .containsExactly(CredentialHandoffCapabilityFilter.AUTHORITY);
        };

        filter.doFilter(req, res, chain);

        assertThat(res.getStatus()).isEqualTo(200);
        // The raw capability reaches the controller by attribute, and by nothing else.
        assertThat(req.getAttribute(CredentialHandoffCapabilityFilter.ATTRIBUTE)).isNotNull();
        // Stateless: nothing about this request survives it.
        assertThat(SecurityContextHolder.getContext().getAuthentication()).isNull();
    }

    @Test
    void rule1_aCapabilityIsRefusedOnANY_OTHER_PATH() throws Exception {
        // Including the route that MINTS capabilities: minting must need a real seller session, or a capability
        // could be used to extend itself indefinitely.
        for (String path : new String[] {
            CredentialHandoffCapabilityFilter.PATH + "/authorize",
            "/api/seller-accounts",
            "/api/agent/credential-handoffs",
        }) {
            MockHttpServletRequest req = post(path);
            req.addHeader(CredentialHandoffCapabilityFilter.HEADER, issued());
            MockHttpServletResponse res = new MockHttpServletResponse();
            MockFilterChain chain = new MockFilterChain();

            filter.doFilter(req, res, chain);

            assertThat(res.getStatus()).as(path).isEqualTo(401);
            assertThat(chain.getRequest()).as("%s must not reach the chain", path).isNull();
        }
    }

    @Test
    void rule1_aCapabilityIsRefusedOnAnyMethodButPOST() throws Exception {
        MockHttpServletRequest req = new MockHttpServletRequest("GET", CredentialHandoffCapabilityFilter.PATH);
        req.setRequestURI(CredentialHandoffCapabilityFilter.PATH);
        req.addHeader(CredentialHandoffCapabilityFilter.HEADER, issued());
        MockHttpServletResponse res = new MockHttpServletResponse();
        MockFilterChain chain = new MockFilterChain();

        filter.doFilter(req, res, chain);

        assertThat(res.getStatus()).isEqualTo(401);
        assertThat(chain.getRequest()).isNull();
    }

    @Test
    void rule3_aJWT_AND_aCapabilityTogetherIsRefused() throws Exception {
        // The request would be asking the server to choose which identity it is acting as.
        MockHttpServletRequest req = post(CredentialHandoffCapabilityFilter.PATH);
        req.addHeader(CredentialHandoffCapabilityFilter.HEADER, issued());
        req.addHeader("Authorization", "Bearer something");
        MockHttpServletResponse res = new MockHttpServletResponse();
        MockFilterChain chain = new MockFilterChain();

        filter.doFilter(req, res, chain);

        assertThat(res.getStatus()).isEqualTo(401);
        assertThat(chain.getRequest()).isNull();
    }

    @Test
    void rule4_anUnknownExpiredOrSpentCapabilityENDS_theRequest_neverFallsThrough() throws Exception {
        String spent = issued();
        assertThat(authorizations.claim(spent)).isTrue();

        for (String presented : new String[] { "0".repeat(32), "not-a-capability", spent }) {
            MockHttpServletRequest req = post(CredentialHandoffCapabilityFilter.PATH);
            req.addHeader(CredentialHandoffCapabilityFilter.HEADER, presented);
            MockHttpServletResponse res = new MockHttpServletResponse();
            MockFilterChain chain = new MockFilterChain();

            filter.doFilter(req, res, chain);

            assertThat(res.getStatus()).as(presented).isEqualTo(401);
            // The whole point: it does NOT continue to a filter that might authenticate it another way.
            assertThat(chain.getRequest()).as("%s must not fall through", presented).isNull();
            assertThat(SecurityContextHolder.getContext().getAuthentication()).isNull();
        }
    }

    @Test
    void noCapabilityHeaderMeansThisFilterDoesNOTHING_theJwtPathIsUntouched() throws Exception {
        MockHttpServletRequest req = post(CredentialHandoffCapabilityFilter.PATH);
        MockHttpServletResponse res = new MockHttpServletResponse();
        MockFilterChain chain = new MockFilterChain();

        filter.doFilter(req, res, chain);

        assertThat(res.getStatus()).isEqualTo(200);
        assertThat(chain.getRequest()).isNotNull();
        assertThat(SecurityContextHolder.getContext().getAuthentication()).isNull();
    }
}
