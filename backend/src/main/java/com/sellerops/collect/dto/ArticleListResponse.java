package com.sellerops.collect.dto;

import java.util.List;

/**
 * One page of the collected-article drill-down: the metadata-only rows plus the
 * paging coordinates the UI needs to render "더 보기" / page navigation. {@code total}
 * is the full count for the (account, type) so the UI can show "N건 중".
 */
public record ArticleListResponse(
        String type,
        int page,
        int size,
        long total,
        List<CommunityArticleView> items) {
}
