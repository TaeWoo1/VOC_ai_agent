package com.sellerops.reviewissue.dto;

import java.util.UUID;

/**
 * The result of recording issue feedback.
 *
 * <p>{@code replayed} distinguishes "this command had already been applied; nothing was written"
 * from a fresh write — both are 200, because a replay is a success. A command id reused for a
 * DIFFERENT issue/kind is the conflict, and it never reaches this record (it is a 409).
 *
 * <p>Carries no lifecycle or queue effect, because there is none — this is offline evaluation data.
 */
public record ReviewIssueFeedbackResponse(UUID issueId, String kind, boolean replayed) {
}
