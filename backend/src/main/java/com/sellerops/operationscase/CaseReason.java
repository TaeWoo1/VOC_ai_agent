package com.sellerops.operationscase;

/**
 * Why a case exists, as the fact behind it — decided before any model runs.
 *
 * <p>{@link #noteKo()} is the first line a seller reads. Each sentence says what was observed and, where the rule
 * concluded something, what Reviewnary did with it; none says a customer was answered or anything was sent.
 */
public enum CaseReason {
    UNANSWERED_INQUIRY("고객이 답변을 기다리는 새 문의입니다."),
    INQUIRY_ALREADY_ANSWERED("이미 답변된 문의로 확인되어 따로 할 일이 없습니다."),
    INQUIRY_THREAD_REPLY("새 문의가 아니라 기존 문의에 달린 답글이라 따로 할 일이 없습니다."),
    INQUIRY_NOT_OPERATIONAL("판매자님이 제외한 문의라 따로 할 일이 없습니다."),
    REVIEW_NEEDS_ATTENTION("낮은 별점에 내용이 있는 새 리뷰입니다."),
    REVIEW_WATCH("지켜볼 리뷰입니다. 같은 이야기가 쌓이면 반복 문제로 모입니다."),
    REVIEW_ROUTINE("별점 4~5점 리뷰라 따로 대응할 일이 없습니다."),
    REVIEW_ALREADY_ANSWERED("이미 답글이 달린 리뷰라 따로 할 일이 없습니다."),
    SOURCE_AUTH_REQUIRED("연결이 만료되어 확인하지 못했습니다. 다시 연결해 주세요."),
    SOURCE_NOT_CONNECTED("연결이 끊겨 확인하지 못했습니다. 다시 연결해 주세요.");

    private final String noteKo;

    CaseReason(String noteKo) {
        this.noteKo = noteKo;
    }

    public String noteKo() {
        return noteKo;
    }
}
