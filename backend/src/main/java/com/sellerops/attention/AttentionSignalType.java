package com.sellerops.attention;

/**
 * Channel-generic kinds of operator attention signal derived from collected VOC
 * data. Independent of any one marketplace — Cafe24 is today's only source, but a
 * NAVER/ESM+/Coupang adapter produces the same types.
 */
public enum AttentionSignalType {
    UNANSWERED_INQUIRY,
    LOW_RATING_REVIEW,
    NEW_INQUIRY,
    NEW_REVIEW,
    UNKNOWN_REPLY_STATUS
}
