package com.sellerops.order.fact;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.springframework.stereotype.Component;

/**
 * The channel readers that exist, indexed by channel — and a refusal to hold one that is not
 * declared.
 *
 * <p><b>The constructor check is the point.</b> {@link ExactOrderLookupCapability} is where a
 * capability is declared, with the vendored document that justifies it. A reader wired in WITHOUT a
 * declaration would make live marketplace calls that no document backs, so that is a startup
 * failure: the code cannot outrun the contract.
 *
 * <p>The opposite gap — a declaration with no reader, which advertises a lookup that silently never
 * happens — is checked structurally rather than here, because a runtime that legitimately has no
 * readers (a persistence-slice test) must still be able to construct this. See
 * {@code ExactOrderLookupContractTest}.
 */
@Component
public class ExactOrderReaders {

    private final Map<String, ExactOrderReader> byChannel = new LinkedHashMap<>();

    public ExactOrderReaders(List<ExactOrderReader> readers) {
        for (ExactOrderReader reader : readers) {
            String channel = reader.channelCode();
            if (!ExactOrderLookupCapability.isAvailable(channel)) {
                throw new IllegalStateException(
                        "exact order reader wired for an undeclared channel: " + channel);
            }
            byChannel.put(channel, reader);
        }
    }

    public Optional<ExactOrderReader> forChannel(String channelCode) {
        return channelCode == null ? Optional.empty() : Optional.ofNullable(byChannel.get(channelCode));
    }
}
