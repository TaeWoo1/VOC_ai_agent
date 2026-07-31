package com.sellerops.connector.cafe24.capability;

/**
 * One capability line in the first-connection tutorial's result screen. All four
 * values are safe to send to the browser: {@code feature}/{@code state}/{@code reason}
 * are closed vocabularies (see {@link Cafe24CapabilityEvaluator}) and {@code label} is a
 * fixed operator-facing Korean string — none of them carries a mall id, token, board
 * name, or any personal data.
 *
 * @param feature closed key: {@code ORDER_READ}, {@code INQUIRY_COLLECT},
 *                {@code REVIEW_COLLECT}, {@code ISSUE_ANALYSIS}, {@code INQUIRY_REPLY},
 *                {@code ONE_TO_ONE_EXCLUDED}
 * @param state   {@code AVAILABLE} | {@code NEEDS_ATTENTION} | {@code NOT_ENABLED}
 * @param label   fixed Korean label for the feature
 * @param reason  closed reason code when the state is not {@code AVAILABLE}; else null
 */
public record Cafe24CapabilityFeature(String feature, String state, String label, String reason) {
}
