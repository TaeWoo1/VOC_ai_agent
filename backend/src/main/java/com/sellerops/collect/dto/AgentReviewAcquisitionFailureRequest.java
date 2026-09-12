package com.sellerops.collect.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;

/**
 * **A screen read that ended without handing anything over.** The sibling of {@link AgentReviewHandoffRequest}
 * for the case that leaves no other trace.
 *
 * <p>Until this existed, a 지금 동기화 the seller pressed and that failed before storing — the marketplace
 * asked for a login, the store on the screen was not theirs, the reading program could not be reached — wrote
 * no row at all. The window said so while it was open and then closed, and afterwards the collection history
 * was indistinguishable from a press that never happened. The seller was left with a button that sometimes
 * does nothing and no way to find out why.
 *
 * <p><b>It carries a code, not a sentence.</b> The failure word is a closed vocabulary the runtime already
 * publishes (the Action Window v2 blocker codes this lane can produce), validated here against the set this
 * lane can actually reach — an unknown word is a 400 that writes nothing, not a string stored for a screen to
 * render. Nothing about the page, the store, the credential, or a review travels on this route; there is no
 * property for any of them to arrive in and {@code ignoreUnknown = false} makes that audible.
 *
 * <p><b>No new table, no new column.</b> The run it records is an ordinary {@code sync_jobs} row with the
 * same method and trigger the successful handoff writes, zero counts, and the code in {@code error_message} —
 * which is where the successful path already records its own named ending.
 */
@JsonIgnoreProperties(ignoreUnknown = false)
public record AgentReviewAcquisitionFailureRequest(
        @NotBlank @Pattern(regexp = "^[0-9a-f]{24}$", message = "계정 슬롯 형식이 올바르지 않습니다.")
        String accountSlot,
        @NotBlank @Pattern(regexp = "^[A-Z0-9_]{2,32}$", message = "채널 코드 형식이 올바르지 않습니다.")
        String channelCode,
        /** The runtime's own word for why the run ended. Checked against a closed set before anything is written. */
        @NotBlank @Pattern(regexp = "^[A-Z_]{2,40}$", message = "실패 코드 형식이 올바르지 않습니다.")
        String failureCode) {
}
