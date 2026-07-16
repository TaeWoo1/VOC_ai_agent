package com.sellerops.attention.dto;

/**
 * One collected VOC row behind an attention signal — the channel-generic drill-down
 * unit. METADATA ONLY: deliberately no raw article title/content, {@code articleNo},
 * {@code productNo}, {@code sku}, source/customer/order identifiers, or {@code mall_id}.
 *
 * <p>{@code productName} is the one product field, and it is a DISPLAY NAME ONLY —
 * never an identifier. That distinction is the whole rule: a product's identity is its
 * SKU ({@code 상품번호} — which for a NAVER export IS the channel's {@code productNo}),
 * and identity stays excluded here along with every other source identifier; the name
 * ({@code 상품명}) is catalog display metadata the operator already owns, and
 * {@link com.sellerops.product.ProductService} treats it as exactly that. It is
 * {@code null} whenever a name cannot be resolved honestly — no product link, or a
 * product row that is absent, cross-org, or blank-named — and always {@code null} for a
 * channel whose store cannot resolve one at all (a Cafe24 community article carries a
 * raw {@code product_no} but no name and no product link). That null means "not
 * available on this channel", NOT "this row has no product"; callers must not render it
 * as an absence of product.
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
