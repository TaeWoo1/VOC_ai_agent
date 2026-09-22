package com.sellerops.responsibility;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.connector.ConnectorRegistry;
import com.sellerops.connector.DataType;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

/**
 * Which concrete sources a responsibility requires for an organisation right now: every API (non-file-upload)
 * seller account on a template channel, for each of that channel's candidate data types.
 *
 * <p>Derived at run time, never stored — the database already knows which accounts exist, and a second list kept
 * in step with it is a list that eventually disagrees. A disconnected account is still required: its source is
 * observed as {@code NONE · NOT_CONNECTED}, which is the truth, rather than dropped from the run.
 *
 * <p><b>A collector that answers «I cannot read this type» removes the obligation; no collector at all does
 * not.</b> Since the template's sources cover more than one channel (2026-09-22), a seller can hold an API
 * account on a channel whose collection of that data type this deployment does not offer — a NAVER account on a
 * build with the 문의 lanes switched off is the live example. Promising to keep such a source current would make
 * every window record a failure for something nobody can act on, which is precisely what PD-1 argued against, so
 * the pair is dropped before it becomes a source: not scanned, not observed, not reported, no gap case.
 *
 * <p>The asymmetry is deliberate. {@link ConnectorRegistry#resolvePullConnector} answering <i>empty</i> is not the
 * same statement as a connector answering <i>unsupported</i>: the first means this deployment wired no collector
 * for the channel at all (every connector flag is off by default, which is how an ordinary local boot runs), and
 * dropping sources then would quietly take the responsibility away from an organisation whose channel is
 * perfectly ordinary. So absence keeps the source and the run records {@code CONNECTOR_UNAVAILABLE} exactly as it
 * did before this rule existed — a deployment fact, visible to whoever operates the deployment, and one that
 * {@code OperationsCaseProcessor} already refuses to turn into a seller-facing case.
 */
@Component
public class ResponsibilitySources {

    public static final String METHOD_API = "API";

    /**
     * A read carried by an installed helper on the seller's own machine rather than by a channel's API
     * (Scheduled Aside v1). Recorded rather than hidden: how a row was observed is part of what it means, and a
     * device-carried observation must never be indistinguishable from one an official API answered.
     */
    public static final String METHOD_DEVICE = "BRIDGE_ASIDE";

    public record ResolvedSource(SellerAccount account, String channelCode, DataType dataType) {
    }

    private final SellerAccountRepository accounts;
    private final ChannelRepository channels;
    private final ConnectorRegistry connectors;

    @Autowired
    public ResponsibilitySources(SellerAccountRepository accounts, ChannelRepository channels,
                                 ConnectorRegistry connectors) {
        this.accounts = accounts;
        this.channels = channels;
        this.connectors = connectors;
    }

    /**
     * Without a connector registry: no collector can answer, so no candidate is dropped. For tests written before
     * the capability gate existed, and for contexts that assemble this class without the collect package.
     */
    public ResponsibilitySources(SellerAccountRepository accounts, ChannelRepository channels) {
        this(accounts, channels, null);
    }

    public List<ResolvedSource> resolve(UUID orgId, ResponsibilityTemplate template) {
        Map<UUID, String> codeByChannel = channels.findAll().stream()
                .collect(Collectors.toMap(Channel::getId, Channel::getCode, (a, b) -> a));
        List<SellerAccount> candidates = accounts.findAllByOrgId(orgId).stream()
                .filter(a -> !a.isFileUpload())
                .filter(a -> template.usesChannel(codeByChannel.get(a.getChannelId())))
                .sorted(Comparator.comparing(SellerAccount::getCreatedAt, Comparator.nullsLast(Comparator.naturalOrder()))
                        .thenComparing(SellerAccount::getId))
                .toList();
        List<ResolvedSource> resolved = new ArrayList<>();
        for (SellerAccount account : candidates) {
            String code = codeByChannel.get(account.getChannelId());
            for (ResponsibilityTemplate.SourceSpec spec : template.sources()) {
                if (spec.channelCode().equals(code) && collectable(code, spec.dataType())) {
                    resolved.add(new ResolvedSource(account, code, spec.dataType()));
                }
            }
        }
        return resolved;
    }

    /** False only when this deployment HAS a collector for the channel and it says it cannot read the type. */
    private boolean collectable(String channelCode, DataType dataType) {
        if (connectors == null || channelCode == null) {
            return true;
        }
        return connectors.resolvePullConnector(channelCode)
                .map(c -> c.capabilities(channelCode).supports(dataType))
                .orElse(true);
    }

    static Function<ResolvedSource, String> key() {
        return s -> s.account().getId() + ":" + s.dataType().name();
    }
}
