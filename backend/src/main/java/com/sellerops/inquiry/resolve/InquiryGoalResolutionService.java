package com.sellerops.inquiry.resolve;

import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.authority.CapabilityId;
import com.sellerops.inquiry.authority.CapabilityRegistry;
import com.sellerops.inquiry.decision.DetailCapability;
import com.sellerops.inquiry.decision.EvidenceScope;
import com.sellerops.inquiry.decision.PrecedentReuse;
import com.sellerops.inquiry.draft.InquiryEvidenceRetriever;
import com.sellerops.inquiry.goal.CustomerGoalSet;
import com.sellerops.inquiry.goal.GoalSetResolution;
import com.sellerops.knowledge.RetrievalOutcome;
import com.sellerops.order.fact.OrderFactLookup;
import java.time.Instant;
import java.util.EnumMap;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Service;

/**
 * <b>One stored inquiry, resolved</b> — the binding seam the Customer Goal contract could not carry.
 *
 * <p>A {@link CustomerGoalSet} names no object, by design. This turns the referents into the objects this
 * inquiry is actually about, and hands the result to the goal package's own loop.
 *
 * <h2>It is handed the gather; it does not repeat it</h2>
 *
 * <p>The knowledge lanes and the order fact arrive as the {@link InquiryEvidenceRetriever.InquiryEvidence} the
 * work unit already produced. That is not a convenience — it is the rule Retrieval Runtime Closure v1 wrote down
 * and guards by name: <b>one retrieval per work unit</b>, because a second one can disagree with the first. Two of
 * the three retrieval steps are model round trips, so a path that re-ran them would also be paying twice and could
 * settle a goal on evidence the saved draft never cited. Resolving a goal is a reading of a gather, not a reason
 * to gather again — and as a result nothing in this package touches a retriever, a corpus or a vendor at all.
 *
 * <h2>No lambda in the public surface</h2>
 *
 * <p>{@link GoalSetResolution#run} takes a caller-supplied resolver, and the audit recorded why that is a window:
 * a resolver is an arbitrary function, so nothing in the goal package can stop one from performing an external
 * effect and then reporting a gap. The fix is not to constrain the function type — it is that <b>production never
 * supplies one</b>. The entry points below take objects, the resolver is always {@link InquiryGoalResolvers}, and
 * {@code InquiryResolutionSafetyTest} asserts both by reflection and by reading the source tree.
 */
@Service
public class InquiryGoalResolutionService {

    private final CapabilityRegistry capabilities;

    public InquiryGoalResolutionService(CapabilityRegistry capabilities) {
        this.capabilities = capabilities;
    }

    /** A resolution and the context it was resolved in — the context is what makes the trace readable. */
    public record Resolved(InquiryResolutionContext context, GoalSetResolution.Outcome outcome) {
    }

    /**
     * This inquiry's goals, resolved against what has already been read about it.
     *
     * @param lanes  the gather this work unit already performed; its product binding, its order fact and its lane
     *               outcomes are what the referents resolve to
     * @param lookup the order-read posture {@code lanes} was gathered under, so the snapshot describes the same
     *               reach the fact actually came from
     */
    public Resolved resolve(UUID orgId, Inquiry inquiry, InquiryEvidenceRetriever.InquiryEvidence lanes,
                            CustomerGoalSet set, OrderFactLookup lookup, Instant now) {
        InquiryResolutionContext context = contextFor(orgId, inquiry, lanes, lookup, now);
        return new Resolved(context, resolve(set, context));
    }

    /**
     * The loop itself, over a context the caller already holds.
     *
     * <p>Static and resolver-free: this is the only shape in which production drives
     * {@link GoalSetResolution}, and there is no parameter through which a different resolver could arrive.
     */
    public static GoalSetResolution.Outcome resolve(CustomerGoalSet set, InquiryResolutionContext context) {
        if (context == null) {
            throw new IllegalArgumentException("goals are resolved about objects, and the context names them");
        }
        return GoalSetResolution.run(set, (goal, run) -> InquiryGoalResolvers.resolve(goal, run, context));
    }

    /** What this inquiry's goals can be about: the objects the channel bound, and what has been read about them. */
    public InquiryResolutionContext contextFor(UUID orgId, Inquiry inquiry,
                                               InquiryEvidenceRetriever.InquiryEvidence lanes,
                                               OrderFactLookup lookup, Instant now) {
        if (orgId == null || inquiry == null || lanes == null) {
            throw new IllegalArgumentException("a context is built for an organization's inquiry, from its gather");
        }
        OrderFactLookup reach = lookup == null ? OrderFactLookup.STORED_ONLY : lookup;
        UUID productId = lanes.productId();

        Map<CapabilityId, RetrievalOutcome> knowledge = new EnumMap<>(CapabilityId.class);
        knowledge.put(CapabilityId.KNOWLEDGE_PRODUCT, lanes.productOutcome());
        knowledge.put(CapabilityId.KNOWLEDGE_ORG, lanes.policyOutcome());
        // KNOWLEDGE_CATALOGUE is deliberately absent. The seller-wide catalogue lane is CatalogueInvestigator, not
        // one of these three, and it is a separate read with its own per-org gate. Leaving the key out makes the
        // adapter report UNAVAILABLE — «this was not searched» — instead of NEEDS_SELLER, which would tell a seller
        // their catalogue has no answer on the strength of a search that never ran.

        return new InquiryResolutionContext(orgId, inquiry.getId(), productId,
                EvidenceScope.orderKey(PrecedentReuse.OrderKey.of(inquiry)), lanes.order(),
                capabilities.listingState(orgId, productId),
                capabilities.snapshot(orgId, inquiry, productId, DetailCapability.NOT_APPLICABLE, reach),
                knowledge, reach, now == null ? Instant.now() : now);
    }
}
