package com.sellerops.inquiry.esmimport;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.common.ApiException;
import com.sellerops.connector.esm.EsmApiConnector;
import com.sellerops.credential.CredentialVault;
import com.sellerops.credential.DecryptedCredential;
import com.sellerops.inquiry.esmimport.dto.EsmFileImportAccountResponse;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Provisions truthful <b>file-import-only</b> GMARKET SellerAccounts for ESM inquiry
 * import, via supported service methods (no ad-hoc SQL). Two explicit operations:
 * <ul>
 *   <li>{@link #create} — always creates a <b>new</b> account (never selects or mutates
 *       an existing account by channel), marked {@code fileUpload=true} +
 *       {@link ChannelStatus#FILE_UPLOAD_SUPPORTED} (never {@code CONNECTED}) with
 *       {@code lastSyncedAt=null}, and stores the given marketplace selling id.</li>
 *   <li>{@link #updateIdentity} — updates one marketplace's selling id on an
 *       <b>explicitly identified</b> account that must belong to the org, be on GMARKET,
 *       and be a file-import account (never a live API/browser connection).</li>
 * </ul>
 * Only the non-secret marketplace selling ids live in the encrypted vault (connector
 * class {@code FILE_IMPORT}, auth type {@code NONE}); a write <b>merges</b> the selected
 * marketplace key while preserving the other, and never adds a password, master_id,
 * secret_key, issuer, refresh token, or session data. Collection is schedule-driven and
 * reconnect is Cafe24-OAuth-only, so a file-import account is never collected or
 * reconnected. Registered only when ESM import <b>and</b> account provisioning are enabled.
 *
 * <p><b>Concurrency limitation (honest):</b> the selling id lives only inside the
 * encrypted vault payload, so there is no database uniqueness constraint on it. Exact-
 * create idempotency is therefore a scan-then-create in application code: it makes an
 * ordinary <b>sequential</b> or network retry safe, but two <b>genuinely simultaneous</b>
 * identical create requests could each scan, find nothing, and both create an account.
 * That residual race is acceptable for this operator-only, default-disabled path; closing
 * it would need a schema/migration, deliberately out of scope for this slice.
 */
@Service
@ConditionalOnProperty(name = {"sellerops.inquiry-import.esm.enabled",
        "sellerops.inquiry-import.esm.account-provisioning.enabled"}, havingValue = "true")
public class EsmFileImportAccountService {

    static final String CONNECTOR_CLASS = "FILE_IMPORT";
    static final String AUTH_TYPE = "NONE";
    private static final String DEFAULT_ALIAS = "ESM 문의 파일 가져오기";

    private final SellerAccountRepository accounts;
    private final ChannelRepository channels;
    private final CredentialVault vault;

    public EsmFileImportAccountService(SellerAccountRepository accounts, ChannelRepository channels,
                                       CredentialVault vault) {
        this.accounts = accounts;
        this.channels = channels;
        this.vault = vault;
    }

    /**
     * Create a new GMARKET file-import account and store its marketplace selling id —
     * unless an exact prior create already exists (same org + marketplace key + selling id
     * on a file-import GMARKET account), in which case that account is returned unchanged
     * with {@code idempotentReplay=true}, so an ordinary sequential/network retry is safe.
     * A different selling id creates a distinct account; an account holding only the other
     * marketplace's identity is never silently attached to (use {@link #updateIdentity}).
     */
    @Transactional
    public EsmFileImportAccountResponse create(UUID orgId, UUID actor, EsmMarketplace marketplace,
                                               String alias, String sellerId) {
        String seller = requireSeller(marketplace, sellerId);
        UUID channelId = gmarketChannelId();

        SellerAccount match = findExactIdentityMatch(orgId, channelId, marketplace, seller);
        if (match != null) {
            return response(match, marketplace, seller, true);   // idempotent retry — no writes
        }

        SellerAccount account = new SellerAccount();
        account.setOrgId(orgId);
        account.setChannelId(channelId);
        account.setAlias(alias == null || alias.isBlank() ? DEFAULT_ALIAS : alias);
        account.setConnectionStatus(ChannelStatus.FILE_UPLOAD_SUPPORTED);
        account.setFileUpload(true);
        // lastSyncedAt intentionally left null: no sync has occurred.
        account = accounts.save(account);

        writeMarketplaceIdentity(orgId, account.getId(), marketplace, seller, actor);
        return response(account, marketplace, seller, false);
    }

    /**
     * The org's file-import GMARKET account whose stored selling id for {@code marketplace}
     * exactly equals {@code seller}, or null. Only org-scoped, GMARKET, {@code fileUpload}
     * accounts with a valid FILE_IMPORT credential are considered — a live (non-file-import)
     * account, a mismatched marketplace key, or malformed/non-FILE_IMPORT metadata is never
     * a match. Reads are org/account scoped and never exposed or logged.
     */
    private SellerAccount findExactIdentityMatch(UUID orgId, UUID gmarketChannelId,
                                                 EsmMarketplace marketplace, String seller) {
        String key = marketplace.sellerIdSecretKey();
        for (SellerAccount a : accounts.findAllByOrgId(orgId)) {
            if (!gmarketChannelId.equals(a.getChannelId()) || !a.isFileUpload()) {
                continue;
            }
            if (!vault.hasCredential(orgId, a.getId())) {
                continue;
            }
            DecryptedCredential cred;
            try {
                cred = vault.open(orgId, a.getId());
            } catch (RuntimeException e) {
                continue;   // unreadable/malformed metadata is never a match
            }
            if (cred == null || !CONNECTOR_CLASS.equals(cred.connectorClass()) || cred.secrets() == null) {
                continue;
            }
            if (seller.equals(cred.secrets().get(key))) {
                return a;
            }
        }
        return null;
    }

    /**
     * Add or update one marketplace's selling id on an explicitly identified file-import
     * account, preserving any other marketplace identity already stored. Fails closed if
     * the account is not the org's, not GMARKET, or not a file-import account.
     */
    @Transactional
    public EsmFileImportAccountResponse updateIdentity(UUID orgId, UUID actor, UUID sellerAccountId,
                                                       EsmMarketplace marketplace, String sellerId) {
        String seller = requireSeller(marketplace, sellerId);
        if (sellerAccountId == null) {
            throw ApiException.badRequest("판매 계정 ID가 필요합니다.");
        }
        SellerAccount account = accounts.findByIdAndOrgId(sellerAccountId, orgId)
                .orElseThrow(() -> ApiException.notFound("판매 계정을 찾을 수 없습니다."));
        if (!gmarketChannelId().equals(account.getChannelId())) {
            throw ApiException.badRequest("GMARKET 채널 계정이 아닙니다.");
        }
        if (!account.isFileUpload()) {
            throw ApiException.conflict("파일 가져오기 계정이 아닙니다 (실연결 계정에는 설정할 수 없습니다).");
        }
        writeMarketplaceIdentity(orgId, account.getId(), marketplace, seller, actor);
        return response(account, marketplace, seller, false);
    }

    /**
     * Merge one marketplace key into the account's FILE_IMPORT vault credential,
     * preserving the other marketplace key and never introducing any non-marketplace
     * field (no password/secret/session). Upserts one credential row per account.
     */
    private void writeMarketplaceIdentity(UUID orgId, UUID accountId, EsmMarketplace marketplace,
                                          String sellerId, UUID actor) {
        Map<String, String> secrets = new LinkedHashMap<>();
        if (vault.hasCredential(orgId, accountId)) {
            DecryptedCredential existing = vault.open(orgId, accountId);
            // Carry forward ONLY the two known marketplace keys; drop anything else.
            for (EsmMarketplace m : EsmMarketplace.values()) {
                String v = existing.secrets().get(m.sellerIdSecretKey());
                if (v != null && !v.isBlank()) {
                    secrets.put(m.sellerIdSecretKey(), v);
                }
            }
        }
        secrets.put(marketplace.sellerIdSecretKey(), sellerId);
        vault.store(orgId, accountId, CONNECTOR_CLASS, AUTH_TYPE, secrets, null, null, actor);
    }

    private static String requireSeller(EsmMarketplace marketplace, String sellerId) {
        if (marketplace == null) {
            throw ApiException.badRequest("마켓플레이스(GMARKET/AUCTION)를 선택해야 합니다.");
        }
        if (sellerId == null || sellerId.isBlank()) {
            throw ApiException.badRequest("판매자 ID는 필수입니다.");
        }
        return sellerId.strip();
    }

    private EsmFileImportAccountResponse response(SellerAccount account, EsmMarketplace marketplace,
                                                  String seller, boolean idempotentReplay) {
        return new EsmFileImportAccountResponse(account.getId(), marketplace,
                account.getConnectionStatus(), account.isFileUpload(), sha256Prefix(seller), idempotentReplay);
    }

    private UUID gmarketChannelId() {
        return channels.findByCode(EsmApiConnector.CHANNEL_CODE)
                .map(Channel::getId)
                .orElseThrow(() -> ApiException.badRequest("GMARKET 채널이 없습니다."));
    }

    /** Non-reversible truncated masked form of the selling id (never the raw value). */
    private static String sha256Prefix(String value) {
        try {
            byte[] d = MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < 6; i++) {
                sb.append(Character.forDigit((d[i] >> 4) & 0xF, 16)).append(Character.forDigit(d[i] & 0xF, 16));
            }
            return sb.toString();
        } catch (Exception e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }
}
