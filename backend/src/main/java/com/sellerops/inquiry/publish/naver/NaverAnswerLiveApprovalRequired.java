package com.sellerops.inquiry.publish.naver;

/** A live NAVER answer was attempted with no armed live-run approval id. Nothing was sent. */
public class NaverAnswerLiveApprovalRequired extends RuntimeException {

    public NaverAnswerLiveApprovalRequired() {
        super("승인된 라이브 실행 ID 없이는 네이버 답변을 등록할 수 없습니다.");
    }
}
