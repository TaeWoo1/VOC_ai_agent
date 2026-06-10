package com.sellerops.selleraccount;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.common.ApiException;
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

        SellerAccount account = accounts.findByOrgIdAndChannelId(orgId, channel.getId())
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

    private SellerAccountResponse toResponse(SellerAccount a, String channelNameKo) {
        return new SellerAccountResponse(
                a.getId(), a.getChannelId(), channelNameKo, a.getAlias(),
                a.getConnectionStatus(), a.getLastSyncedAt(), a.isFileUpload());
    }
}
