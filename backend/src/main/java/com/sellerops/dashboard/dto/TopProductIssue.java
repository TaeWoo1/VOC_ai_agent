package com.sellerops.dashboard.dto;

import java.time.LocalDate;
import java.util.UUID;

/**
 * One product's negative-review roll-up: how many negative reviews it has, and when they happened.
 *
 * <p><b>{@code productId} is the identity; the name is a label.</b> The roll-up has always been
 * computed by grouping {@code reviews.product_id} — a canonical product row — and then thrown that
 * id away at the DTO boundary, leaving the name as the only handle a consumer had. The demo org
 * holds ten duplicated titles and one name shared by four products
 * ({@code docs/demo_org_and_channel_knowledge_v1.md}), so a consumer keying on the name merges
 * different products into one row. The id is carried so nobody has to.
 *
 * <p><b>{@code productName} may be null</b> — never a placeholder. A review can point at a product
 * the ordinary (real-data-only) catalogue read does not return, and printing "-" as a product name
 * is a label nobody can act on. Null says "we hold no name for this id", which is what is true.
 *
 * <p><b>The dates are these rows' own.</b> {@code firstNegativeOn}/{@code lastNegativeOn} are the
 * min/max receipt date of exactly the negative reviews counted here — not a query window, not the
 * time the dashboard was read. They are what lets a claim about a period rest on this row at all.
 *
 * <p>This is NOT review-issue evidence. A negative review is a rating judgement on one review; a
 * review-issue evidence row is an opinion unit an extractor tied to a repeated problem
 * ({@code reviewissue/}). The two counts answer different questions and neither may be renamed into
 * the other.
 */
public record TopProductIssue(UUID productId, String productName, String issueLabel, long count,
                              LocalDate firstNegativeOn, LocalDate lastNegativeOn) {
}
