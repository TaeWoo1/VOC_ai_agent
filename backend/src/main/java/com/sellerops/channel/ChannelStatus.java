package com.sellerops.channel;

/** Connection state of a commerce channel for the current org. */
public enum ChannelStatus {
    CONNECTED,
    AVAILABLE,
    FILE_UPLOAD_SUPPORTED,
    PREPARING,
    REQUEST_AVAILABLE;

    /** Korean action-button label shown on the channel card. */
    public String actionLabel() {
        return switch (this) {
            case CONNECTED -> "관리";
            case AVAILABLE -> "연결하기";
            case FILE_UPLOAD_SUPPORTED -> "파일 업로드";
            case PREPARING -> "준비 중";
            case REQUEST_AVAILABLE -> "요청하기";
        };
    }
}
