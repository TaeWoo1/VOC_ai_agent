package com.sellerops.channel;

/** Connection state of a commerce channel for the current org. */
public enum ChannelStatus {
    CONNECTED,
    AVAILABLE,
    FILE_UPLOAD_SUPPORTED,
    PREPARING,
    REQUEST_AVAILABLE,
    /** API onboarding started, awaiting the seller's browser login/consent. */
    PENDING,
    /** A prior connection needs the seller to re-authorize (expired/failed consent). */
    RECONNECT_REQUIRED;

    /** Korean action-button label shown on the channel card. */
    public String actionLabel() {
        return switch (this) {
            case CONNECTED -> "관리";
            case AVAILABLE -> "연결하기";
            case FILE_UPLOAD_SUPPORTED -> "파일 업로드";
            case PREPARING -> "준비 중";
            case REQUEST_AVAILABLE -> "요청하기";
            case PENDING -> "연결 중";
            case RECONNECT_REQUIRED -> "재연결 필요";
        };
    }
}
