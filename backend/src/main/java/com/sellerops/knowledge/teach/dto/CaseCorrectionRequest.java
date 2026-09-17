package com.sellerops.knowledge.teach.dto;

import jakarta.validation.constraints.Size;

/**
 * The seller saying a different action is right for this case. {@code correctedActionType} is one of the closed
 * recommendation tokens; {@code note} is their own sentence. {@code remember} is 「다음에도 참고」.
 */
public record CaseCorrectionRequest(String correctedActionType, @Size(max = 2000) String note, boolean remember,
                                    String scope) {
}
