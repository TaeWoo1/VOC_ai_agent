package com.sellerops.review.publish;

import com.sellerops.inquiry.publish.cafe24.Cafe24AnswerExecutionGrant;
import com.sellerops.review.publish.cafe24.Cafe24ReviewCommentAdapter;
import java.util.UUID;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Component;

/**
 * The per-channel execution capability for review replies, as BUILT and CONFIGURED — the third
 * column beside {@code ReviewTriageChannelCapability}'s two.
 *
 * <p>The answer for Cafe24 is not a constant: it is {@code API_EXECUTION} only while the adapter bean
 * exists (execution flag AND Cafe24 connector on) and THIS seller's mall recorded a
 * {@code mall.write_community} grant. Each miss has its own {@link ReviewExecutionReason} so the
 * screen and the Agent can say which switch is off instead of "not supported". NAVER is a guided
 * browser flow regardless of configuration; Coupang has no reply feature (policy gate D8).
 */
@Component
public class ReviewExecutionCapability {

    /** One channel's answer: the kind, and — when {@code NOT_SUPPORTED} — why. */
    public record Decision(ReviewExecutionKind kind, ReviewExecutionReason reason) {

        static Decision of(ReviewExecutionKind kind) {
            return new Decision(kind, null);
        }

        static Decision unsupported(ReviewExecutionReason reason) {
            return new Decision(ReviewExecutionKind.NOT_SUPPORTED, reason);
        }
    }

    private final ObjectProvider<Cafe24ReviewCommentAdapter> cafe24;
    private final Cafe24AnswerExecutionGrant grant;

    public ReviewExecutionCapability(ObjectProvider<Cafe24ReviewCommentAdapter> cafe24,
                                     Cafe24AnswerExecutionGrant grant) {
        this.cafe24 = cafe24;
        this.grant = grant;
    }

    /**
     * A capability with no Cafe24 adapter and no grant reader — every Cafe24 answer is
     * {@code EXECUTION_DISABLED}. For the services' legacy test constructors; never a bean.
     */
    public static ReviewExecutionCapability disabled() {
        return new ReviewExecutionCapability(null, null);
    }

    public Decision of(UUID orgId, UUID sellerAccountId, String channelCode) {
        if (channelCode == null) {
            return Decision.unsupported(ReviewExecutionReason.EXECUTION_DISABLED);
        }
        return switch (channelCode) {
            case "NAVER" -> Decision.of(ReviewExecutionKind.GUIDED_BROWSER_EXECUTION);
            case "CAFE24" -> cafe24(orgId, sellerAccountId);
            // Coupang (and any channel with no seller reply flow): a fact about the platform, not a switch that
            // could be turned on — the conversation says so honestly and offers the next moves instead.
            default -> Decision.unsupported(ReviewExecutionReason.CHANNEL_UNSUPPORTED);
        };
    }

    /** The Cafe24 adapter when the lane is on, or null. */
    public Cafe24ReviewCommentAdapter cafe24Adapter() {
        return cafe24 == null ? null : cafe24.getIfAvailable();
    }

    private Decision cafe24(UUID orgId, UUID sellerAccountId) {
        if (cafe24Adapter() == null || grant == null) {
            return Decision.unsupported(ReviewExecutionReason.EXECUTION_DISABLED);
        }
        if (orgId == null || sellerAccountId == null || !grant.hasWriteGrant(orgId, sellerAccountId)) {
            return Decision.unsupported(ReviewExecutionReason.WRITE_GRANT_MISSING);
        }
        return Decision.of(ReviewExecutionKind.API_EXECUTION);
    }
}
