package com.sellerops.inquiry.publish;

import java.util.UUID;

/**
 * Port for posting a seller answer to the official ESM Trading CS QnA endpoint. The
 * transient reply {@code token} is passed per-call and never returned or stored; the
 * outcome carries only a normalized provider {@code messageNo} on success or a
 * numeric {@code resultCode} on rejection — never the free-text provider message.
 */
public interface EsmAnswerClient {

    Outcome post(AnswerCommand command);

    /** All fields of the approved answer plus the transient token and the connection identity. */
    record AnswerCommand(UUID orgId, UUID sellerAccountId, String messageNo, String token,
                         int answerStatus, String title, String comments) {
    }

    record Outcome(Kind kind, String providerMessageNo, Integer resultCode) {
        public enum Kind { SUCCESS, FAILURE, DELIVERY_UNKNOWN }

        public static Outcome success(String providerMessageNo) {
            return new Outcome(Kind.SUCCESS, providerMessageNo, null);
        }

        public static Outcome failure(Integer resultCode) {
            return new Outcome(Kind.FAILURE, null, resultCode);
        }

        public static Outcome deliveryUnknown() {
            return new Outcome(Kind.DELIVERY_UNKNOWN, null, null);
        }
    }
}
