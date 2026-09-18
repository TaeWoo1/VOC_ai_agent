package com.sellerops.connector.naver;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * One NAVER listing's detail — what the LIST resource never sent, read through
 * {@code GET /v2/products/channel-products/{channelProductNo}}.
 *
 * <p>{@code detailContent} is the seller's own 상세페이지 markup — their writing, delivered through the channel's API.
 * {@code options} are the 규격 that make {@code SpecApplicability.VARIANT_NAMED} reachable on NAVER, now with the
 * axis label the seller gave each one (「용량: 9oz」, not a bare 「9oz」), the channel's usable flag and stock.
 * {@code supplements} are the 추가상품 a buyer can add to this listing — a separately purchasable item the seller sells,
 * which is exactly what «do you sell a lid for this» is asking about. {@code facts} are the channel's own structured
 * statements about the product — 상품정보제공고시 fields (크기, 재질, 구성품…), the NAVER shopping model name, the
 * category attributes the seller chose — each under the label the channel's schema gives it.
 * {@code imageUrls} are recorded so that a page which carries its answers in pictures can be DESCRIBED honestly.
 *
 * <p>The field paths and their labels are the published contract, vendored at
 * {@code docs/vendor/naver-commerce-api/get-v2-products-channel-products-channelProductNo.detailAttribute.md}. Nothing
 * here is inferred from a page: an absent field is an absent statement.
 *
 * <p>No delivery, certification, customer-benefit or buyer field is projected.
 */
public record NaverProductDetail(String name, String detailContent, List<Option> options,
                                 List<String> imageUrls, String statusType, String displayStatus,
                                 String leafCategoryId, boolean stockManaged, List<Supplement> supplements,
                                 Map<String, String> facts, List<AttributeRef> attributes) {

    public NaverProductDetail {
        options = options == null ? List.of() : List.copyOf(options);
        imageUrls = imageUrls == null ? List.of() : List.copyOf(imageUrls);
        supplements = supplements == null ? List.of() : List.copyOf(supplements);
        facts = facts == null ? Map.of() : java.util.Collections.unmodifiableMap(new LinkedHashMap<>(facts));
        attributes = attributes == null ? List.of() : List.copyOf(attributes);
    }

    /** The original four-part shape — text, options and images only. */
    public NaverProductDetail(String name, String detailContent, List<Option> options, List<String> imageUrls) {
        this(name, detailContent, options, imageUrls, null, null, null, false, List.of(), Map.of(), List.of());
    }

    /** The same detail with category attributes resolved to named facts (see {@code NaverProductAttributeClient}). */
    public NaverProductDetail withFacts(Map<String, String> more) {
        Map<String, String> merged = new LinkedHashMap<>(facts);
        more.forEach(merged::putIfAbsent);
        return new NaverProductDetail(name, detailContent, options, imageUrls, statusType, displayStatus,
                leafCategoryId, stockManaged, supplements, merged, attributes);
    }

    /**
     * The listing's selling status as a buyer meets it: the origin product's {@code statusType}, except that a
     * SmartStore listing whose display is suspended cannot be bought whatever that says. Null when neither was sent.
     */
    public String effectiveStatus() {
        if ("SUSPENSION".equalsIgnoreCase(displayStatus == null ? "" : displayStatus.strip())) {
            return "SUSPENSION";
        }
        return statusType == null || statusType.isBlank() ? null : statusType.strip();
    }

    /**
     * One 규격, with the identity that makes it upsertable.
     *
     * <p>{@code externalId} may be null. A null one is SKIPPED downstream, never given a synthetic id: a variant that
     * gets a new identity on every read is worse than a variant that is missing, because the second is visible and
     * the first is silent duplication. {@code usable} and {@code stockQuantity} are the channel's own; null when it
     * did not say.
     */
    public record Option(String externalId, String optionName, Integer price, Integer stockQuantity,
                         Boolean usable) {

        public Option(String externalId, String optionName) {
            this(externalId, optionName, null, null, null);
        }

        /**
         * Whether the channel says a buyer can choose this option now. Unknown is not "yes": a stock the channel does
         * not manage ({@code useStockManagement=false}) is not a stock figure, so only a managed zero means sold out.
         */
        public boolean purchasable(boolean stockManaged) {
            if (Boolean.FALSE.equals(usable)) {
                return false;
            }
            return !stockManaged || stockQuantity == null || stockQuantity > 0;
        }
    }

    /** One 추가상품: the seller's own group label and item name, as the listing offers it. */
    public record Supplement(String externalId, String groupName, String name, Integer price,
                             Integer stockQuantity, Boolean usable) {

        /** Offered now: usable (the channel's default is true). Stock is not managed per 추가상품 in every store. */
        public boolean offered() {
            return !Boolean.FALSE.equals(usable);
        }

        /** 「용량: 9oz 뚜껑」 — the group label and the item, as the buyer sees them. */
        public String label() {
            String item = name == null ? "" : name.strip();
            boolean group = groupName != null && !groupName.isBlank() && !groupName.strip().equals(item);
            return (group ? groupName.strip() + ": " : "") + item;
        }
    }

    /** A category attribute the seller chose, by the channel's ids — named by a separate catalogue read. */
    public record AttributeRef(Long attributeSeq, Long attributeValueSeq, String realValue, String realValueUnitCode) {
    }
}
