package com.sellerops.connector.cafe24;

import com.sellerops.connector.cafe24.Cafe24BoardClassifier.BoardKind;
import com.sellerops.credential.ConnectorCredentialRepository;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;

/**
 * Committed, reproducible live-proof for the Cafe24 read path — a diagnostic
 * ONLY. It performs exactly one credential refresh (+ single-use rotation
 * write-back) and one read-only {@code GET /api/v2/admin/boards}, then reports a
 * sanitized board-discovery classification. It never collects articles, orders,
 * products, or any post/author/PII, and never mutates runtime board mapping.
 *
 * <p><b>Double-gated, never on a normal path.</b> The bean exists only when
 * {@code sellerops.connector.cafe24.enabled=true} (its whole configuration) AND
 * {@code sellerops.connector.cafe24.diagnostic.boards.enabled=true}. Even then it
 * is inert unless {@code ...diagnostic.boards.account-id} names a seller account.
 * It is not wired into the scheduler or any collection path.
 *
 * <p><b>One path, no copied logic.</b> Refresh + rotation write-back come solely
 * from the shared {@link Cafe24Authorizer} (the same seam the connector uses);
 * this runner adds none of that logic. <b>Fail-closed:</b> if the refresh or
 * rotation write-back fails, the {@code /boards} call is never made.
 *
 * <p><b>Sanitized output.</b> The {@link DiagnosticReport} carries only board
 * metadata (board number, board name, classification, exclusion) and booleans —
 * never a mall id, access/refresh token, client id/secret, or credential payload.
 */
public class Cafe24BoardDiagnosticRunner implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(Cafe24BoardDiagnosticRunner.class);

    private final Cafe24Authorizer authorizer;
    private final Cafe24BoardDiscovery discovery;
    private final SellerAccountRepository accounts;
    private final ConnectorCredentialRepository credentials;
    private final String accountIdProperty;

    public Cafe24BoardDiagnosticRunner(Cafe24Authorizer authorizer, Cafe24BoardDiscovery discovery,
                                       SellerAccountRepository accounts,
                                       ConnectorCredentialRepository credentials,
                                       String accountIdProperty) {
        this.authorizer = authorizer;
        this.discovery = discovery;
        this.accounts = accounts;
        this.credentials = credentials;
        this.accountIdProperty = accountIdProperty;
    }

    @Override
    public void run(ApplicationArguments args) {
        if (accountIdProperty == null || accountIdProperty.isBlank()) {
            log.warn("[cafe24-boards-diagnostic] enabled but no seller account-id configured; skipping.");
            return;
        }
        UUID accountId;
        try {
            accountId = UUID.fromString(accountIdProperty.trim());
        } catch (IllegalArgumentException e) {
            log.warn("[cafe24-boards-diagnostic] configured account-id is not a valid UUID; skipping.");
            return;
        }
        try {
            logReport(runDiagnostic(accountId));
        } catch (RuntimeException e) {
            // Defense in depth: a diagnostic must never crash the backend it boots in.
            log.warn("[cafe24-boards-diagnostic] aborted (unexpected error); backend continues.");
        }
    }

    /**
     * The testable core: refresh (+ rotation write-back) via the shared seam,
     * then — only on success — one {@code /boards} discovery, classified and
     * compared to the hardcoded runtime board mapping. Never throws; failures are
     * captured as a fail-closed report.
     */
    public DiagnosticReport runDiagnostic(UUID accountId) {
        Optional<SellerAccount> account;
        long rowCount;
        try {
            account = accounts.findById(accountId);
            rowCount = credentials.countBySellerAccountId(accountId);
        } catch (RuntimeException e) {
            // A transient repository/DB failure is a fail-closed diagnostic result,
            // never a thrown exception (keeps the "never throws" contract true).
            return DiagnosticReport.failed("ACCOUNT_LOOKUP_FAILED", 0L);
        }
        if (account.isEmpty()) {
            return DiagnosticReport.failed("ACCOUNT_NOT_FOUND", rowCount);
        }
        UUID orgId = account.get().getOrgId();

        Cafe24Authorizer.Authorized auth;
        try {
            // Shared seam: refresh + immediate single-use rotation write-back.
            auth = authorizer.authorize(orgId, accountId);
        } catch (Cafe24RateLimitedException e) {
            return DiagnosticReport.failed("RATE_LIMITED", credentials.countBySellerAccountId(accountId));
        } catch (RuntimeException e) {
            // Fail-closed: no /boards call after a refresh/rotation failure.
            return DiagnosticReport.failed(refreshFailureCategory(e),
                    credentials.countBySellerAccountId(accountId));
        }

        // Rotation write-back (if any) already persisted inside the seam. Re-count
        // to report the row count and prove no duplicate row was created.
        long rowsAfter = credentials.countBySellerAccountId(accountId);

        Cafe24BoardDiscovery.Result result;
        try {
            result = discovery.discover(auth.accessToken(), auth.mallId());
        } catch (RuntimeException e) {
            // Refresh succeeded but the single /boards read failed — stop, no retry.
            return new DiagnosticReport("PASS", null, rowsAfter, List.of(),
                    false, false, "BOARD_DISCOVERY_FAILED");
        }

        List<BoardLine> lines = new ArrayList<>();
        boolean reviewMatch = false;
        boolean inquiryMatch = false;
        for (Cafe24BoardDiscovery.ClassifiedBoard board : result.boards()) {
            boolean excluded = isExcluded(board);
            String excludedReason = excluded ? exclusionReason(board) : null;
            lines.add(new BoardLine(board.boardNo(), board.boardName(),
                    board.kind().name(), excluded, excludedReason));
            if (board.kind() == BoardKind.REVIEW_BEARING
                    && board.boardNo() == Cafe24BoardArticleMapper.REVIEW_BOARD_NO) {
                reviewMatch = true;
            }
            if (board.kind() == BoardKind.INQUIRY_BEARING && !excluded
                    && board.boardNo() == Cafe24BoardArticleMapper.PRODUCT_INQUIRY_BOARD_NO) {
                inquiryMatch = true;
            }
        }
        String mapping = (reviewMatch && inquiryMatch)
                ? "BOARD_MAPPING_MATCH" : "BOARD_MAPPING_MISMATCH";
        return new DiagnosticReport("PASS", null, rowsAfter, List.copyOf(lines),
                reviewMatch, inquiryMatch, mapping);
    }

    /** Board 9 (1:1 맞춤상담) and any 1:1/PII-sensitive board are collection-excluded. */
    private static boolean isExcluded(Cafe24BoardDiscovery.ClassifiedBoard board) {
        if (board.boardNo() == Cafe24BoardArticleMapper.ONE_TO_ONE_BOARD_NO) {
            return true;
        }
        String name = board.boardName() == null ? "" : board.boardName().toLowerCase();
        return name.contains("1:1") || name.contains("맞춤상담");
    }

    private static String exclusionReason(Cafe24BoardDiscovery.ClassifiedBoard board) {
        return board.boardNo() == Cafe24BoardArticleMapper.ONE_TO_ONE_BOARD_NO
                ? "BOARD_9_ONE_TO_ONE_PII"
                : "ONE_TO_ONE_OR_PII_SENSITIVE";
    }

    /** Coarse, secret-free category for a refresh/rotation failure. */
    private static String refreshFailureCategory(RuntimeException e) {
        String message = e.getMessage() == null ? "" : e.getMessage();
        if (message.contains("mall_id 또는 refresh_token")) {
            return "CREDENTIAL_FIELDS_MISSING";
        }
        if (message.contains("앱 자격 증명")) {
            return "APP_CREDENTIALS_MISSING";
        }
        return "REFRESH_OR_ROTATION_FAILED";
    }

    private static void logReport(DiagnosticReport report) {
        log.info("[cafe24-boards-diagnostic] REFRESH_ROTATION={}{}", report.refreshRotation(),
                report.failReason() == null ? "" : " reason=" + report.failReason());
        log.info("[cafe24-boards-diagnostic] credential_row_count={}", report.credentialRowCount());
        for (BoardLine b : report.boards()) {
            log.info("[cafe24-boards-diagnostic] board_no={} name={} classification={} excluded={}{}",
                    b.boardNo(), b.boardName(), b.classification(), b.excluded(),
                    b.excludedReason() == null ? "" : " excluded_reason=" + b.excludedReason());
        }
        if ("PASS".equals(report.refreshRotation())) {
            log.info("[cafe24-boards-diagnostic] hardcoded_review_match={} hardcoded_inquiry_match={}",
                    report.reviewMatch(), report.inquiryMatch());
            log.info("[cafe24-boards-diagnostic] {}", report.mappingResult());
            if (!"BOARD_MAPPING_MATCH".equals(report.mappingResult())) {
                log.warn("[cafe24-boards-diagnostic] mapping is not 4/6 — REVIEW/INQUIRY runtime "
                        + "collection must NOT be started; runtime board mapping left unchanged.");
            }
        }
    }

    /** Sanitized one-board line: metadata only, never content/author/PII. */
    public record BoardLine(int boardNo, String boardName, String classification,
                            boolean excluded, String excludedReason) {
    }

    /**
     * Sanitized diagnostic result — board metadata + booleans only; never a mall
     * id, token, client secret, or credential payload.
     */
    public record DiagnosticReport(String refreshRotation, String failReason, long credentialRowCount,
                                   List<BoardLine> boards, boolean reviewMatch, boolean inquiryMatch,
                                   String mappingResult) {

        static DiagnosticReport failed(String reason, long credentialRowCount) {
            return new DiagnosticReport("FAIL", reason, credentialRowCount, List.of(),
                    false, false, null);
        }
    }
}
