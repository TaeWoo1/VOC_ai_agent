package com.sellerops.channel;

import com.sellerops.connector.ConnectionVerifier;
import com.sellerops.connector.ConnectorRegistry;
import com.sellerops.connector.DataType;
import com.sellerops.connector.PullConnector;
import com.sellerops.credential.CredentialTemplates;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ChannelService {

    private final ChannelRepository channels;
    private final SellerAccountRepository sellerAccounts;
    private final ConnectorRegistry registry;

    public ChannelService(ChannelRepository channels, SellerAccountRepository sellerAccounts,
                          ConnectorRegistry registry) {
        this.channels = channels;
        this.sellerAccounts = sellerAccounts;
        this.registry = registry;
    }

    /**
     * The product-visible catalog: {@link #listForOrg(UUID)} narrowed to {@link ProductChannels}.
     * This is what every seller-facing surface reads; the full catalog stays available to
     * internal callers (uploads, connectors, tests) through {@link #listForOrg(UUID)}.
     */
    @Transactional(readOnly = true)
    public List<ChannelResponse> listVisibleForOrg(UUID orgId) {
        return listForOrg(orgId).stream()
                .filter(channel -> ProductChannels.isVisible(channel.code()))
                .toList();
    }

    /** Full channel catalog with the calling org's effective status + last-sync overlaid. */
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
                    status.actionLabel(),
                    support(channel)));
        }
        return result;
    }

    /**
     * Honest, flag-aware support facts for a channel (see {@link ChannelSupport}).
     * The auto-collect signal trusts a connector only when it is <b>dedicated</b>
     * to this channel — the generic mock fallback ({@code dedicatedChannels()}
     * empty) over-advertises and must never read as real collection.
     */
    private ChannelSupport support(Channel channel) {
        String code = channel.getCode();
        boolean fileUploadSupported = !registry.isFileChannel(code);
        List<String> fileUploadDataTypes =
                fileUploadSupported ? List.of("리뷰", "문의", "주문") : List.of();

        Optional<PullConnector> resolved = registry.resolvePullConnector(code);
        boolean dedicated = resolved.map(p -> p.dedicatedChannels().contains(code)).orElse(false);
        List<String> autoCollectDataTypes = dedicated
                ? collectableLabels(resolved.get().capabilities(code).supportedDataTypes())
                : List.of();
        boolean autoCollectSupported = !autoCollectDataTypes.isEmpty();

        // A mock can never be a ConnectionVerifier, so this is true only for a real
        // dedicated connector that opts into auth verification (e.g. NAVER when enabled).
        boolean connectionCheckSupported =
                resolved.filter(ConnectionVerifier.class::isInstance).isPresent();
        boolean credentialSetupSupported = CredentialTemplates.find(code).isPresent();

        return new ChannelSupport(
                fileUploadSupported,
                fileUploadDataTypes,
                autoCollectSupported,
                autoCollectDataTypes,
                connectionCheckSupported,
                credentialSetupSupported);
    }

    /**
     * Operator-collectable data types in display order. SALES/PRODUCT are
     * intentionally omitted — they have no ingestion path, so emitting them would
     * over-claim.
     */
    private static List<String> collectableLabels(Set<DataType> types) {
        List<String> out = new ArrayList<>();
        if (types.contains(DataType.REVIEW)) {
            out.add("리뷰");
        }
        if (types.contains(DataType.INQUIRY)) {
            out.add("문의");
        }
        if (types.contains(DataType.ORDER_SUMMARY)) {
            out.add("주문");
        }
        return out;
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
