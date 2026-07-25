package com.sellerops.reviewimport.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import java.util.UUID;

/**
 * The seller's decision about how much history to import: which month to start from.
 *
 * <p>Only a start month — deliberately. The end is today, resolved server-side, because that is what the seller
 * means by "가져올 기간" and because a client-supplied "today" is a plan whose last segment can be wrong. And a
 * MONTH rather than a date, because segments are calendar months: offering a day would imply a precision the
 * plan does not have, and a mid-month start would only ever be clipped to the month anyway.
 *
 * @param sellerAccountId the connected channel account this history belongs to
 * @param startMonth      `YYYY-MM`, validated for shape here and for range in the service
 */
public record SelectImportRangeRequest(
        @NotNull UUID sellerAccountId,
        @NotBlank @Pattern(regexp = "\\d{4}-\\d{2}", message = "가져오기를 시작할 달을 YYYY-MM 형식으로 선택해 주세요.")
        String startMonth) {
}
