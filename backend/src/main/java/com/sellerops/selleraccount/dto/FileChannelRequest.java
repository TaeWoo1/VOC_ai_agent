package com.sellerops.selleraccount.dto;

import jakarta.validation.constraints.NotNull;
import java.util.UUID;

/** Register a file-upload channel account. Phase 1 records the account only;
 *  the actual upload connector is not implemented yet. */
public record FileChannelRequest(
        @NotNull UUID channelId,
        String alias) {
}
