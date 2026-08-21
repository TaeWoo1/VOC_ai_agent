package com.sellerops.customermemory.dto;

import java.time.LocalDate;

/**
 * One repeated customer question: the same closed-vocabulary cue asked more than once in a window.
 *
 * <p><b>Framed as a candidate, never a diagnosis</b> — the same framing {@code ReviewIssueView}
 * carries, and for the same reason: the extractor's accuracy is unmeasured, so "이 문의가 반복되고
 * 있습니다" is a signal to look at and "고객들이 X 때문에 문의합니다" is a claim with nothing behind it.
 *
 * @param axis {@code SIGNATURE} when grouped on {@code aspect:problem}, {@code TOPIC} when grouped on
 *     the analysis category. Reported rather than blended, because a signature repeat is a much
 *     sharper signal than a topic repeat and merging them would hide which one fired
 * @param key the signature or topic that repeated
 * @param labelKo the operator-facing label, derived from vocabulary only — never from a body
 * @param occurrences how many inquiries in the window carried this cue
 * @param answeredOccurrences how many of them are already answered — a repeat that is entirely
 *     answered is a documentation gap (an FAQ candidate), one that is not is a backlog
 */
public record RepeatedInquiryView(String axis, String key, String labelKo, long occurrences,
                                  long answeredOccurrences, LocalDate firstSeenOn,
                                  LocalDate lastSeenOn, int windowDays) {

    public static final String AXIS_SIGNATURE = "SIGNATURE";
    public static final String AXIS_TOPIC = "TOPIC";
}
