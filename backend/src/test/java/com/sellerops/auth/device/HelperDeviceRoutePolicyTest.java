package com.sellerops.auth.device;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.mock.web.MockHttpServletRequest;

/**
 * What an installed helper may do unattended is a closed list, and the seller-only surfaces are outside it by
 * name: approving another helper, listing or revoking devices, the seller's profile, and every operations screen.
 */
class HelperDeviceRoutePolicyTest {

    private static boolean admitted(String method, String path) {
        MockHttpServletRequest req = new MockHttpServletRequest(method, path);
        return HelperDeviceAuthFilter.ALLOWED.stream().anyMatch(r -> r.admits(req));
    }

    @Test
    void theHelpersOwnCallsAreAdmitted() {
        assertThat(admitted("POST", "/api/uploads")).isTrue();
        assertThat(admitted("GET", "/api/channels")).isTrue();
        assertThat(admitted("POST", "/api/imports/reviews/launches/abc/ingest")).isTrue();
        assertThat(admitted("GET", "/api/seller-accounts/x/session-readiness")).isTrue();
        assertThat(admitted("POST", "/api/agent/reply-submission-targets")).isTrue();
        assertThat(admitted("GET", "/api/helper-devices/me")).isTrue();
        assertThat(admitted("DELETE", "/api/helper-devices/me")).isTrue();
    }

    @Test
    void theSellersSurfacesAreNotAndAPrefixNeverOpensASibling() {
        for (String path : List.of("/api/helper-devices", "/api/helper-devices/approve",
                "/api/helper-devices/" + java.util.UUID.randomUUID(), "/api/users/me", "/api/inquiries",
                "/api/reviews/recent", "/api/org-knowledge/sources", "/api/agent/credential-handoff",
                "/api/uploadsx", "/api/channels-extra", "/api/auth/device/code")) {
            assertThat(admitted("GET", path)).as(path).isFalse();
            assertThat(admitted("POST", path)).as(path).isFalse();
            assertThat(admitted("DELETE", path)).as(path).isFalse();
        }
        assertThat(admitted("DELETE", "/api/uploads")).isFalse();
        assertThat(admitted("POST", "/api/channels")).isFalse();
        // The allow-list never names a method it does not spell: a null method is "any", and only the two
        // families whose sub-routes the helper reads AND writes carry it.
        assertThat(HelperDeviceAuthFilter.ALLOWED.stream().filter(r -> r.method() == null).map(HelperDeviceAuthFilter.Route::pathPrefix))
                .containsExactlyInAnyOrder("/api/seller-accounts", "/api/imports/reviews/launches");
        assertThat(HelperDeviceAuthFilter.ALLOWED.stream().map(HelperDeviceAuthFilter.Route::method)
                .filter(java.util.Objects::nonNull)).doesNotContain(HttpMethod.PUT, HttpMethod.PATCH);
    }
}
