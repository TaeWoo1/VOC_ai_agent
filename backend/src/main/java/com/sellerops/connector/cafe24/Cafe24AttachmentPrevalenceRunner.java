package com.sellerops.connector.cafe24;

import com.sellerops.selleraccount.SellerAccount;
import java.time.LocalDate;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;

/**
 * The double gate and the one log line for {@link Cafe24AttachmentPrevalenceProbe}.
 *
 * <p>The bean exists only when {@code sellerops.connector.cafe24.enabled=true} (its whole
 * configuration) AND {@code sellerops.connector.cafe24.diagnostic.attachment-prevalence.enabled=true}.
 * Even then it is inert until an account id is configured. It is not wired into the scheduler or any
 * collection path, and the same run cannot be triggered by a seller, a screen or the Agent.
 *
 * <p><b>Fail-closed and never fatal.</b> A refresh or rotation failure means no article read at all;
 * any unexpected error is caught so a diagnostic cannot take down the backend it boots in.
 *
 * <p><b>The log line's alphabet is the probe's.</b> Integers, booleans and one closed outcome token —
 * no mall id, no access or refresh token, no article number, no filename, no URL.
 */
public class Cafe24AttachmentPrevalenceRunner implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(Cafe24AttachmentPrevalenceRunner.class);

    private final Cafe24Authorizer authorizer;
    private final Cafe24AttachmentPrevalenceProbe probe;
    private final com.sellerops.selleraccount.SellerAccountRepository accounts;
    private final String accountIdProperty;
    private final int boardNo;
    private final int windowDays;

    public Cafe24AttachmentPrevalenceRunner(Cafe24Authorizer authorizer,
                                            Cafe24AttachmentPrevalenceProbe probe,
                                            com.sellerops.selleraccount.SellerAccountRepository accounts,
                                            String accountIdProperty, int boardNo, int windowDays) {
        this.authorizer = authorizer;
        this.probe = probe;
        this.accounts = accounts;
        this.accountIdProperty = accountIdProperty;
        this.boardNo = boardNo;
        this.windowDays = windowDays;
    }

    @Override
    public void run(ApplicationArguments args) {
        try {
            logReport(runProbe());
        } catch (RuntimeException e) {
            log.warn("[cafe24-attachment-prevalence] aborted (unexpected error); backend continues.");
        }
    }

    /** The testable core. Never throws; every failure is a fail-closed report. */
    public Cafe24AttachmentPrevalenceProbe.AttachmentPrevalence runProbe() {
        if (accountIdProperty == null || accountIdProperty.isBlank()) {
            return Cafe24AttachmentPrevalenceProbe.AttachmentPrevalence.failed("NO_ACCOUNT_CONFIGURED", 0);
        }
        UUID accountId;
        try {
            accountId = UUID.fromString(accountIdProperty.trim());
        } catch (IllegalArgumentException e) {
            return Cafe24AttachmentPrevalenceProbe.AttachmentPrevalence.failed("ACCOUNT_ID_MALFORMED", 0);
        }
        Optional<SellerAccount> account;
        try {
            account = accounts.findById(accountId);
        } catch (RuntimeException e) {
            return Cafe24AttachmentPrevalenceProbe.AttachmentPrevalence.failed("ACCOUNT_LOOKUP_FAILED", 0);
        }
        if (account.isEmpty()) {
            return Cafe24AttachmentPrevalenceProbe.AttachmentPrevalence.failed("ACCOUNT_NOT_FOUND", 0);
        }

        Cafe24Authorizer.Authorized auth;
        try {
            // The shared seam — refresh plus immediate single-use rotation write-back. The only state
            // change this run makes, and it is not this class's to make differently.
            auth = authorizer.authorize(account.get().getOrgId(), accountId);
        } catch (Cafe24RateLimitedException e) {
            return Cafe24AttachmentPrevalenceProbe.AttachmentPrevalence.failed("RATE_LIMITED", 0);
        } catch (RuntimeException e) {
            // Fail closed: no article read after a refresh failure.
            return Cafe24AttachmentPrevalenceProbe.AttachmentPrevalence.failed("AUTH_FAILED", 0);
        }

        LocalDate end = LocalDate.now();
        LocalDate start = end.minusDays(Math.max(1, windowDays));
        return probe.measure(auth.accessToken(), auth.mallId(), boardNo, start, end);
    }

    private static void logReport(Cafe24AttachmentPrevalenceProbe.AttachmentPrevalence r) {
        log.info("[cafe24-attachment-prevalence] outcome={} requests={} articlesInWindow={} windowFull={} "
                        + "withAttachment={} attachmentsTotal={} attachmentsMax={} "
                        + "vendorFilteredWith={} vendorFilteredWithout={} filterPartitions={} filterAgreesWithField={}",
                r.outcome(), r.requests(), r.articlesInWindow(), r.windowFull(),
                r.withAttachment(), r.attachmentsTotal(), r.attachmentsMax(),
                r.vendorFilteredWith(), r.vendorFilteredWithout(),
                r.filterPartitions(), r.filterAgreesWithField());
    }
}
