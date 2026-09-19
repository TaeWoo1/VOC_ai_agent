package com.sellerops.inquiry.authority;

import com.sellerops.inquiry.decision.EvidenceScope;
import java.time.Instant;

/**
 * Where one resolved fact came from: which authority, which capability, which instance, which source, as of when, and
 * whether «now» may be said about it. Carried beside every observed field so a later reader — a draft, a seller packet, an
 * eval — never has to re-derive it, and so a fact can never be attributed to a different instance than the one it was
 * read for.
 *
 * @param entity    the instance, in the {@link EvidenceScope} vocabulary the v2.2 invariants already use
 * @param asOf      when this system last saw it; null for knowledge, which is dated by its own document
 * @param freshness {@link Freshness#FRESH} only when the source proved it current
 */
public record AuthorityProvenance(CapabilityId capability, EvidenceScope entity, Source source, Instant asOf,
                                  Freshness freshness) {

    public enum Source {
        ORDER_STORED, ORDER_EXACT_READ, LISTING_STORED, OPTION_STORED, SELLER_KNOWLEDGE, ORG_KNOWLEDGE, CATALOGUE_FACT
    }

    public enum Freshness { FRESH, UNPROVEN }

    public Authority authority() {
        return capability.authority();
    }
}
