package com.sellerops.attention.dto;

/**
 * One collected VOC row behind an attention signal — the channel-generic drill-down
 * unit. METADATA ONLY: deliberately no raw article title/content, {@code articleNo},
 * {@code productNo}, {@code sku}, source/customer/order identifiers, or {@code mall_id}.
 *
 * <p>{@code productName} is the one product field, and on THIS surface it is a DISPLAY
 * NAME ONLY — never an identifier. A product's identity is its SKU ({@code 상품번호} —
 * which for a NAVER export IS the channel's {@code productNo}); the name ({@code 상품명})
 * is catalog display metadata the operator already owns.
 *
 * <p>Those two are NOT independent in the data, which is why the rule is enforced rather
 * than assumed: when an ingested row has a SKU but no name, {@code ProductService} stores
 * the SKU <em>as</em> the product's name, so a naive read would ship the identifier inside
 * the display field. The source therefore withholds any name equal to its own SKU. This
 * guarantee is scoped to the operator attention surface — it is NOT a claim about
 * {@code products} (rows there legitimately carry SKU-derived names) nor about other
 * surfaces that show product names, such as {@code inbox}'s {@code FeedItem}.
 *
 * <p>{@code null} whenever a name cannot be resolved honestly — no product link; a product
 * row that is absent, cross-org, blank-named, named with ingest's placeholder, or named
 * with its own SKU — and always {@code null} for a channel whose store cannot resolve one
 * at all (a Cafe24 community article carries a raw {@code product_no} but no name and no
 * product link). That null means "no name is available", NOT "this row has no product";
 * callers must not render it as an absence of product.
 *
 * <p>{@code safePreview} is the one CUSTOMER-authored free-text field: a sanitized,
 * length-limited preview produced read-time by {@link
 * com.sellerops.common.VocPreviewSanitizer} — never the raw body. It is {@code null}
 * when the source was empty or the sanitizer suppressed it (too much redacted); the raw
 * text is never exposed either way. {@code productName} is deliberately NOT run through
 * that sanitizer: it is seller-authored catalog text carrying no customer PII, and the
 * sanitizer's rules (60-char truncation, {@code [번호]} redaction of any 7+ digit run,
 * whole-value suppression below 4 visible characters) would corrupt legitimate model
 * numbers and short names while protecting nothing.
 *
 * <p>{@code sourceType} is the operator-facing kind (REVIEW / INQUIRY);
 * {@code channelCode}/{@code channelNameKo} identify the channel; dates are KST
 * calendar dates (date only), {@code sourceCreatedDate} null when the source value
 * was timezone-less. {@code signalType} echoes the requesting
 * {@link com.sellerops.attention.AttentionSignalType}.
 */
public record OperatorVocItem(
        String channelCode,
        String channelNameKo,
        String sourceType,
        String productName,
        Integer rating,
        String replyStatus,
        String sourceCreatedDate,
        String collectedDate,
        String signalType,
        String safePreview) {
}
