package com.sellerops.ingest;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.connector.esm.EsmApiConnector;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** Pure unit tests for the versioned REVIEW dedup-key policy (no DB). */
class ReviewDedupKeyTest {

    private static final UUID CH = UUID.randomUUID();
    private static final UUID PROD = UUID.randomUUID();
    private static final String DATE = "2026-02-03";
    private static final String BODY = "합성-리뷰-본문";

    @Test
    void versionForGmarketIsV2AndEverythingElseIsV1() {
        assertThat(ReviewDedupKey.versionFor(EsmApiConnector.CHANNEL_CODE)).isEqualTo(ReviewDedupKey.V2);
        assertThat(ReviewDedupKey.versionFor("GMARKET")).isEqualTo(2);
        assertThat(ReviewDedupKey.versionFor("NAVER")).isEqualTo(ReviewDedupKey.V1);
        assertThat(ReviewDedupKey.versionFor("FILE_UPLOAD")).isEqualTo(1);
        assertThat(ReviewDedupKey.versionFor(null)).isEqualTo(1);
    }

    @Test
    void v2FoldsInRatingSoDifferentRatingsGiveDifferentKeys() {
        String r5 = ReviewDedupKey.contentHash(ReviewDedupKey.V2, CH, PROD, DATE, BODY, 5);
        String r2 = ReviewDedupKey.contentHash(ReviewDedupKey.V2, CH, PROD, DATE, BODY, 2);
        assertThat(r5).isNotEqualTo(r2).hasSize(64);
    }

    @Test
    void v1IgnoresRatingSoDifferentRatingsGiveTheSameKey() {
        String r5 = ReviewDedupKey.contentHash(ReviewDedupKey.V1, CH, PROD, DATE, BODY, 5);
        String r2 = ReviewDedupKey.contentHash(ReviewDedupKey.V1, CH, PROD, DATE, BODY, 2);
        assertThat(r5).isEqualTo(r2).hasSize(64);
    }

    @Test
    void v1MatchesTheOriginalFourPartFormulaByteForByte() {
        String viaHelper = ReviewDedupKey.contentHash(ReviewDedupKey.V1, CH, PROD, DATE, BODY, 5);
        String viaPrimitive = ContentHash.of(CH.toString(), PROD.toString(), DATE, BODY);
        assertThat(viaHelper).isEqualTo(viaPrimitive); // v1 is unchanged
    }

    @Test
    void v2IsStableAcrossCallsAndHandlesNullRating() {
        String a = ReviewDedupKey.contentHash(ReviewDedupKey.V2, CH, PROD, DATE, BODY, null);
        String b = ReviewDedupKey.contentHash(ReviewDedupKey.V2, CH, PROD, DATE, BODY, null);
        assertThat(a).isEqualTo(b).hasSize(64);
        // A null rating (empty part) is distinct from a present rating.
        assertThat(a).isNotEqualTo(ReviewDedupKey.contentHash(ReviewDedupKey.V2, CH, PROD, DATE, BODY, 5));
    }
}
