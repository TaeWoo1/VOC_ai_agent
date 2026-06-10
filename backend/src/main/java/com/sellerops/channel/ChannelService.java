package com.sellerops.channel;

import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ChannelService {

    private final ChannelRepository channels;
    private final SellerAccountRepository sellerAccounts;

    public ChannelService(ChannelRepository channels, SellerAccountRepository sellerAccounts) {
        this.channels = channels;
        this.sellerAccounts = sellerAccounts;
    }

    /** Channel catalog with the calling org's effective status + last-sync overlaid. */
    @Transactional(readOnly = true)
    public List<ChannelResponse> listForOrg(UUID orgId) {
        Map<UUID, SellerAccount> byChannel = sellerAccounts.findAllByOrgId(orgId).stream()
                .collect(Collectors.toMap(SellerAccount::getChannelId, Function.identity(), (a, b) -> a));

        List<ChannelResponse> result = new ArrayList<>();
        for (Channel channel : channels.findAllByOrderBySortOrderAsc()) {
            SellerAccount account = byChannel.get(channel.getId());
            ChannelStatus status = account != null ? account.getConnectionStatus() : channel.getStatus();
            var lastSyncedAt = account != null ? account.getLastSyncedAt() : null;
            result.add(new ChannelResponse(
                    channel.getId(),
                    channel.getCode(),
                    channel.getNameKo(),
                    status,
                    dataBadges(channel),
                    lastSyncedAt,
                    status.actionLabel()));
        }
        return result;
    }

    private List<String> dataBadges(Channel c) {
        List<String> badges = new ArrayList<>();
        if (c.isSupportsInquiry()) {
            badges.add("문의");
        }
        if (c.isSupportsReview()) {
            badges.add("리뷰");
        }
        if (c.isSupportsOrder()) {
            badges.add("주문");
        }
        if (c.isSupportsSales()) {
            badges.add("매출");
        }
        if (c.isSupportsProduct()) {
            badges.add("상품");
        }
        return badges;
    }
}
