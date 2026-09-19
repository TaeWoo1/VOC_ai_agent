package com.sellerops.inquiry.decision;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * The two semantic judgements Inquiry Decision v2 needs from a model — and nothing else. Production: the
 * {@link InquiryDecisionService} door. An evaluation harness may substitute its own implementation; nothing
 * downstream can tell, which is what keeps the policy in {@link NeedAggregation} independent of who judged.
 *
 * <p>A null {@link Answer#value()} means 「no opinion」 (off, refused, unparseable): the engine never completes a Case
 * on it.
 */
public interface InquiryDecisionModel {

    boolean enabledFor(UUID orgId);

    /** The customer's independent needs, in the seller's words. */
    Answer<List<InquiryNeed>> plan(UUID orgId, String question);

    /** One verdict per need, over ONE candidate list, in ONE call. */
    Answer<Map<String, NeedVerdict>> judge(UUID orgId, String question, List<InquiryNeed> needs,
                                           List<EvidenceCandidate> evidence, List<PrecedentCandidate> precedents);

    /** A value (or null for no opinion) and what getting it cost — returned, never kept on a shared object. */
    record Answer<T>(T value, CallCost cost) {
        public static <T> Answer<T> none() {
            return new Answer<>(null, CallCost.NONE);
        }
    }

    record CallCost(int calls, long elapsedMs, int promptTokens, int completionTokens) {
        public static final CallCost NONE = new CallCost(0, 0, 0, 0);

        public CallCost plus(CallCost o) {
            return new CallCost(calls + o.calls, elapsedMs + o.elapsedMs, promptTokens + Math.max(0, o.promptTokens),
                    completionTokens + Math.max(0, o.completionTokens));
        }
    }
}
