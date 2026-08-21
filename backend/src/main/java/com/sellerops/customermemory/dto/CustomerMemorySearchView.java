package com.sellerops.customermemory.dto;

import com.sellerops.product.dto.SignalCoverageView;
import java.util.List;

/**
 * The result of one recall: the precedents, the cue they were found by, and whether the index could
 * answer at all.
 *
 * <p>{@code coverage} is present for the reason it is present on a product report: an empty
 * {@code hits} list means "we have never seen this before" only when the index actually covers the
 * org's history. On an org whose reviews were collected before this index existed — or whose rows
 * carry no product link — an empty answer means "we cannot tell", and a caller that reads the two the
 * same way will confidently tell a seller something new is happening for the first time.
 *
 * @param cueSignatureKey the closed-vocabulary cue actually used, echoed so a run can be replayed
 * @param cueTopic the topic cue actually used
 */
public record CustomerMemorySearchView(String cueSignatureKey, String cueTopic,
                                       List<CustomerMemoryHitView> hits,
                                       SignalCoverageView coverage) {
}
