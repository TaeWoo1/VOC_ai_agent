package com.sellerops.inquiry.resolve;

import com.sellerops.inquiry.authority.CapabilityId;
import com.sellerops.inquiry.authority.CapabilitySnapshot;
import com.sellerops.inquiry.authority.ListingState;
import com.sellerops.inquiry.goal.CustomerGoalSet;
import com.sellerops.inquiry.goal.Referent;
import com.sellerops.knowledge.RetrievalOutcome;
import com.sellerops.order.fact.OrderFact;
import com.sellerops.order.fact.OrderFactLookup;
import java.time.Instant;
import java.util.EnumMap;
import java.util.Map;
import java.util.UUID;

/**
 * <b>Which objects this inquiry's goals are about</b> — the missing half of the Customer Goal contract.
 *
 * <p>A {@link CustomerGoalSet} names no object. {@link Referent#CURRENT_ORDER} is a <b>kind</b>, not an order id, and
 * that is deliberate: the interpreter reads a sentence, and a sentence does not contain this seller's order uuid. So
 * the goal package can decide <i>which resolver is asked next</i> and can never decide <i>what to read</i>. This
 * record is the seam that carries the second answer, and it is assembled from what the channel already told us —
 * never from the customer's words, and never by a model.
 *
 * <table><caption>referent to object</caption>
 *   <tr><td>{@link Referent#CURRENT_ORDER}</td><td>{@link #orderKey()} / {@link #order()}, from
 *       {@code inquiries.source_order_ref} when {@code InquiryOrderBinding.SOURCE_EXACT}</td></tr>
 *   <tr><td>{@link Referent#CURRENT_LISTING}</td><td>{@link #productId()} / {@link #listing()}, from the
 *       inquiry's product binding</td></tr>
 *   <tr><td>{@link Referent#ORGANIZATION}, {@link Referent#SELLER_CATALOGUE}</td><td>{@link #orgId()}</td></tr>
 * </table>
 *
 * <h2>What a missing entry means</h2>
 *
 * <p>{@link #knowledge()} holds one {@link RetrievalOutcome} per KNOWLEDGE capability that was <b>actually
 * searched</b>. A capability with no entry was not read, and the adapter says so with
 * {@code CAPABILITY_GAP / UNAVAILABLE} rather than reporting the absence of an answer. <b>Not having looked and
 * having looked and found nothing are different claims</b>, and only the second one may reach the seller.
 *
 * @param orgId      the organization every read is scoped to
 * @param inquiryId  the inquiry these goals were read from — identity only; the customer's text is not carried here
 * @param productId  the bound product, or null when the channel bound none
 * @param orderKey   the evidence key of the order the CHANNEL named, or null
 * @param order      the order fact already read for that key, or null when there is no order
 * @param listing    the listing state of {@link #productId()} — never null; an unbound one carries a null product
 * @param snapshot   what this inquiry's channel and bindings make readable at all
 * @param knowledge  the outcome of each knowledge search that ran; a missing key means it did not run
 * @param lookup     the order-read posture these facts were gathered under
 * @param now        the instant listing freshness is judged against
 */
public record InquiryResolutionContext(UUID orgId, UUID inquiryId, UUID productId, String orderKey, OrderFact order,
                                       ListingState listing, CapabilitySnapshot snapshot,
                                       Map<CapabilityId, RetrievalOutcome> knowledge, OrderFactLookup lookup,
                                       Instant now) {

    public InquiryResolutionContext {
        if (orgId == null) {
            throw new IllegalArgumentException("a resolution context is scoped to an organization");
        }
        if (snapshot == null) {
            throw new IllegalArgumentException("a resolution context carries what this inquiry may read");
        }
        if (now == null) {
            throw new IllegalArgumentException("freshness is judged against an instant");
        }
        listing = listing == null ? new ListingState(productId, null, null, java.util.List.of()) : listing;
        EnumMap<CapabilityId, RetrievalOutcome> read = new EnumMap<>(CapabilityId.class);
        if (knowledge != null) {
            knowledge.forEach((capability, outcome) -> {
                if (capability == null || outcome == null) {
                    throw new IllegalArgumentException("a searched capability names its outcome");
                }
                if (capability.authority() != com.sellerops.inquiry.authority.Authority.KNOWLEDGE) {
                    throw new IllegalArgumentException(capability + " is not a knowledge capability");
                }
                read.put(capability, outcome);
            });
        }
        knowledge = java.util.Collections.unmodifiableMap(read);
    }

    /** Whether this context can say anything at all about the object a referent names. */
    public boolean binds(Referent referent) {
        return switch (referent) {
            case CURRENT_ORDER -> orderKey != null;
            case CURRENT_LISTING -> productId != null;
            case ORGANIZATION, SELLER_CATALOGUE -> true;
            case UNRESOLVED -> false;
        };
    }

    /** The outcome of the search that ran for this capability, or null when none ran. */
    public RetrievalOutcome searched(CapabilityId capability) {
        return knowledge.get(capability);
    }
}
