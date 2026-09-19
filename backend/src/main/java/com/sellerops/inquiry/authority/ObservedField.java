package com.sellerops.inquiry.authority;

/** One field an ENTITY_STATE capability actually observed, with its provenance. {@code value} is a closed enum name. */
public record ObservedField(EntityField field, String value, AuthorityProvenance provenance) {
}
