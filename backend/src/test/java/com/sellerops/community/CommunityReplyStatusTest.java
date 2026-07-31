package com.sellerops.community;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class CommunityReplyStatusTest {

    @Test
    void mapsPendingSynonyms() {
        assertThat(CommunityReplyStatus.normalize("PENDING")).isEqualTo(CommunityReplyStatus.PENDING);
        assertThat(CommunityReplyStatus.normalize("waiting")).isEqualTo(CommunityReplyStatus.PENDING);
        assertThat(CommunityReplyStatus.normalize("Unanswered")).isEqualTo(CommunityReplyStatus.PENDING);
    }

    @Test
    void mapsCafe24NoReplyTokenNToPending() {
        // "N" (미답변) confirmed by live shape verification; case-insensitive.
        assertThat(CommunityReplyStatus.normalize("N")).isEqualTo(CommunityReplyStatus.PENDING);
        assertThat(CommunityReplyStatus.normalize("n")).isEqualTo(CommunityReplyStatus.PENDING);
    }

    @Test
    void mapsInProgressSynonyms() {
        assertThat(CommunityReplyStatus.normalize("in_progress")).isEqualTo(CommunityReplyStatus.IN_PROGRESS);
        assertThat(CommunityReplyStatus.normalize("processing")).isEqualTo(CommunityReplyStatus.IN_PROGRESS);
    }

    @Test
    void mapsCafe24InProgressTokenPToInProgress() {
        // "P" (처리중) — official Cafe24 token; case-insensitive.
        assertThat(CommunityReplyStatus.normalize("P")).isEqualTo(CommunityReplyStatus.IN_PROGRESS);
        assertThat(CommunityReplyStatus.normalize("p")).isEqualTo(CommunityReplyStatus.IN_PROGRESS);
    }

    @Test
    void mapsAnsweredSynonyms() {
        assertThat(CommunityReplyStatus.normalize("ANSWERED")).isEqualTo(CommunityReplyStatus.ANSWERED);
        assertThat(CommunityReplyStatus.normalize("complete")).isEqualTo(CommunityReplyStatus.ANSWERED);
        assertThat(CommunityReplyStatus.normalize("done")).isEqualTo(CommunityReplyStatus.ANSWERED);
    }

    @Test
    void mapsCafe24CompletedTokenCToAnswered() {
        // "C" (처리완료) — official Cafe24 token; maps to ANSWERED. Not yet live-observed
        // (synthetic tests only; every live-sampled row to date was unanswered).
        assertThat(CommunityReplyStatus.normalize("C")).isEqualTo(CommunityReplyStatus.ANSWERED);
        assertThat(CommunityReplyStatus.normalize("c")).isEqualTo(CommunityReplyStatus.ANSWERED);
    }

    @Test
    void unknownOrBlankBecomesUnknown() {
        assertThat(CommunityReplyStatus.normalize(null)).isEqualTo(CommunityReplyStatus.UNKNOWN);
        assertThat(CommunityReplyStatus.normalize("")).isEqualTo(CommunityReplyStatus.UNKNOWN);
        assertThat(CommunityReplyStatus.normalize("mystery")).isEqualTo(CommunityReplyStatus.UNKNOWN);
    }
}
