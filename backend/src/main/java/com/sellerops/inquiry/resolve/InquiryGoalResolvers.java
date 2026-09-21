package com.sellerops.inquiry.resolve;

import com.sellerops.inquiry.authority.Authority;
import com.sellerops.inquiry.authority.CapabilityId;
import com.sellerops.inquiry.authority.CapabilityStatus;
import com.sellerops.inquiry.authority.EntityField;
import com.sellerops.inquiry.authority.EntityStateResolver;
import com.sellerops.inquiry.authority.GapReason;
import com.sellerops.inquiry.authority.ListingState;
import com.sellerops.inquiry.authority.Resolution;
import com.sellerops.inquiry.authority.ResolutionState;
import com.sellerops.inquiry.goal.CustomerGoal;
import com.sellerops.inquiry.goal.EntityStateRequirement;
import com.sellerops.inquiry.goal.ReferentRegistry;
import com.sellerops.inquiry.goal.ResolutionPolicy;
import com.sellerops.inquiry.goal.ResolverOutcome;
import com.sellerops.knowledge.RetrievalOutcome;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * <b>The resolvers themselves</b> — the one production answer to a {@link ResolutionPolicy.Run}.
 *
 * <p>Pure and total: every branch returns from what {@link InquiryResolutionContext} already holds. There is no
 * repository here, no channel client, no model and no clock beyond the one the context carries, so this class cannot
 * read or change anything. That is not a convention — it is what makes a dispatch of the effectful capability safe,
 * and {@code InquiryResolutionSafetyTest} asserts it by name.
 *
 * <h2>Choosing the capability</h2>
 *
 * <p>{@link ResolutionPolicy#next} names the <i>authority</i> on the first dispatch and leaves the capability null,
 * because which of an authority's capabilities can speak about a referent is a fact about the referent, not about the
 * goal. {@link ReferentRegistry} already declares that, and {@link #PREFERRED} orders the answer <b>narrowest object
 * first</b>: this listing before this company's rules before the whole catalogue. The ordering is written out rather
 * than taken from the enum's declaration order, so reordering {@link CapabilityId} for an unrelated reason cannot
 * silently change which resolver answers.
 *
 * <h2>The procedure never acts</h2>
 *
 * <p>{@code PROCEDURE_ORDER_ACTION} returns a constant, and it names <b>no prerequisite</b>. It would be theatre to
 * read the order first: no observation can make an absent executor present, and a precondition that cannot unblock
 * anything is a step that exists to look careful. So an {@code ACTION} goal reaches exactly one dispatch, that
 * dispatch performs no work of any kind, and the goal terminates {@code CAPABILITY_GAP / NOT_EXECUTABLE}.
 */
public final class InquiryGoalResolvers {

    /**
     * The capability each authority answers with, narrowest object first.
     *
     * <p>Intersected with {@link ReferentRegistry#capabilitiesAbout} this is total and single-valued over every
     * (authority, bound referent) pair the registry admits — asserted, not assumed.
     */
    static final List<CapabilityId> PREFERRED = List.of(
            CapabilityId.KNOWLEDGE_PRODUCT, CapabilityId.KNOWLEDGE_ORG, CapabilityId.KNOWLEDGE_CATALOGUE,
            CapabilityId.ENTITY_ORDER, CapabilityId.ENTITY_LISTING,
            CapabilityId.PROCEDURE_ORDER_ACTION, CapabilityId.SELLER);

    private InquiryGoalResolvers() {
    }

    /**
     * What the named resolver reports for this goal, from this context.
     *
     * <p>Never null: {@link com.sellerops.inquiry.goal.GoalResolution} reads a null as a failed run, and every
     * question this class is asked has an answer in the context it was handed.
     */
    public static ResolverOutcome resolve(CustomerGoal goal, ResolutionPolicy.Run run, InquiryResolutionContext ctx) {
        if (goal == null || run == null || ctx == null) {
            throw new IllegalArgumentException("a resolver answers a dispatch about a goal, in a context");
        }
        CapabilityId capability = run.capability() != null ? run.capability() : capabilityFor(run.resolver(), goal);
        if (capability == null) {
            // The registry says this authority cannot speak about this referent. ResolutionPolicy refuses to
            // dispatch that, so reaching here means the two disagree — report it rather than choose one.
            return ResolverOutcome.of(Resolution.gap(fallback(run.resolver()), GapReason.NOT_SUPPORTED, null, null));
        }
        return ResolverOutcome.of(switch (capability.authority()) {
            case KNOWLEDGE -> knowledge(capability, ctx);
            case ENTITY_STATE -> entity(capability, goal, ctx);
            case PROCEDURE -> notExecutable(capability);
            case SELLER -> Resolution.of(capability, ResolutionState.NEEDS_SELLER);
        });
    }

    /** The capability of {@code authority} that speaks about this goal's subject, or null if none does. */
    static CapabilityId capabilityFor(Authority authority, CustomerGoal goal) {
        Set<CapabilityId> about = ReferentRegistry.capabilitiesAbout(goal.subject());
        for (CapabilityId candidate : PREFERRED) {
            if (candidate.authority() == authority && about.contains(candidate)) {
                return candidate;
            }
        }
        return null;
    }

    // --- knowledge ---------------------------------------------------------------------------------------------

    /**
     * <b>What one search established</b>, in the resolution vocabulary.
     *
     * <p>The three non-{@code FOUND} outcomes all settle {@link ResolutionState#NEEDS_SELLER} and that is the
     * point of §10: the seller is reached from an <b>observed absence</b>, never from the shape of the question.
     * They stay distinct facts for the seller-facing sentence, which is not this layer's job; here they agree that
     * a human judgement is required because nothing written down decides it.
     *
     * <p>Having searched and found nothing is the only one of these that may reach a human. A capability the
     * context never searched reports {@code UNAVAILABLE}, so an unwired lane can never be read as an empty library.
     */
    private static Resolution knowledge(CapabilityId capability, InquiryResolutionContext ctx) {
        if (ctx.snapshot().status(capability) != CapabilityStatus.AVAILABLE) {
            return Resolution.gap(capability, GapReason.NOT_SUPPORTED, null, null);
        }
        RetrievalOutcome outcome = ctx.searched(capability);
        if (outcome == null) {
            return Resolution.gap(capability, GapReason.UNAVAILABLE, null, null);
        }
        return outcome == RetrievalOutcome.FOUND
                ? Resolution.of(capability, ResolutionState.RESOLVED)
                : Resolution.of(capability, ResolutionState.NEEDS_SELLER);
    }

    // --- entity state ------------------------------------------------------------------------------------------

    private static Resolution entity(CapabilityId capability, CustomerGoal goal, InquiryResolutionContext ctx) {
        EntityStateRequirement requirement = EntityStateRequirement.of(capability);
        Set<EntityField> fields = fieldsToRead(requirement, ctx);
        return capability == CapabilityId.ENTITY_ORDER
                ? EntityStateResolver.resolveOrder(ctx.order(), fields, ctx.snapshot(), ctx.orderKey())
                : EntityStateResolver.resolveListing(ctx.listing(), fields, optionLabel(goal, ctx.listing()),
                        ctx.snapshot(), ctx.now());
    }

    /**
     * Which fields to ask for.
     *
     * <p>One available field per required dimension — the resolvers refuse a read whose fields are not all
     * available, so asking for both members of a dimension that only half supports would turn a readable entity
     * into a {@code NOT_SUPPORTED} gap. When a dimension has nothing available the whole dimension is asked, so
     * that the gap the resolver reports names what is actually missing. Optional fields come along only when they
     * are readable; they are optional precisely because their absence is not a gap.
     */
    static Set<EntityField> fieldsToRead(EntityStateRequirement requirement, InquiryResolutionContext ctx) {
        Set<EntityField> fields = new LinkedHashSet<>();
        for (Set<EntityField> dimension : requirement.requiredDimensions()) {
            EntityField available = dimension.stream().sorted()
                    .filter(f -> ctx.snapshot().status(f) == CapabilityStatus.AVAILABLE).findFirst().orElse(null);
            if (available != null) {
                fields.add(available);
            } else {
                dimension.stream().sorted().forEach(fields::add);
            }
        }
        requirement.optional().stream().sorted()
                .filter(f -> ctx.snapshot().status(f) == CapabilityStatus.AVAILABLE).forEach(fields::add);
        return fields;
    }

    /**
     * The option the customer named, when they named one this listing actually declares.
     *
     * <p>Exact equality against a stored option label, which is a lookup rather than a reading: a constraint that
     * matches nothing yields null, and the resolver then asks the customer instead of guessing. Matching loosely
     * here would answer about a different variant, which is the defect Spec Applicability exists to prevent.
     */
    static String optionLabel(CustomerGoal goal, ListingState listing) {
        for (String constraint : goal.explicitConstraints()) {
            for (ListingState.Option option : listing.options()) {
                if (constraint.equals(option.label())) {
                    return constraint;
                }
            }
        }
        return null;
    }

    // --- procedure ---------------------------------------------------------------------------------------------

    /** A constant. Nothing is read, nothing is called, and no input can change what this returns. */
    private static Resolution notExecutable(CapabilityId capability) {
        return Resolution.gap(capability, GapReason.NOT_EXECUTABLE, null, null);
    }

    private static CapabilityId fallback(Authority authority) {
        for (CapabilityId candidate : PREFERRED) {
            if (candidate.authority() == authority) {
                return candidate;
            }
        }
        return CapabilityId.SELLER;
    }
}
