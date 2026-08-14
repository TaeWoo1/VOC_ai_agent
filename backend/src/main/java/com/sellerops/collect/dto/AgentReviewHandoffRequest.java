package com.sellerops.collect.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.util.List;

/**
 * The Local Agent's review handoff: the 상품평 the agent read off the seller's own WING screen, under that
 * seller's explicit connection.
 *
 * <p><b>The slot selects; the JWT authorizes</b> — the same binding the credential handoff uses. The org comes
 * from the authenticated principal, {@code accountSlot} is resolved inside it, and {@code channelCode} is a
 * GUARD rather than a routing key.
 *
 * <p><b>No run interlock, and that is a deliberate difference.</b> The credential handoff is armed with the
 * operator's whole approval identity and spends a one-shot, because it carries secrets a seller can only issue
 * once. This carries the seller's own reviews: nothing secret, no marketplace action, and a replay is a no-op
 * because every row dedups. Authentication, org scoping and the channel guard are proportionate to that; an
 * interlock here would be ceremony that teaches an operator to expect one where it does not protect anything.
 *
 * <p><b>{@code complete} is a claim, not a formality.</b> The agent sets it only when its walk reached a real
 * boundary or the operator declared the list finished. An incomplete handoff still stores its reviews — dedup
 * makes that free — but the coverage claim is what the product must not infer from a successful POST.
 *
 * <p><b>There is no author field, on either record.</b> Coupang prints the buyer's name beside every review;
 * the acquisition path resolves that column so it can refuse to read it, and there is no property here for the
 * value to arrive in. {@code ignoreUnknown = false} makes that refusal audible: a request carrying one is
 * rejected rather than quietly accepted with the field dropped.
 */
@JsonIgnoreProperties(ignoreUnknown = false)
public record AgentReviewHandoffRequest(
        @NotBlank @Pattern(regexp = "^[0-9a-f]{24}$", message = "계정 슬롯 형식이 올바르지 않습니다.")
        String accountSlot,
        @NotBlank @Pattern(regexp = "^[A-Z0-9_]{2,32}$", message = "채널 코드 형식이 올바르지 않습니다.")
        String channelCode,
        /** Whether the agent's walk actually covered the list. Never inferred from the request succeeding. */
        boolean complete,
        /** The agent's own named ending, carried for the operator's record. Not trusted for any decision. */
        @Pattern(regexp = "^[A-Z_]{0,40}$", message = "종료 사유 형식이 올바르지 않습니다.")
        String stopReason,
        @NotEmpty @Size(max = AgentReviewHandoffRequest.MAX_REVIEWS)
        List<@Valid @NotNull Review> reviews) {

    /** One handoff is one sitting's worth of pages, not an archive. Beyond this the agent posts again. */
    public static final int MAX_REVIEWS = 500;

    /**
     * One acquired review. Every field is either the seller's own catalog identity or what the buyer wrote —
     * never who they are.
     */
    @JsonIgnoreProperties(ignoreUnknown = false)
    public record Review(
            @NotBlank @Pattern(regexp = "^\\d{4}-\\d{2}-\\d{2}$", message = "작성일 형식이 올바르지 않습니다.")
            String writtenOn,
            @NotNull @Min(1) @Max(5) Integer rating,
            /**
             * What the buyer wrote. BLANK is legitimate and means exactly one thing — see {@code textless}.
             * A channel's own placeholder sentence must never arrive here: it is UI text, not a customer's
             * words, and storing it as a body is what made 19 of 22 reviews look written on the first live
             * backfill.
             */
            @NotNull @Size(max = 8000) String body,
            @NotBlank @Pattern(regexp = "^\\d{1,32}$", message = "상품 ID 형식이 올바르지 않습니다.")
            String productId,
            @Pattern(regexp = "^\\d{1,32}$", message = "옵션 ID 형식이 올바르지 않습니다.")
            String vendorItemId,
            @Size(max = 500) String productName,
            @Min(0) @Max(50) int mediaCount,
            /** The list cell cut the body off. Stored text is then a prefix, and the product should say so. */
            boolean bodyTruncated,
            /**
             * The buyer rated and wrote nothing. Carried rather than inferred from a blank body, because the
             * two are different claims: a blank body could be a reader defect, while this is the agent saying
             * it saw a rating with no text. A disagreement between the two is refused rather than resolved.
             */
            boolean textless) {

        /** Masked — a review body is a customer's words and has no business in a log line or a stack trace. */
        @Override
        public String toString() {
            return "Review[writtenOn=" + writtenOn + ", rating=" + rating
                    + ", body=<masked:" + (body != null ? body.length() : 0) + ">"
                    + ", textless=" + textless
                    + ", productId=" + productId + ", mediaCount=" + mediaCount + "]";
        }
    }

    /** Masked for the same reason: the row list is review text, and a request object gets printed. */
    @Override
    public String toString() {
        return "AgentReviewHandoffRequest[accountSlot=<masked>, channelCode=" + channelCode
                + ", complete=" + complete + ", stopReason=" + stopReason
                + ", reviews=<masked:" + (reviews != null ? reviews.size() : 0) + ">]";
    }
}
