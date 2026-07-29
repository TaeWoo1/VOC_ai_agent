package com.sellerops.selleraccount.dto;

import jakarta.validation.constraints.NotNull;
import java.util.UUID;

/**
 * Start an official-API channel connection by recording the (org, channel) seller account the
 * guided-connection wizard then attaches credentials to. Records the account only — no secret, no
 * live provider call: the account begins {@code PENDING} and becomes CONNECTED only once the seller
 * registers credentials, the connection test passes, and the first sync runs (guided-connection §12).
 */
public record ApiChannelRequest(
        @NotNull UUID channelId,
        String alias) {
}
