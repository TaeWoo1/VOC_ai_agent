package com.sellerops.connector.coupang.onboarding;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.connector.coupang.CoupangApiConnector;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import java.util.UUID;
import java.util.function.Function;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Drives the account-level connection lifecycle for a Coupang API seller account — the same
 * two-signal path NAVER uses (an explicit operator credential TEST, then a first
 * {@code ORDER_SUMMARY} data sync). CONNECTED is earned only when BOTH are confirmed; neither
 * signal alone is enough, so a green connection honestly means "the operator verified the
 * credential AND order data actually flowed for this seller."
 *
 * <p>This is a deliberate sibling of {@code NaverConnectionLifecycle} (and Cafe24's own
 * onboarding service): the codebase keeps one lifecycle per channel, each guarded to its own
 * channel so a cross-channel event is a no-op. The transition semantics are identical; only the
 * channel guard differs.
 *
 * <p><b>Transitions</b> (all idempotent; a settled CONNECTED account is never shaken by a duplicate
 * success event):
 * <ul>
 *   <li><b>Explicit test verified</b> — records the verification as {@link ChannelStatus#PREPARING}
 *       ("credential verified, awaiting first order sync"). Never CONNECTED on its own, and a
 *       reconnect re-arms here so it must re-prove data flow.</li>
 *   <li><b>{@code ORDER_SUMMARY} sync collected</b> (SUCCESS or PARTIAL) — only an account already in
 *       PREPARING advances to CONNECTED. A sync on a not-yet-verified PENDING account changes nothing:
 *       sync alone never connects.</li>
 *   <li><b>Credential rejected</b> — a verify outcome clearly classified as an authentication failure
 *       → {@link ChannelStatus#RECONNECT_REQUIRED}. Transient conditions never change the status.</li>
 * </ul>
 *
 * <p><b>Scope + safety.</b> Coupang API accounts only — a call for any other channel or a file-upload
 * account is a no-op. Each transition re-reads the account under a {@code PESSIMISTIC_WRITE} row lock in
 * its own transaction, so concurrent test / sync events serialize and every transition converges
 * idempotently. It writes only {@code seller_accounts.connection_status}.
 */
@Component
public class CoupangConnectionLifecycle {

    private final SellerAccountRepository accounts;
    private final ChannelRepository channels;
    private final TransactionTemplate tx;

    public CoupangConnectionLifecycle(SellerAccountRepository accounts, ChannelRepository channels,
                                      PlatformTransactionManager txManager) {
        this.accounts = accounts;
        this.channels = channels;
        this.tx = new TransactionTemplate(txManager);
    }

    /**
     * An explicit operator credential test verified the stored Coupang credential. Records the
     * verification as PREPARING — never CONNECTED on its own. A CONNECTED account is left untouched.
     */
    public void onCredentialTestVerified(UUID orgId, UUID sellerAccountId) {
        transition(orgId, sellerAccountId, account ->
                account.getConnectionStatus() == ChannelStatus.CONNECTED
                        ? null
                        : ChannelStatus.PREPARING);
    }

    /**
     * The stored Coupang credential was clearly classified as invalid/unauthorized (an authentication
     * failure, not a transient error) → RECONNECT_REQUIRED. Idempotent.
     */
    public void onCredentialRejected(UUID orgId, UUID sellerAccountId) {
        transition(orgId, sellerAccountId, account ->
                account.getConnectionStatus() == ChannelStatus.RECONNECT_REQUIRED
                        ? null
                        : ChannelStatus.RECONNECT_REQUIRED);
    }

    /**
     * An {@code ORDER_SUMMARY} sync collected rows for this account (SUCCESS or PARTIAL only). Only a
     * verified (PREPARING) account advances to CONNECTED; a never-tested PENDING account is left
     * untouched (sync alone must not connect), and a CONNECTED account stays (idempotent).
     */
    public void onOrderSyncCollected(UUID orgId, UUID sellerAccountId) {
        transition(orgId, sellerAccountId, account ->
                account.getConnectionStatus() == ChannelStatus.PREPARING
                        ? ChannelStatus.CONNECTED
                        : null);
    }

    /**
     * Re-read the account under a pessimistic lock, apply {@code decide} (a {@code null} target means
     * "no change"), and save only when the status actually moves. Serializes concurrent events and is a
     * no-op for an unknown, cross-org, or non-Coupang / file-upload account (fail closed).
     */
    private void transition(UUID orgId, UUID sellerAccountId, Function<SellerAccount, ChannelStatus> decide) {
        tx.executeWithoutResult(status -> {
            SellerAccount account = accounts.findByIdForUpdate(sellerAccountId).orElse(null);
            if (account == null || !orgId.equals(account.getOrgId()) || !isCoupangApiAccount(account)) {
                return;
            }
            ChannelStatus target = decide.apply(account);
            if (target != null && target != account.getConnectionStatus()) {
                account.setConnectionStatus(target);
                accounts.save(account);
            }
        });
    }

    private boolean isCoupangApiAccount(SellerAccount account) {
        if (account.isFileUpload()) {
            return false;
        }
        return channels.findById(account.getChannelId())
                .map(Channel::getCode)
                .filter(CoupangApiConnector.CHANNEL_CODE::equals)
                .isPresent();
    }
}
