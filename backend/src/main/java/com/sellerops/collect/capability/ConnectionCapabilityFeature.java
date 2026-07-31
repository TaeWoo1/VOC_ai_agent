package com.sellerops.collect.capability;

/**
 * One capability line in a channel's connection-capability result. All four values are safe to
 * send to the browser: {@code feature}/{@code state}/{@code reason} are closed vocabularies (see
 * {@link NaverCapabilityEvaluator}) and {@code label} is a fixed operator-facing Korean string —
 * none of them carries an account id, token, secret, order id, or personal data.
 *
 * @param feature closed key: {@code ORDER_READ} | {@code REVIEW_IMPORT} | {@code REVIEW_REPLY}
 *                | {@code INQUIRY_READ}
 * @param state   {@code AVAILABLE} | {@code GUIDED_CONFIRMATION} | {@code NOT_ENABLED}
 *                | {@code INTEGRATION_PENDING} | {@code NEEDS_ATTENTION}
 * @param label   fixed Korean label for the feature
 * @param reason  closed reason code (or null when the state needs none)
 */
public record ConnectionCapabilityFeature(String feature, String state, String label, String reason) {
}
