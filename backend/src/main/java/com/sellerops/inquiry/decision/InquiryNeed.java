package com.sellerops.inquiry.decision;

/**
 * One independent piece of information or action without which the customer's request is not resolved.
 *
 * @param id     {@code N1}, {@code N2}, … — positional, never a database id
 * @param ask    the need in the seller's words, as the seller will read it on the Case (≤ 120 chars, no personal data)
 * @param type   what it is about
 * @param search a short phrasing to search the seller's knowledge with — the planner's, not the customer's sentence
 */
public record InquiryNeed(String id, String ask, NeedType type, String search) {
}
