package com.sellerops.review.channel.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * The seller telling us which store this account is (Coupang 업체코드).
 *
 * <p>Not a credential and never carried with one: this request has exactly one field, so there is no
 * shape in which an API key could ride along with it.
 */
public record StoreIdentityRequest(@NotBlank @Size(max = 64) String storeIdentity) {
}
