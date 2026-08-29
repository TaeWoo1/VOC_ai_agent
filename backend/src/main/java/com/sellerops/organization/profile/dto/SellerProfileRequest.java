package com.sellerops.organization.profile.dto;

/**
 * What the 회사 정보 screen sends. One field; an empty or blank value clears the summary — a PUT that
 * merged would make 「소개를 지웠다」 unrepresentable.
 */
public record SellerProfileRequest(String businessSummary) {
}
