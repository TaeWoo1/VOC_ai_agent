package com.sellerops.connector.cafe24.onboarding.dto;

import com.sellerops.channel.ChannelStatus;
import java.util.UUID;

/**
 * Sanitized start result: the pending API-mode account, the connection status
 * ({@code PENDING}), and the Cafe24 consent URL the frontend redirects the browser to.
 * Carries no secret, code, or token.
 */
public record Cafe24ConnectStartResponse(UUID sellerAccountId, ChannelStatus connectionStatus,
                                         String authorizationUrl) {
}
