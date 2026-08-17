package com.sellerops.review.triage;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.review.triage.ReviewTriageChannelCapability.OriginalLocate;
import com.sellerops.review.triage.feedback.TriageActionKind;
import com.sellerops.review.triage.feedback.TriageBehaviorKind;
import com.sellerops.review.triage.feedback.TriageEventKind;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The three rows of {@code contracts/review-triage-events/v1/CONTRACT.md} §1, pinned — and the
 * contract file itself, so the table in code and the table in prose cannot drift apart silently.
 */
class ReviewTriageChannelCapabilityTest {

    @Test
    @DisplayName("exactly three channels are inside the contract, with exactly these columns")
    void theTable() {
        assertThat(ReviewTriageChannelCapability.of("NAVER"))
                .isEqualTo(new ReviewTriageChannelCapability("NAVER", true, OriginalLocate.NONE, true));
        assertThat(ReviewTriageChannelCapability.of("CAFE24"))
                .isEqualTo(new ReviewTriageChannelCapability("CAFE24", true, OriginalLocate.NONE, false));
        assertThat(ReviewTriageChannelCapability.of("COUPANG"))
                .isEqualTo(new ReviewTriageChannelCapability("COUPANG", true, OriginalLocate.LOCATE_RUN, false));

        for (String outside : java.util.Arrays.asList("GMARKET", "AUCTION", "ELEVENST", "SSG", "naver", "", null)) {
            ReviewTriageChannelCapability c = ReviewTriageChannelCapability.of(outside);
            assertThat(c.inContract()).as("%s", outside).isFalse();
            assertThat(c.aiTriage()).isFalse();
            assertThat(c.replySupported()).isFalse();
            assertThat(c.originalLocate()).isEqualTo(OriginalLocate.NONE);
            for (TriageBehaviorKind k : TriageBehaviorKind.values()) {
                assertThat(c.permits(k)).as("%s %s", outside, k).isFalse();
            }
            for (TriageActionKind k : TriageActionKind.values()) {
                assertThat(c.permits(k)).as("%s %s", outside, k).isFalse();
            }
        }
    }

    @Test
    @DisplayName("Coupang can never produce a reply event, and only Coupang can produce a locate event")
    void coupangHasNoReplyAndOnlyCoupangLocates() {
        ReviewTriageChannelCapability coupang = ReviewTriageChannelCapability.COUPANG;
        assertThat(coupang.permits(TriageActionKind.REPLY_DRAFTED)).isFalse();
        assertThat(coupang.permits(TriageActionKind.REPLY_SUBMITTED)).isFalse();
        assertThat(coupang.permits(TriageBehaviorKind.ORIGINAL_OPENED)).isTrue();
        assertThat(coupang.permits(TriageBehaviorKind.MARKETPLACE_LOCATED)).isTrue();

        for (ReviewTriageChannelCapability c : List.of(ReviewTriageChannelCapability.NAVER, ReviewTriageChannelCapability.CAFE24)) {
            assertThat(c.permits(TriageBehaviorKind.ORIGINAL_OPENED)).as(c.channelCode()).isFalse();
            assertThat(c.permits(TriageBehaviorKind.MARKETPLACE_LOCATED)).as(c.channelCode()).isFalse();
            assertThat(c.permits(TriageBehaviorKind.AI_ATTENTION_SHOWN)).isTrue();
            assertThat(c.permits(TriageBehaviorKind.REVIEW_OPENED)).isTrue();
            assertThat(c.permits(TriageActionKind.ACTION_COMPLETED)).isTrue();
        }
        assertThat(ReviewTriageChannelCapability.NAVER.permits(TriageActionKind.REPLY_DRAFTED)).isTrue();
        assertThat(ReviewTriageChannelCapability.CAFE24.permits(TriageActionKind.REPLY_DRAFTED)).isFalse();
    }

    @Test
    @DisplayName("the event vocabulary is the contract's, and has no IGNORED")
    void theVocabularyIsTheContracts() throws Exception {
        String contract = Files.readString(Path.of("..", "contracts", "review-triage-events", "v1", "CONTRACT.md"));
        for (TriageEventKind k : TriageEventKind.values()) {
            assertThat(contract).as("contract names %s", k).contains("`" + k.name() + "`");
        }
        for (TriageBehaviorKind k : TriageBehaviorKind.values()) {
            assertThat(TriageEventKind.of(k).name()).isEqualTo(k.name());
        }
        for (TriageActionKind k : TriageActionKind.values()) {
            assertThat(TriageEventKind.of(k).name()).isEqualTo(k.name());
        }
        assertThat(TriageEventKind.values()).extracting(Enum::name)
                .noneMatch(n -> n.contains("IGNOR") || n.contains("SKIP") || n.contains("DISMISS") || n.contains("ABSENT"));
        // The three channels named in the contract's table, and stated once in code.
        for (String code : List.of("`NAVER`", "`CAFE24`", "`COUPANG`")) {
            assertThat(contract).contains(code);
        }
    }
}
