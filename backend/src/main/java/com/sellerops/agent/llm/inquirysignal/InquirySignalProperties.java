package com.sellerops.agent.llm.inquirysignal;

import com.sellerops.agent.llm.operator.AgentOperatorProperties;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * {@code sellerops.inquiry.signature.*} — the inquiry-classification switch.
 *
 * <p>Off by default in the same three independent ways every other capability is (master flag, key,
 * org allow-list). It reuses {@link AgentOperatorProperties}' SHAPE and emphatically not another
 * capability's FLAG: this one sends a customer's own sentence, which is a heavier exposure than the
 * planner's (the operator's sentence) or the judge's (a SellerOps-authored claim), and a deployment
 * that wants goal interpretation must not thereby be sending customer questions to a vendor.
 *
 * <p>{@link #maxTextChars} bounds a single request; {@link #maxBatchPerCall} bounds how many
 * classifications one backfill page may perform. Both exist because this is the only capability whose
 * natural usage is a whole corpus, and a corpus-sized capability without a stated ceiling is one that
 * discovers its ceiling in a bill.
 */
@Component
public class InquirySignalProperties extends AgentOperatorProperties {

    private final int maxTextChars;
    private final int maxBatchPerCall;

    public InquirySignalProperties(
            @Value("${sellerops.inquiry.signature.enabled:false}") boolean enabled,
            @Value("${sellerops.inquiry.signature.enabled-org-ids:}") String enabledOrgIds,
            @Value("${sellerops.inquiry.signature.vendor:OPENAI}") String vendor,
            @Value("${sellerops.inquiry.signature.model:gpt-5-2025-08-07}") String model,
            @Value("${sellerops.inquiry.signature.api-key:}") String apiKey,
            // 200 was sized for the ANSWER — two labels in a JSON object. On a reasoning model that
            // budget is SHARED with internal reasoning, so it was spent before any answer was emitted
            // and arrived as `budget_exhausted`. Measured live 2026-08-21: 2 of 50 real classifications.
            // `AgentDraftProperties` documents the identical trap; this is the same mistake made again
            // in a new capability, so the number now carries the reason.
            @Value("${sellerops.inquiry.signature.max-output-tokens:2000}") int maxOutputTokens,
            @Value("${sellerops.inquiry.signature.reasoning-effort:low}") String reasoningEffort,
            @Value("${sellerops.inquiry.signature.max-text-chars:2000}") int maxTextChars,
            @Value("${sellerops.inquiry.signature.max-batch-per-call:200}") int maxBatchPerCall) {
        super(enabled, enabledOrgIds, vendor, model, apiKey, maxOutputTokens, reasoningEffort);
        this.maxTextChars = maxTextChars <= 0 ? 2000 : maxTextChars;
        this.maxBatchPerCall = maxBatchPerCall <= 0 ? 200 : maxBatchPerCall;
    }

    /** A longer inquiry is TRUNCATED, never split into a second call — one text, one egress. */
    public int maxTextChars() {
        return maxTextChars;
    }

    public int maxBatchPerCall() {
        return maxBatchPerCall;
    }
}
