package com.sellerops.inquiry.authority;

import com.sellerops.inquiry.decision.EvidenceCandidate;
import com.sellerops.inquiry.decision.EvidenceScope;
import com.sellerops.inquiry.decision.NeedResult;
import com.sellerops.inquiry.decision.NeedStatus;
import com.sellerops.inquiry.decision.NeedType;
import com.sellerops.order.fact.OrderFact;
import java.util.ArrayList;
import java.util.EnumSet;
import java.util.List;
import java.util.Set;

/**
 * <b>The v2 authority-confusion fence</b> (Inquiry Architecture v3 WP-1) — the deterministic authority layer applied to the
 * judge's enforced verdicts, before the basis is derived. Default OFF
 * ({@code sellerops.inquiry-authority.fence.enabled}).
 *
 * <p>The rule it holds, generalising v2.2's {@code SCOPE_UNATTRIBUTED}: <b>a need is closed only by its own authority</b>.
 * <ul>
 *   <li>an ORDER_STATE need is ENTITY_STATE — closed only by THIS order's fresh fact. A company rule citing what usually
 *       happens is context, never a close; and unlike v2.2 this holds for CONDITIONAL too (the A-arm T13a shape);</li>
 *   <li>an ORDER_ACTION need is PROCEDURE — declared, no executor in v3.0: it is never closed, and it is recorded as a
 *       capability gap (NOT_EXECUTABLE), not as the seller's knowledge being short;</li>
 *   <li>a SELLER_DECISION need is SELLER — no evidence closes it;</li>
 *   <li>a listing or policy need is KNOWLEDGE — an order fact alone does not close it.</li>
 * </ul>
 * An unavailable authority is never substituted by another: it becomes {@link ResolutionState#CAPABILITY_GAP} with a
 * reason, and that is recorded apart from {@link ResolutionState#NEEDS_SELLER}.
 *
 * <p><b>The bridge.</b> v2's planner names a {@link NeedType}, not an authority, so {@link #planned(NeedType)} maps one to
 * the other. It is a bridge, pinned in {@code contracts/inquiry-resolution-plan/v1/vocabulary.json} and scored against the
 * plan gold; the v3 Resolution Planner replaces it. Where the bridge is coarser than the gold (availability that is really
 * listing STATE, a read that is really an order FIELD) it errs toward the fence doing nothing more than v2 did.
 */
public final class AuthorityFence {

    /** What the fence reads besides the verdicts — the snapshot and the order fact the caller already has. */
    public record Context(CapabilitySnapshot snapshot, OrderFact order, String orderKey) {
    }

    private static final Set<EntityField> ORDER_FIELDS = EnumSet.of(EntityField.ORDER_PAYMENT,
            EntityField.ORDER_CANCELLATION, EntityField.ORDER_FULFILLMENT, EntityField.ORDER_TRACKING);

    private AuthorityFence() {
    }

    /** The v2 → v3 bridge: which capability a v2 need type would be planned to. */
    public static CapabilityId planned(NeedType type) {
        if (type == null) {
            return CapabilityId.SELLER;
        }
        return switch (type) {
            case PRODUCT_SPEC, PRODUCT_USAGE, PRODUCT_COMPATIBILITY, CATALOGUE_AVAILABILITY -> CapabilityId.KNOWLEDGE_PRODUCT;
            case POLICY -> CapabilityId.KNOWLEDGE_ORG;
            case ORDER_STATE -> CapabilityId.ENTITY_ORDER;
            case ORDER_ACTION -> CapabilityId.PROCEDURE_ORDER_ACTION;
            case SELLER_DECISION -> CapabilityId.SELLER;
        };
    }

    /** Which authority a piece of v2 evidence speaks with — from its kind, i.e. its provenance, never its text. */
    public static Authority authorityOf(EvidenceCandidate.Kind kind) {
        return kind == EvidenceCandidate.Kind.ORDER_FACT ? Authority.ENTITY_STATE : Authority.KNOWLEDGE;
    }

    public static List<NeedResult> apply(List<NeedResult> results, Context ctx) {
        List<NeedResult> out = new ArrayList<>(results.size());
        for (NeedResult r : results) {
            out.add(apply(r, ctx));
        }
        return List.copyOf(out);
    }

    static NeedResult apply(NeedResult r, Context ctx) {
        CapabilityId capability = planned(r.need().type());
        return switch (capability.authority()) {
            case KNOWLEDGE -> knowledge(r, capability);
            case ENTITY_STATE -> order(r, ctx);
            case PROCEDURE -> {
                Resolution precondition = orderEntity(ctx);
                Resolution gap = new Resolution(capability, ResolutionState.CAPABILITY_GAP, GapReason.NOT_EXECUTABLE,
                        null, null, null, List.of(precondition));
                yield r.status().covered() ? r.withAuthority(downgrade(r), NeedResult.Enforcement.WRONG_AUTHORITY, gap)
                        : r.withAuthority(r.status(), r.enforcement(), gap);
            }
            case SELLER -> {
                Resolution seller = Resolution.of(capability, ResolutionState.NEEDS_SELLER);
                yield r.status().covered() ? r.withAuthority(downgrade(r), NeedResult.Enforcement.WRONG_AUTHORITY, seller)
                        : r.withAuthority(r.status(), r.enforcement(), seller);
            }
        };
    }

    private static NeedResult knowledge(NeedResult r, CapabilityId capability) {
        boolean citesKnowledge = r.evidence().stream().anyMatch(e -> authorityOf(e.kind()) == Authority.KNOWLEDGE);
        if (r.status().covered() && !citesKnowledge) {
            return r.withAuthority(downgrade(r), NeedResult.Enforcement.WRONG_AUTHORITY,
                    Resolution.of(capability, ResolutionState.NEEDS_SELLER));
        }
        Resolution resolution = switch (r.status()) {
            case FULL -> Resolution.of(capability, ResolutionState.RESOLVED);
            case CONDITIONAL_ON_CUSTOMER -> new Resolution(capability, ResolutionState.RESOLVED_CONDITIONAL, null, null,
                    List.of(CustomerInput.UNNAMED_PRODUCT_CONTEXT), null, null);
            case UNKNOWN -> Resolution.gap(CapabilityId.KNOWLEDGE_CATALOGUE, GapReason.UNREADABLE_SOURCE, null, null);
            default -> r.acquirable() ? Resolution.gap(CapabilityId.KNOWLEDGE_CATALOGUE, GapReason.ACQUIRABLE, null, null)
                    : Resolution.of(capability, ResolutionState.NEEDS_SELLER);
        };
        return r.withAuthority(r.status(), r.enforcement(), resolution);
    }

    private static NeedResult order(NeedResult r, Context ctx) {
        Resolution entity = orderEntity(ctx);
        String key = ctx == null ? null : ctx.orderKey();
        boolean citesThisOrder = key != null && r.evidence().stream().anyMatch(e -> e.kind()
                == EvidenceCandidate.Kind.ORDER_FACT && e.scope() != null && e.scope().kind() == EvidenceScope.Kind.ORDER
                && key.equals(e.scope().id()));
        boolean fresh = !entity.observed().isEmpty() && entity.observed().stream()
                .allMatch(o -> o.provenance().freshness() == AuthorityProvenance.Freshness.FRESH);
        if (r.status() == NeedStatus.FULL && citesThisOrder && fresh) {
            // The judge read THIS order's fresh fact as answering; the field-level question is the v3 planner's (WP-2).
            return r.withAuthority(r.status(), r.enforcement(), new Resolution(CapabilityId.ENTITY_ORDER,
                    ResolutionState.RESOLVED, null, null, null, entity.observed(), null));
        }
        Resolution open = unresolvedOrder(entity);
        if (!r.status().covered()) {
            return r.withAuthority(r.status(), r.enforcement(), open);
        }
        return r.withAuthority(downgrade(r), citesThisOrder ? NeedResult.Enforcement.AUTHORITY_UNRESOLVED
                : NeedResult.Enforcement.WRONG_AUTHORITY, open);
    }

    /**
     * What this order's entity step says with every order field asked — the v2 need names no field. A gap wins over the
     * seller: an unbound, unreachable, stale or partly unobservable order is the system's limit, not the seller's.
     */
    private static Resolution orderEntity(Context ctx) {
        if (ctx == null || ctx.snapshot() == null) {
            return Resolution.gap(CapabilityId.ENTITY_ORDER, GapReason.UNBOUND, List.copyOf(ORDER_FIELDS), null);
        }
        return EntityStateResolver.resolveOrder(ctx.order(), ORDER_FIELDS, ctx.snapshot(), ctx.orderKey());
    }

    private static Resolution unresolvedOrder(Resolution entity) {
        if (entity.state() == ResolutionState.CAPABILITY_GAP) {
            return entity;
        }
        return new Resolution(CapabilityId.ENTITY_ORDER, ResolutionState.NEEDS_SELLER, null, null, null,
                entity.observed(), null);
    }

    /** A verdict of support the authority does not back: PARTIAL while it still cites something, else NONE. */
    private static NeedStatus downgrade(NeedResult r) {
        return r.evidence().isEmpty() ? NeedStatus.NONE : NeedStatus.PARTIAL;
    }
}
