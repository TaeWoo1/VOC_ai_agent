package com.sellerops.inquiry.goal;

import com.sellerops.inquiry.authority.Authority;
import com.sellerops.inquiry.authority.CapabilityId;
import java.util.EnumMap;
import java.util.EnumSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * <b>Which referents this deployment can identify, and which capabilities can be about each</b> (Inquiry v3.5).
 *
 * <p>This is the structure §2 of the brief asked to be checked: a goal's subject is <b>bound to a registry entry</b>,
 * not to a free string the interpreter chose. The interpreter may only name a referent this registry publishes, or
 * {@link Referent#UNRESOLVED}. Nothing downstream ever parses a subject sentence.
 *
 * <p><b>The referents are not a new vocabulary.</b> Every bound value here is a scope some capability of this
 * deployment is already about, and {@code ReferentRegistryTest} asserts the correspondence in both directions — a
 * referent with no capability, or a capability scope with no referent, fails the build. That is what keeps this from
 * becoming a second truth about what the system can be asked about.
 *
 * <p><b>Extension is a registration, not an edit here.</b> A deployment selling appointments rather than listings
 * registers its own referents against its own capabilities; what does not change is the contract — a goal names one
 * referent, the referent decides which resolvers may be about it, and an unbound referent is a reported outcome rather
 * than a silent substitution. The commerce names below are <b>this registry's content</b>, not the architecture's.
 */
public final class ReferentRegistry {

    private static final Map<Referent, Set<CapabilityId>> ABOUT = about();

    private ReferentRegistry() {
    }

    /** The referents this deployment can identify. {@link Referent#UNRESOLVED} is deliberately not among them. */
    public static List<Referent> bound() {
        return List.copyOf(ABOUT.keySet());
    }

    /**
     * The capabilities that can be about this referent. Empty for {@link Referent#UNRESOLVED} — which is the whole
     * content of "unresolved": there is nothing this deployment can point at, so no resolver can act.
     */
    public static Set<CapabilityId> capabilitiesAbout(Referent referent) {
        return ABOUT.getOrDefault(referent, Set.of());
    }

    /**
     * Whether a resolver of this authority can act on this referent at all. <b>A registry question, asked before any
     * resolver runs</b> — and the reason an interpreter never has to know which authority can do what.
     */
    public static boolean canAct(Authority authority, Referent referent) {
        return capabilitiesAbout(referent).stream().anyMatch(c -> c.authority() == authority);
    }

    private static Map<Referent, Set<CapabilityId>> about() {
        Map<Referent, Set<CapabilityId>> m = new EnumMap<>(Referent.class);
        m.put(Referent.CURRENT_LISTING, EnumSet.of(CapabilityId.KNOWLEDGE_PRODUCT, CapabilityId.KNOWLEDGE_CATALOGUE,
                CapabilityId.ENTITY_LISTING, CapabilityId.SELLER));
        m.put(Referent.SELLER_CATALOGUE, EnumSet.of(CapabilityId.KNOWLEDGE_CATALOGUE, CapabilityId.SELLER));
        m.put(Referent.CURRENT_ORDER, EnumSet.of(CapabilityId.ENTITY_ORDER, CapabilityId.PROCEDURE_ORDER_ACTION,
                CapabilityId.KNOWLEDGE_ORG, CapabilityId.SELLER));
        m.put(Referent.ORGANIZATION, EnumSet.of(CapabilityId.KNOWLEDGE_ORG, CapabilityId.SELLER));
        return java.util.Collections.unmodifiableMap(m);
    }
}
