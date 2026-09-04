package com.sellerops.report;

/**
 * What happened to the narrative when the snapshot was taken. Stored, so a reopened report explains
 * itself without re-asking the capability.
 */
public enum NarrativeStatus {
    /** The model wrote lines and at least one survived {@link NarrativeClaimGuard}. */
    READY(null),
    /** The capability is off for this org — the deterministic summary is the whole reading. */
    UNAVAILABLE("AI 요약 기능이 이 계정에서 꺼져 있어, 정리된 사실만 보여 드립니다."),
    /** The call failed, or nothing the model wrote could be traced to a fact. */
    FAILED("AI 요약을 만들지 못해, 정리된 사실만 보여 드립니다.");

    private final String noteKo;

    NarrativeStatus(String noteKo) {
        this.noteKo = noteKo;
    }

    /** The one sentence the screen prints beside a report without a narrative, or null. */
    public String noteKo() {
        return noteKo;
    }
}
