package com.sellerops.inquiry.authority;

import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.InquiryOrderBinding;
import com.sellerops.inquiry.decision.DetailCapability;
import com.sellerops.order.fact.ExactOrderLookupCapability;
import com.sellerops.order.fact.OrderFactLookup;
import com.sellerops.product.ChannelProductRepository;
import com.sellerops.product.ProductVariantRepository;
import com.sellerops.channel.ChannelRepository;
import java.util.EnumMap;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Component;

/**
 * <b>The capability registry</b> (Inquiry Architecture v3 WP-1): which authorities can act for one inquiry, derived from
 * facts this repository already owns and from nothing else — no sentence is read, no model is called, no channel is
 * reached.
 *
 * <p>Every rule below points at the fact it restates:
 * <ul>
 *   <li><b>Order payment</b> is observable from the store only where a stored status code has a proven meaning — NAVER
 *       {@code PAYED} → PAID ({@code NormalizedOrderStatus}); Coupang's stored codes have none. With an exact read
 *       ({@link ExactOrderLookupCapability}: Cafe24, and only when the caller allows it) payment, cancellation and
 *       fulfillment are observable.</li>
 *   <li><b>Cancellation and fulfillment</b> never from the store — {@code InquiryOrderFactReader.storedFact} leaves them
 *       UNPROVEN by design.</li>
 *   <li><b>Tracking</b>: no source in this repository reads carrier or invoice numbers — NOT_SUPPORTED everywhere.</li>
 *   <li><b>Listing state</b>: {@code channel_products.selling_status} and {@code product_variants.selling_status}, when the
 *       rows exist.</li>
 *   <li><b>Every PROCEDURE</b> is declared and has no executor in v3.0.</li>
 * </ul>
 * The binding of an order is the channel's ({@link InquiryOrderBinding#SOURCE_EXACT}); availability of a capability is
 * not a promise that this inquiry's instance is bound — that is resolved per step.
 */
@Component
public class CapabilityRegistry {

    private final ChannelRepository channels;
    private final ChannelProductRepository listings;
    private final ProductVariantRepository variants;

    public CapabilityRegistry(ChannelRepository channels, ChannelProductRepository listings,
                              ProductVariantRepository variants) {
        this.channels = channels;
        this.listings = listings;
        this.variants = variants;
    }

    /** The facts a snapshot is derived from — gathered by {@link #snapshot}, or given directly by a test. */
    public record Inputs(String channelCode, String sourceSubtype, boolean orderBound, OrderFactLookup lookup,
                         UUID productId, DetailCapability detail, boolean listingRow, int variantCount) {
    }

    public CapabilitySnapshot snapshot(UUID orgId, Inquiry inquiry, UUID productId, DetailCapability detail,
                                       OrderFactLookup lookup) {
        String code = inquiry.getChannelId() == null ? null
                : channels.findById(inquiry.getChannelId()).map(c -> c.getCode()).orElse(null);
        boolean bound = inquiry.getSourceOrderRef() != null && !inquiry.getSourceOrderRef().isBlank()
                && inquiry.orderBinding() == InquiryOrderBinding.SOURCE_EXACT;
        boolean listingRow = productId != null && !listings.findByOrgIdAndProductId(orgId, productId).isEmpty();
        int variantCount = productId == null ? 0 : variants.findByOrgIdAndProductId(orgId, productId).size();
        return derive(new Inputs(code, inquiry.getSourceSubtype(), bound, lookup, productId, detail, listingRow,
                variantCount));
    }

    /** This listing's stored selling state, for an ENTITY.LISTING step. No channel is reached. */
    public ListingState listingState(UUID orgId, UUID productId) {
        if (productId == null) {
            return new ListingState(null, null, null, java.util.List.of());
        }
        var rows = listings.findByOrgIdAndProductId(orgId, productId);
        var row = rows.stream().filter(r -> r.getObservedAt() != null)
                .max(java.util.Comparator.comparing(com.sellerops.product.ChannelProduct::getObservedAt)).orElse(null);
        var options = variants.findByOrgIdAndProductId(orgId, productId).stream()
                .map(v -> new ListingState.Option(v.getOptionName(),
                        com.sellerops.product.SellingStatus.normalize(v.getSellingStatus()), v.getObservedAt()))
                .toList();
        return new ListingState(productId, row == null ? null : com.sellerops.product.SellingStatus.normalize(
                row.getSellingStatus()), row == null ? null : row.getObservedAt(), options);
    }

    /** Pure: the whole registry policy in one function. */
    public static CapabilitySnapshot derive(Inputs in) {
        boolean exact = in.lookup() == OrderFactLookup.EXACT_ALLOWED && in.channelCode() != null
                && ExactOrderLookupCapability.isAvailable(in.channelCode());
        Map<EntityField, CapabilityStatus> f = new EnumMap<>(EntityField.class);
        f.put(EntityField.ORDER_PAYMENT, exact || "NAVER".equals(in.channelCode())
                ? CapabilityStatus.AVAILABLE : CapabilityStatus.NOT_SUPPORTED);
        f.put(EntityField.ORDER_CANCELLATION, exact ? CapabilityStatus.AVAILABLE : CapabilityStatus.NOT_SUPPORTED);
        f.put(EntityField.ORDER_FULFILLMENT, exact ? CapabilityStatus.AVAILABLE : CapabilityStatus.NOT_SUPPORTED);
        f.put(EntityField.ORDER_TRACKING, CapabilityStatus.NOT_SUPPORTED);
        f.put(EntityField.LISTING_SALE_STATUS, in.listingRow() ? CapabilityStatus.AVAILABLE : CapabilityStatus.NOT_SUPPORTED);
        f.put(EntityField.LISTING_OPTION_SALE_STATUS, in.variantCount() > 0
                ? CapabilityStatus.AVAILABLE : CapabilityStatus.NOT_SUPPORTED);

        Map<CapabilityId, CapabilityStatus> c = new EnumMap<>(CapabilityId.class);
        boolean listing = in.productId() != null;
        c.put(CapabilityId.KNOWLEDGE_PRODUCT, listing ? CapabilityStatus.AVAILABLE : CapabilityStatus.NOT_SUPPORTED);
        c.put(CapabilityId.KNOWLEDGE_ORG, CapabilityStatus.AVAILABLE);
        c.put(CapabilityId.KNOWLEDGE_CATALOGUE, listing ? CapabilityStatus.AVAILABLE : CapabilityStatus.NOT_SUPPORTED);
        c.put(CapabilityId.ENTITY_ORDER, anyAvailable(f, CapabilityId.ENTITY_ORDER)
                ? CapabilityStatus.AVAILABLE : CapabilityStatus.NOT_SUPPORTED);
        c.put(CapabilityId.ENTITY_LISTING, listing && anyAvailable(f, CapabilityId.ENTITY_LISTING)
                ? CapabilityStatus.AVAILABLE : CapabilityStatus.NOT_SUPPORTED);
        c.put(CapabilityId.PROCEDURE_ORDER_ACTION, CapabilityStatus.DECLARED_NO_EXECUTOR);
        c.put(CapabilityId.SELLER, CapabilityStatus.AVAILABLE);
        return new CapabilitySnapshot(CapabilitySnapshot.VERSION, in.channelCode(), InquirySurface.of(in.sourceSubtype()),
                in.orderBound(), in.lookup(), in.detail() == null ? DetailCapability.NOT_APPLICABLE : in.detail(),
                in.variantCount(), c, f);
    }

    private static boolean anyAvailable(Map<EntityField, CapabilityStatus> f, CapabilityId capability) {
        return f.entrySet().stream().anyMatch(e -> e.getKey().capability() == capability
                && e.getValue() == CapabilityStatus.AVAILABLE);
    }
}
