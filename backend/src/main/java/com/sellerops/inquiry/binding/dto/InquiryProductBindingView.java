package com.sellerops.inquiry.binding.dto;

import java.time.Instant;
import java.util.UUID;

/**
 * What an inquiry's product attribution currently is, and how it came to be.
 *
 * <p>{@code binding} is {@code SOURCE_EXACT}, {@code USER_CONFIRMED}, or null when nothing is bound.
 * {@code sourceProductRef} is the channel's own identifier as the source stated it — present and
 * unbound means "the channel named a listing we do not hold", which is a catalogue gap rather than a
 * question for a person.
 */
public record InquiryProductBindingView(UUID inquiryId, UUID productId, String productName,
                                        String binding, Instant boundAt, String boundByName,
                                        String sourceProductRef) {
}
