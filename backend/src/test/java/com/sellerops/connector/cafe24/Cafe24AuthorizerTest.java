package com.sellerops.connector.cafe24;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.credential.CredentialVault;
import com.sellerops.credential.DecryptedCredential;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/**
 * The Cafe24 refresh/rotation seam under the single-use-token concurrency guard. Cafe24 refresh
 * tokens are single-use: two concurrent streams (or a concurrent capability probe) can spend the
 * same token, and one loses. These tests pin the observable safety net — the optimistic
 * re-read-and-retry on {@code invalid_grant} — which is what keeps a rotation race from being
 * mistaken for a dead connection (and is also what makes the guard cross-process-safe). The
 * in-process serialization lock itself is covered by construction (one lock per account) and is
 * not timing-tested here.
 */
class Cafe24AuthorizerTest {

    private static final String APP_ID = "app-client-id";
    private static final String APP_SECRET = "app-client-secret";
    private static final String MALL = "teststore";

    private final Cafe24TokenClient tokenClient = mock(Cafe24TokenClient.class);
    private final CredentialVault vault = mock(CredentialVault.class);
    private final Cafe24Authorizer authorizer =
            new Cafe24Authorizer(tokenClient, vault, APP_ID, APP_SECRET);

    private final UUID org = UUID.randomUUID();
    private final UUID account = UUID.randomUUID();

    private static DecryptedCredential credentialWith(String refreshToken) {
        return new DecryptedCredential("com.sellerops.connector.cafe24.Cafe24ApiConnector", "OAUTH2",
                Map.of("mall_id", MALL, "refresh_token", refreshToken), null, null);
    }

    private static Cafe24OAuthException invalidGrant() {
        return Cafe24OAuthException.fromTokenError(401, "{\"error\":\"invalid_grant\"}", new ObjectMapper());
    }

    @Test
    void happyPathRefreshesAndPersistsTheRotatedToken() {
        when(vault.open(org, account)).thenReturn(credentialWith("R1"));
        when(tokenClient.refresh(MALL, APP_ID, APP_SECRET, "R1"))
                .thenReturn(new Cafe24TokenResult("access-1", "R2", null, null));

        Cafe24Authorizer.Authorized authorized = authorizer.authorize(org, account);

        assertThat(authorized.mallId()).isEqualTo(MALL);
        assertThat(authorized.accessToken()).isEqualTo("access-1");
        // Single-use rotation persisted (the new token R2 replaces R1).
        verify(vault).rotateSecrets(eq(org), eq(account),
                argThatContainsRefreshToken("R2"));
    }

    @Test
    void invalidGrantAfterASiblingRotationRetriesWithTheCurrentTokenInsteadOfFailing() {
        // First open sees R1; the refresh with R1 fails invalid_grant because another process already
        // spent it. The re-read now shows the rotated R2 → the guard retries with R2 and succeeds.
        when(vault.open(org, account))
                .thenReturn(credentialWith("R1"))   // first read (used R1)
                .thenReturn(credentialWith("R2"));  // re-read after invalid_grant (sibling rotated to R2)
        when(tokenClient.refresh(MALL, APP_ID, APP_SECRET, "R1")).thenThrow(invalidGrant());
        when(tokenClient.refresh(MALL, APP_ID, APP_SECRET, "R2"))
                .thenReturn(new Cafe24TokenResult("access-2", "R3", null, null));

        Cafe24Authorizer.Authorized authorized = authorizer.authorize(org, account);

        assertThat(authorized.accessToken()).isEqualTo("access-2");
        verify(tokenClient).refresh(MALL, APP_ID, APP_SECRET, "R2");
        verify(vault).rotateSecrets(eq(org), eq(account), argThatContainsRefreshToken("R3"));
    }

    @Test
    void invalidGrantWithNoRotationIsATrulyDeadTokenAndPropagates() {
        // The re-read still shows R1 → nothing rotated it → the token is genuinely revoked.
        when(vault.open(org, account)).thenReturn(credentialWith("R1"));
        when(tokenClient.refresh(MALL, APP_ID, APP_SECRET, "R1")).thenThrow(invalidGrant());

        assertThatThrownBy(() -> authorizer.authorize(org, account))
                .isInstanceOf(Cafe24OAuthException.class)
                .satisfies(e -> assertThat(((Cafe24OAuthException) e).kind())
                        .isEqualTo(Cafe24OAuthException.Kind.INVALID_GRANT));
        // A dead token is never persisted as a rotation.
        verify(vault, never()).rotateSecrets(any(), any(), any());
    }

    @Test
    void insufficientScopePropagatesImmediatelyWithoutARetry() {
        when(vault.open(org, account)).thenReturn(credentialWith("R1"));
        when(tokenClient.refresh(MALL, APP_ID, APP_SECRET, "R1")).thenThrow(
                Cafe24OAuthException.fromTokenError(403, "{\"error\":\"insufficient_scope\"}", new ObjectMapper()));

        assertThatThrownBy(() -> authorizer.authorize(org, account))
                .isInstanceOf(Cafe24OAuthException.class)
                .satisfies(e -> assertThat(((Cafe24OAuthException) e).kind())
                        .isEqualTo(Cafe24OAuthException.Kind.INSUFFICIENT_SCOPE));
        // Scope failure is not a rotation race → no re-read, no second refresh.
        verify(vault, times(1)).open(org, account);
        verify(tokenClient, times(1)).refresh(any(), any(), any(), any());
    }

    private static Map<String, String> argThatContainsRefreshToken(String token) {
        return argThat(m -> m != null && token.equals(m.get("refresh_token")));
    }
}
