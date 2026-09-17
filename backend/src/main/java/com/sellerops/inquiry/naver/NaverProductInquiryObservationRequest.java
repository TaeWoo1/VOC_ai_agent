package com.sellerops.inquiry.naver;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import java.util.List;

/**
 * <b>What an unattended NAVER 상품 문의 read may hand back: the rows of the newest page, the page's own size and total,
 * and the period it was drawn over — nothing about who asked.</b>
 *
 * <p>The Seller Center row object carries the buyer's masked id, member number and an audit block with the writer's
 * IP beside every inquiry. None has a field here, and unknown properties are refused rather than ignored, so a helper
 * that sent one would be told so instead of quietly succeeding.
 *
 * @param pageSize    rows per page as the screen's own pager states it
 * @param totalCount  inquiries in the screen's period as the screen's own pager states it
 * @param windowStart the period's first day, {@code yyyy-MM-dd}, as the screen's search form holds it
 * @param windowEnd   the period's last day, {@code yyyy-MM-dd}
 */
@JsonIgnoreProperties(ignoreUnknown = false)
public record NaverProductInquiryObservationRequest(List<Inquiry> inquiries, Integer pageSize, Integer totalCount,
                                                    String windowStart, String windowEnd) {

    /**
     * One inquiry as the list's view model held it.
     *
     * @param questionId       the row's own id — the Commerce API's {@code questionId}
     * @param createdAt        the registration instant (ISO-8601 with offset)
     * @param answered         the page's own «seller answered» flag; never inferred
     * @param secret           the page's own 비밀글 flag. Carried as a reading and counted; not stored — the official API
     *                         publishes no such field, and a column the two acquisition paths set differently would make
     *                         each of them «change» the row the other one wrote
     * @param channelProductNo the 채널상품번호 the row's product link opens
     */
    @JsonIgnoreProperties(ignoreUnknown = false)
    public record Inquiry(String questionId, String createdAt, String body, Boolean answered, Boolean secret,
                          String channelProductNo) {
    }
}
