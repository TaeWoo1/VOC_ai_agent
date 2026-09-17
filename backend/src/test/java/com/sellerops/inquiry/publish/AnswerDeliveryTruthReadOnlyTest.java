package com.sellerops.inquiry.publish;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * <b>The one seam that lets another package read delivery truth stays a read.</b>
 *
 * <p>{@link AnswerDeliveryTruthReader} exists so a responsibility case can quote what the answer lifecycle
 * observed instead of inventing a second vocabulary for «sent». That is only safe while the seam cannot do
 * anything else: a reader that grew a dispatch, an approval or a save would hand a background loop the one
 * authority this product keeps with the seller — and it would do it without changing a single caller.
 *
 * <p>Asserted on the source, because every property here is an absence.
 */
class AnswerDeliveryTruthReadOnlyTest {

    private static final Path SOURCE =
            Paths.get("src/main/java/com/sellerops/inquiry/publish/AnswerDeliveryTruthReader.java");

    private static String code() throws IOException {
        return Files.readString(SOURCE).replaceAll("(?s)/\\*.*?\\*/", "").replaceAll("(?m)//.*$", "");
    }

    @Test
    @DisplayName("it writes nothing: no save, no status change, no approval, no dispatch")
    void itOnlyReads() throws IOException {
        String code = code();
        for (String forbidden : List.of(".save(", ".delete(", ".saveAll(", "setStatus(", "setVerified(",
                "InquiryPublishService", "ChannelReplyAdapter", "InquiryApprovalRepository", "binding",
                "dispatch(", "@Transactional")) {
            assertThat(code).as("the delivery reader names %s", forbidden).doesNotContain(forbidden);
        }
    }

    @Test
    @DisplayName("it reaches no channel and no vendor of its own")
    void itTalksToNoChannel() throws IOException {
        String code = code();
        for (String forbidden : List.of("HttpClient", "HttpRequest", "RestTemplate", "WebClient",
                "com.sellerops.connector", "http://", "https://")) {
            assertThat(code).as("the delivery reader names %s", forbidden).doesNotContain(forbidden);
        }
    }

    @Test
    @DisplayName("every read is scoped to the organisation the caller named")
    void everyReadIsOrgScoped() throws IOException {
        assertThat(code())
                .as("a work item id alone would let one seller's case read another seller's delivery")
                .contains("orgId.equals(execution.getOrgId())");
    }

    @Test
    @DisplayName("what leaves is this package's own vocabulary, never a freshly minted word")
    void itQuotesRatherThanTranslates() throws IOException {
        String code = code();
        assertThat(code).contains("status.name()").contains("PublishOutcomeCategory.fromStatus(status).name()")
                .contains("latest.getObservedStatus()");
        for (String minted : List.of("\"SENT\"", "\"DELIVERED\"", "\"EXECUTED_VERIFIED\"", "\"보냈", "\"전송")) {
            assertThat(code).as("the reader mints %s instead of quoting the lifecycle", minted)
                    .doesNotContain(minted);
        }
    }
}
