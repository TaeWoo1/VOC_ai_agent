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
    void mapsInProgressSynonyms() {
        assertThat(CommunityReplyStatus.normalize("in_progress")).isEqualTo(CommunityReplyStatus.IN_PROGRESS);
        assertThat(CommunityReplyStatus.normalize("processing")).isEqualTo(CommunityReplyStatus.IN_PROGRESS);
    }

    @Test
    void mapsAnsweredSynonyms() {
        assertThat(CommunityReplyStatus.normalize("ANSWERED")).isEqualTo(CommunityReplyStatus.ANSWERED);
        assertThat(CommunityReplyStatus.normalize("complete")).isEqualTo(CommunityReplyStatus.ANSWERED);
        assertThat(CommunityReplyStatus.normalize("done")).isEqualTo(CommunityReplyStatus.ANSWERED);
    }

    @Test
    void unknownOrBlankBecomesUnknown() {
        assertThat(CommunityReplyStatus.normalize(null)).isEqualTo(CommunityReplyStatus.UNKNOWN);
        assertThat(CommunityReplyStatus.normalize("")).isEqualTo(CommunityReplyStatus.UNKNOWN);
        assertThat(CommunityReplyStatus.normalize("mystery")).isEqualTo(CommunityReplyStatus.UNKNOWN);
    }
}
