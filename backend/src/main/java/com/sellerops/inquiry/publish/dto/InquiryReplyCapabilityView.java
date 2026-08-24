package com.sellerops.inquiry.publish.dto;

/**
 * One audited answer to "can a reply be posted to this channel's inquiries, and how do we know".
 *
 * <p>{@code evidence} is a short repository-level pointer (a class name, an audit note) and never a
 * URL, a credential, an account, or a vendor response. It is what makes the row falsifiable: a
 * transport nobody can trace back to something in the code is a claim, not a capability.
 */
public record InquiryReplyCapabilityView(String channelCode, String sourceSubtype, String transport,
                                         String reasonKo, String evidence) {
}
