package com.sellerops.connector.cafe24;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.credential.ConnectorCredentialRepository;
import com.sellerops.credential.CredentialVault;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.context.annotation.UserConfigurations;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.test.context.ActiveProfiles;

/**
 * The committed Cafe24 board-discovery diagnostic: refresh + single-use rotation
 * write-back through the shared {@link Cafe24Authorizer} seam, then exactly one
 * read-only {@code /boards} discovery — all over the recording fake + H2. Proves
 * fail-closed ordering (no {@code /boards} unless rotation succeeds), single-row
 * credential replacement (no duplicate), 4/6 mapping match/mismatch, sanitized
 * output, and the double-gated bean wiring.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class Cafe24BoardDiagnosticRunnerTest {

    @Autowired SellerAccountRepository sellerAccounts;
    @Autowired ChannelRepository channels;
    @Autowired ConnectorCredentialRepository credentials;

    private final UUID org = UUID.randomUUID();
    private final FakeCafe24HttpClient http = new FakeCafe24HttpClient();

    private CredentialVault vault;
    private SellerAccount account;
    private Cafe24BoardDiagnosticRunner runner;

    @BeforeEach
    void setUp() {
        Channel ch = new Channel();
        ch.setCode(Cafe24ApiConnector.CHANNEL_CODE);
        ch.setNameKo("카페24");
        ch.setStatus(ChannelStatus.AVAILABLE);
        ch.setSupportsReview(true);
        ch.setSupportsInquiry(true);
        ch.setSupportsOrder(true);
        ch.setSupportsSales(true);
        ch.setSupportsProduct(true);
        ch.setSortOrder(0);
        channels.save(ch);

        SellerAccount acc = new SellerAccount();
        acc.setOrgId(org);
        acc.setChannelId(ch.getId());
        acc.setConnectionStatus(ChannelStatus.CONNECTED);
        acc.setFileUpload(false);
        account = sellerAccounts.save(acc);

        byte[] key = new byte[32];
        new SecureRandom().nextBytes(key);
        vault = new CredentialVault(credentials, new ObjectMapper(),
                Base64.getEncoder().encodeToString(key), "local-test-1");
        vault.store(org, account.getId(), "API", "OAUTH2",
                Map.of("mall_id", "samplemall", "refresh_token", "old-refresh-token"),
                null, null, null);

        Cafe24Authorizer authorizer =
                new Cafe24Authorizer(new Cafe24TokenClient(http), vault, "app-id", "app-secret");
        Cafe24BoardDiscovery discovery =
                new Cafe24BoardDiscovery(new Cafe24BoardsClient(http), new Cafe24BoardClassifier());
        runner = new Cafe24BoardDiagnosticRunner(authorizer, discovery, sellerAccounts, credentials,
                account.getId().toString());
    }

    @Test
    void rotationThenDiscoveryClassifiesAndMatches() {
        http.enqueue(FakeCafe24HttpClient.tokenOk("access-1", "new-refresh-token")); // rotation
        http.enqueue(FakeCafe24HttpClient.boardsOk(
                FakeCafe24HttpClient.board(1, "공지사항", "board"),
                FakeCafe24HttpClient.board(4, "상품 사용후기", "board"),
                FakeCafe24HttpClient.board(6, "상품 Q&A", "board"),
                FakeCafe24HttpClient.board(9, "1:1 맞춤상담", "board")));

        Cafe24BoardDiagnosticRunner.DiagnosticReport report = runner.runDiagnostic(account.getId());

        assertThat(report.refreshRotation()).isEqualTo("PASS");
        assertThat(report.credentialRowCount()).isEqualTo(1L); // single row, no duplicate
        assertThat(report.reviewMatch()).isTrue();
        assertThat(report.inquiryMatch()).isTrue();
        assertThat(report.mappingResult()).isEqualTo("BOARD_MAPPING_MATCH");
        // board 9 (1:1 맞춤상담) reported as collection-excluded
        assertThat(report.boards())
                .anySatisfy(b -> {
                    assertThat(b.boardNo()).isEqualTo(9);
                    assertThat(b.excluded()).isTrue();
                    assertThat(b.excludedReason()).isEqualTo("BOARD_9_ONE_TO_ONE_PII");
                });
        // rotation write-back actually persisted the replacement token
        assertThat(vault.open(org, account.getId()).secrets()).containsEntry("refresh_token", "new-refresh-token");
        // one token POST then one boards GET — nothing else
        assertThat(http.sent).hasSize(2);
        assertThat(http.sent.get(0).method()).isEqualTo("POST_FORM");
        assertThat(http.sent.get(1).method()).isEqualTo("GET");
    }

    @Test
    void refreshFailureFailsClosedWithNoDiscovery() {
        http.enqueue(FakeCafe24HttpClient.rateLimited429("5")); // refresh throttled → refresh fails

        Cafe24BoardDiagnosticRunner.DiagnosticReport report = runner.runDiagnostic(account.getId());

        assertThat(report.refreshRotation()).isEqualTo("FAIL");
        assertThat(report.boards()).isEmpty();
        assertThat(report.mappingResult()).isNull();
        // fail-closed: the /boards GET was never attempted (only the token POST happened)
        assertThat(http.sent).hasSize(1);
        assertThat(http.sent.get(0).method()).isEqualTo("POST_FORM");
    }

    @Test
    void discoveredMappingDifferentFromFourSixIsMismatch() {
        http.enqueue(FakeCafe24HttpClient.tokenOk("access-1", "new-refresh-token"));
        http.enqueue(FakeCafe24HttpClient.boardsOk(
                FakeCafe24HttpClient.board(5, "구매후기", "board"),   // review on 5, not 4
                FakeCafe24HttpClient.board(7, "상품문의", "board"))); // inquiry on 7, not 6

        Cafe24BoardDiagnosticRunner.DiagnosticReport report = runner.runDiagnostic(account.getId());

        assertThat(report.refreshRotation()).isEqualTo("PASS");
        assertThat(report.reviewMatch()).isFalse();
        assertThat(report.inquiryMatch()).isFalse();
        assertThat(report.mappingResult()).isEqualTo("BOARD_MAPPING_MISMATCH");
    }

    @Test
    void reportCarriesNoMallIdOrToken() {
        http.enqueue(FakeCafe24HttpClient.tokenOk("access-secret-1", "new-refresh-token"));
        http.enqueue(FakeCafe24HttpClient.boardsOk(
                FakeCafe24HttpClient.board(4, "상품 사용후기", "board"),
                FakeCafe24HttpClient.board(6, "상품 Q&A", "board")));

        Cafe24BoardDiagnosticRunner.DiagnosticReport report = runner.runDiagnostic(account.getId());

        String rendered = report.toString();
        assertThat(rendered).doesNotContain("samplemall");        // mall id
        assertThat(rendered).doesNotContain("access-secret-1");   // access token
        assertThat(rendered).doesNotContain("new-refresh-token"); // refresh token
    }

    @Test
    void missingAccountFailsClosed() {
        Cafe24BoardDiagnosticRunner.DiagnosticReport report = runner.runDiagnostic(UUID.randomUUID());

        assertThat(report.refreshRotation()).isEqualTo("FAIL");
        assertThat(report.failReason()).isEqualTo("ACCOUNT_NOT_FOUND");
        assertThat(http.sent).isEmpty(); // no HTTP at all
    }

    // --- Bean wiring: double-gated, never created on a normal bootRun ---

    private ApplicationContextRunner contextRunner() {
        return new ApplicationContextRunner()
                .withBean(CredentialVault.class, () -> mock(CredentialVault.class))
                .withBean(ConnectorCredentialRepository.class, () -> mock(ConnectorCredentialRepository.class))
                .withBean(SellerAccountRepository.class, () -> mock(SellerAccountRepository.class))
                .withConfiguration(UserConfigurations.of(Cafe24ConnectorConfiguration.class));
    }

    @Test
    void runnerBeanAbsentWithoutAnyFlags() {
        contextRunner().run(ctx ->
                assertThat(ctx).doesNotHaveBean(Cafe24BoardDiagnosticRunner.class));
    }

    @Test
    void runnerBeanAbsentWithConnectorFlagButNoDiagnosticFlag() {
        contextRunner()
                .withPropertyValues("sellerops.connector.cafe24.enabled=true")
                .run(ctx -> {
                    assertThat(ctx).hasSingleBean(Cafe24ApiConnector.class);
                    assertThat(ctx).doesNotHaveBean(Cafe24BoardDiagnosticRunner.class);
                });
    }

    @Test
    void runnerBeanPresentOnlyWhenBothFlagsOn() {
        contextRunner()
                .withPropertyValues(
                        "sellerops.connector.cafe24.enabled=true",
                        "sellerops.connector.cafe24.diagnostic.boards.enabled=true")
                .run(ctx -> assertThat(ctx).hasSingleBean(Cafe24BoardDiagnosticRunner.class));
    }
}
