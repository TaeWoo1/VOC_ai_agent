package com.sellerops.attention.source;

import com.sellerops.attention.dto.OperatorVocItem;
import java.util.List;

/**
 * One page of the 제외한 작업 recovery list, as read from one source.
 *
 * <p>{@code items} are reviews the operator has currently set aside (most-recently set aside first);
 * {@code hasMore} says a further page exists, so the caller can offer "더 보기" rather than hide older
 * set-aside items behind a hard cap. An empty page with {@code hasMore=false} on a COVERED scope is an
 * honest "nothing is set aside"; the caller still pairs it with the coverage verdict so an empty list
 * under an unattributable scope never reads as an answer.
 */
public record DismissedReplyWorkSlice(List<OperatorVocItem> items, boolean hasMore) {

    private static final DismissedReplyWorkSlice EMPTY = new DismissedReplyWorkSlice(List.of(), false);

    public static DismissedReplyWorkSlice empty() {
        return EMPTY;
    }
}
