package com.sellerops.inquiry.publish;

import java.time.Instant;
import java.util.UUID;

/**
 * Channel-neutral publish request handed to a {@link ChannelReplyAdapter}. The core
 * fills it from the work item, its inquiry, and the approved reply draft; the adapter
 * interprets the neutral fields in its own channel terms (for ESM: {@code externalId}
 * is the messageNo, {@code subject}/{@code body} are the answer title/comments). No
 * channel-specific fields (answerStatus, token, JWT identity) appear here — those are
 * the adapter's concern.
 */
public record ReplyPublishCommand(UUID orgId, UUID sellerAccountId, UUID channelId,
                                  String externalId, Instant receivedAt,
                                  String subject, String body) {
}
