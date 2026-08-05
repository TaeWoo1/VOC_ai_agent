package com.sellerops.selleraccount;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.common.ApiException;
import com.sellerops.selleraccount.dto.ApiChannelRequest;
import com.sellerops.selleraccount.dto.FileChannelRequest;
import com.sellerops.selleraccount.dto.SellerAccountResponse;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class SellerAccountService {

    private final SellerAccountRepository accounts;
    private final ChannelRepository channels;

    public SellerAccountService(SellerAccountRepository accounts, ChannelRepository channels) {
        this.accounts = accounts;
        this.channels = channels;
    }

    @Transactional(readOnly = true)
    public List<SellerAccountResponse> listForOrg(UUID orgId) {
        Map<UUID, String> channelNames = channels.findAll().stream()
                .collect(Collectors.toMap(Channel::getId, Channel::getNameKo, (a, b) -> a));
        return accounts.findAllByOrgId(orgId).stream()
                .map(a -> toResponse(a, channelNames.getOrDefault(a.getChannelId(), "")))
                .toList();
    }

    @Transactional
    public SellerAccountResponse registerFileChannel(UUID orgId, FileChannelRequest req) {
        Channel channel = channels.findById(req.channelId())
                .orElseThrow(() -> ApiException.notFound("채널을 찾을 수 없습니다."));

        // Scope to the file-upload row so registering a file channel can never overwrite an API-mode
        // account the guided-connection wizard may be mid-flow on (they are distinct rows, §isolation).
        SellerAccount account = accounts
                .findFirstByOrgIdAndChannelIdAndFileUploadOrderByCreatedAtAsc(orgId, channel.getId(), true)
                .orElseGet(SellerAccount::new);
        account.setOrgId(orgId);
        account.setChannelId(channel.getId());
        account.setAlias(req.alias() == null || req.alias().isBlank()
                ? channel.getNameKo() : req.alias());
        account.setConnectionStatus(ChannelStatus.CONNECTED);
        account.setFileUpload(true);
        account.setLastSyncedAt(Instant.now());
        account = accounts.save(account);
        return toResponse(account, channel.getNameKo());
    }

    /**
     * Start (or resume) an official-API channel connection: find-or-create the single API-mode seller
     * account for this (org, channel). The guided-connection wizard calls this before it can register
     * credentials, so a first-time seller is no longer stranded with no account to attach to.
     *
     * <p>Idempotent and non-destructive: an existing API account is returned unchanged — a settled
     * CONNECTED (or RECONNECT_REQUIRED) account is never downgraded to {@code PENDING} by re-entering
     * the wizard. A brand-new account begins {@code PENDING} with no {@code lastSyncedAt}; it becomes
     * CONNECTED only through the real registration → test → sync path (nothing here calls a provider or
     * touches a credential).
     */
    @Transactional
    public SellerAccountResponse registerApiChannel(UUID orgId, ApiChannelRequest req) {
        // Lock the channel row FIRST (SELECT … FOR UPDATE) so concurrent connection starts on the same
        // channel serialize here: the find-or-create below is then atomic and two tabs / a retried request
        // cannot both insert a PENDING API account. The lock is what makes a race return the SAME account —
        // the second caller, once it holds the lock, re-reads via findFirst and returns the first caller's
        // row instead of inserting. The partial unique index uq_seller_accounts_api_org_channel
        // (V36, on (org_id, channel_id) WHERE is_file_upload = false) is the fail-closed backstop: if the
        // lock is ever bypassed the duplicate API-mode insert is rejected rather than silently creating a
        // second row. (File-upload accounts are not covered — ESM holds several per channel by identity.)
        Channel channel = channels.findByIdForUpdate(req.channelId())
                .orElseThrow(() -> ApiException.notFound("채널을 찾을 수 없습니다."));

        SellerAccount existing = accounts
                .findFirstByOrgIdAndChannelIdAndFileUploadOrderByCreatedAtAsc(orgId, channel.getId(), false)
                .orElse(null);
        if (existing != null) {
            return toResponse(existing, channel.getNameKo());
        }

        SellerAccount account = new SellerAccount();
        account.setOrgId(orgId);
        account.setChannelId(channel.getId());
        account.setAlias(req.alias() == null || req.alias().isBlank()
                ? channel.getNameKo() : req.alias());
        account.setConnectionStatus(ChannelStatus.PENDING);
        account.setFileUpload(false);
        account.setLastSyncedAt(null);
        account = accounts.save(account);
        return toResponse(account, channel.getNameKo());
    }

    private SellerAccountResponse toResponse(SellerAccount a, String channelNameKo) {
        return new SellerAccountResponse(
                a.getId(), a.getChannelId(), channelNameKo, a.getAlias(),
                a.getConnectionStatus(), a.getLastSyncedAt(), a.isFileUpload());
    }
}
