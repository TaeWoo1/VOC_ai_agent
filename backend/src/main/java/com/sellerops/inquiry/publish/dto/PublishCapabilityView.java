package com.sellerops.inquiry.publish.dto;

import java.util.List;

/**
 * Read-only publish-capability status. Reports whether the inquiry reply-send path is
 * enabled and which channels currently have a reply adapter registered. Carries no
 * secret, token, or credential — only the execution flag and static channel codes — so
 * an orchestration client can assert the send path is fail-closed (disabled) before it
 * acts. On the default configuration {@code executionEnabled} is false and
 * {@code replyAdapterChannelCodes} is empty.
 */
public record PublishCapabilityView(
        boolean executionEnabled,
        List<String> replyAdapterChannelCodes) {
}
