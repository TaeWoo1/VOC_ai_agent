package com.sellerops.connector.cafe24.onboarding;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.common.ApiException;
import com.sellerops.connector.cafe24.Cafe24ApiConnector;
import com.sellerops.connector.cafe24.Cafe24TokenResult;
import com.sellerops.credential.CredentialVault;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Instant;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Orchestrates the seller-driven "Connect Cafe24" OAuth flow, in two calls:
 *
 * <ol>
 *   <li>{@link #start} — creates (or reuses) an API-mode CAFE24 {@link SellerAccount}
 *       in {@link ChannelStatus#PENDING}, persists a short-lived tenant-bound
 *       single-use {@link Cafe24OAuthState}, and returns the Cafe24 consent URL.</li>
 *   <li>{@link #complete} — validates the returned state (existence, tenant/channel,
 *       expiry, single use), exchanges the authorization code for tokens via
 *       {@link Cafe24OAuthClient}, stores {@code mall_id/client_id/client_secret/
 *       refresh_token} through {@link CredentialVault}, and marks the account
 *       {@link ChannelStatus#CONNECTED} <b>only after</b> the encrypted persistence
 *       succeeds. Any failure leaves/sets {@link ChannelStatus#RECONNECT_REQUIRED}
 *       with no credential written.</li>
 * </ol>
 *
 * <p>Atomicity uses an explicit {@link TransactionTemplate} (not a {@code
 * @Transactional} proxy) so the guarantee holds when the bean is hand-constructed in
 * tests, matching this codebase's style. No authorization code, token, or client
 * secret is ever returned, logged, or placed in an exception message.
 */
public class Cafe24OnboardingService {

    /** Outcome of {@link #complete}, mapped by the controller to a sanitized redirect. */
    public enum CompletionStatus { CONNECTED, RECONNECT_REQUIRED, INVALID }

    public record StartResult(UUID sellerAccountId, String authorizationUrl,
                              ChannelStatus connectionStatus) {
    }

    public record CompletionResult(CompletionStatus status, UUID sellerAccountId) {
    }

    private static final SecureRandom RANDOM = new SecureRandom();
    private static final Base64.Encoder URL64 = Base64.getUrlEncoder().withoutPadding();

    private final SellerAccountRepository accounts;
    private final ChannelRepository channels;
    private final Cafe24OAuthStateRepository states;
    private final CredentialVault vault;
    private final Cafe24OAuthClient oauthClient;
    private final TransactionTemplate tx;
    private final Clock clock;

    private final String clientId;
    private final String clientSecret;
    private final String redirectUri;
    private final String scopes;
    private final long stateTtlSeconds;

    public Cafe24OnboardingService(SellerAccountRepository accounts, ChannelRepository channels,
                                   Cafe24OAuthStateRepository states, CredentialVault vault,
                                   Cafe24OAuthClient oauthClient, PlatformTransactionManager txManager,
                                   Clock clock, String clientId, String clientSecret,
                                   String redirectUri, String scopes, long stateTtlSeconds) {
        this.accounts = accounts;
        this.channels = channels;
        this.states = states;
        this.vault = vault;
        this.oauthClient = oauthClient;
        this.tx = new TransactionTemplate(txManager);
        this.clock = clock;
        this.clientId = clientId;
        this.clientSecret = clientSecret;
        this.redirectUri = redirectUri;
        this.scopes = scopes;
        this.stateTtlSeconds = stateTtlSeconds;
        // Fail closed at construction if a write scope was configured — this flow is
        // read-only by contract and must never request community-write permission.
        if (scopes == null || scopes.isBlank() || scopes.toLowerCase(Locale.ROOT).contains("write")) {
            throw new IllegalStateException(
                    "카페24 OAuth 스코프는 읽기 전용이어야 합니다 (write 스코프 금지).");
        }
    }

    /**
     * Start the flow for {@code (orgId, mallId)}. Idempotent per (org, CAFE24 channel):
     * an existing account is reused and reset to PENDING. Returns the consent URL the
     * caller sends the seller's browser to.
     */
    public StartResult start(UUID orgId, UUID userId, String mallId) {
        if (!Cafe24OAuthClient.isValidMallId(mallId)) {
            throw ApiException.badRequest("카페24 mall_id 형식이 올바르지 않습니다.");
        }
        Channel channel = channels.findByCode(Cafe24ApiConnector.CHANNEL_CODE)
                .orElseThrow(() -> ApiException.notFound("채널을 찾을 수 없습니다."));

        return tx.execute(status -> {
            // Lock the channel row FIRST (SELECT … FOR UPDATE) so concurrent first-time connects on this
            // channel serialize: a double-clicked / retried start then re-reads and reuses the same API-mode
            // account instead of racing a second insert. Without this the partial unique index
            // uq_seller_accounts_api_org_channel (V35, one API row per (org, channel)) would surface the
            // race as a fail-closed error rather than a graceful reuse — the same guarantee NAVER's
            // SellerAccountService.registerApiChannel already relies on.
            channels.findByIdForUpdate(channel.getId());
            // Mode-scoped lookup: an org may now hold BOTH an API-mode and a file-upload account on one
            // channel (the file-channel/API-channel flows keep separate rows), so the unscoped single-result
            // finder would throw on a non-unique result. Cafe24 onboarding owns the API-mode row only.
            SellerAccount account = accounts
                    .findFirstByOrgIdAndChannelIdAndFileUploadOrderByCreatedAtAsc(orgId, channel.getId(), false)
                    .orElseGet(SellerAccount::new);
            account.setOrgId(orgId);
            account.setChannelId(channel.getId());
            if (account.getAlias() == null || account.getAlias().isBlank()) {
                account.setAlias(channel.getNameKo());
            }
            account.setFileUpload(false);
            // Reconnect preservation: a CONNECTED account keeps its status (and its
            // working credential) until a new exchange succeeds; only a not-yet-
            // connected account moves to PENDING.
            if (account.getConnectionStatus() != ChannelStatus.CONNECTED) {
                account.setConnectionStatus(ChannelStatus.PENDING);
            }
            SellerAccount saved = accounts.save(account);

            Instant now = clock.instant();
            // Single active attempt: supersede any prior in-flight state for this
            // account so a stale callback can never mutate credentials or status.
            for (Cafe24OAuthState prior : states.findBySellerAccountIdAndConsumedAtIsNull(saved.getId())) {
                prior.setConsumedAt(now);
                states.save(prior);
            }

            String rawState = randomState();
            Cafe24OAuthState state = new Cafe24OAuthState();
            state.setOrgId(orgId);
            state.setSellerAccountId(saved.getId());
            state.setChannelId(channel.getId());
            state.setStateHash(sha256Hex(rawState));
            state.setMallId(mallId);
            state.setRedirectUri(redirectUri);
            state.setInitiatedBy(userId);
            state.setExpiresAt(now.plusSeconds(stateTtlSeconds));
            states.save(state);

            // The RAW state leaves only in the authorization URL — never persisted.
            String url = oauthClient.authorizationUrl(mallId, clientId, redirectUri, scopes, rawState);
            return new StartResult(saved.getId(), url, saved.getConnectionStatus());
        });
    }

    /**
     * Complete the flow from the OAuth callback. {@code error} is Cafe24's optional
     * denial marker. The state is single-use: consumed on first callback (even when
     * expired), so it can never be replayed; a second callback with the same state is
     * rejected as INVALID without touching any account.
     */
    public CompletionResult complete(String rawState, String code, String error) {
        Instant now = clock.instant();
        return tx.execute(status -> {
            Optional<Cafe24OAuthState> found = (rawState == null || rawState.isBlank())
                    ? Optional.empty() : states.findByStateHash(sha256Hex(rawState));
            if (found.isEmpty()) {
                // Forged/unknown state.
                return new CompletionResult(CompletionStatus.INVALID, null);
            }
            Cafe24OAuthState state = found.get();
            if (state.getConsumedAt() != null) {
                // Replayed or superseded — never mutate any account/credential.
                return new CompletionResult(CompletionStatus.INVALID, null);
            }
            boolean expired = !now.isBefore(state.getExpiresAt());
            // Consume immediately (single use) regardless of the outcome below.
            state.setConsumedAt(now);
            states.save(state);

            SellerAccount account = accounts
                    .findByIdAndOrgId(state.getSellerAccountId(), state.getOrgId())
                    .orElse(null);
            if (account == null) {
                return new CompletionResult(CompletionStatus.INVALID, null);
            }
            // A CONNECTED account means this is a reconnect: its working credential and
            // status must survive a failed attempt untouched.
            boolean wasConnected = account.getConnectionStatus() == ChannelStatus.CONNECTED;

            Channel channel = channels.findByCode(Cafe24ApiConnector.CHANNEL_CODE).orElse(null);
            boolean channelOk = channel != null && channel.getId().equals(state.getChannelId());
            boolean denied = error != null && !error.isBlank();
            boolean noCode = code == null || code.isBlank();

            if (expired || denied || noCode || !channelOk) {
                return failAttempt(account, wasConnected);
            }

            try {
                Cafe24TokenResult tokens = oauthClient.exchangeAuthorizationCode(
                        state.getMallId(), clientId, clientSecret, code, state.getRedirectUri());
                // Seller-connection values only — the app client id/secret are config,
                // never persisted per seller.
                Map<String, String> secrets = new LinkedHashMap<>();
                secrets.put("mall_id", state.getMallId());
                secrets.put("refresh_token", tokens.refreshToken());
                // Encrypted persistence FIRST — a single upsert atomically replaces any
                // prior credential; CONNECTED is set only after it succeeds.
                vault.store(state.getOrgId(), account.getId(), "API", "OAUTH2",
                        secrets, null, null, state.getInitiatedBy());
                account.setConnectionStatus(ChannelStatus.CONNECTED);
                accounts.save(account);
                return new CompletionResult(CompletionStatus.CONNECTED, account.getId());
            } catch (RuntimeException e) {
                // Code exchange or encrypted persistence failed — no credential written.
                return failAttempt(account, wasConnected);
            }
        });
    }

    /**
     * A failed attempt. A prior CONNECTED account keeps its working credential and
     * status untouched (the reconnect simply did not take); an initial connection
     * becomes {@link ChannelStatus#RECONNECT_REQUIRED}.
     */
    private CompletionResult failAttempt(SellerAccount account, boolean wasConnected) {
        if (!wasConnected) {
            account.setConnectionStatus(ChannelStatus.RECONNECT_REQUIRED);
            accounts.save(account);
        }
        return new CompletionResult(CompletionStatus.RECONNECT_REQUIRED, account.getId());
    }

    private static String randomState() {
        byte[] bytes = new byte[32];
        RANDOM.nextBytes(bytes);
        return URL64.encodeToString(bytes);
    }

    /** Lowercase hex SHA-256 of the raw state — the only form ever persisted or queried. */
    static String sha256Hex(String value) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder(digest.length * 2);
            for (byte b : digest) {
                sb.append(Character.forDigit((b >> 4) & 0xF, 16));
                sb.append(Character.forDigit(b & 0xF, 16));
            }
            return sb.toString();
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256을 사용할 수 없습니다.", e);
        }
    }
}
