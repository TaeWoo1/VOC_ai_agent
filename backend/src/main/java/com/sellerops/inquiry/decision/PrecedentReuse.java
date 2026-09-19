package com.sellerops.inquiry.decision;

import com.sellerops.inquiry.Inquiry;
import com.sellerops.knowledge.memory.AnswerMemoryReuseScope;
import java.util.Objects;
import java.util.UUID;

/**
 * <b>Which past answers may prefill which Case</b> — a memory provenance invariant (Inquiry Decision v2.1), owned by
 * code and read from what a person declared ({@link AnswerMemoryReuseScope}), never from the answer's words.
 *
 * <ul>
 *   <li>{@code REUSABLE} — any Case.</li>
 *   <li>{@code ORDER_ONLY} — only a Case whose inquiry is bound to the SAME order: same channel, same channel order
 *       reference, both stated by the channel ({@code Inquiry.sourceOrderRef}). Answer memory holds no order reference
 *       — the comparison goes through the two inquiries, so an order identifier never becomes long-term memory.</li>
 *   <li>{@code CASE_ONLY} and {@code UNKNOWN} — only the Case the answer was written in. Nobody said it is general, so it
 *       is not treated as general.</li>
 * </ul>
 * The other prefill fences (same org, same product or unbound, not this inquiry's own answer) still apply on top.
 */
public final class PrecedentReuse {

    private PrecedentReuse() {
    }

    /** The order an inquiry is about, as the channel stated it; null when none was stated. */
    public record OrderKey(UUID channelId, String orderRef) {
        public static OrderKey of(Inquiry inquiry) {
            if (inquiry == null || inquiry.getSourceOrderRef() == null || inquiry.getSourceOrderRef().isBlank()) {
                return null;
            }
            return new OrderKey(inquiry.getChannelId(), inquiry.getSourceOrderRef().strip());
        }
    }

    /**
     * @param scope           the answer's declared reuse scope (null reads as UNKNOWN)
     * @param originInquiryId the inquiry the answer was written for
     * @param originOrder     that inquiry's order, or null
     * @param currentInquiry  the Case's inquiry
     * @param currentOrder    the Case's order, or null
     */
    public static boolean admits(AnswerMemoryReuseScope scope, UUID originInquiryId, OrderKey originOrder,
                                 UUID currentInquiry, OrderKey currentOrder) {
        AnswerMemoryReuseScope s = scope == null ? AnswerMemoryReuseScope.UNKNOWN : scope;
        return switch (s) {
            case REUSABLE -> true;
            case ORDER_ONLY -> originOrder != null && currentOrder != null && originOrder.equals(currentOrder);
            case CASE_ONLY, UNKNOWN -> currentInquiry != null && Objects.equals(currentInquiry, originInquiryId);
        };
    }
}
