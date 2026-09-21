package com.sellerops.operationscase;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * <b>One queue over both kinds — and the briefing is its first five rows, not a second answer.</b>
 *
 * <p>Before this, 「내 결정 필요」 was computed once, cut to five, and everything past the cut was described to the
 * seller as living on 「문의·리뷰 화면」 — the split a case-centred queue exists to remove. The rest of that list is
 * the rest of that list.
 *
 * <p>What these assertions hold is not the number five. It is that the briefing and the queue read the same
 * population, in the same order, through the same row mapping: two pipelines over one table would eventually rank
 * differently, filter differently, or word a case differently, and then the list the seller is briefed with and the
 * list they work through would be about different mornings.
 */
class CustomerOperationsQueueTest {

    private static final Path SERVICE =
            Paths.get("src/main/java/com/sellerops/operationscase/CustomerOperationsHomeService.java");
    private static final Path CONTROLLER =
            Paths.get("src/main/java/com/sellerops/operationscase/CustomerOperationsHomeController.java");
    private static final Path EXCEPTIONS =
            Paths.get("../frontend/src/components/customerOperations/CustomerOperationsExceptions.tsx");

    private static String code(Path path) throws IOException {
        return Files.readString(path).replaceAll("(?s)/\\*.*?\\*/", "").replaceAll("(?m)//.*$", "");
    }

    private static int count(String haystack, String needle) {
        int n = 0;
        for (int i = haystack.indexOf(needle); i >= 0; i = haystack.indexOf(needle, i + needle.length())) {
            n++;
        }
        return n;
    }

    @Test
    @DisplayName("the waiting population is selected in exactly one place")
    void oneSelection() throws IOException {
        String service = code(SERVICE);

        assertThat(count(service, "waiting(orgId"))
                .as("the briefing and the queue both reach the population through the same method, and nothing else "
                        + "selects it")
                .isEqualTo(2);
        assertThat(count(service, "this::stillWaitingOnCanonicalRecord"))
                .as("the canonical-record filter that decides what is still waiting is written once")
                .isEqualTo(1);
        assertThat(count(service, "CasePriority.HIGH ? 0 : 1"))
                .as("a second copy of the order is a second answer to 「무엇부터 보시겠습니까」")
                .isEqualTo(1);
    }

    @Test
    @DisplayName("a case is turned into a row in exactly one place, and only the briefing cuts to five")
    void oneRowMapping() throws IOException {
        String service = code(SERVICE);

        assertThat(count(service, "new CustomerOperationsHomeView.DecisionRow("))
                .as("one mapping: a case must read the same way in both lists")
                .isEqualTo(1);
        assertThat(count(service, "rowsOf(waiting"))
                .as("the briefing and the queue differ by their size argument and nothing else")
                .isEqualTo(2);
        assertThat(service)
                .as("the briefing takes the five-row cut; the queue takes what was asked for")
                .contains("rowsOf(waiting, MAX_ROWS, channelById)")
                .contains("rowsOf(waiting, size, channelById)");
    }

    @Test
    @DisplayName("the queue read is still read-only, and still says which cases it counted")
    void readOnlyAndHonestAboutDepth() throws IOException {
        String service = code(SERVICE);
        String controller = code(CONTROLLER);

        assertThat(controller)
                .as("a case's status belongs to the reconciler; this controller has never had a write")
                .doesNotContain("@PostMapping").doesNotContain("@PutMapping").doesNotContain("@DeleteMapping")
                .doesNotContain("@PatchMapping");
        assertThat(controller)
                .as("the caller cannot ask for an unbounded page")
                .contains("MAX_QUEUE_ROWS");
        assertThat(service)
                .as("total and rows are counted over the same read, so a shortfall means depth, not absence")
                .contains("new CustomerOperationsHomeView.Decisions(waiting.size(), rowsOf(waiting");
        assertThat(service)
                .as("read-only: this service never writes a case")
                .doesNotContain(".setStatus(");
    }

    @Test
    @DisplayName("the overflow no longer sends the seller back to two screens")
    void theRestOfTheListIsTheRestOfTheList() throws IOException {
        String exceptions = code(EXCEPTIONS);

        assertThat(exceptions)
                .as("the rest of 「내 결정 필요」 opens the queue, not 문의 and 리뷰 separately")
                .contains("/customer-operations/cases")
                .doesNotContain("문의·리뷰 화면에 있습니다");
    }
}
