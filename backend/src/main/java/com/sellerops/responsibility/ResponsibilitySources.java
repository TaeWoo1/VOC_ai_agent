package com.sellerops.responsibility;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
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
import org.springframework.stereotype.Component;

/**
 * Which concrete sources a responsibility requires for an organisation right now: every API (non-file-upload)
 * seller account on a template channel, for each of that channel's required data types.
 *
 * <p>Derived at run time, never stored — the database already knows which accounts exist, and a second list kept
 * in step with it is a list that eventually disagrees. A disconnected account is still required: its source is
 * observed as {@code NONE · NOT_CONNECTED}, which is the truth, rather than dropped from the run.
 */
@Component
public class ResponsibilitySources {

    public static final String METHOD_API = "API";

    public record ResolvedSource(SellerAccount account, String channelCode, DataType dataType) {
    }

    private final SellerAccountRepository accounts;
    private final ChannelRepository channels;

    public ResponsibilitySources(SellerAccountRepository accounts, ChannelRepository channels) {
        this.accounts = accounts;
        this.channels = channels;
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
                if (spec.channelCode().equals(code)) {
                    resolved.add(new ResolvedSource(account, code, spec.dataType()));
                }
            }
        }
        return resolved;
    }

    static Function<ResolvedSource, String> key() {
        return s -> s.account().getId() + ":" + s.dataType().name();
    }
}
