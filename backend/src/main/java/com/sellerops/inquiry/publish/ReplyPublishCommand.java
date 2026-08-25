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
 *
 * <p>{@code subject} is the approved DRAFT's title; {@code targetSubject} is the title the customer's
 * own message carried. Two fields because on some channels they are two things and on others they are
 * the same thing, and which it is belongs to the channel. Cafe24 is the case that forced the
 * distinction: a reply there is an article of its own and needs a title, and the observed rule on the
 * seller's own past answers is that the title IS the question's (SAME_AS_PARENT 43 of 44). An adapter
 * that used {@code subject} there would put the draft's internal label on a customer-visible post; one
 * that invented a prefix would be making up a rule the board does not follow.
 */
public record ReplyPublishCommand(UUID orgId, UUID sellerAccountId, UUID channelId,
                                  String externalId, Instant receivedAt,
                                  String subject, String body, String targetSubject) {
}
