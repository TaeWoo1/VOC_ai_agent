package com.sellerops.inquiry.goal;

import com.sellerops.inquiry.authority.CapabilityId;
import com.sellerops.inquiry.authority.EntityField;
import java.util.EnumMap;
import java.util.EnumSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * <b>The minimum state that actually answers the question</b> (Inquiry v3.5 §8) — declared by the registry, checked by
 * the Entity Resolver, and named by nobody upstream.
 *
 * <p>Until now the planner's {@code fields} list was treated as an <i>exact requirement</i>: every field it named had
 * to be available or the whole entity step became a gap. That made an over-read fatal. It was measured twice — {@code
 * P01} under v3 and {@code C4} under v4 — and both times a goal that the deployment could answer was reported as
 * unanswerable because the model had also asked for a carrier number that no channel in this repository can read.
 *
 * <p>In v3.5 no component upstream names a field at all, so the choice WP-3.2 §4 left open is settled by the
 * architecture: the resolver decides. What this class adds is the part that keeps that from becoming permissive.
 *
 * <h2>Why not "any readable field resolves it"</h2>
 *
 * <p>Because {@code R:7a8136b2} is the counterexample and it stays a regression. There, fulfilment is genuinely
 * unreadable on that channel while other order fields are readable, and a rule that resolves on any readable field
 * reports "answerable" for a question it cannot answer. Field-level availability was priced and rejected for exactly
 * this on the recorded runs; that rejection stands.
 *
 * <h2>The rule</h2>
 *
 * <p>A requirement is a list of <b>dimensions</b>. A dimension is satisfied by any one of its fields — which is how a
 * listing's sale status can be answered at either option or listing granularity without demanding both. The goal is
 * answerable when <b>every required dimension</b> is satisfied. Optional fields are recorded when readable and are
 * never fatal when they are not.
 *
 * <table><caption>this registry's entities</caption>
 *   <tr><th>entity</th><th>required</th><th>optional</th><th>evidence</th></tr>
 *   <tr><td>{@code ENTITY.ORDER}</td><td>fulfilment</td><td>payment · cancellation · tracking</td>
 *       <td>11 of 11 order steps in the frozen gold read fulfilment; none requires the other three</td></tr>
 *   <tr><td>{@code ENTITY.LISTING}</td><td>sale status <i>(option or listing)</i></td><td>—</td>
 *       <td>3 of 3 listing steps in the frozen gold read option sale status</td></tr>
 * </table>
 *
 * <p><b>What is honestly unobserved.</b> No goal in the 72 requires payment or cancellation state as its answer. A
 * customer asking "was my payment cancelled?" would need a second required dimension, and this class does not guess
 * one: the extension point is a registry declaration, and which goals need it is a Layer-B resolver-eval question and
 * not something to invent from zero examples.
 */
public record EntityStateRequirement(CapabilityId entity, List<Set<EntityField>> requiredDimensions,
                                     Set<EntityField> optional) {

    private static final Map<CapabilityId, EntityStateRequirement> DECLARED = declared();

    public EntityStateRequirement {
        if (entity == null || entity.authority() != com.sellerops.inquiry.authority.Authority.ENTITY_STATE) {
            throw new IllegalArgumentException(entity + " is not an entity");
        }
        if (requiredDimensions == null || requiredDimensions.isEmpty()) {
            throw new IllegalArgumentException("an entity requirement names at least one required dimension");
        }
        requiredDimensions = requiredDimensions.stream().map(Set::copyOf).toList();
        for (Set<EntityField> d : requiredDimensions) {
            if (d.isEmpty()) {
                throw new IllegalArgumentException("a dimension is satisfied by at least one field");
            }
            for (EntityField f : d) {
                if (f.capability() != entity) {
                    throw new IllegalArgumentException(f + " is not " + entity.wire() + "'s field");
                }
            }
        }
        optional = optional == null ? Set.of() : Set.copyOf(optional);
        for (EntityField f : optional) {
            if (f.capability() != entity) {
                throw new IllegalArgumentException(f + " is not " + entity.wire() + "'s field");
            }
        }
    }

    /** What this deployment declares is needed to answer a question about this entity. */
    public static EntityStateRequirement of(CapabilityId entity) {
        EntityStateRequirement r = DECLARED.get(entity);
        if (r == null) {
            throw new IllegalArgumentException("no state requirement declared for " + entity);
        }
        return r;
    }

    /**
     * Whether the state that could actually be read answers the question.
     *
     * @param readable the fields this deployment can read for this instance, now
     */
    public boolean satisfiedBy(Set<EntityField> readable) {
        Set<EntityField> have = readable == null ? Set.of() : readable;
        return requiredDimensions.stream().allMatch(d -> d.stream().anyMatch(have::contains));
    }

    /** The required dimensions nothing readable satisfies — what to report as the reason for a gap. */
    public List<Set<EntityField>> unsatisfied(Set<EntityField> readable) {
        Set<EntityField> have = readable == null ? Set.of() : readable;
        return requiredDimensions.stream().filter(d -> d.stream().noneMatch(have::contains)).toList();
    }

    /** Every field this entity may read. Required first, then optional — the read set, not the requirement. */
    public Set<EntityField> readable() {
        Set<EntityField> all = new LinkedHashSet<>();
        requiredDimensions.forEach(all::addAll);
        all.addAll(optional);
        return Set.copyOf(all);
    }

    private static Map<CapabilityId, EntityStateRequirement> declared() {
        Map<CapabilityId, EntityStateRequirement> m = new EnumMap<>(CapabilityId.class);
        m.put(CapabilityId.ENTITY_ORDER, new EntityStateRequirement(CapabilityId.ENTITY_ORDER,
                List.of(Set.of(EntityField.ORDER_FULFILLMENT)),
                EnumSet.of(EntityField.ORDER_PAYMENT, EntityField.ORDER_CANCELLATION, EntityField.ORDER_TRACKING)));
        m.put(CapabilityId.ENTITY_LISTING, new EntityStateRequirement(CapabilityId.ENTITY_LISTING,
                List.of(EnumSet.of(EntityField.LISTING_OPTION_SALE_STATUS, EntityField.LISTING_SALE_STATUS)),
                Set.of()));
        return java.util.Collections.unmodifiableMap(m);
    }
}
