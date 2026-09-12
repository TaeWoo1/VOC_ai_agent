package com.sellerops.producttruth;

/**
 * One precondition an execution path has, stated as data rather than buried in prose.
 *
 * <p>Why structured: "카페24 문의 답변은 판매자 승인 후 직접 등록합니다" and "그러려면 쓰기 권한
 * 동의와 배포 설정과 유효한 승인이 있어야 합니다" are two different facts, and flattening the second
 * into the first is how a capability row starts reading like a deployment posture. Keeping them apart
 * lets a runtime overlay answer "which of these is satisfied here" without the capability moving.
 */
public record ProductExecutionRequirement(
        ProductRequirementKind kind,
        /** Seller-facing. Names what the seller (or the operator) can act on, not a config key. */
        String description) {
}
