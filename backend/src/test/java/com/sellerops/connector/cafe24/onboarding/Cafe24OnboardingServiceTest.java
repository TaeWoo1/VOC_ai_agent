package com.sellerops.connector.cafe24.onboarding;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.connector.cafe24.onboarding.Cafe24OnboardingService.CompletionResult;
import com.sellerops.connector.cafe24.onboarding.Cafe24OnboardingService.CompletionStatus;
import com.sellerops.connector.cafe24.onboarding.Cafe24OnboardingService.StartResult;
import com.sellerops.credential.ConnectorCredentialRepository;
import com.sellerops.credential.CredentialVault;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Base64;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.PlatformTransactionManager;

/**
 * The Connect-Cafe24 flow end to end over the real (H2) DB and real vault: start
 * creates a PENDING API-mode account + a single-use, tenant-bound state (only its
 * SHA-256 hash persisted); complete exchanges the code, encrypts+persists ONLY the
 * seller-connection values, and flips to CONNECTED only on success. Covers stale/
 * superseded/replayed/denied/failed callbacks and reconnect preservation of a working
 * connection.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class Cafe24OnboardingServiceTest {

    @Autowired SellerAccountRepository accounts;
    @Autowired ChannelRepository channels;
    @Autowired Cafe24OAuthStateRepository states;
    @Autowired ConnectorCredentialRepository credentials;
    @Autowired PlatformTransactionManager txManager;

    private static final Clock CLOCK = Clock.fixed(Instant.parse("2026-07-05T00:00:00Z"), ZoneOffset.UTC);
    private static final String REDIRECT = "http://localhost:8080/api/connect/cafe24/callback";
    private static final Pattern STATE_PARAM = Pattern.compile("[?&]state=([^&]+)");

    private final UUID org = UUID.randomUUID();
    private final UUID user = UUID.randomUUID();
    private final RecordingCafe24HttpClient http = new RecordingCafe24HttpClient();

    private CredentialVault vault;
    private UUID cafe24ChannelId;
    private Cafe24OnboardingService service;

    @BeforeEach
    void setUp() {
        byte[] key = new byte[32];
        new SecureRandom().nextBytes(key);
        vault = new CredentialVault(credentials, new ObjectMapper(), Base64.getEncoder().encodeToString(key),
                "local-test-1");
        Channel ch = new Channel();
        ch.setCode("CAFE24");
        ch.setNameKo("카페24 자사몰");
        ch.setStatus(ChannelStatus.AVAILABLE);
        ch.setSupportsInquiry(true);
        ch.setSortOrder(0);
        cafe24ChannelId = channels.save(ch).getId();
        service = build("mall.read_community,mall.read_order");
    }

    private Cafe24OnboardingService build(String scopes) {
        return new Cafe24OnboardingService(accounts, channels, states, vault,
                new Cafe24OAuthClient(http), txManager, CLOCK,
                "the-client-id", "the-client-secret", REDIRECT, scopes, 600);
    }

    /** Start the flow and return the RAW state token, extracted from the consent URL. */
    private String startAndGetRawState() {
        return rawStateOf(service.start(org, user, "samplemall"));
    }

    private static String rawStateOf(StartResult r) {
        Matcher m = STATE_PARAM.matcher(r.authorizationUrl());
        assertThat(m.find()).isTrue();
        return URLDecoder.decode(m.group(1), StandardCharsets.UTF_8);
    }

    /** Drive a full successful connect and return the account id. */
    private UUID connect(String refreshToken) {
        String raw = startAndGetRawState();
        http.respondWith(200, RecordingCafe24HttpClient.tokenBody("access", refreshToken));
        CompletionResult r = service.complete(raw, "the-auth-code", null);
        assertThat(r.status()).isEqualTo(CompletionStatus.CONNECTED);
        return r.sellerAccountId();
    }

    private ChannelStatus statusOf(UUID accountId) {
        return accounts.findById(accountId).orElseThrow().getConnectionStatus();
    }

    private String refreshTokenOf(UUID accountId) {
        return vault.open(org, accountId).secrets().get("refresh_token");
    }

    @Test
    void startCreatesPendingApiAccountAndSingleUseState() {
        StartResult r = service.start(org, user, "samplemall");

        SellerAccount account = accounts.findById(r.sellerAccountId()).orElseThrow();
        assertThat(account.getChannelId()).isEqualTo(cafe24ChannelId);
        assertThat(account.getConnectionStatus()).isEqualTo(ChannelStatus.PENDING);
        assertThat(account.isFileUpload()).isFalse(); // API-mode, not file upload

        Cafe24OAuthState state = states.findAll().get(0);
        assertThat(state.getOrgId()).isEqualTo(org);
        assertThat(state.getSellerAccountId()).isEqualTo(r.sellerAccountId());
        assertThat(state.getMallId()).isEqualTo("samplemall");
        assertThat(state.getInitiatedBy()).isEqualTo(user);
        assertThat(state.getConsumedAt()).isNull();
        assertThat(state.getExpiresAt()).isEqualTo(Instant.parse("2026-07-05T00:10:00Z")); // now + 600s
    }

    @Test
    void startToleratesFileUploadAndApiAccountsCoexistingOnTheSameChannel() {
        // An org may now hold BOTH a file-upload and an API-mode account on one channel (the file-channel
        // and API-channel start flows keep separate rows). The unscoped single-result finder would throw
        // IncorrectResultSizeDataAccessException on that; Cafe24 onboarding must reuse only its API-mode row.
        SellerAccount fileAcct = new SellerAccount();
        fileAcct.setOrgId(org);
        fileAcct.setChannelId(cafe24ChannelId);
        fileAcct.setAlias("파일 업로드");
        fileAcct.setConnectionStatus(ChannelStatus.CONNECTED);
        fileAcct.setFileUpload(true);
        accounts.save(fileAcct);
        SellerAccount apiAcct = new SellerAccount();
        apiAcct.setOrgId(org);
        apiAcct.setChannelId(cafe24ChannelId);
        apiAcct.setAlias("API");
        apiAcct.setConnectionStatus(ChannelStatus.PENDING);
        apiAcct.setFileUpload(false);
        UUID apiId = accounts.save(apiAcct).getId();

        StartResult r = service.start(org, user, "samplemall");

        assertThat(r.sellerAccountId()).isEqualTo(apiId); // reused the existing API row — no non-unique error
        assertThat(accounts.findAll()).hasSize(2); // no third row created; the two modes coexist
    }

    @Test
    void onlyTheStateHashIsPersistedNeverTheRawToken() {
        StartResult r = service.start(org, user, "samplemall");
        String raw = rawStateOf(r);

        Cafe24OAuthState persisted = states.findAll().get(0);
        assertThat(persisted.getStateHash()).isEqualTo(Cafe24OnboardingService.sha256Hex(raw));
        assertThat(persisted.getStateHash()).isNotEqualTo(raw).hasSize(64);
        // A DB read of the raw value finds nothing; only the hash is a key.
        assertThat(states.findByStateHash(raw)).isEmpty();
        assertThat(states.findByStateHash(Cafe24OnboardingService.sha256Hex(raw))).isPresent();
    }

    @Test
    void completeStoresOnlySellerConnectionSecretsAndMarksConnected() {
        String raw = startAndGetRawState();
        http.respondWith(200, RecordingCafe24HttpClient.tokenBody("access-1", "refresh-1"));

        CompletionResult result = service.complete(raw, "the-auth-code", null);

        assertThat(result.status()).isEqualTo(CompletionStatus.CONNECTED);
        assertThat(statusOf(result.sellerAccountId())).isEqualTo(ChannelStatus.CONNECTED);

        Map<String, String> secrets = vault.open(org, result.sellerAccountId()).secrets();
        // Seller-connection values ONLY — no client_secret/client_id in plaintext.
        assertThat(secrets).containsOnlyKeys("mall_id", "refresh_token");
        assertThat(secrets).containsEntry("mall_id", "samplemall").containsEntry("refresh_token", "refresh-1");
        assertThat(secrets).doesNotContainKey("client_secret").doesNotContainKey("client_id");
    }

    @Test
    void unknownStateIsInvalidAndWritesNothing() {
        CompletionResult result = service.complete("no-such-state", "code", null);

        assertThat(result.status()).isEqualTo(CompletionStatus.INVALID);
        assertThat(result.sellerAccountId()).isNull();
        assertThat(accounts.findAll()).isEmpty();
        assertThat(credentials.findAll()).isEmpty();
    }

    @Test
    void expiredInitialStateFailsClosedAsReconnectRequiredNoCredential() {
        String raw = startAndGetRawState();
        Cafe24OAuthState state = states.findByStateHash(Cafe24OnboardingService.sha256Hex(raw)).orElseThrow();
        state.setExpiresAt(Instant.parse("2026-07-04T23:59:59Z")); // before the fixed clock
        states.save(state);
        http.respondWith(200, RecordingCafe24HttpClient.tokenBody("a", "r"));

        CompletionResult result = service.complete(raw, "the-auth-code", null);

        assertThat(result.status()).isEqualTo(CompletionStatus.RECONNECT_REQUIRED);
        assertThat(statusOf(result.sellerAccountId())).isEqualTo(ChannelStatus.RECONNECT_REQUIRED);
        assertThat(credentials.findAll()).isEmpty();
        assertThat(http.posts).isEmpty(); // never exchanged an expired state
    }

    @Test
    void deniedInitialConsentFailsClosedNoCredential() {
        String raw = startAndGetRawState();

        CompletionResult result = service.complete(raw, null, "access_denied");

        assertThat(result.status()).isEqualTo(CompletionStatus.RECONNECT_REQUIRED);
        assertThat(statusOf(result.sellerAccountId())).isEqualTo(ChannelStatus.RECONNECT_REQUIRED);
        assertThat(credentials.findAll()).isEmpty();
        assertThat(http.posts).isEmpty();
    }

    @Test
    void exchangeFailureOnInitialConnectLeavesReconnectRequiredNoCredential() {
        String raw = startAndGetRawState();
        http.respondWith(400, "{\"error\":\"invalid_grant\"}");

        CompletionResult result = service.complete(raw, "the-auth-code", null);

        assertThat(result.status()).isEqualTo(CompletionStatus.RECONNECT_REQUIRED);
        assertThat(statusOf(result.sellerAccountId())).isEqualTo(ChannelStatus.RECONNECT_REQUIRED);
        assertThat(credentials.findAll()).isEmpty(); // connected only after successful persistence
    }

    @Test
    void replayingAConsumedStateIsInvalidAndDoesNotTouchTheConnectedAccount() {
        String raw = startAndGetRawState();
        http.respondWith(200, RecordingCafe24HttpClient.tokenBody("a", "r"));
        CompletionResult first = service.complete(raw, "the-auth-code", null);
        assertThat(first.status()).isEqualTo(CompletionStatus.CONNECTED);

        CompletionResult replay = service.complete(raw, "the-auth-code", null);

        assertThat(replay.status()).isEqualTo(CompletionStatus.INVALID);
        assertThat(statusOf(first.sellerAccountId())).isEqualTo(ChannelStatus.CONNECTED);
        assertThat(refreshTokenOf(first.sellerAccountId())).isEqualTo("r"); // unchanged
    }

    @Test
    void twoStartsThenTheOlderCallbackIsInvalidAndChangesNothing() {
        String older = startAndGetRawState();
        String newer = startAndGetRawState(); // supersedes the older attempt
        assertThat(older).isNotEqualTo(newer);

        CompletionResult result = service.complete(older, "the-auth-code", null);

        assertThat(result.status()).isEqualTo(CompletionStatus.INVALID);
        // The account stays PENDING; nothing exchanged, nothing stored.
        assertThat(accounts.findAll()).hasSize(1);
        assertThat(statusOf(accounts.findAll().get(0).getId())).isEqualTo(ChannelStatus.PENDING);
        assertThat(credentials.findAll()).isEmpty();
        assertThat(http.posts).isEmpty();
    }

    @Test
    void newerCallbackSucceedsThenTheOlderCallbackCannotDowngradeIt() {
        String older = startAndGetRawState();
        String newer = startAndGetRawState();
        http.respondWith(200, RecordingCafe24HttpClient.tokenBody("access", "refresh-new"));
        CompletionResult ok = service.complete(newer, "the-auth-code", null);
        assertThat(ok.status()).isEqualTo(CompletionStatus.CONNECTED);

        CompletionResult stale = service.complete(older, "the-auth-code", null);

        assertThat(stale.status()).isEqualTo(CompletionStatus.INVALID);
        assertThat(statusOf(ok.sellerAccountId())).isEqualTo(ChannelStatus.CONNECTED);
        assertThat(refreshTokenOf(ok.sellerAccountId())).isEqualTo("refresh-new"); // unchanged
    }

    @Test
    void reconnectOfConnectedAccountWithDeniedConsentPreservesTheWorkingConnection() {
        UUID accountId = connect("refresh-1");
        // Seller starts a reconnect (account stays CONNECTED), then denies consent.
        String raw = startAndGetRawState();
        assertThat(statusOf(accountId)).isEqualTo(ChannelStatus.CONNECTED); // preserved during attempt

        CompletionResult result = service.complete(raw, null, "access_denied");

        assertThat(result.status()).isEqualTo(CompletionStatus.RECONNECT_REQUIRED);
        assertThat(statusOf(accountId)).isEqualTo(ChannelStatus.CONNECTED); // not downgraded
        assertThat(refreshTokenOf(accountId)).isEqualTo("refresh-1"); // old credential intact
    }

    @Test
    void reconnectOfConnectedAccountWithExchangeFailurePreservesTheWorkingConnection() {
        UUID accountId = connect("refresh-1");
        String raw = startAndGetRawState();
        http.respondWith(400, "{\"error\":\"invalid_grant\"}");

        CompletionResult result = service.complete(raw, "the-auth-code", null);

        assertThat(result.status()).isEqualTo(CompletionStatus.RECONNECT_REQUIRED);
        assertThat(statusOf(accountId)).isEqualTo(ChannelStatus.CONNECTED); // still connected
        assertThat(refreshTokenOf(accountId)).isEqualTo("refresh-1"); // unchanged
    }

    @Test
    void successfulReconnectReplacesTheRefreshTokenOnce() {
        UUID accountId = connect("refresh-1");

        String raw = startAndGetRawState();
        http.respondWith(200, RecordingCafe24HttpClient.tokenBody("access-2", "refresh-2"));
        CompletionResult result = service.complete(raw, "the-auth-code", null);

        assertThat(result.status()).isEqualTo(CompletionStatus.CONNECTED);
        assertThat(statusOf(accountId)).isEqualTo(ChannelStatus.CONNECTED);
        assertThat(refreshTokenOf(accountId)).isEqualTo("refresh-2"); // atomically replaced
        assertThat(credentials.findAll()).hasSize(1); // one row — replaced, not duplicated
    }

    @Test
    void aWriteScopeConfigurationFailsClosedAtConstruction() {
        assertThatThrownBy(() -> build("mall.read_community,mall.write_community"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("읽기 전용");
    }
}
