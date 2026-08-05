package com.sellerops.connector.naver.onboarding;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.connector.naver.NaverApiConnector;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import java.util.UUID;
import java.util.function.Function;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Drives the account-level connection lifecycle for a NAVER commerce-API seller account — the state
 * machine the guided-connection wizard's success / error / retry screens reflect. Before this,
 * {@code seller_accounts.connection_status} was set to {@link ChannelStatus#PENDING} at registration
 * and never moved for NAVER; this is the missing transition path (Cafe24 has its own
 * {@code Cafe24OnboardingService}).
 *
 * <p>Unlike Cafe24 (one OAuth callback flips CONNECTED), NAVER connects through a <b>two-signal</b>
 * path: an explicit operator credential TEST and a first {@code ORDER_SUMMARY} data sync. CONNECTED
 * is earned only when BOTH are confirmed — neither signal alone is enough — so a green connection
 * honestly means "the operator verified the credential AND order data actually flowed for this
 * seller."
 *
 * <p><b>CONNECTED means "an order sync collected while the credential stood verified."</b> The two
 * signals are ordered by construction: a verified test records PREPARING, and the <em>next</em>
 * collected order sync confirms it. A test never connects by reaching back to a historical sync — a
 * stale sync collected under an old (since-rotated / since-rejected) credential must not vouch for a
 * freshly verified one — so the confirming sync is always one that ran under the verified credential
 * (the guided wizard runs it immediately after a successful test; a schedule provides it otherwise).
 *
 * <p><b>Transitions</b> (all idempotent; a settled CONNECTED account is never shaken by a duplicate
 * success event):
 * <ul>
 *   <li><b>Explicit test verified</b> — records the verification as {@link ChannelStatus#PREPARING}
 *       ("credential verified, awaiting first order sync"). Never CONNECTED on its own — <b>test alone
 *       never connects</b> — and a reconnect (from RECONNECT_REQUIRED) re-arms here, so it must re-prove
 *       data flow rather than ride a pre-rejection sync.</li>
 *   <li><b>{@code ORDER_SUMMARY} sync collected</b> (the caller passes only a run that collected —
 *       SUCCESS or PARTIAL) — only an account already in PREPARING (i.e. the credential was explicitly
 *       verified) advances to CONNECTED. A sync on a not-yet-verified PENDING account changes nothing:
 *       <b>sync alone never connects.</b></li>
 *   <li><b>Credential rejected</b> — a verify outcome <em>clearly classified</em> as an authentication
 *       failure → {@link ChannelStatus#RECONNECT_REQUIRED}. Transient conditions (timeout / network /
 *       5xx / provider-unavailable / an ordinary sync FAILED) never change the status.</li>
 * </ul>
 *
 * <p><b>Scope + safety.</b> NAVER API accounts only — a call for any other channel or a file-upload
 * account is a no-op (Cafe24 owns its own lifecycle). Each transition re-reads the account under a
 * {@code PESSIMISTIC_WRITE} row lock in its own transaction, so concurrent test / sync events
 * serialize and every transition converges idempotently. It writes only
 * {@code seller_accounts.connection_status}: no credential, secret, timestamp, provider detail, or
 * personal data is read, logged, or returned.
 */
@Component
public class NaverConnectionLifecycle {

    private final SellerAccountRepository accounts;
    private final ChannelRepository channels;
    private final TransactionTemplate tx;

    public NaverConnectionLifecycle(SellerAccountRepository accounts, ChannelRepository channels,
                                    PlatformTransactionManager txManager) {
        this.accounts = accounts;
        this.channels = channels;
        this.tx = new TransactionTemplate(txManager);
    }

    /**
     * An explicit operator credential test verified the stored NAVER credential. Records the
     * verification as PREPARING — never CONNECTED on its own (the confirming order sync must run under
     * this verified credential). A CONNECTED account is left untouched (a duplicate success).
     */
    public void onCredentialTestVerified(UUID orgId, UUID sellerAccountId) {
        transition(orgId, sellerAccountId, account ->
                account.getConnectionStatus() == ChannelStatus.CONNECTED
                        ? null
                        : ChannelStatus.PREPARING);
    }

    /**
     * The stored NAVER credential was <em>clearly classified</em> as invalid / unauthorized (an
     * authentication failure, not a transient error) → RECONNECT_REQUIRED. Idempotent.
     */
    public void onCredentialRejected(UUID orgId, UUID sellerAccountId) {
        transition(orgId, sellerAccountId, account ->
                account.getConnectionStatus() == ChannelStatus.RECONNECT_REQUIRED
                        ? null
                        : ChannelStatus.RECONNECT_REQUIRED);
    }

    /**
     * An {@code ORDER_SUMMARY} sync collected rows for this account (the caller invokes this only for a
     * run that collected — SUCCESS or PARTIAL — never a FAILED one). Only a verified (PREPARING) account
     * advances to CONNECTED; a never-tested PENDING account is left untouched (sync alone must not
     * connect), and a CONNECTED account stays (idempotent).
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
     * no-op for an unknown, cross-org, or non-NAVER / file-upload account (fail closed).
     */
    private void transition(UUID orgId, UUID sellerAccountId, Function<SellerAccount, ChannelStatus> decide) {
        tx.executeWithoutResult(status -> {
            SellerAccount account = accounts.findByIdForUpdate(sellerAccountId).orElse(null);
            if (account == null || !orgId.equals(account.getOrgId()) || !isNaverApiAccount(account)) {
                return;
            }
            ChannelStatus target = decide.apply(account);
            if (target != null && target != account.getConnectionStatus()) {
                account.setConnectionStatus(target);
                accounts.save(account);
            }
        });
    }

    private boolean isNaverApiAccount(SellerAccount account) {
        if (account.isFileUpload()) {
            return false;
        }
        return channels.findById(account.getChannelId())
                .map(Channel::getCode)
                .filter(NaverApiConnector.CHANNEL_CODE::equals)
                .isPresent();
    }
}
