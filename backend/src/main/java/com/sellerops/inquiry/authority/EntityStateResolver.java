package com.sellerops.inquiry.authority;

import com.sellerops.inquiry.decision.EvidenceScope;
import com.sellerops.order.fact.OrderFact;
import com.sellerops.order.fact.OrderFactProvenance;
import com.sellerops.order.fact.OrderFactState;
import com.sellerops.product.SellingStatus;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.EnumSet;
import java.util.List;
import java.util.Set;

/**
 * <b>ENTITY_STATE resolver foundation</b> (Inquiry Architecture v3 WP-1). Deterministic and pure: it reads what a
 * connector already observed and says, field by field, whether this instance's state may be stated now.
 *
 * <p>No model and no network. The order fact is the one the caller already read ({@code InquiryOrderFactReader}, with
 * the caller's own {@code OrderFactLookup}); this class never reads again.
 *
 * <p>What it never does: close an instance's state from a company rule, a product document or a past answer. It has
 * no parameter through which one could arrive.
 */
public final class EntityStateResolver {

    /**
     * How old a stored listing state may be and still be stated as current. The catalogue refresh this repository runs
     * is daily ({@code sellerops.knowledge.bootstrap}, 24h); older than one refresh cycle is not provably current.
     */
    public static final Duration LISTING_STATE_MAX_AGE = Duration.ofHours(24);

    private static final Set<EntityField> ORDER_FIELDS = EnumSet.of(EntityField.ORDER_PAYMENT,
            EntityField.ORDER_CANCELLATION, EntityField.ORDER_FULFILLMENT, EntityField.ORDER_TRACKING);

    private EntityStateResolver() {
    }

    /**
     * @param requested the fields the step asks for; must be non-empty order fields
     * @param orderKey  the Case's order ({@link EvidenceScope#orderKey}), recorded as the provenance's entity
     */
    public static Resolution resolveOrder(OrderFact fact, Set<EntityField> requested, CapabilitySnapshot snapshot,
                                          String orderKey) {
        if (requested == null || requested.isEmpty() || !ORDER_FIELDS.containsAll(requested)) {
            throw new IllegalArgumentException("an order step names order fields");
        }
        List<EntityField> asked = sorted(requested);
        if (!snapshot.orderBound() || orderKey == null || fact == null
                || fact.state() == OrderFactState.NO_ORDER_REFERENCE) {
            return Resolution.gap(CapabilityId.ENTITY_ORDER, GapReason.UNBOUND, asked, null);
        }
        if (fact.state() == OrderFactState.ORDER_NOT_FOUND || fact.state() == OrderFactState.SOURCE_UNAVAILABLE) {
            return Resolution.gap(CapabilityId.ENTITY_ORDER, GapReason.UNAVAILABLE, asked, null);
        }
        AuthorityProvenance provenance = new AuthorityProvenance(CapabilityId.ENTITY_ORDER, EvidenceScope.order(orderKey),
                fact.provenance() == OrderFactProvenance.EXACT_READ ? AuthorityProvenance.Source.ORDER_EXACT_READ
                        : AuthorityProvenance.Source.ORDER_STORED, fact.asOf(),
                fact.state() == OrderFactState.OBSERVED_FRESH ? AuthorityProvenance.Freshness.FRESH
                        : AuthorityProvenance.Freshness.UNPROVEN);
        List<ObservedField> observed = new ArrayList<>();
        List<EntityField> unsupported = new ArrayList<>();
        List<EntityField> unproven = new ArrayList<>();
        for (EntityField f : asked) {
            if (snapshot.status(f) != CapabilityStatus.AVAILABLE) {
                unsupported.add(f);
                continue;
            }
            String value = switch (f) {
                case ORDER_PAYMENT -> fact.payment().isProven() ? fact.payment().name() : null;
                case ORDER_CANCELLATION -> fact.cancellation().isProven() ? fact.cancellation().name() : null;
                case ORDER_FULFILLMENT -> fact.fulfillment().isProven() ? fact.fulfillment().name() : null;
                default -> null;
            };
            if (value == null) {
                unproven.add(f);
            } else {
                observed.add(new ObservedField(f, value, provenance));
            }
        }
        if (!unsupported.isEmpty()) {
            return Resolution.gap(CapabilityId.ENTITY_ORDER, GapReason.NOT_SUPPORTED, unsupported, observed);
        }
        if (fact.state() != OrderFactState.OBSERVED_FRESH) {
            return Resolution.gap(CapabilityId.ENTITY_ORDER, GapReason.STALE, asked, observed);
        }
        if (!unproven.isEmpty()) {
            return Resolution.gap(CapabilityId.ENTITY_ORDER, GapReason.UNPROVEN, unproven, observed);
        }
        return new Resolution(CapabilityId.ENTITY_ORDER, ResolutionState.RESOLVED, null, null, null, observed, null);
    }

    /**
     * @param optionLabel the option the step is about, when named (the seller's exact label); null when not named
     * @param now         the clock the freshness bound is measured against
     */
    public static Resolution resolveListing(ListingState state, Set<EntityField> requested, String optionLabel,
                                            CapabilitySnapshot snapshot, Instant now) {
        if (requested == null || requested.isEmpty()
                || requested.stream().anyMatch(f -> f.capability() != CapabilityId.ENTITY_LISTING)) {
            throw new IllegalArgumentException("a listing step names listing fields");
        }
        List<EntityField> asked = sorted(requested);
        if (state == null || state.productId() == null) {
            return Resolution.gap(CapabilityId.ENTITY_LISTING, GapReason.UNBOUND, asked, null);
        }
        EvidenceScope entity = EvidenceScope.product(state.productId());
        List<ObservedField> observed = new ArrayList<>();
        List<EntityField> unsupported = new ArrayList<>();
        List<EntityField> unproven = new ArrayList<>();
        boolean stale = false;
        for (EntityField f : asked) {
            if (snapshot.status(f) != CapabilityStatus.AVAILABLE) {
                unsupported.add(f);
                continue;
            }
            SellingStatus status;
            Instant asOf;
            AuthorityProvenance.Source source;
            if (f == EntityField.LISTING_SALE_STATUS) {
                status = state.listingStatus();
                asOf = state.listingAsOf();
                source = AuthorityProvenance.Source.LISTING_STORED;
            } else {
                ListingState.Option option;
                if (optionLabel == null) {
                    if (state.options().size() != 1) {
                        return new Resolution(CapabilityId.ENTITY_LISTING, ResolutionState.NEEDS_CUSTOMER_INPUT, null,
                                List.of(f), List.of(CustomerInput.OPTION), observed, null);
                    }
                    option = state.options().get(0);
                } else {
                    option = state.options().stream().filter(o -> optionLabel.equals(o.label())).findFirst().orElse(null);
                    if (option == null) {
                        return Resolution.gap(CapabilityId.ENTITY_LISTING, GapReason.UNAVAILABLE, List.of(f), observed);
                    }
                }
                status = option.status();
                asOf = option.asOf();
                source = AuthorityProvenance.Source.OPTION_STORED;
            }
            boolean fresh = asOf != null && now != null && !asOf.isBefore(now.minus(LISTING_STATE_MAX_AGE));
            stale |= !fresh;
            if (status == null || status == SellingStatus.UNKNOWN) {
                unproven.add(f);
                continue;
            }
            observed.add(new ObservedField(f, status.name(), new AuthorityProvenance(CapabilityId.ENTITY_LISTING, entity,
                    source, asOf, fresh ? AuthorityProvenance.Freshness.FRESH : AuthorityProvenance.Freshness.UNPROVEN)));
        }
        if (!unsupported.isEmpty()) {
            return Resolution.gap(CapabilityId.ENTITY_LISTING, GapReason.NOT_SUPPORTED, unsupported, observed);
        }
        if (stale) {
            return Resolution.gap(CapabilityId.ENTITY_LISTING, GapReason.STALE, asked, observed);
        }
        if (!unproven.isEmpty()) {
            return Resolution.gap(CapabilityId.ENTITY_LISTING, GapReason.UNPROVEN, unproven, observed);
        }
        return new Resolution(CapabilityId.ENTITY_LISTING, ResolutionState.RESOLVED, null, null, null, observed, null);
    }

    private static List<EntityField> sorted(Set<EntityField> fields) {
        List<EntityField> out = new ArrayList<>(fields);
        out.sort(null);
        return out;
    }
}
