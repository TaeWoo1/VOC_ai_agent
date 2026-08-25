package com.sellerops.connector.cafe24;

/**
 * Raised when a Cafe24 WRITE would reach a real mall without an armed live-run approval id.
 *
 * <p>Its own type rather than a generic failure so the publish core can tell "this deployment is not
 * armed" apart from "the mall refused the seller's reply". The first is ours to fix and the same
 * approved draft stays sendable; the second is the customer's answer being turned down.
 */
public class Cafe24WriteApprovalRequired extends IllegalStateException {

    public Cafe24WriteApprovalRequired() {
        super("카페24 쓰기에는 승인된 라이브 실행 ID가 필요합니다.");
    }
}
